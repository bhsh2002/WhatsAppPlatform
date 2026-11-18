import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { GuidedWhatsAppSetupService } from '../services/guidedWhatsAppSetup.js';
import { createGuidedWhatsAppSetupRouter } from '../routes/guidedWhatsAppSetup.js';

const TOKEN = 'synthetic-owned-meta-user-token';
const SHORT = 'synthetic-short-lived-meta-token';
const APP = 'synthetic-app';
const SECRET = 'synthetic-owned-app-secret';
const rejectCode = code => error => error.code === `whatsapp_setup_${code}`;
const aes = () => {
    const key = crypto.randomBytes(32);
    return { encrypt(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64'); },
    decrypt(value) { const bytes = Buffer.from(value, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(); } };
};
const open = async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-guided-owned-http-'));
    const db = new Database(path.join(directory, 'owned.sqlite'));
    db.exec(`CREATE TABLE tenants(id INTEGER PRIMARY KEY,name TEXT,status TEXT,phone_number_id TEXT,waba_id TEXT,business_id TEXT,
        dataset_id TEXT,access_token TEXT,access_token_encrypted TEXT,updated_at TEXT);
        CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER,role TEXT,is_active INTEGER,auth_version INTEGER);
        INSERT INTO tenants(id,name,status) VALUES(1,'Owned tenant','Active'),(2,'Other tenant','Active');
        INSERT INTO users VALUES(1,1,'tenant',1,0),(2,2,'tenant',1,0),(3,1,'employee',1,0);
        CREATE TABLE tenant_whatsapp_numbers(id INTEGER PRIMARY KEY,tenant_id INTEGER,phone_number_id TEXT UNIQUE,waba_id TEXT,
            business_id TEXT,dataset_id TEXT,display_phone_number TEXT,verified_name TEXT,label TEXT,quality_rating TEXT,
            platform_status TEXT,access_token_encrypted TEXT,is_default INTEGER,is_active INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT,
            UNIQUE(tenant_id,phone_number_id));
        CREATE UNIQUE INDEX one_default ON tenant_whatsapp_numbers(tenant_id) WHERE is_default=1;
        CREATE TABLE activity_logs(id INTEGER PRIMARY KEY,tenant_id INTEGER,tenant_name TEXT,event_type TEXT,description TEXT,status TEXT);`);
    let clock = Date.now(); let verified = true; let after = async () => {};
    const principal = { tenantId: 1, userId: 1, sessionId: 'owned-synthetic-jti', authVersion: 0, role: 'tenant', sessionExpiresAt: Math.floor(clock / 1000) + 7200 };
    const state = { scopes: ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'],
        user: 'meta-person', app: APP, type: 'USER', tokenExpires: Math.floor(clock / 1000) + 3600,
        businesses: [{ id: 'owned-business', name: 'المؤسسة المملوكة' }],
        accounts: [{ id: 'owned-waba', name: 'الحساب المعتمد' }],
        phones: [{ id: 'owned-phone', verified_name: 'متجرنا', display_phone_number: '+218 91 000 0000', status: 'CONNECTED' },
            { id: 'other-owned-phone', verified_name: 'فرع آخر', display_phone_number: '+218 92 000 0000' }],
        webhook: true, paging: null, dropSubscription: false, splitArabic: false };
    const calls = [];
    const provider = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1'); calls.push({ method: req.method, path: url.pathname,
                query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization });
            let body;
            if (url.pathname === '/v25.0/oauth/access_token') {
                assert.equal(req.method, 'GET'); assert.equal(url.searchParams.get('client_id'), APP);
                assert.equal(url.searchParams.get('client_secret'), SECRET);
                if (url.searchParams.get('grant_type') === 'fb_exchange_token') {
                    assert.equal(url.searchParams.get('fb_exchange_token'), SHORT); assert.equal(url.searchParams.has('code'), false);
                    body = { access_token: TOKEN, token_type: 'bearer' };
                } else { assert.equal(url.searchParams.get('code'), 'owned-code'); body = { access_token: SHORT, token_type: 'bearer' }; }
            } else if (url.pathname === '/v25.0/debug_token') {
                assert.equal(req.headers.authorization, `Bearer ${APP}|${SECRET}`); assert.ok([SHORT, TOKEN].includes(url.searchParams.get('input_token')));
                body = { data: { is_valid: true, app_id: state.app, user_id: state.user, type: state.type, scopes: state.scopes,
                    expires_at: state.tokenExpires, data_access_expires_at: 0 } };
            } else {
                assert.ok([SHORT, TOKEN].some(token => req.headers.authorization === `Bearer ${token}`));
                if (url.pathname === '/v25.0/me') body = { id: state.user, name: 'Owned Meta person' };
                else if (url.pathname === '/v25.0/me/businesses') body = { data: state.businesses, ...(state.paging ? { paging: state.paging } : {}) };
                else if (url.pathname === '/v25.0/owned-business/owned_whatsapp_business_accounts') body = { data: state.accounts };
                else if (url.pathname === '/v25.0/owned-waba/phone_numbers') body = { data: state.phones };
                else if (url.pathname === '/v25.0/owned-waba/subscribed_apps' && req.method === 'POST') {
                    if (state.dropSubscription) { req.socket.destroy(); return; }
                    body = { success: state.webhook };
                } else { res.writeHead(404).end(); return; }
            }
            await after(url, body);
            const bytes = Buffer.from(JSON.stringify(body));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (state.splitArabic && url.pathname.endsWith('/me/businesses')) {
                const split = bytes.indexOf(Buffer.from('المؤسسة')) + 1; assert.ok(split > 0);
                res.write(bytes.subarray(0, split));
                await new Promise(resolve => setTimeout(resolve, 5));
                res.end(bytes.subarray(split));
            } else res.end(bytes);
        } catch { res.writeHead(500).end('{}'); }
    });
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const origin = `http://127.0.0.1:${provider.address().port}`;
    const encryption = aes();
    const config = { appId: APP, appSecret: SECRET, apiBase: `${origin}/v25.0`, authorizationEndpoint: `${origin}/v25.0/dialog/oauth`,
        redirectUri: `${origin}/oauth/callback`, allowLoopback: true };
    const make = overrides => new GuidedWhatsAppSetupService({ database: db, encryption, verifyLocalPrincipal: () => verified,
        now: () => clock, config, ...overrides });
    const service = make();
    t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); db.close(); fs.rmSync(directory, { recursive: true }); });
    const complete = async () => { const start = service.start(principal); return service.complete(principal, { code: 'owned-code', state: start.state }); };
    const phone = async () => { const business = await complete(); const account = await service.choose(principal, { choice: business.choices[0].value });
        return service.choose(principal, { choice: account.choices[0].value }); };
    return { db, service, make, principal, state, calls, encryption, config, origin, complete, phone,
        after: fn => { after = fn; }, clock: value => { clock = value; }, time: () => clock, verify: value => { verified = value; } };
};

