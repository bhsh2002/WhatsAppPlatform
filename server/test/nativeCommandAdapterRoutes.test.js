import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { createNativeCommandAdapterRouter } from '../routes/nativeCommandAdapter.js';
import { NativeCommandProtocol, nativeCommandJson } from '../services/nativeCommandProtocol.js';
import { CollaborativeExecutionError } from '../services/collaborativeExecution.js';

const NOW = Date.parse('2026-11-18T15:00:00Z');
const PREFIX = '/savana/command-adapter/v1';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity' };
const delegation = { grant_approved_by: 'synthetic-owner', native_authority_revision: 'synthetic-owned-revision',
    capability_grant_revision: 3, allowed_fields: ['message'], resource_policy: 'selected', resource_refs: ['synthetic-contact'],
    scope_epochs: [{ scope, ownership_epoch: 2 }] };
const context = () => ({ ...scope, actor_id: 'synthetic-reviewer', external_tenant_id: 'wa_savana:tenant:1',
    session_version: 4, authorization_revision: 'synthetic-current-authorization', ...structuredClone(delegation) });
const ownerContext = () => ({ ...context(), branch_id: 'synthetic-branch', warehouse_id: 'synthetic-warehouse' });
const validationContext = () => { const { session_version: _sessionVersion, ...value } = context(); return value; };
const resultContext = () => { const { session_version: _sessionVersion, scope_epochs: _scopeEpochs, ...value } = context(); return value; };
const command = () => ({ command_id: 'synthetic-command', version: 2, fingerprint: 'a'.repeat(64), attempt_id: 'synthetic-attempt',
    capability: 'messaging.send', action: 'message.send', scope, actor_id: 'synthetic-reviewer',
    provider_ref: 'synthetic-provider', provider_installation_id: 'synthetic-installation', external_tenant_id: 'wa_savana:tenant:1',
    authorization_revision: 'synthetic-current-authorization', ...structuredClone(delegation),
    validation_revision: 'synthetic-preview', validation_valid_until: new Date(NOW + 30_000).toISOString(),
    payload: { payload_type: 'native_action', parameters: { channel: 'sms', message: 'رسالة اختبار غير مرسلة' } } });
const receipt = () => ({ command_id: command().command_id, version: command().version,
    fingerprint: command().fingerprint, outcome: 'unknown', source_result: null });
const query = value => {
    const params = new URLSearchParams(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? nativeCommandJson(item) : String(item)]));
    params.sort(); return params.toString();
};

