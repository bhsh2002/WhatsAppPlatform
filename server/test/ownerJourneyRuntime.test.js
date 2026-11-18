import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import express from 'express';
import { validateRuntimeConfig, ownerJourneyJsonParserOptions, ownerJourneyProviderEnvironment, ownerJourneyObservations, ownerJourneyDiagnosticEnvelope, privateOwnerBrowserContext } from '../test-support/ownerJourneyRuntime.mjs';
import { ownerJourneyRouteTemplates } from '../test-support/ownerJourneyRouteTemplates.js';

const moduleUrl = new URL('../test-support/ownerJourneyRuntime.mjs', import.meta.url).href;

test('actual diagnostic envelope preserves closed published Catalog result rows and separates source ownership', () => {
    const published = JSON.parse(fs.readFileSync(new URL('../test-fixtures/wa-catalog-result-evidence-v1.synthetic-example.json', import.meta.url)));
    const rows = published.catalog_result_reads;
    assert.ok(Array.isArray(rows) && rows.length > 0);
    const source = { facts: { catalog_ledger_reads: 1 }, observations: [
        { service: 'wa_savana', method: 'GET', path_template: '/api/portal/integrations/workspace/commands/:command/result', status: 200 },
        { service: 'portal', method: 'GET', path_template: '/v1/integration/workspace/commands/:command/result', status: 200 },
    ], catalog_result_reads: rows };
    const config = { run_id: 'owned-diagnostic-row-unit', source_revision: 'a'.repeat(40), source_sha256: 'b'.repeat(64), process_generation: 3 };
    const output = ownerJourneyDiagnosticEnvelope({ source, config });
    assert.deepEqual(JSON.parse(JSON.stringify(output)).catalog_result_reads, rows);
    assert.equal(output.facts.actual_process_restarts, 2);
    assert.equal(output.observations.length, 1); assert.equal(output.observations[0].service, 'wa_savana');
    assert.equal(Object.hasOwn(output, 'catalog_reconciliations'), false);
    assert.throws(() => ownerJourneyDiagnosticEnvelope({ source: { ...source, catalog_reconciliations: published.catalog_reconciliations }, config }), { code: 'invalid_request' });
    for (const invalid of [null, {}, Array.from({ length: 513 }, () => rows[0])]) {
        assert.throws(() => ownerJourneyDiagnosticEnvelope({ source: { ...source, catalog_result_reads: invalid }, config }), { code: 'diagnostic_invalid' });
    }
});

