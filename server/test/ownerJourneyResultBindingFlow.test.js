import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { WorkspaceCoreTransport } from '../services/workspaceCoreTransport.js';
import { createOwnerJourneyResultBindingCapture } from '../test-support/ownerJourneyResultBindingCapture.js';
import { matchOwnerJourneyResultBinding, OWNER_JOURNEY_RESULT_BINDING_HEADER } from '../test-support/ownerJourneyResultBinding.js';
import { createOwnerJourneyResultDelivery } from '../test-support/ownerJourneyResultDelivery.js';
import { createOwnerJourneyConsumerEvidence } from '../test-support/ownerJourneyConsumerEvidence.js';
import { ownerJourneyDiagnosticEnvelope } from '../test-support/ownerJourneyRuntime.mjs';

const NOW = Date.parse('2026-11-18T13:00:00Z');
const runId = 'synthetic_binding_flow';
const prefix = '/api/portal/integrations';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const start = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
const origin = server => `http://127.0.0.1:${server.address().port}`;

// Actual owned HTTP on both sides, with private synthetic credentials checked
// by the result probe. This is not Core, OIDC enrollment or business authority.
const fixture = async (t, { mime = 'application/json', wrongOrigin = false } = {}) => {
    const database = new Database(':memory:');
    const consumer = createOwnerJourneyConsumerEvidence({ database, runId, now: () => NOW });
    const tokens = Object.fromEntries(['platform', 'owner', 'native'].map(key => [key, crypto.randomBytes(32).toString('hex')]));
    const principal = { tenantId: 1, userId: 2, sessionId: 'synthetic-native-session', authVersion: 1,
        role: 'tenant', sessionExpiresAt: NOW / 1000 + 600 };
    const owner = { actorId: 'synthetic-core-owner', organizationId: 'synthetic-org', generation: 'synthetic-generation',
        accessToken: tokens.owner, expiresAt: new Date(NOW + 300_000).toISOString() };
    const native = { id: 'synthetic-core-native-account', organization_id: owner.organizationId,
        external_tenant_id: 'wa_savana:tenant:1', status: 'active', platform_code: 'wa_savana' };
    const currentScope = { organization_id: owner.organizationId, activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
    const frozenScope = { ...currentScope, branch_id: 'synthetic-branch', warehouse_id: 'synthetic-warehouse' };
    const provider = { platform: 'catalog', provider_ref: 'synthetic-provider', activity_id: currentScope.activity_id, label: 'مصدر اختباري',
        installations: ['synthetic-first-not-selected', 'synthetic-bound-installation'].map(installation_id => ({ installation_id, activity_id: currentScope.activity_id })) };
    const identity = () => ({ actorId: owner.actorId, organizationId: owner.organizationId, nativeAccountId: native.external_tenant_id,
        coreAccountId: native.id, generation: owner.generation, expiresAt: owner.expiresAt });
    const command = id => ({ command_id: id, organization_id: owner.organizationId, activity_id: currentScope.activity_id,
        provider_ref: provider.provider_ref, capability: 'inventory.read', action: 'inventory.read',
        payload: { payload_type: 'native_action', parameters: { limit: 20 } }, version: 2, approval_fingerprint: sha(Buffer.from(id)),
        state: 'source_applied', requested_by: owner.actorId, projection_state: 'not_required', available_actions: [],
        updated_at: new Date(NOW).toISOString(), source_result: { local_entity_id: 'synthetic-record-' + id,
            source_revision: 3, result_reference: 'synthetic-receipt-' + id } });
    const bytesFor = id => Buffer.from(mime === 'application/json'
        ? `{ "quantity":1.0, "label":"رصيد ${id}" }` : `الاسم,الكمية\r\nرصيد ${id},1.0\r\n`, 'utf8');
    const bindingFor = (id, bytes) => ({ format: 'savana-owner-fixture-result-binding/1', run_id: runId,
        command_id: id, version: command(id).version, approval_fingerprint: command(id).approval_fingerprint,
        provider_ref: provider.provider_ref, source_installation_id: 'synthetic-bound-installation', scope: { ...frozenScope },
        capability_code: 'inventory.read', operation: 'inventory.read', source_result: { ...command(id).source_result },
        content_type: mime, byte_length: bytes.length, content_sha256: sha(bytes) });
    let headerMode = 'valid'; let mode = 'normal'; let local = true; let current = true;
    let beforeReply = async () => {}; const requests = []; const routeEvents = [];
    const coreApp = express();
    coreApp.get('/v1/integration/workspace/commands/:id/result', async (req, res) => {
        const authorized = req.headers.authorization === `Bearer ${tokens.owner}` && req.headers['x-savana-platform-token'] === tokens.platform
            && req.headers['x-savana-platform-code'] === 'wa_savana' && req.headers['x-savana-consumer-installation'] === 'synthetic-consumer';
        requests.push({ id: req.params.id, authorized });
        if (!authorized) return res.status(401).json({ error: { code: 'synthetic_authorization_required' } });
        const id = req.params.id; const bytes = bytesFor(id); const binding = bindingFor(id, bytes);
        await beforeReply(id);
        if (headerMode === 'wrong-run') binding.run_id = 'different-run';
        if (headerMode === 'wrong-version') binding.version++;
        if (headerMode === 'wrong-receipt') binding.source_result.result_reference = 'different-receipt';
        if (headerMode === 'wrong-installation') binding.source_installation_id = 'unoffered-installation';
        if (headerMode === 'wrong-digest') binding.content_sha256 = 'a'.repeat(64);
        const encoded = Buffer.from(JSON.stringify(binding)).toString('base64url');
        if (headerMode !== 'missing') res.setHeader(OWNER_JOURNEY_RESULT_BINDING_HEADER,
            headerMode === 'malformed' ? 'not a base64url header' : headerMode === 'repeated' ? [encoded, encoded] : encoded);
        res.status(mode === 'non200' ? 201 : 200).set('Content-Type', mime).set('X-Savana-Result-SHA256', sha(bytes)).send(bytes);
    });
    const core = await start(coreApp);
    const association = createOwnerJourneyResultBindingCapture({ coreOrigin: wrongOrigin ? 'http://127.0.0.1:1' : origin(core) });
    const setupService = { config: { centerOrigin: origin(core), platformToken: tokens.platform, allowLoopback: true },
        assertLocal(p) { assert.equal(p, principal); if (!local || p.sessionExpiresAt * 1000 <= NOW) throw new Error('synthetic_local_revoked'); },
        identity: async () => ({ ...owner }), nativeAccount: async () => ({ ...native }),
        store: { ownerCurrent: (_p, value) => current && value.actorId === owner.actorId && value.organizationId === owner.organizationId
            && value.generation === owner.generation && value.expiresAt === owner.expiresAt && Date.parse(value.expiresAt) > NOW } };
    const transport = new WorkspaceCoreTransport({ setupService, fetchImpl: association.wrapFetch(fetch), now: () => NOW });
    const finished = deferred(); const prepared = deferred(); const released = deferred(); const aborted = deferred();
    const captures = []; const delivery = createOwnerJourneyResultDelivery({ onDelivered: event => {
        routeEvents.push({ service: 'wa_savana', method: 'GET', path_template: '/api/portal/integrations/workspace/commands/:command/result',
            status: 200, observed_at: new Date(NOW).toISOString() });
        try {
            setupService.assertLocal(event.principal);
            if (setupService.store.ownerCurrent(event.principal, event.after.identity)) consumer.recordResult(event);
        } catch { /* Current delivery evidence must be withheld after native/session withdrawal. */ }
        finally { finished.resolve(); }
    } });
    const waApp = express();
    waApp.use(prefix, (req, res, next) => req.headers.authorization === `Bearer ${tokens.native}` ? next() : res.sendStatus(401), delivery.middleware);
    waApp.get(prefix + '/workspace/commands/:id/result', async (req, res) => {
        try {
            const id = req.params.id;
            const context = () => ({ command: command(id), identity: identity(), provider: structuredClone(provider), scope: { ...currentScope } });
            const before = context();
            const read = async () => (await transport.request(principal, { path: `/v1/integration/workspace/commands/${id}/result?format=${mime === 'text/csv' ? 'csv' : 'json'}`,
                expectedIdentity: before.identity, representation: mime === 'text/csv' ? 'csv' : 'json', consumerInstallation: 'synthetic-consumer' })).payload;
            const result = mode === 'outside' ? { value: await read(), header: null }
                : await association.run(mode === 'wrong-command' ? 'different-' + id : id,
                    async () => { if (mode === 'repeated-request') await read(); return read(); });
            const after = context(); const representation = result.value;
            const first = matchOwnerJourneyResultBinding({ header: result.header, runId, command: before.command, scope: before.scope, provider: before.provider, representation });
            const last = matchOwnerJourneyResultBinding({ header: result.header, runId, command: after.command, scope: after.scope, provider: after.provider, representation });
            if (first && last) { before.sourceInstallationId = first.sourceInstallationId; after.sourceInstallationId = last.sourceInstallationId;
                before.resultScope = first.scope; after.resultScope = last.scope; }
            captures.push({ header: result.header, before, after, representation });
            delivery.capture({ principal, before, after, representation });
            res.set('Content-Type', representation.contentType).set('X-Savana-Result-SHA256', representation.sha256);
            if (mode === 'pause' || mode === 'abort') {
                res.once('close', aborted.resolve); res.write(representation.bytes.subarray(0, 8)); prepared.resolve();
                if (mode === 'abort') return;
                await released.promise; return res.end(representation.bytes.subarray(8));
            }
            res.send(representation.bytes);
        } catch (error) { res.status(error.status || 403).json({ error: { code: error.code || 'synthetic_context_changed' } }); }
    });
    const wa = await start(waApp);
    t.after(async () => { for (const server of [wa, core]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } database.close(); });
    const diagnostic = () => ownerJourneyDiagnosticEnvelope({ source: { facts: consumer.snapshot().facts,
        catalog_result_reads: consumer.snapshot().catalog_result_reads, observations: routeEvents },
        config: { run_id: runId, source_revision: 'a'.repeat(40), source_sha256: 'b'.repeat(64), process_generation: 1 } });
    return { transport, association, command, bytesFor, requests, captures, consumer, diagnostic, finished: finished.promise,
        prepared: prepared.promise, aborted: aborted.promise, release: released.resolve, provider, currentScope,
        url: id => `${origin(wa)}${prefix}/workspace/commands/${id}/result`,
        get: id => fetch(`${origin(wa)}${prefix}/workspace/commands/${id}/result`, { headers: { Authorization: `Bearer ${tokens.native}` } }),
        setHeader: value => { headerMode = value; }, setMode: value => { mode = value; }, onReply: value => { beforeReply = value; },
        nativeHeaders: { Authorization: `Bearer ${tokens.native}` }, revoke: () => { local = false; },
        rotate: () => { owner.generation = 'new-synthetic-generation'; }, disconnect: () => { current = false; },
        expire: () => { owner.expiresAt = new Date(NOW).toISOString(); },
        coreOrigin: origin(core), principal };
};

test('real authenticated result HTTP to verified transport to WA finish emits one closed row and top-level diagnostic for JSON and CSV', { timeout: 10_000 }, async t => {
    for (const mime of ['application/json', 'text/csv']) {
        const f = await fixture(t, { mime }); f.setMode('pause');
        const pending = f.get('synthetic-one'); await f.prepared; const response = await pending;
        assert.deepEqual(f.diagnostic().catalog_result_reads, []); f.release();
        const actual = Buffer.from(await response.arrayBuffer()); await f.finished;
        assert.equal(response.status, 200); assert.deepEqual(actual, f.bytesFor('synthetic-one'));
        assert.equal(response.headers.get('x-savana-result-sha256'), sha(actual));
        const rows = f.diagnostic().catalog_result_reads; assert.equal(rows.length, 1);
        assert.equal(rows[0].source_installation_id, 'synthetic-bound-installation');
        assert.equal(rows[0].scope.warehouse_id, 'synthetic-warehouse');
        assert.equal(f.captures[0].before.scope.warehouse_id, null);
        assert.equal(rows[0].content_type, mime); assert.equal(rows[0].byte_length, actual.length); assert.equal(rows[0].content_sha256, sha(actual));
        assert.equal(rows[0].command_id, 'synthetic-one'); assert.deepEqual(rows[0].source_result, f.command('synthetic-one').source_result);
        assert.ok(f.requests.every(request => request.authorized)); assert.equal(f.requests.length, 1);
        assert.equal(f.diagnostic().observations[0].service, 'wa_savana');
        assert.equal(JSON.stringify(rows).includes('quantity'), false);
        const unauthorized = await fetch(f.coreOrigin + '/v1/integration/workspace/commands/synthetic-one/result?format=json');
        assert.equal(unauthorized.status, 401); await unauthorized.arrayBuffer();
        assert.equal(f.requests.at(-1).authorized, false); assert.equal(f.diagnostic().catalog_result_reads.length, 1);
    }
});

test('missing, malformed, repeated or tuple-mismatched binding metadata preserves authorized bytes but emits no joined row', { timeout: 10_000 }, async t => {
    for (const header of ['missing', 'malformed', 'repeated', 'wrong-run', 'wrong-version', 'wrong-receipt', 'wrong-installation', 'wrong-digest']) {
        const f = await fixture(t); f.setHeader(header);
        const response = await f.get('synthetic-negative'); const bytes = Buffer.from(await response.arrayBuffer()); await f.finished;
        assert.equal(response.status, 200, header); assert.deepEqual(bytes, f.bytesFor('synthetic-negative'));
        assert.equal(response.headers.get('x-savana-result-sha256'), sha(bytes));
        assert.deepEqual(f.diagnostic().catalog_result_reads, [], header);
    }
});

test('an aborted downstream HTTP read cannot emit a joined row even after upstream bytes and binding were verified', { timeout: 10_000 }, async t => {
    const f = await fixture(t); f.setMode('abort');
    await new Promise((resolve, reject) => {
        const request = http.get(f.url('synthetic-aborted'), { headers: f.nativeHeaders }, response => {
            response.once('data', bytes => { assert.deepEqual(bytes, f.bytesFor('synthetic-aborted').subarray(0, bytes.length));
                response.destroy(); request.destroy(); resolve(); }); response.on('error', () => {});
        });
        request.once('error', error => error.code === 'ECONNRESET' ? resolve() : reject(error));
    });
    await f.aborted; await new Promise(setImmediate);
    assert.ok(f.captures[0].header); assert.deepEqual(f.diagnostic().catalog_result_reads, []);
});

test('outside ALS, repeated requests, wrong command/origin or non200 cannot associate a header or change authorized bytes', { timeout: 10_000 }, async t => {
    for (const mode of ['outside', 'repeated-request', 'wrong-origin', 'wrong-command', 'non200']) {
        const f = await fixture(t, { wrongOrigin: mode === 'wrong-origin' }); f.setMode(mode);
        const response = await f.get('synthetic-unassociated'); const bytes = Buffer.from(await response.arrayBuffer()); await f.finished;
        assert.deepEqual(bytes, f.bytesFor('synthetic-unassociated')); assert.equal(f.captures[0].header, null);
        assert.deepEqual(f.diagnostic().catalog_result_reads, []);
        assert.equal(f.requests.length, mode === 'repeated-request' ? 2 : 1);
        assert.equal((await f.association.run('synthetic-unassociated', async () => 'no HTTP read')).header, null);
    }
});

test('concurrent real HTTP reads finishing out of order retain independent command bindings and delivered digests', { timeout: 10_000 }, async t => {
    const f = await fixture(t); const firstEntered = deferred(); const releaseFirst = deferred();
    f.onReply(async id => { if (id === 'synthetic-first') { firstEntered.resolve(); await releaseFirst.promise; } });
    const first = f.get('synthetic-first'); await firstEntered.promise;
    const second = await f.get('synthetic-second'); const secondBytes = Buffer.from(await second.arrayBuffer());
    assert.equal(f.diagnostic().catalog_result_reads.length, 1); releaseFirst.resolve();
    const firstBytes = Buffer.from(await (await first).arrayBuffer()); await new Promise(setImmediate);
    const rows = f.diagnostic().catalog_result_reads; assert.equal(rows.length, 2);
    for (const [id, bytes] of [['synthetic-first', firstBytes], ['synthetic-second', secondBytes]]) {
        const row = rows.find(item => item.command_id === id); assert.equal(row.content_sha256, sha(bytes));
        assert.equal(row.approval_fingerprint, f.command(id).approval_fingerprint);
    }
});

test('current owner withdrawal during the actual awaited HTTP response prevents delivery and any new evidence', { timeout: 10_000 }, async t => {
    for (const action of ['revoke', 'rotate', 'disconnect']) {
        const f = await fixture(t); f.onReply(async () => { f[action](); });
        const response = await f.get('synthetic-withdrawn'); assert.equal(response.status, 403); await response.arrayBuffer();
        assert.equal(f.captures.length, 0); assert.deepEqual(f.diagnostic().catalog_result_reads, []);
    }
});

test('withdrawal after capture but before HTTP finish preserves already prepared bytes and withholds joined evidence', { timeout: 10_000 }, async t => {
    for (const action of ['revoke', 'rotate', 'disconnect', 'expire']) {
        const f = await fixture(t); f.setMode('pause');
        const pending = f.get('synthetic-post-capture'); await f.prepared; const response = await pending;
        assert.ok(f.captures[0].header); assert.deepEqual(f.diagnostic().catalog_result_reads, []);
        f[action](); f.release();
        const actual = Buffer.from(await response.arrayBuffer()); await f.finished;
        assert.equal(response.status, 200); assert.deepEqual(actual, f.bytesFor('synthetic-post-capture'));
        assert.equal(response.headers.get('x-savana-result-sha256'), sha(actual));
        assert.deepEqual(f.diagnostic().catalog_result_reads, [], action);
    }
});
