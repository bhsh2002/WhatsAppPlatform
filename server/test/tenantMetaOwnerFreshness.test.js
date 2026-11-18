import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { createTenantMetaOnboardingRouter } from '../routes/tenantMetaOnboarding.js';

const fixture = async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-meta-owner-fence-'));
    const db = new Database(path.join(directory, 'owned.sqlite'));
    db.exec(`CREATE TABLE tenants(id INTEGER PRIMARY KEY,name TEXT,status TEXT,updated_at TEXT,
        facebook_user_access_token_encrypted TEXT,facebook_user_token_scopes TEXT,facebook_user_token_updated_at TEXT,
        facebook_user_token_status TEXT,facebook_user_token_expires_at TEXT,facebook_user_token_checked_at TEXT,
        facebook_user_token_app_id TEXT,facebook_user_id TEXT,facebook_user_name TEXT,facebook_user_email TEXT,
        facebook_user_picture_url TEXT,facebook_user_profile_updated_at TEXT);
        INSERT INTO tenants(id,name,status) VALUES(1,'Owned tenant','Active'),(2,'Other tenant','Active');
        CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER,role TEXT,is_active INTEGER,auth_version INTEGER,tokens_revoked_at TEXT);
        INSERT INTO users VALUES(1,1,'tenant',1,0,NULL),(2,2,'tenant',1,0,NULL),(3,1,'tenant',1,0,NULL);
        CREATE TABLE revoked_tokens(jti TEXT PRIMARY KEY);
        CREATE TABLE tenant_pages(id INTEGER PRIMARY KEY,tenant_id INTEGER,platform TEXT,page_id TEXT UNIQUE,page_name TEXT,
            page_access_token_encrypted TEXT,page_category TEXT,page_picture_url TEXT,is_active INTEGER DEFAULT 1,
            subscribed_fields TEXT,webhook_subscribed INTEGER,token_status TEXT,token_expires_at TEXT,token_checked_at TEXT,
            token_app_id TEXT,token_scopes TEXT,updated_at TEXT);
        CREATE TABLE activity_logs(id INTEGER PRIMARY KEY,tenant_id INTEGER,tenant_name TEXT,event_type TEXT,description TEXT,status TEXT);
        CREATE TABLE facebook_content_campaigns(id INTEGER PRIMARY KEY,tenant_id INTEGER,linked_page_id INTEGER,status TEXT,next_run_at TEXT,last_error TEXT,updated_at TEXT);
        CREATE TABLE facebook_content_publications(id INTEGER PRIMARY KEY,tenant_id INTEGER,linked_page_id INTEGER,status TEXT,next_attempt_at TEXT,error_code TEXT,error_message TEXT,updated_at TEXT);`);
    let clock = Date.now(); const issued = Math.floor(clock / 1000);
    const user = { id: 1, tenant_id: 1, role: 'tenant', jti: 'owned-synthetic-native-session', auth_version: 0, iat: issued, exp: issued + 3600 };
    let beforeReply = async () => {}; let paginated = false; let unsubscribeSuccess = true; const calls = [];
    const provider = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1'); const call = { method: req.method, path: url.pathname,
            after: url.searchParams.get('after'), inputToken: url.searchParams.get('input_token') };
        calls.push(call); let body;
        if (url.pathname === '/v25.0/oauth/access_token' && req.method === 'POST') {
            let raw = ''; for await (const chunk of req) raw += chunk;
            const form = new URLSearchParams(raw); body = { access_token: form.get('grant_type') ? 'owned-long-user-token' : 'owned-short-user-token' };
        } else if (url.pathname === '/v25.0/debug_token') body = { data: { is_valid: true, app_id: 'owned-meta-app',
            scopes: ['pages_show_list', 'pages_messaging'], expires_at: Math.floor(clock / 1000) + 7200 } };
        else if (url.pathname === '/v25.0/me') body = { id: 'owned-meta-person', name: 'Owned Meta person' };
        else if (url.pathname === '/v25.0/me/accounts') {
            const pages = [{ id: 'owned-page-a', name: 'First named page', access_token: 'owned-page-a-token' },
                { id: 'owned-page-b', name: 'Second named page', access_token: 'owned-page-b-token' }];
            body = paginated && !call.after ? { data: pages.slice(0, 1), paging: {
                next: `http://127.0.0.1:${provider.address().port}/v25.0/me/accounts?after=page-two`, cursors: { after: 'page-two' } } }
                : { data: paginated ? pages.slice(1) : pages };
        } else if (/^\/v25\.0\/owned-page-[ab]\/subscribed_apps$/.test(url.pathname)) body = { success: req.method === 'DELETE' ? unsubscribeSuccess : true };
        else { res.writeHead(404).end('{}'); return; }
        if (await beforeReply(call) === false) { req.socket.destroy(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    });
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const router = createTenantMetaOnboardingRouter({ database: db, now: () => clock,
        encryptToken: value => `encrypted:${value}`, decryptToken: value => value?.replace(/^encrypted:/, '') || null,
        buildReadiness: async () => ({}), listSnapshots: () => [], saveSnapshot: () => ({}),
        requestMeta: async (url, options) => { const response = await fetch(url, { ...options, redirect: 'error' });
            return { ok: response.ok, status: response.status, data: await response.json() }; },
        config: { appId: 'owned-meta-app', appSecret: 'synthetic-owned-meta-secret', redirectUri: 'https://app.invalid/auth/facebook/callback',
            apiBase: `http://127.0.0.1:${provider.address().port}/v25.0`, apiVersion: 'v25.0',
            reviewScopes: ['pages_show_list', 'pages_messaging'], webhookFields: ['feed', 'messages', 'message_echoes'] } });
    const app = express(); app.use(express.json());
    // HTTP fixture supplies only a native principal already authenticated by
    // its owned boundary. The router independently rechecks actual SQL/JTI.
    let currentUser = user; app.use((req, _res, next) => { req.user = { ...currentUser }; next(); }); app.use(router);
    const native = app.listen(0, '127.0.0.1'); await once(native, 'listening');
    t.after(async () => { provider.closeAllConnections(); native.closeAllConnections();
        await Promise.all([new Promise(resolve => provider.close(resolve)), new Promise(resolve => native.close(resolve))]);
        db.close(); fs.rmSync(directory, { recursive: true }); });
    const request = async (method, route, body) => {
        const response = await fetch(`http://127.0.0.1:${native.address().port}${route}`, { method,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() };
    };
    const auth = async () => { const value = await request('GET', '/facebook/auth-url'); assert.equal(value.status, 200); return value.body; };
    const connect = async state => request('POST', '/facebook/connect', { code: 'owned-code', state: state || (await auth()).state });
    const connected = async () => { const value = await connect(); assert.equal(value.status, 200); return value.body; };
    const link = (state, pages = ['owned-page-a', 'owned-page-b']) => request('POST', '/facebook/link-pages', { link_state: state, page_ids: pages });
    return { db, user, calls, request, auth, connect, connected, link,
        reply: callback => { beforeReply = callback; }, principal: value => { currentUser = value; },
        paginate: () => { paginated = true; }, expire: () => { clock = (user.exp + 1) * 1000; }, unsubscribeAck: value => { unsubscribeSuccess = value; } };
};
const denied = value => { assert.equal(value.status, 403); assert.equal(value.body.code, 'META_OWNER_SESSION_REQUIRED'); assert.equal(value.body.clear_previous, true); };
const revoke = f => f.db.prepare('INSERT INTO revoked_tokens VALUES(?)').run(f.user.jti);

