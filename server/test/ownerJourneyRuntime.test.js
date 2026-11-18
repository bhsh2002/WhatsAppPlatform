import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import express from 'express';
import { validateRuntimeConfig, ownerJourneyJsonParserOptions, ownerJourneyProviderEnvironment, ownerJourneyObservations, privateOwnerBrowserContext } from '../test-support/ownerJourneyRuntime.mjs';
import { ownerJourneyRouteTemplates } from '../test-support/ownerJourneyRouteTemplates.js';

const moduleUrl = new URL('../test-support/ownerJourneyRuntime.mjs', import.meta.url).href;

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