const fixture = async (t, { publicPrefix = '', captureRaw = true } = {}) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-native-route-'));
    const filename = path.join(directory, 'owned.sqlite');
    let database = new Database(filename);
    database.exec(`CREATE TABLE tenants(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY);
        CREATE TABLE savana_service_requests(id INTEGER PRIMARY KEY);
        CREATE TABLE facebook_content_publications(id INTEGER PRIMARY KEY); CREATE TABLE broadcast_jobs(id INTEGER PRIMARY KEY);`);
    database.exec(fs.readFileSync(new URL('../db/migrations/061_collaborative_execution.sql', import.meta.url), 'utf8'));
    const token = crypto.randomBytes(32).toString('hex'); const calls = [];
    const publicKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
    const enrollment = { platform: 'wa_savana', organization_id: scope.organization_id, external_tenant_id: 'wa_savana:tenant:1',
        display_name: 'حساب اختبار مملوك', public_key_pem: publicKey, accepted_scopes: ['savana.collaboration.v1'] };
    let failure = null; let invalidResult = false; let server; let base;
    const record = (kind, args) => { calls.push({ kind, args: structuredClone(args) }); if (failure) throw failure; };
    const start = async () => {
        const protocol = new NativeCommandProtocol({ database, callbackToken: token, now: () => NOW, signaturePathPrefix: publicPrefix });
        const app = express();
        app.use(express.json({ verify: captureRaw ? (req, _res, bytes) => { req.rawBody = Buffer.from(bytes); } : undefined }));
        app.use(PREFIX, createNativeCommandAdapterRouter({ protocol,
            discovery: c => { record('discovery', [c]); return { platform: 'wa_savana', providers: [] }; },
            enrollments: {
                read: (...args) => { record('enrollments.read', args); return { platform: 'wa_savana', enrollments: [enrollment] }; },
                enroll: (...args) => { record('enrollments.enroll', args); return enrollment; },
            },
            products: (c, options) => { record('products', [c, options]); return { platform: 'wa_savana', organization_id: scope.organization_id,
                external_tenant_id: 'wa_savana:tenant:1', products: [], next_cursor: null }; },
            service: {
                execute: (value, c) => { record('execute', [value, c]); return invalidResult ? { ...receipt(), secret: 'must-never-return' } : receipt(); },
                reconcile: (value, c) => { record('reconcile', [value, c]); return receipt(); },
                validate: (value, c) => { record('validate', [value, c]); return { capability: value.capability, action: value.action,
                    valid: false, validation_revision: 'synthetic-actual-validator-rejection', valid_until: new Date(NOW + 5000).toISOString(), allowed_fields: [] }; },
                result: (id, c, options) => { record('result', [id, c, options]); return { command_id: id, version: 2, fingerprint: command().fingerprint,
                    provider_ref: command().provider_ref, scope, format: 'json', content_type: 'application/json',
                    content_sha256: sha('{}'), generated_at: new Date(NOW).toISOString(), data: {} }; },
            } }));
        server = await new Promise((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
        base = `http://127.0.0.1:${server.address().port}`;
    };
    const closeListener = async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; } };
    t.after(async () => { await closeListener(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    await start();
    const signed = ({ method = 'POST', route = '/commands', body = { ...command(), context: context() }, nonce = crypto.randomBytes(16).toString('hex') } = {}) => {
        const raw = Buffer.isBuffer(body) ? body : body === null ? Buffer.alloc(0) : Buffer.from(nativeCommandJson(body));
        const wirePath = publicPrefix + PREFIX + route; const timestamp = String(NOW / 1000);
        return { method, route, raw, wirePath, headers: { 'Content-Type': 'application/json', 'X-Savana-Callback-Token': token,
            'X-Savana-Command-Timestamp': timestamp, 'X-Savana-Command-Nonce': nonce,
            'X-Savana-Command-Signature': `v1=${crypto.createHmac('sha256', token).update([
                'savana-command-request-v1', method, wirePath, timestamp, nonce, sha(raw),
            ].join('\n')).digest('hex')}` } };
    };
    const send = async request => {
        const response = await fetch(base + PREFIX + request.route, { method: request.method, headers: request.headers,
            body: request.method === 'GET' ? undefined : request.raw, redirect: 'error' });
        const bytes = Buffer.from(await response.arrayBuffer());
        return { response, bytes, value: JSON.parse(bytes.toString()) };
    };
    const verify = (request, result) => {
        const timestamp = result.response.headers.get('x-savana-command-timestamp');
        const signature = `v1=${crypto.createHmac('sha256', token).update([
            'savana-command-response-v1', request.method, request.wirePath, timestamp,
            request.headers['X-Savana-Command-Nonce'], sha(request.raw), String(result.response.status), sha(result.bytes),
        ].join('\n')).digest('hex')}`;
        assert.equal(result.response.headers.get('x-savana-command-signature'), signature);
        assert.equal(result.response.headers.get('x-savana-command-nonce'), request.headers['X-Savana-Command-Nonce']);
        assert.equal(result.response.headers.get('cache-control'), 'no-store');
    };
    return { calls, signed, send, verify, database: () => database, base: () => base,
        fail: error => { failure = error; }, invalidResult: () => { invalidResult = true; },
        restart: async () => { await closeListener(); database.close(); database = new Database(filename); await start(); } };
};

test('actual signed POST preserves flat command plus context and separately forwards business payload to execute/reconcile', async t => {
    const f = await fixture(t);
    for (const route of ['/commands', '/commands/synthetic-command/reconcile']) {
        const request = f.signed({ route }); const result = await f.send(request);
        assert.equal(result.response.status, 200); f.verify(request, result); assert.deepEqual(result.value, receipt());
    }
    assert.deepEqual(f.calls.map(row => row.kind), ['execute', 'reconcile']);
    for (const row of f.calls) assert.deepEqual(row.args, [command(), context()]);
    const nested = f.signed({ body: { payload: command(), context: context() } });
    const rejected = await f.send(nested); assert.equal(rejected.response.status, 422); f.verify(nested, rejected);
    assert.equal(f.calls.length, 2);
});

test('actual GET uses empty bytes and exact sorted scalar query with parsed delegation arrays and typed versions', async t => {
    const f = await fixture(t); const c = context();
    const request = f.signed({ method: 'GET', route: '/discovery?' + query(c), body: null });
    const result = await f.send(request); assert.equal(result.response.status, 200); f.verify(request, result);
    assert.deepEqual(f.calls[0], { kind: 'discovery', args: [c] });
    const products = f.signed({ method: 'GET', route: '/products?' + query({ ...c, q: 'منتج تجريبي', cursor: 'synthetic-cursor' }), body: null });
    const productsResult = await f.send(products); assert.equal(productsResult.response.status, 200); f.verify(products, productsResult);
    assert.deepEqual(f.calls[1], { kind: 'products', args: [c, { q: 'منتج تجريبي', cursor: 'synthetic-cursor' }] });
});

test('tampered exact body/path and durable replay after actual listener/SQLite reopen never reach the service twice', async t => {
    const f = await fixture(t);
    const body = f.signed(); body.raw = Buffer.concat([body.raw, Buffer.from(' ')]);
    assert.equal((await f.send(body)).response.status, 403);
    const wrongPath = f.signed(); wrongPath.route += '?extra=changed';
    assert.equal((await f.send(wrongPath)).response.status, 403);
    assert.equal(f.calls.length, 0); assert.equal(f.database().prepare('SELECT COUNT(*) n FROM savana_collaborative_nonces').get().n, 0);
    const original = f.signed(); assert.equal((await f.send(original)).response.status, 200);
    await f.restart();
    const replay = await f.send(original); assert.equal(replay.response.status, 403);
    assert.equal(replay.value.error.code, 'native_command_nonce_replayed'); assert.equal(f.calls.length, 1);
});

test('operator public path prefix is HMAC bound and a forwarded-prefix header supplies no authority', async t => {
    const f = await fixture(t, { publicPrefix: '/api' });
    const request = f.signed({ method: 'GET', route: '/discovery?' + query(context()), body: null });
    request.headers['X-Forwarded-Prefix'] = '/untrusted';
    const result = await f.send(request); assert.equal(result.response.status, 200); f.verify(request, result);
    const withoutPrefix = f.signed({ method: 'GET', route: '/discovery?' + query(context()), body: null });
    const material = ['savana-command-request-v1', 'GET', withoutPrefix.wirePath.slice(4),
        withoutPrefix.headers['X-Savana-Command-Timestamp'], withoutPrefix.headers['X-Savana-Command-Nonce'], sha(withoutPrefix.raw)];
    // A signature from the unprefixed profile must fail in this configured profile.
    withoutPrefix.headers['X-Savana-Command-Signature'] = 'v1=' + crypto.createHmac('sha256', withoutPrefix.headers['X-Savana-Callback-Token']).update(material.join('\n')).digest('hex');
    withoutPrefix.headers['X-Forwarded-Prefix'] = '/api';
    assert.equal((await f.send(withoutPrefix)).response.status, 403); assert.equal(f.calls.length, 1);
});

test('known service errors, unexpected errors and invalid public DTOs produce correlated signed fixed errors without private fields', async t => {
    const f = await fixture(t);
    for (const error of [new CollaborativeExecutionError('synthetic_current_scope_withdrawn', 409), new Error('synthetic-private-provider-detail')]) {
        f.fail(error); const request = f.signed(); const result = await f.send(request); f.verify(request, result);
        assert.equal(result.response.status, error instanceof CollaborativeExecutionError ? 409 : 503);
        assert.equal(result.bytes.includes(Buffer.from('synthetic-private-provider-detail')), false);
        assert.equal(result.value.error.code, error instanceof CollaborativeExecutionError ? error.code : 'native_command_unavailable');
    }
    f.fail(null); f.invalidResult(); const request = f.signed(); const result = await f.send(request);
    assert.equal(result.response.status, 422); f.verify(request, result);
    assert.equal(result.bytes.includes(Buffer.from('must-never-return')), false);
});

test('result lookup forwards exact version/fingerprint/provider selectors separately from verified context', async t => {
    const f = await fixture(t);
    const request = f.signed({ method: 'GET', body: null, route: '/commands/synthetic-command/result?' + query({ ...resultContext(),
        version: 2, fingerprint: command().fingerprint, provider_ref: command().provider_ref, format: 'json' }) });
    const result = await f.send(request); assert.equal(result.response.status, 200); f.verify(request, result);
    assert.deepEqual(f.calls[0], { kind: 'result', args: ['synthetic-command', resultContext(),
        { version: '2', fingerprint: command().fingerprint, providerRef: command().provider_ref, format: 'json' }] });
    for (const extra of [{ session_version: 4 }, { scope_epochs: delegation.scope_epochs },
        { consumer_authorization_revision: 'internal-generation' }, { branch_id: 'internal-branch' }, { warehouse_id: 'internal-warehouse' }]) {
        const invalid = f.signed({ method: 'GET', body: null, route: '/commands/synthetic-command/result?' + query({ ...resultContext(),
            version: 2, fingerprint: command().fingerprint, provider_ref: command().provider_ref, format: 'json', ...extra }) });
        const rejected = await f.send(invalid); assert.equal(rejected.response.status, 422); f.verify(invalid, rejected);
    }
    assert.equal(f.calls.length, 1);
});

test('V2 enrollment preserves authenticated owner scope/delegation context without provider or Core-internal selectors', async t => {
    const f = await fixture(t); const owner = ownerContext();
    for (const request of [f.signed({ method: 'GET', body: null, route: '/enrollments?' + query(owner) }),
        f.signed({ route: '/enrollments', body: { context: owner } })]) {
        const result = await f.send(request); assert.equal(result.response.status, 200); f.verify(request, result);
    }
    assert.deepEqual(f.calls, [{ kind: 'enrollments.read', args: [owner] }, { kind: 'enrollments.enroll', args: [owner] }]);
    for (const request of [f.signed({ route: '/enrollments', body: { context: owner, provider_ref: 'synthetic-provider' } }),
        f.signed({ route: '/enrollments', body: { context: { ...owner, provider_ref: 'synthetic-provider' } } }),
        f.signed({ route: '/enrollments', body: { context: { ...owner, consumer_authorization_revision: 'internal-generation' } } }),
        f.signed({ method: 'GET', body: null, route: '/enrollments?' + query({ ...owner, consumer_authorization_revision: 'internal-generation' }) }),
        f.signed({ method: 'GET', body: null, route: '/enrollments?' + query({ ...owner, provider_ref: 'synthetic-provider' }) })]) {
        const result = await f.send(request); assert.equal(result.response.status, 422); f.verify(request, result);
    }
    assert.equal(f.calls.length, 2);
});

test('V2 validation forwards the closed authorization context and rejects internal session/provider fields before validation', async t => {
    const f = await fixture(t); const { capability, action, payload } = command(); const proposal = { capability, action, payload };
    const request = f.signed({ route: '/commands/validate', body: { ...proposal, context: validationContext() } });
    const result = await f.send(request); assert.equal(result.response.status, 200); f.verify(request, result);
    assert.deepEqual(f.calls, [{ kind: 'validate', args: [proposal, validationContext()] }]);
    const missingRevision = validationContext(); delete missingRevision.authorization_revision;
    for (const c of [missingRevision, { ...validationContext(), session_version: 4 },
        { ...validationContext(), provider_ref: 'synthetic-provider' },
        { ...validationContext(), consumer_authorization_revision: 'internal-generation' }]) {
        const invalid = f.signed({ route: '/commands/validate', body: { ...proposal, context: c } });
        const rejected = await f.send(invalid); assert.equal(rejected.response.status, 422); f.verify(invalid, rejected);
    }
    assert.equal(f.calls.length, 1);
});

test('unsupported query structures, contradictory reconcile ID and POST query additions reject before service with signed errors', async t => {
    const f = await fixture(t);
    const requests = [f.signed({ method: 'GET', body: null, route: '/discovery?actor_id=one&actor_id=two' }),
        f.signed({ method: 'GET', body: null, route: '/discovery?session_version=1.5' }),
        f.signed({ method: 'GET', body: null, route: '/discovery?allowed_fields=%7B%7D' }),
        f.signed({ route: '/commands/contradictory-command/reconcile' }), f.signed({ route: '/commands?unexpected=1' }),
        f.signed({ body: { ...command(), context: { ...context(), actor_role: 'owner' } } })];
    for (const request of requests) { const result = await f.send(request); assert.equal(result.response.status, 422); f.verify(request, result); }
    assert.equal(f.calls.length, 0);
});

test('missing exact raw-body capture and a signed GET carrying body bytes reject before authentication or native service', async t => {
    const missing = await fixture(t, { captureRaw: false });
    assert.equal((await missing.send(missing.signed())).response.status, 422); assert.equal(missing.calls.length, 0);
    const f = await fixture(t); const request = f.signed({ method: 'GET', route: '/discovery', body: {} });
    const result = await new Promise((resolve, reject) => {
        const connection = http.request(f.base() + PREFIX + request.route, { method: 'GET', headers: { ...request.headers, 'Content-Length': request.raw.length } }, response => {
            const chunks = []; response.on('data', bytes => chunks.push(bytes)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
        });
        connection.on('error', reject); connection.end(request.raw);
    });
    assert.equal(result.status, 422); assert.equal(result.headers['x-savana-command-signature'], undefined);
    assert.equal(f.calls.length, 0); assert.equal(f.database().prepare('SELECT COUNT(*) n FROM savana_collaborative_nonces').get().n, 0);
});