test('Facebook profile HTTP await cannot persist a credential or profile after auth-version withdrawal', async t => {
    const f = await fixture(t); f.reply(async call => { if (call.path === '/v25.0/me') f.db.prepare('UPDATE users SET auth_version=1 WHERE id=1').run(); });
    denied(await f.connect()); const row = f.db.prepare('SELECT * FROM tenants WHERE id=1').get();
    assert.equal(row.facebook_user_access_token_encrypted, null); assert.equal(row.facebook_user_id, null);
    assert.equal(f.calls.some(call => call.path === '/v25.0/me/accounts'), false);
});

test('page account discovery cannot insert a credential or dispatch subscription after native role withdrawal', async t => {
    const f = await fixture(t); const context = await f.connected(); const before = f.calls.length;
    f.reply(async call => { if (call.path === '/v25.0/me/accounts') f.db.prepare("UPDATE users SET role='employee' WHERE id=1").run(); });
    denied(await f.link(context.link_state));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tenant_pages').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_logs').get().n, 0);
    assert.deepEqual(f.calls.slice(before).map(call => call.path), ['/v25.0/me/accounts']);
});

test('page debug withdrawal is rethrown instead of being swallowed as a best-effort Meta failure', async t => {
    const f = await fixture(t); const context = await f.connected();
    f.reply(async call => { if (call.inputToken === 'owned-page-a-token') { revoke(f); return false; } });
    denied(await f.link(context.link_state));
    const page = f.db.prepare('SELECT * FROM tenant_pages').get();
    assert.equal(page.token_status, 'unchecked'); assert.equal(page.token_app_id, null); assert.equal(page.webhook_subscribed, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_logs').get().n, 0);
    assert.equal(f.calls.some(call => call.path.endsWith('/subscribed_apps')), false);
});

test('subscription await stops later pages and cannot confirm status or write audit after tenant reassignment', async t => {
    const f = await fixture(t); const context = await f.connected();
    f.reply(async call => { if (call.path === '/v25.0/owned-page-a/subscribed_apps') f.db.prepare('UPDATE users SET tenant_id=2 WHERE id=1').run(); });
    denied(await f.link(context.link_state));
    const rows = f.db.prepare('SELECT * FROM tenant_pages').all(); assert.equal(rows.length, 1);
    assert.equal(rows[0].webhook_subscribed, 0); assert.equal(rows[0].subscribed_fields, '[]');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_logs').get().n, 0);
    assert.equal(f.calls.filter(call => call.path.endsWith('/subscribed_apps')).length, 1);
});

test('unsubscribe acknowledgement after native revocation cannot clear credentials, cancel queues or write audit', async t => {
    const f = await fixture(t);
    f.db.exec(`INSERT INTO tenant_pages(id,tenant_id,page_id,page_name,page_access_token_encrypted,is_active,subscribed_fields,webhook_subscribed,token_status)
        VALUES(1,1,'owned-page-a','Retained page','encrypted:owned-page-a-token',1,'["messages"]',1,'ready');
        INSERT INTO facebook_content_campaigns(id,tenant_id,linked_page_id,status,next_run_at) VALUES(1,1,1,'active','2030-01-01');
        INSERT INTO facebook_content_publications(id,tenant_id,linked_page_id,status,next_attempt_at) VALUES(1,1,1,'pending','2030-01-01');`);
    const snapshot = () => ['tenant_pages', 'facebook_content_campaigns', 'facebook_content_publications', 'activity_logs']
        .map(table => f.db.prepare(`SELECT * FROM ${table}`).all()); const before = snapshot();
    f.reply(async call => { if (call.method === 'DELETE') revoke(f); });
    denied(await f.request('DELETE', '/facebook/disconnect/1')); assert.deepEqual(snapshot(), before);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'DELETE');
});