test('browser route metadata comes from actual nested Express routes and matches the registered trace mapper', async t => {
    const app = express(), root = express.Router(), child = express.Router(); const traces = [];
    child.get('/:contact', (req, res) => { traces.push('/api/portal' + req.route.path); res.json({ ok: true }); });
    root.use('/contacts', child); app.use('/api/portal', root);
    const rows = ownerJourneyRouteTemplates({ router: root, publicPrefix: '/api/portal' });
    assert.deepEqual(rows, ['wa_frontend', 'wa_savana'].map(browser_service => ({ browser_service, method: 'GET',
        public_path_template: '/api/portal/contacts/:contact', trace_service: 'wa_savana', path_template: '/api/portal/:contact' })));
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/portal/contacts/synthetic-owned`)).status, 200);
    assert.equal(traces[0], rows[0].path_template);
    const context = privateOwnerBrowserContext({ username: 'synthetic', password: 'private' }, undefined, [...rows, ...rows]);
    assert.deepEqual(context.http_route_templates, rows); assert.equal(JSON.stringify(context).includes('synthetic-owned'), false);
    assert.throws(() => privateOwnerBrowserContext({ username: 'synthetic', password: 'private' }, undefined,
        [{ ...rows[0], public_path_template: '/api/portal/contacts?private=secret' }]), { code: 'private_route_templates_invalid' });
});

test('persisted application observations and automatic native auth observations are composed once without collapsing real identical calls', () => {
    const app = { service: 'wa_savana', method: 'GET', path_template: '/api/portal/integrations/workspace', status: 200 };
    const auth = { service: 'wa_savana', method: 'POST', path_template: '/api/auth/login', status: 200 };
    assert.deepEqual(ownerJourneyObservations([app, app], [auth, app, app], [auth]), [app, app, auth]);
    assert.deepEqual(ownerJourneyObservations(undefined, [auth, app, app], [auth]), [auth, app, app]);
    assert.deepEqual(ownerJourneyObservations([], [], []), []);
});

test('exported observations contain only owned servers while separate outbound evidence stays intact across both composition paths', () => {
    const own = { service: 'wa_savana', method: 'GET', path_template: '/api/portal/integrations/workspace', status: 200, observed_at: '2026-11-18T12:00:00Z' };
    const frontend = { ...own, service: 'wa_frontend' };
    const auth = { ...own, method: 'POST', path_template: '/api/auth/login' };
    const external = ['portal', 'connect', 'subscriptions', 'message_provider', 'catalog', 'sawemly', 'payment_provider', 'controller']
        .map(service => ({ ...own, service }));
    const persisted = [own, ...external, { ...own }, frontend];
    const observed = [auth, ...persisted];
    const outboundBefore = structuredClone(external), persistedBefore = structuredClone(persisted);
    assert.deepEqual(ownerJourneyObservations(persisted, observed, [auth]), [own, own, frontend, auth]);
    assert.deepEqual(ownerJourneyObservations(undefined, observed, [auth]), [auth, own, own, frontend]);
    assert.deepEqual(ownerJourneyObservations(external, observed, []), []); // persisted source remains authoritative, never resurrect old in-process copies
    assert.deepEqual(external, outboundBefore); assert.deepEqual(persisted, persistedBefore);
});

test('real peer calls followed by owned callback/server traces stay separate without losing identical actual calls', async t => {
    const owned = express(), peer = express(); const serverRows = [], outboundRows = [];
    const stamp = '2026-11-18T12:00:00.000Z'; // deliberately identical across distinct actual calls
    owned.use((req, res, next) => { res.once('finish', () => serverRows.push({ service: 'wa_savana', method: req.method,
        path_template: req.route.path, status: res.statusCode, observed_at: stamp })); next(); });
    owned.post('/api/portal/owned-callback', (_req, res) => res.status(202).json({ received: true }));
    const ownerServer = await new Promise(resolve => { const listener = owned.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(async () => { ownerServer.closeAllConnections(); await new Promise(resolve => ownerServer.close(resolve)); });
    const ownerUrl = `http://127.0.0.1:${ownerServer.address().port}`;
    peer.get('/owned-peer/setup', async (_req, res) => {
        const callback = await fetch(ownerUrl + '/api/portal/owned-callback', { method: 'POST' });
        assert.equal(callback.status, 202); await callback.arrayBuffer();
        res.json({ configured: true });
    });
    const peerServer = await new Promise(resolve => { const listener = peer.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(async () => { peerServer.closeAllConnections(); await new Promise(resolve => peerServer.close(resolve)); });
    const peerUrl = `http://127.0.0.1:${peerServer.address().port}`;
    owned.get('/api/portal/owned-setup', async (_req, res) => {
        const response = await fetch(peerUrl + '/owned-peer/setup'); await response.arrayBuffer();
        outboundRows.push({ service: 'portal', method: 'GET', path_template: '/owned-peer/setup', status: response.status, observed_at: stamp });
        res.json({ checked: true });
    });
    for (let index = 0; index < 2; index += 1) {
        const response = await fetch(ownerUrl + '/api/portal/owned-setup'); assert.equal(response.status, 200); await response.arrayBuffer();
    }
    assert.equal(serverRows.length, 4); assert.equal(outboundRows.length, 2);
    assert.deepEqual(serverRows.slice(0, 2), serverRows.slice(2));
    // Older persisted state may still contain outbound observations; filtering
    // must not mutate that evidence or the separate current outbound ledger.
    const persisted = [outboundRows[0], ...serverRows, outboundRows[1]], observed = [...persisted];
    const before = structuredClone(outboundRows);
    assert.deepEqual(ownerJourneyObservations(persisted, observed, []), serverRows);
    assert.deepEqual(ownerJourneyObservations(undefined, observed, []), serverRows);
    assert.deepEqual(outboundRows, before);
});

test('provider import environment derives only per-run owned callback credentials and exact native callback', () => {
    const config = { run_id: 'synthetic-runtime-environment', credentials: { callback_token: 'synthetic-private-callback-only' },
        urls: { wa_savana: 'http://127.0.0.1:19505' } };
    const value = ownerJourneyProviderEnvironment(config);
    assert.equal(value.META_APP_SECRET, crypto.createHmac('sha256', config.credentials.callback_token).update('owned-meta:' + config.run_id).digest('hex'));
    assert.equal(value.WEBHOOK_VERIFY_TOKEN, crypto.createHmac('sha256', config.credentials.callback_token).update('owned-webhook:' + config.run_id).digest('hex'));
    assert.notEqual(value.META_APP_SECRET, value.WEBHOOK_VERIFY_TOKEN);
    assert.notEqual(value.META_APP_SECRET, ownerJourneyProviderEnvironment({ ...config, run_id: 'another-owned-run' }).META_APP_SECRET);
    assert.equal(value.SMS_GATEWAY_CALLBACK_BASE_URL, 'http://127.0.0.1:19505/api/integrations/sms-gateway/events');
    assert.equal(value.SMS_GATEWAY_ALLOW_TENANT_MANUAL_CONFIG, 'true');
    assert.equal(value.META_APP_ID, 'owned-native-meta-app');
});

test('source-owned technical provider context is private, bounded and cannot carry grants or seeded business authority', () => {
    const owner = { username: 'synthetic-owner', password: 'synthetic-private-owner-password' };
    const provider = { sms: { base_url: 'http://127.0.0.1:19507', api_key: 'synthetic-private-provider-key' } };
    const value = privateOwnerBrowserContext(owner, provider);
    assert.deepEqual(value, { ordinary_owner: owner, native_provider: provider });
    assert.notEqual(value.native_provider, provider);
    for (const invalid of [{ grants: [] }, { contacts: [] }, { scope: { approved: true } }, { blob: 'x'.repeat(65537) }]) {
        assert.throws(() => privateOwnerBrowserContext(owner, invalid), { code: 'private_provider_context_invalid' });
    }
    let invoked = false;
    const getter = {}; Object.defineProperty(getter, 'secret', { enumerable: true, get() { invoked = true; return 'private'; } });
    assert.throws(() => privateOwnerBrowserContext(owner, getter), { code: 'private_provider_context_invalid' });
    assert.equal(invoked, false);
});

test('actual runtime JSON parser retains exact UTF8 transport bytes independently of parsed/reserialized JSON', async t => {
    const body = Buffer.from('{\n  "z": "رسالة تجريبية", "a": 1\n}\n', 'utf8');
    const sha = value => crypto.createHash('sha256').update(value).digest('hex');
    const app = express(); app.use(express.json(ownerJourneyJsonParserOptions()));
    app.post('/exact-bytes', (req, res) => {
        assert.ok(Buffer.isBuffer(req.rawBody)); assert.deepEqual(req.rawBody, body);
        assert.notEqual(sha(req.rawBody), sha(JSON.stringify(req.body)));
        req.body.a = 99;
        res.json({ original_sha256: sha(req.rawBody), parsed_value: req.body.a });
    });
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/exact-bytes`, { method: 'POST', body,
        headers: { 'Content-Type': 'application/json' }, redirect: 'error' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { original_sha256: sha(body), parsed_value: 99 });
});

test('owner journey runtime validates fresh scoped input without importing the application or opening a DB', () => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-owner-config-')));
    try {
        const names = ['connect', 'subscriptions', 'portal', 'catalog', 'sawemly', 'wa_savana', 'wa_frontend', 'message_provider', 'payment_provider', 'controller'];
        const urls = { ...Object.fromEntries(names.map((name, index) => [name, `http://127.0.0.1:${19500 + index}`])),
            catalog_domain_proxy: 'https://127.0.0.1:19510' };
        const config = { run_id: 'config_validation_only', state_root: directory, port_base: 19500, urls,
            credentials: Object.fromEntries(['platform_token', 'callback_token', 'subscriptions_platform_token', 'subscription_signing']
                .map(key => [key, 'synthetic-only-' + key + '-not-real-secret'])), peers: {},
            identity: { client_id: 'synthetic-native-client', redirect_uri: urls.wa_frontend + '/api/portal/integrations/shared-read-setup/callback',
                issuer: urls.portal, discovery_url: urls.portal + '/.well-known/openid-configuration', subscriptions_url: urls.subscriptions, portal_url: urls.portal,
                ingress_service: 'portal', ingress_url: urls.portal, api_base_url: urls.portal, authorization_endpoint: urls.portal + '/oauth/authorize',
                token_endpoint: urls.portal + '/v1/oidc/token', userinfo_endpoint: urls.portal + '/v1/oidc/userinfo', jwks_uri: urls.portal + '/.well-known/jwks.json' },
            source_revision: 'a'.repeat(40), source_sha256: 'b'.repeat(64), process_generation: 1,
            private_native: { jwt_secret: 'c'.repeat(96), crypto_key: 'd'.repeat(64), username: `owner_${'e'.repeat(16)}`, password: 'synthetic-private-config-only' } };
        assert.equal(validateRuntimeConfig(config), config);
        assert.throws(() => validateRuntimeConfig({ ...config, identity: { ...config.identity, issuer: urls.connect } }), { code: 'identity_registration_mismatch' });
        assert.throws(() => validateRuntimeConfig({ ...config, ready: true }), { code: 'invalid_request' });
        assert.throws(() => validateRuntimeConfig({ ...config, urls: { ...config.urls, connect: 'https://example.invalid' } }), { code: 'loopback_urls_required' });
        assert.throws(() => validateRuntimeConfig({ ...config, private_native: { ...config.private_native, crypto_key: 'bad' } }), { code: 'invalid_request' });
        assert.deepEqual(fs.readdirSync(directory), []);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('owner journey network guard permits declared real loopback HTTP and denies redirects/public or undeclared sockets', () => {
    const script = `
        import assert from 'node:assert/strict';
        import http from 'node:http';
        import net from 'node:net';
        import tls from 'node:tls';
        import dgram from 'node:dgram';
        import { installLoopbackGuard } from ${JSON.stringify(moduleUrl)};
        let calls = 0, forbiddenCalls = 0;
        const forbidden = http.createServer((req,res) => { forbiddenCalls++; res.end('must never receive'); });
        await new Promise(resolve => forbidden.listen(0, '127.0.0.1', resolve));
        const deniedUrl = 'http://127.0.0.1:' + forbidden.address().port;
        const allowed = http.createServer((req,res) => {
            calls++;
            if (req.url === '/redirect') { res.writeHead(302, {location:deniedUrl}); res.end(); }
            else res.end('actual-loopback');
        });
        await new Promise(resolve => allowed.listen(0, '127.0.0.1', resolve));
        const url = 'http://127.0.0.1:' + allowed.address().port;
        installLoopbackGuard({own:url,catalog_domain_proxy:deniedUrl.replace('http:','https:')});
        try {
            assert.equal(await (await fetch(url)).text(), 'actual-loopback');
            await assert.rejects(fetch(url + '/redirect'));
            assert.throws(() => fetch('http://example.invalid'), {code:'external_network_forbidden'});
            assert.throws(() => fetch(deniedUrl), {code:'external_network_forbidden'});
            assert.throws(() => net.connect({host:'127.0.0.1',port:forbidden.address().port}), {code:'external_network_forbidden'});
            assert.throws(() => fetch(url.replace('127.0.0.1','localhost')), {code:'external_network_forbidden'});
            assert.throws(() => net.connect({host:'203.0.113.1',port:80}), {code:'external_network_forbidden'});
            assert.throws(() => tls.connect({host:'127.0.0.1',port:443}), {code:'external_network_forbidden'});
            assert.throws(() => dgram.createSocket('udp4'), {code:'external_network_forbidden'});
            assert.equal(calls,2); assert.equal(forbiddenCalls,0);
            console.log(JSON.stringify({allowed_http_requests:calls,forbidden_http_requests:forbiddenCalls}));
        } finally {
            allowed.closeAllConnections(); forbidden.closeAllConnections();
            await Promise.all([new Promise(resolve=>allowed.close(resolve)), new Promise(resolve=>forbidden.close(resolve))]);
        }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module'], { input: script, encoding: 'utf8', timeout: 15000,
        env: { PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', TZ: 'UTC' } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { allowed_http_requests: 2, forbidden_http_requests: 0 });
});