test('actual owned HTTP code flow names business/account/phone and persists only the verified selection, encrypted', async t => {
    const f = await open(t);
    f.db.prepare(`INSERT INTO tenant_whatsapp_numbers(tenant_id,phone_number_id,waba_id,access_token_encrypted,is_default,is_active)
        VALUES(1,'existing-phone','existing-waba',?,1,1)`).run(f.encryption.encrypt('previous-owned-token'));
    const started = f.service.start(f.principal);
    const authorize = new URL(started.authorization_url);
    assert.equal(authorize.origin, f.origin); assert.equal(authorize.searchParams.get('state'), started.state);
    assert.equal(authorize.searchParams.get('response_type'), 'code'); assert.equal(authorize.searchParams.has('client_secret'), false);
    let step = await f.service.complete(f.principal, { code: 'owned-code', state: started.state });
    assert.equal(step.stage, 'business'); assert.equal(step.choices[0].label, 'المؤسسة المملوكة');
    step = await f.service.choose(f.principal, { choice: step.choices[0].value }); assert.equal(step.stage, 'account');
    step = await f.service.choose(f.principal, { choice: step.choices[0].value }); assert.equal(step.stage, 'phone');
    const result = await f.service.connect(f.principal, { choice: step.choices[0].value });
    assert.equal(result.stage, 'connected'); assert.equal(result.webhook_status, 'confirmed');
    const rows = f.db.prepare('SELECT * FROM tenant_whatsapp_numbers ORDER BY id').all();
    assert.equal(rows.length, 2); assert.equal(rows[0].is_default, 1); assert.equal(rows[1].is_default, 0);
    assert.equal(rows[1].phone_number_id, 'owned-phone'); assert.equal(f.encryption.decrypt(rows[1].access_token_encrypted), TOKEN);
    assert.equal(f.db.prepare('SELECT count(*) n FROM activity_logs').get().n, 1);
    for (const privateValue of [TOKEN, SECRET, 'owned-business', 'owned-waba', 'owned-phone', 'meta-person']) assert.equal(JSON.stringify(result).includes(privateValue), false);
    assert.equal(f.calls.filter(row => row.path.endsWith('/subscribed_apps')).length, 1);
    assert.equal(f.calls.some(row => row.path.endsWith('/messages')), false);
});