test('missing or malformed unsubscribe ACK stays remote-unknown while the explicit local disconnect completes once', async t => {
    const f = await fixture(t);
    for (const value of [undefined, 'true', [], false]) {
        f.db.exec(`DELETE FROM tenant_pages; INSERT INTO tenant_pages(id,tenant_id,page_id,page_name,page_access_token_encrypted,is_active,subscribed_fields,webhook_subscribed)
            VALUES(1,1,'owned-page-a','Retained page','encrypted:owned-page-a-token',1,'["messages"]',1);`);
        f.unsubscribeAck(value);
        const response = await f.request('DELETE', '/facebook/disconnect/1');
        assert.equal(response.status, 200); assert.equal(response.body.success, false); assert.equal(response.body.partial_success, true);
        assert.equal(response.body.local_disconnected, true); assert.equal(response.body.webhook_unsubscribed, false);
        assert.equal(f.db.prepare('SELECT is_active FROM tenant_pages').get().is_active, 0);
    }
    assert.equal(f.calls.length, 4); assert.ok(f.calls.every(call => call.method === 'DELETE'));
});

test('OAuth and page-link states cannot cross another native user, fresh JWT or auth generation in the same tenant', async t => {
    const f = await fixture(t); const auth = await f.auth();
    for (const user of [{ ...f.user, id: 3 }, { ...f.user, jti: 'different-valid-native-jti' }]) {
        f.principal(user); assert.equal((await f.connect(auth.state)).status, 400);
    }
    assert.equal(f.calls.length, 0); f.principal(f.user); const connected = await f.connect(auth.state); assert.equal(connected.status, 200);
    const before = f.calls.length;
    for (const user of [{ ...f.user, id: 3 }, { ...f.user, jti: 'different-valid-native-jti' }]) {
        f.principal(user); assert.equal((await f.link(connected.body.link_state)).status, 400);
    }
    f.db.prepare('UPDATE users SET auth_version=1 WHERE id=1').run(); f.principal({ ...f.user, auth_version: 1 });
    assert.equal((await f.link(connected.body.link_state)).status, 400);
    assert.equal(f.calls.length, before); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tenant_pages').get().n, 0);
});

test('fresh checks apply to each actual paginated account response and native expiry before page writes', async t => {
    const f = await fixture(t); const context = await f.connected(); f.paginate();
    f.reply(async call => { if (call.after === 'page-two') f.expire(); });
    denied(await f.link(context.link_state, ['owned-page-b']));
    assert.equal(f.calls.filter(call => call.after === 'page-two').length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tenant_pages').get().n, 0);
    assert.equal(f.calls.some(call => call.path.endsWith('/subscribed_apps')), false);
});

test('a native-identity change inside the final SQL transaction rolls back subscription status and audit together', async t => {
    const f = await fixture(t); const context = await f.connected();
    f.db.exec(`CREATE TRIGGER withdraw_on_page_audit AFTER INSERT ON activity_logs
        WHEN NEW.event_type='page_linked' BEGIN UPDATE users SET auth_version=auth_version+1 WHERE id=1; END;`);
    denied(await f.link(context.link_state, ['owned-page-a']));
    const page = f.db.prepare('SELECT * FROM tenant_pages').get();
    assert.equal(page.webhook_subscribed, 0); assert.equal(page.subscribed_fields, '[]');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_logs').get().n, 0);
    assert.equal(f.db.prepare('SELECT auth_version FROM users WHERE id=1').get().auth_version, 0);
});