test('OAuth state belongs to the current native owner and code exchange is claimed once even during concurrency', async t => {
    const f = await open(t); const started = f.service.start(f.principal);
    await assert.rejects(f.service.complete({ ...f.principal, sessionId: 'fresh-jti' }, { code: 'owned-code', state: started.state }), rejectCode('context_changed'));
    await assert.rejects(f.service.complete({ ...f.principal, tenantId: 2, userId: 2 }, { code: 'owned-code', state: started.state }), rejectCode('state_invalid'));
    let release; let reached;
    const waiting = new Promise(resolve => { reached = resolve; }); const held = new Promise(resolve => { release = resolve; });
    f.after(async url => { if (url.pathname.endsWith('/oauth/access_token')) { reached(); await held; } });
    const first = f.service.complete(f.principal, { code: 'owned-code', state: started.state }); await waiting;
    await assert.rejects(f.service.complete(f.principal, { code: 'owned-code', state: started.state }), rejectCode('operation_in_progress'));
    release(); await first;
    await assert.rejects(f.service.complete(f.principal, { code: 'owned-code', state: started.state }), rejectCode('state_invalid'));
    assert.equal(f.calls.filter(row => row.path.endsWith('/oauth/access_token') && row.query.code).length, 1);
    assert.equal(f.calls.filter(row => row.query.grant_type === 'fb_exchange_token').length, 1);
});

test('actual provider app, user-token type, permissions and expiry are verified before any named discovery or save', async t => {
    const f = await open(t);
    for (const [field, bad] of [['app', 'foreign-app'], ['type', 'SYSTEM_USER'], ['scopes', ['business_management']], ['tokenExpires', 1]]) {
        const old = f.state[field]; f.state[field] = bad; const before = f.calls.length;
        await assert.rejects(f.complete(), rejectCode('permission_required'));
        assert.equal(f.calls.slice(before).some(row => row.path.endsWith('/me/businesses')), false);
        assert.equal(f.service.status(f.principal).stage, 'expired'); f.state[field] = old;
    }
    assert.equal(f.db.prepare('SELECT count(*) n FROM tenant_whatsapp_numbers').get().n, 0);
});

test('removing business, WABA or selected phone after discovery cannot save a stale opaque choice', async t => {
    const f = await open(t);
    for (const field of ['businesses', 'accounts', 'phones']) {
        const stage = await f.phone(); const old = f.state[field]; f.state[field] = [];
        await assert.rejects(f.service.connect(f.principal, { choice: stage.choices[0].value }), rejectCode('choice_changed'));
        f.state[field] = old;
    }
    assert.equal(f.db.prepare('SELECT count(*) n FROM tenant_whatsapp_numbers').get().n, 0);
    assert.equal(f.calls.some(row => row.path.endsWith('/subscribed_apps')), false);
});

test('ownership withdrawn while the phone lookup is awaited is rechecked before any native write', async t => {
    const f = await open(t); const stage = await f.phone();
    f.after(async url => { if (url.pathname.endsWith('/phone_numbers')) f.state.accounts = []; });
    await assert.rejects(f.service.connect(f.principal, { choice: stage.choices[0].value }), rejectCode('choice_changed'));
    assert.equal(f.db.prepare('SELECT count(*) n FROM tenant_whatsapp_numbers').get().n, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM activity_logs').get().n, 0);
    assert.equal(f.calls.some(row => row.path.endsWith('/subscribed_apps')), false);
});

test('the extended token must still belong to the originally authorized Meta person', async t => {
    const f = await open(t);
    f.after(async (url, body) => { if (url.pathname.endsWith('/debug_token') && url.searchParams.get('input_token') === TOKEN) body.data.user_id = 'different-meta-person'; });
    await assert.rejects(f.complete(), rejectCode('provider_identity_changed'));
    assert.equal(f.calls.some(row => row.path.endsWith('/me/businesses')), false);
    assert.equal(f.db.prepare('SELECT count(*) n FROM tenant_whatsapp_numbers').get().n, 0);
});

test('local disable, auth version, role, tenant or token expiry across an await blocks the final transaction', async t => {
    const f = await open(t);
    const changes = [() => f.db.prepare('UPDATE users SET is_active=0 WHERE id=1').run(),
        () => f.db.prepare('UPDATE users SET auth_version=1 WHERE id=1').run(),
        () => f.db.prepare("UPDATE users SET role='employee' WHERE id=1").run(),
        () => f.db.prepare('UPDATE users SET tenant_id=2 WHERE id=1').run(),
        () => f.clock(f.state.tokenExpires * 1000)];
    for (const [index, change] of changes.entries()) {
        if (index === changes.length - 1) f.state.tokenExpires = Math.floor(f.time() / 1000) + 60;
        const stage = await f.phone(); let once = false;
        f.after(async url => { if (!once && url.pathname.endsWith('/phone_numbers')) { once = true; change(); } });
        await assert.rejects(f.service.connect(f.principal, { choice: stage.choices[0].value }), error => ['whatsapp_setup_context_changed', 'whatsapp_setup_expired', 'whatsapp_setup_permission_required'].includes(error.code));
        f.after(async () => {}); f.db.prepare("UPDATE users SET is_active=1,auth_version=0,role='tenant',tenant_id=1 WHERE id=1").run();
        f.clock(Date.now());
    }
    assert.equal(f.db.prepare('SELECT count(*) n FROM tenant_whatsapp_numbers').get().n, 0);
});

test('same-origin pagination copies only cursor, and an external next page never reaches the network', async t => {
    const f = await open(t); let first = true;
    f.state.paging = { next: `${f.origin}/v25.0/me/businesses?after=next-owned&access_token=untrusted-next-token`, cursors: { after: 'next-owned' } };
    f.after(async (url, body) => { if (url.pathname.endsWith('/me/businesses')) {
        if (first) { first = false; f.state.businesses = [{ id: 'second-business', name: 'Second business' }]; f.state.paging = null; }
        else assert.equal(body.data[0].id, 'second-business');
    } });
    const result = await f.complete(); assert.equal(result.choices.length, 2);
    const page = f.calls.find(row => row.query.after === 'next-owned'); assert.ok(page); assert.equal(page.query.access_token, undefined);
    f.after(async () => {}); f.state.paging = { next: 'https://example.invalid/leak?after=other', cursors: { after: 'other' } };
    await assert.rejects(f.complete(), rejectCode('provider_invalid'));
    assert.ok(f.calls.every(row => row.path.startsWith('/v25.0/')));
});

test('actual HTTP chunks split inside an Arabic UTF8 character retain the exact named choice', async t => {
    const f = await open(t); f.state.splitArabic = true;
    const result = await f.complete();
    assert.equal(result.choices[0].label, 'المؤسسة المملوكة');
    assert.equal(result.choices[0].label.includes('\ufffd'), false);
});

test('foreign native number collision rolls back credential/default/audit without revealing another tenant', async t => {
    const f = await open(t); f.db.prepare(`INSERT INTO tenant_whatsapp_numbers(tenant_id,phone_number_id,waba_id,access_token_encrypted,is_default,is_active)
        VALUES(2,'owned-phone','old-waba',?,1,1)`).run(f.encryption.encrypt('other-secret'));
    const before = f.db.prepare('SELECT * FROM tenant_whatsapp_numbers').all(); const stage = await f.phone();
    await assert.rejects(f.service.connect(f.principal, { choice: stage.choices[0].value, setDefault: true }), rejectCode('conflict'));
    assert.deepEqual(f.db.prepare('SELECT * FROM tenant_whatsapp_numbers').all(), before);
    assert.equal(f.db.prepare('SELECT count(*) n FROM activity_logs').get().n, 0);
});

test('legacy ownership blocks reassignment even when the registry table exists without that legacy row', async t => {
    const f = await open(t);
    f.db.prepare("UPDATE tenants SET phone_number_id='owned-phone',waba_id='legacy-waba',access_token_encrypted=? WHERE id=2")
        .run(f.encryption.encrypt('retained-legacy-token'));
    const retained = f.db.prepare('SELECT * FROM tenants WHERE id=2').get(); const stage = await f.phone();
    await assert.rejects(f.service.connect(f.principal, { choice: stage.choices[0].value }), rejectCode('conflict'));
    assert.equal(f.db.prepare('SELECT count(*) n FROM tenant_whatsapp_numbers').get().n, 0);
    assert.deepEqual(f.db.prepare('SELECT * FROM tenants WHERE id=2').get(), retained);
    assert.equal(f.db.prepare('SELECT count(*) n FROM activity_logs').get().n, 0);
});

test('lost webhook ACK preserves verified native connection but never claims confirmation or retries it', async t => {
    const f = await open(t); const stage = await f.phone(); f.state.dropSubscription = true;
    const result = await f.service.connect(f.principal, { choice: stage.choices[0].value, setDefault: true });
    assert.equal(result.connection.connected, true); assert.equal(result.webhook_status, 'unknown');
    assert.equal(f.service.status(f.principal).webhook_status, 'unknown');
    await assert.rejects(f.service.connect(f.principal, { choice: stage.choices[0].value }), rejectCode('choice_changed'));
    assert.equal(f.calls.filter(row => row.path.endsWith('/subscribed_apps')).length, 1);
    const wrongKey = f.make({ encryption: aes() });
    assert.equal(wrongKey.status(f.principal).connection.connected, false);
    assert.equal(f.db.prepare('SELECT count(*) n FROM tenant_whatsapp_numbers').get().n, 1);
});

test('cancel/restart invalidates a response still in flight, and inaccessible SQL owner never starts OAuth', async t => {
    const f = await open(t); const begin = f.service.start(f.principal);
    f.after(async url => { if (url.pathname.endsWith('/me/businesses')) f.service.cancel(f.principal); });
    await assert.rejects(f.service.complete(f.principal, { code: 'owned-code', state: begin.state }), rejectCode('context_changed'));
    assert.equal(f.service.status(f.principal).stage, 'idle');
    assert.throws(() => f.service.start({ ...f.principal, userId: 3, role: 'employee' }), rejectCode('context_changed'));
    assert.throws(() => f.service.start({ ...f.principal, tenantId: 2 }), rejectCode('context_changed'));
});

test('native HTTP facade requires exact browser intent/origin, strict body and current native identity', async t => {
    const f = await open(t); const app = express(); app.use(express.json());
    app.use((req, _res, next) => { const p = f.principal; req.user = { id: p.userId, tenant_id: p.tenantId, role: p.role,
        jti: p.sessionId, auth_version: p.authVersion, exp: p.sessionExpiresAt }; next(); });
    app.use('/api/portal', createGuidedWhatsAppSetupRouter({ service: f.service, appOrigin: 'http://127.0.0.1:12345' }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}/api/portal/whatsapp/setup`;
    const headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:12345', 'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1' };
    assert.equal((await fetch(`${url}/start`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${url}/start`, { method: 'POST', headers: { ...headers, Origin: 'https://foreign.invalid' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${url}/start`, { method: 'POST', headers, body: '{"appId":"browser"}' })).status, 422);
    const started = await fetch(`${url}/start`, { method: 'POST', headers, body: '{}' }); assert.equal(started.status, 200);
    const value = await started.json();
    assert.equal((await fetch(`${url}/complete`, { method: 'POST', headers, body: JSON.stringify({ code: 'owned-code', state: value.state, access_token: TOKEN }) })).status, 422);
    f.verify(false); const denied = await fetch(url); assert.equal(denied.status, 403);
    assert.equal((await denied.text()).includes(TOKEN), false);
});

test('unconfigured Meta keeps authenticated setup status available without a Core origin and rejects every mutation', async t => {
    const f = await open(t); const service = f.make({ config: {} });
    assert.throws(() => createGuidedWhatsAppSetupRouter({ service: f.service, appOrigin: null }), TypeError);
    assert.throws(() => createGuidedWhatsAppSetupRouter({ service, appOrigin: 'https://app.invalid/path' }), TypeError);
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { const p = f.principal; req.user = { id: p.userId, tenant_id: p.tenantId, role: p.role,
        jti: p.sessionId, auth_version: p.authVersion, exp: p.sessionExpiresAt }; next(); });
    app.use(createGuidedWhatsAppSetupRouter({ service, appOrigin: null }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}/whatsapp/setup`;
    const response = await fetch(url); assert.equal(response.status, 200);
    const status = await response.json(); assert.equal(status.configured, false); assert.equal(status.next_action.code, 'configure_meta');
    for (const operation of ['start', 'complete', 'choose', 'connect', 'cancel']) {
        const denied = await fetch(`${url}/${operation}`, { method: 'POST', headers: { Origin: 'https://browser.invalid',
            'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1', 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(denied.status, 403);
    }
    assert.equal(f.calls.length, 0); f.verify(false); assert.equal((await fetch(url)).status, 403);
});
