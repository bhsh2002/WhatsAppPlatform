import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';
import { createConnectCallbacksRouter } from '../routes/savanaIntegrations.js';
import { canonicalJson, SavanaIntegrationService, signWebhook } from '../services/savanaIntegration.js';

// The Core/subscription endpoint below is an owned rejection/protocol fixture,
// not an observation of Core, a business grant, or cross-application acceptance.
const organizationId = '4d61396a-46f0-4b49-b4d0-0b56d12c20c2';
const migrationDirectory = new URL('../db/migrations/', import.meta.url);
const serviceUrl = new URL('../services/savanaIntegration.js', import.meta.url).href;
const routeUrl = new URL('../routes/savanaIntegrations.js', import.meta.url).href;
const sqliteUrl = import.meta.resolve('better-sqlite3');
const expressUrl = import.meta.resolve('express');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const connection = (extra = {}) => ({
    id: 'synthetic-lifecycle-connection', organization_id: organizationId,
    source_platform: 'catalog', target_platform: 'wa_savana',
    source_tenant_id: 'synthetic-catalog-account', target_tenant_id: 'synthetic-wa-account',
    source_external_tenant_id: 'catalog:synthetic-shop:1', target_external_tenant_id: 'wa_savana:tenant:1',
    scopes: ['catalog.products.projection'], status: 'pending_authorization', lifecycle_version: 0,
    ...extra,
});
const listen = async server => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
};
const close = async server => {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    });
};
const initialize = filename => {
    const db = new Database(filename);
    db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=5000');
    for (const name of fs.readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort()) {
        db.exec(fs.readFileSync(new URL(name, migrationDirectory), 'utf8'));
    }
    db.exec(`INSERT INTO tenants(id,name,phone,status) VALUES
        (1,'Synthetic lifecycle owner','synthetic-lifecycle-1','Active'),
        (2,'Synthetic foreign owner','synthetic-lifecycle-2','Active');
        CREATE TABLE lifecycle_route_effects(id INTEGER PRIMARY KEY,kind TEXT NOT NULL);
        CREATE TRIGGER lifecycle_route_integration_effect AFTER UPDATE ON savana_integrations
        WHEN OLD.status IS NOT NEW.status OR OLD.webhook_secret_encrypted IS NOT NEW.webhook_secret_encrypted
            OR OLD.scopes_json IS NOT NEW.scopes_json
        BEGIN INSERT INTO lifecycle_route_effects(kind) VALUES('integration'); END;
        CREATE TRIGGER lifecycle_route_visibility_effect AFTER UPDATE ON bot_products
        WHEN OLD.is_active IS NOT NEW.is_active OR OLD.availability IS NOT NEW.availability
        BEGIN INSERT INTO lifecycle_route_effects(kind) VALUES('visibility'); END;`);
    return db;
};

const fixture = async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lifecycle-routes-'));
    const filename = path.join(directory, 'owned.sqlite');
    const db = initialize(filename);
    const secret = () => crypto.randomBytes(32).toString('hex');
    const credentials = { callbackToken: secret(), connectPlatformToken: secret(), subscriptionsPlatformToken: secret(),
        subscriptionsSigningSecret: secret() };
    const state = { current: connection(), currentStatus: 200, badSignature: false, requests: [], gate: null, lostAck: null,
        redirectTransition: null };
    const core = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://owned.invalid');
        if (state.redirectTransition && url.pathname === `/v1/platform-connections/${encodeURIComponent(state.current.id)}/resume`) {
            const bytes = [];
            for await (const chunk of req) bytes.push(chunk);
            const valid = req.method === 'POST' && req.headers['x-savana-platform-code'] === 'wa_savana'
                && req.headers['x-savana-platform-token'] === credentials.connectPlatformToken
                && canonicalJson(JSON.parse(Buffer.concat(bytes).toString('utf8'))) === canonicalJson({
                    external_tenant_id: 'wa_savana:tenant:1', actor_id: 'synthetic-owner',
                });
            if (!valid) { res.writeHead(403); res.end(); return; }
            state.redirectTransition.posts += 1;
            res.writeHead(302, { Location: '/forged-state' }); res.end(); return;
        }
        if (state.redirectTransition && url.pathname === '/forged-state') {
            state.redirectTransition.forgedRequests += 1;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ...state.current, status: 'active', lifecycle_version: 999 })); return;
        }
        const isCurrent = url.pathname === `/v1/platform-connections/${encodeURIComponent(state.current.id)}`;
        const isEntitlement = url.pathname === `/v1/organizations/${organizationId}/entitlements/wa_savana/latest`;
        const expectedToken = isCurrent ? credentials.connectPlatformToken : credentials.subscriptionsPlatformToken;
        const valid = req.method === 'GET' && (isCurrent || isEntitlement)
            && req.headers['x-savana-platform-code'] === 'wa_savana'
            && req.headers['x-savana-platform-token'] === expectedToken
            && (isCurrent ? url.searchParams.size === 1 && url.searchParams.get('external_tenant_id') === 'wa_savana:tenant:1' : !url.search);
        const kind = isCurrent ? 'current' : isEntitlement ? 'entitlement' : 'unexpected';
        state.requests.push({ kind, authenticated: valid });
        if (!valid) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"error":"fixture_denied"}'); return; }
        const current = copy(state.current);
        if (state.gate?.kind === kind) {
            const gate = state.gate; state.gate = null; gate.entered.resolve(); await gate.release.promise;
        }
        res.setHeader('Content-Type', 'application/json');
        if (isCurrent) {
            res.statusCode = state.currentStatus;
            res.end(JSON.stringify(state.currentStatus === 200 ? current : { error: 'fixture_unavailable' }));
            return;
        }
        const payload = { spec_version: '1.0', organization_id: organizationId, platform_code: 'wa_savana',
            subscription_status: 'active', version: 1, issued_at: new Date().toISOString(),
            valid_until: new Date(Date.now() + 86_400_000).toISOString(),
            entitlements: { 'wa_savana.integration.catalog.enabled': true } };
        const signature = `v1=${crypto.createHmac('sha256', credentials.subscriptionsSigningSecret).update(canonicalJson(payload)).digest('hex')}`;
        res.end(JSON.stringify({ data: { payload, signature: state.badSignature ? 'v1=synthetic-invalid' : signature } }));
    });
    const coreOrigin = await listen(core);
    const config = { enabled: true, ...credentials, connectUrl: coreOrigin, subscriptionsUrl: coreOrigin,
        subscriptionsMode: 'central', timeoutMs: 5000, callbackUrl: 'http://127.0.0.1/integrations/connect/events',
        publicAppUrl: 'http://127.0.0.1' };
    const service = new SavanaIntegrationService({ database: db, fetchImpl: globalThis.fetch, config });
    const app = express();
    app.use(express.json({ verify(req, _res, bytes) { req.rawBody = Buffer.from(bytes); } }));
    app.use((req, res, next) => {
        if (state.lostAck && req.path === '/api/integrations/connect/lifecycle') {
            const send = res.send;
            res.send = function dropAfterCommit(body) {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    const check = state.lostAck; state.lostAck = null;
                    check(); res.socket.destroy(); return res;
                }
                return send.call(this, body);
            };
        }
        next();
    });
    app.use('/api/integrations/connect', createConnectCallbacksRouter({ service }));
    const server = http.createServer(app);
    const origin = await listen(server);
    t.after(async () => {
        state.gate?.release.resolve();
        await close(server); await close(core);
        if (db.open) db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const post = async (suffix, body, headers = {}, target = origin) => {
        const response = await fetch(`${target}/api/integrations/connect/${suffix}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Savana-Callback-Token': credentials.callbackToken, ...headers },
            body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
        });
        return { status: response.status, body: await response.json() };
    };
    const deliver = (value, extra = {}) => post('lifecycle', { connection: value,
        action: value.status === 'rejected' ? 'revoked' : value.status }, {
        'X-Savana-Lifecycle-Delivery-Id': crypto.randomUUID(), 'X-Savana-Lifecycle-Version': String(value.lifecycle_version), ...extra,
    });
    const provision = (value = state.current, key = credentials.callbackToken) => post('provision', { connection: value, webhook_secret: key });
    const saved = () => ({ integration: db.prepare('SELECT * FROM savana_integrations WHERE tenant_id=1 AND platform_code=\'catalog\'').get(),
        cursor: db.prepare('SELECT * FROM savana_lifecycle_state ORDER BY connection_id').all(),
        products: db.prepare('SELECT * FROM bot_products ORDER BY id').all(),
        effects: db.prepare('SELECT * FROM lifecycle_route_effects ORDER BY id').all() });
    const cursor = () => service.lifecycle.read(state.current.id);
    const seedProduct = () => {
        service.applyEvent(service.get(1, 'catalog'), { event_type: 'catalog.product_snapshot.v1', source: 'catalog', data: {
            snapshot_id: crypto.randomUUID(), generated_at: new Date().toISOString(), products: [{
                canonical_product_id: crypto.randomUUID(), sku: 'SYNTHETIC-LIFECYCLE-1', name: 'Synthetic lifecycle product',
                online_price: '12.500', currency: 'LYD', is_active: true,
            }],
        } });
        assert.equal(db.prepare('SELECT is_active FROM bot_products').get().is_active, 1);
    };
    const activate = async () => {
        state.current = connection({ status: 'active', lifecycle_version: 1 });
        assert.equal((await provision()).status, 200);
    };
    return { db, directory, filename, state, config, service, origin, server, core, post, deliver, provision, saved, cursor, seedProduct, activate };
};

test('token-only provision commits real pending version zero before ACK, then active one preserves encrypted key', async t => {
    const f = await fixture(t);
    for (const token of ['', 'synthetic-wrong-token']) {
        assert.equal((await f.post('provision', { connection: f.state.current, webhook_secret: 'synthetic-key' },
            { 'X-Savana-Callback-Token': token })).status, 401);
        assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_integrations').get().n, 0);
    }
    assert.equal(f.state.requests.length, 0);
    assert.equal((await f.provision()).status, 200);
    assert.equal(f.cursor().version, 0);
    assert.equal(f.service.get(1, 'catalog').status, 'pending_authorization');
    const encrypted = f.service.get(1, 'catalog').webhook_secret_encrypted;
    assert.ok(encrypted); assert.notEqual(encrypted, f.config.callbackToken);
    assert.deepEqual(f.state.requests.map(row => row.kind), ['current', 'entitlement']);
    assert.ok(f.state.requests.every(row => row.authenticated));
    const active = connection({ status: 'active', lifecycle_version: 1 });
    assert.equal((await f.deliver(active)).status, 200);
    assert.equal(f.cursor().version, 1); assert.equal(f.service.get(1, 'catalog').status, 'active');
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, encrypted);
});

test('ordered callbacks deduplicate without effects and reject old/equal-changed state; rejected stays a raw cursor fact', async t => {
    const f = await fixture(t); await f.activate(); f.seedProduct();
    for (const [status, version] of [['paused', 2], ['degraded', 3], ['revoked', 4]]) {
        assert.equal((await f.deliver(connection({ status, lifecycle_version: version }))).status, 200);
        assert.equal(f.cursor().version, version);
    }
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, null);
    assert.equal(f.db.prepare('SELECT is_active FROM bot_products').get().is_active, 0);
    const before = f.saved(), requests = f.state.requests.length;
    assert.equal((await f.deliver(connection({ status: 'revoked', lifecycle_version: 4 }))).status, 200);
    assert.equal((await f.deliver(connection({ status: 'active', lifecycle_version: 1 }))).status, 409);
    assert.equal((await f.deliver(connection({ status: 'active', lifecycle_version: 4 }))).status, 409);
    assert.equal((await f.deliver(connection({ status: 'revoked', lifecycle_version: 4, scopes: ['catalog.other'] }))).status, 409);
    assert.deepEqual(f.saved(), before); assert.equal(f.state.requests.length, requests);
    assert.equal((await f.deliver(connection({ status: 'rejected', lifecycle_version: 5 }))).status, 200);
    assert.equal(f.cursor().status, 'rejected'); assert.equal(f.service.get(1, 'catalog').status, 'revoked');
});

test('unknown legacy cursor never becomes zero or reactivates from an old hint; actual restrictive current GET is committed', async t => {
    const f = await fixture(t); await f.activate(); f.seedProduct();
    f.db.exec('DELETE FROM savana_lifecycle_state');
    f.db.prepare("UPDATE savana_integrations SET status='revoked',webhook_secret_encrypted=NULL").run();
    f.service.reconcileIntegrationMembershipVisibility(f.service.get(1, 'catalog').id, 1);
    assert.equal(f.cursor(), null);
    const before = f.saved();
    f.state.currentStatus = 503;
    assert.equal((await f.deliver(connection({ status: 'active', lifecycle_version: 1 }))).status, 502);
    assert.deepEqual(f.saved(), before); assert.equal(f.cursor(), null);
    f.state.currentStatus = 200; f.state.current = connection({ status: 'revoked', lifecycle_version: 9 });
    assert.equal((await f.deliver(connection({ status: 'active', lifecycle_version: 1 }))).status, 409);
    assert.equal(f.cursor().version, 9); assert.equal(f.cursor().status, 'revoked');
    assert.equal(f.service.get(1, 'catalog').status, 'revoked');
    assert.equal(f.db.prepare('SELECT is_active FROM bot_products').get().is_active, 0);
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, null);
});

test('callback headers, exact top-level wire and known connection tuple reject before mutation or foreign row creation', async t => {
    const f = await fixture(t); await f.activate();
    const active = connection({ status: 'active', lifecycle_version: 2 });
    const before = f.saved(), requests = f.state.requests.length;
    for (const headers of [
        { 'X-Savana-Lifecycle-Delivery-Id': 'not-a-uuid' }, { 'X-Savana-Lifecycle-Version': '02' },
        { 'X-Savana-Lifecycle-Version': '2.0' }, { 'X-Savana-Lifecycle-Version': '2e0' },
        { 'X-Savana-Lifecycle-Version': '3' }, { 'X-Savana-Lifecycle-Version': '-1' },
    ]) assert.equal((await f.deliver(active, headers)).status, 422);
    assert.equal((await f.post('lifecycle', { connection: active, action: 'active' })).status, 422);
    assert.equal((await f.post('lifecycle', { connection: active, action: 'paused' }, {
        'X-Savana-Lifecycle-Delivery-Id': crypto.randomUUID(), 'X-Savana-Lifecycle-Version': '2',
    })).status, 422);
    assert.equal((await f.post('lifecycle', { connection: active, action: 'active', extra: true })).status, 422);
    for (const changed of [
        { target_external_tenant_id: 'wa_savana:tenant:2' },
        { organization_id: crypto.randomUUID() }, { source_tenant_id: 'foreign-catalog-account' },
        { source_platform: 'sawemly' },
    ]) assert.equal((await f.deliver({ ...active, ...changed })).status, 409);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_integrations WHERE tenant_id=2').get().n, 0);
    assert.deepEqual(f.saved(), before); assert.equal(f.state.requests.length, requests);
});

test('same-version provisioning preserves exact encrypted bytes and rejects a replacement secret without a new effect', async t => {
    const f = await fixture(t); await f.activate();
    const before = f.saved(), requests = f.state.requests.length;
    assert.equal((await f.provision()).status, 200);
    assert.deepEqual(f.saved(), before);
    assert.equal((await f.provision(f.state.current, 'synthetic-different-key')).status, 409);
    assert.deepEqual(f.saved(), before); assert.equal(f.state.requests.length, requests);
});

test('server-only lifecycle transition rejects a redirect before any forged higher active state can be followed', async t => {
    const f = await fixture(t); await f.activate();
    const revoked = connection({ status: 'revoked', lifecycle_version: 2 });
    assert.equal((await f.deliver(revoked)).status, 200);
    f.state.current = revoked;
    f.state.redirectTransition = { posts: 0, forgedRequests: 0 };
    const before = f.saved(), requests = f.state.requests.length;
    await assert.rejects(f.service.transition(f.service.get(1, 'catalog'), 'resume', 'synthetic-owner'), {
        statusCode: 502, code: 'control_plane_unavailable',
    });
    assert.equal(f.state.redirectTransition.posts, 1);
    assert.equal(f.state.redirectTransition.forgedRequests, 0);
    assert.deepEqual(f.saved(), before); assert.equal(f.state.requests.length, requests);
    assert.equal(f.cursor().version, 2); assert.equal(f.service.get(1, 'catalog').status, 'revoked');
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, null);
});

test('degraded same-version key repair requires fresh proof and preserves authority, entitlement and cursor before resume', async t => {
    const f = await fixture(t); await f.activate();
    const degraded = connection({ status: 'degraded', lifecycle_version: 2 });
    assert.equal((await f.deliver(degraded)).status, 200);
    f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL').run();
    f.state.current = degraded;
    const before = f.saved(), requests = f.state.requests.length;
    assert.equal((await f.provision()).status, 200);
    const repaired = f.service.get(1, 'catalog');
    assert.ok(repaired.webhook_secret_encrypted);
    assert.equal(repaired.status, 'degraded'); assert.deepEqual(f.saved().cursor, before.cursor);
    for (const key of ['organization_id', 'connection_id', 'local_platform_tenant_id', 'remote_platform_tenant_id',
        'remote_external_tenant_id', 'scopes_json', 'entitlement_payload_json', 'entitlement_signature', 'entitlement_valid_until']) {
        assert.equal(repaired[key], before.integration[key]);
    }
    assert.deepEqual(f.state.requests.slice(requests).map(row => row.kind), ['current']);
    const stable = f.saved(); assert.equal((await f.provision()).status, 200); assert.deepEqual(f.saved(), stable);
    assert.equal((await f.deliver(connection({ status: 'active', lifecycle_version: 1 }))).status, 409);
    assert.deepEqual(f.saved(), stable);
    assert.equal((await f.deliver(connection({ status: 'active', lifecycle_version: 3 }))).status, 200);
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, repaired.webhook_secret_encrypted);
    assert.equal(f.cursor().version, 3);
});

test('visibility SQL failure prevents ACK and atomically rolls back status, ciphertext, cursor and product visibility', async t => {
    const f = await fixture(t); await f.activate(); f.seedProduct();
    const before = f.saved();
    f.db.exec(`CREATE TRIGGER lifecycle_route_fail_visibility BEFORE UPDATE OF is_active ON bot_products
        WHEN OLD.is_active=1 AND NEW.is_active=0 BEGIN SELECT RAISE(ABORT,'synthetic_visibility_failure'); END;`);
    const revoked = connection({ status: 'revoked', lifecycle_version: 2 });
    assert.equal((await f.deliver(revoked)).status, 500);
    assert.deepEqual(f.saved(), before);
    f.db.exec('DROP TRIGGER lifecycle_route_fail_visibility');
    assert.equal((await f.deliver(revoked)).status, 200);
    assert.equal(f.cursor().version, 2); assert.equal(f.service.get(1, 'catalog').status, 'revoked');
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, null);
    assert.equal(f.db.prepare('SELECT is_active FROM bot_products').get().is_active, 0);
});

test('replacement binding retains Catalog history and hides old products until a fresh new-account snapshot arrives', async t => {
    const f = await fixture(t); await f.activate();
    const first = copy(f.state.current);
    const generatedAt = Date.now() - 10_000;
    const product = (sku, name) => ({ canonical_product_id: crypto.randomUUID(), sku, name,
        online_price: '12.500', currency: 'LYD', is_active: true });
    const postSnapshot = async (bound, key, generated, products) => {
        const body = { spec_version: '1.0', event_id: crypto.randomUUID(),
            event_type: 'catalog.product_snapshot.v1', source: 'catalog', organization_id: bound.organization_id,
            platform_tenant_id: bound.source_tenant_id, entity_id: null, entity_version: 1,
            occurred_at: new Date().toISOString(), idempotency_key: `synthetic-snapshot:${crypto.randomUUID()}`,
            correlation_id: crypto.randomUUID(), causation_id: null,
            data: { snapshot_id: crypto.randomUUID(), generated_at: new Date(generated).toISOString(),
                page_number: 1, page_count: 1, complete: true, products } };
        const bytes = Buffer.from(JSON.stringify(body)), timestamp = String(Math.floor(Date.now() / 1000));
        const deliveryId = crypto.randomUUID();
        const response = await f.post('events', body, { 'X-Savana-Connection-Id': bound.id,
            'X-Savana-Delivery-Id': deliveryId, 'X-Savana-Timestamp': timestamp,
            'X-Savana-Signature': signWebhook(key, timestamp, deliveryId, bytes) });
        assert.equal(response.status, 200); assert.equal(response.body.accepted, true);
    };
    await postSnapshot(first, f.config.callbackToken, generatedAt, [product('SYNTHETIC-ACCOUNT-A', 'Synthetic account A product')]);
    assert.equal(f.db.prepare("SELECT is_active FROM bot_products WHERE sku='SYNTHETIC-ACCOUNT-A'").get().is_active, 1);
    assert.equal((await f.deliver({ ...first, status: 'revoked', lifecycle_version: 2 })).status, 200);
    assert.equal(f.db.prepare("SELECT is_active FROM bot_products WHERE sku='SYNTHETIC-ACCOUNT-A'").get().is_active, 0);
    const history = () => ({
        pages: f.db.prepare('SELECT * FROM savana_product_snapshot_pages ORDER BY snapshot_id,page_number').all(),
        streams: f.db.prepare('SELECT * FROM savana_product_snapshot_streams ORDER BY event_type').all(),
        events: f.db.prepare('SELECT * FROM savana_integration_events ORDER BY id').all(),
        memberships: f.db.prepare('SELECT * FROM savana_product_snapshot_memberships ORDER BY projection_key').all(),
    });
    const prior = history();
    assert.equal(prior.pages.length, 1); assert.equal(prior.streams.length, 1); assert.equal(prior.events.length, 1);
    assert.equal(prior.memberships.length, 1); assert.equal(prior.memberships[0].is_active, 1);
    const second = connection({ id: 'synthetic-lifecycle-connection-b', source_tenant_id: 'synthetic-catalog-account-b',
        source_external_tenant_id: 'catalog:synthetic-shop:2', status: 'active', lifecycle_version: 1 });
    const secondKey = crypto.randomBytes(32).toString('hex');
    f.state.current = second;
    assert.equal((await f.provision(second, secondKey)).status, 200);
    assert.equal(f.service.get(1, 'catalog').connection_id, second.id);
    assert.equal(f.service.get(1, 'catalog').remote_platform_tenant_id, second.source_tenant_id);
    assert.equal(f.service.get(1, 'catalog').status, 'active');
    const rebound = history();
    // Rebinding preserves the prior stream/page/event bytes and ordering marks.
    // It only withdraws that lineage's visibility; it does not re-label its data.
    assert.deepEqual(rebound.pages, prior.pages); assert.deepEqual(rebound.streams, prior.streams);
    assert.deepEqual(rebound.events, prior.events);
    assert.equal(rebound.memberships.length, prior.memberships.length);
    const { is_active: _wasActive, ...oldMembership } = prior.memberships[0];
    const { is_active: _nowInactive, ...retainedMembership } = rebound.memberships[0];
    assert.deepEqual(retainedMembership, oldMembership); assert.equal(rebound.memberships[0].is_active, 0);
    assert.equal(f.db.prepare("SELECT is_active FROM bot_products WHERE sku='SYNTHETIC-ACCOUNT-A'").get().is_active, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_lifecycle_state').get().n, 2);
    await postSnapshot(second, secondKey, generatedAt + 5_000, [product('SYNTHETIC-ACCOUNT-B', 'Synthetic account B product')]);
    assert.equal(f.db.prepare("SELECT is_active FROM bot_products WHERE sku='SYNTHETIC-ACCOUNT-B'").get().is_active, 1);
    assert.equal(f.db.prepare("SELECT is_active FROM bot_products WHERE sku='SYNTHETIC-ACCOUNT-A'").get().is_active, 0);
    // Normal fresh-snapshot rotation replaces staged pages/current memberships.
    // Durable event history and the old hidden product remain intact.
    assert.equal(history().events.length, 2);
    assert.deepEqual(history().events[0], prior.events[0]);
    assert.equal(history().memberships.length, 1);
    assert.equal(history().memberships[0].is_active, 1);
});

test('current-state and entitlement await races cannot overwrite a concurrently changed local binding', async t => {
    for (const kind of ['current', 'entitlement']) {
        const f = await fixture(t);
        const item = f.service.getOrCreate(1, 'catalog');
        const entered = deferred(), release = deferred();
        f.state.gate = { kind, entered, release };
        const pending = f.provision();
        await entered.promise;
        f.db.prepare("UPDATE savana_integrations SET status='error',last_error='synthetic_concurrent_owner_change' WHERE id=?").run(item.id);
        const concurrentlyChanged = f.saved(); release.resolve();
        assert.equal((await pending).status, 409);
        assert.deepEqual(f.saved(), concurrentlyChanged); assert.equal(f.cursor(), null);
    }
});

test('invalid entitlement cannot partially provision a key or ordering cursor after a successful current-state GET', async t => {
    const f = await fixture(t);
    f.state.badSignature = true;
    assert.equal((await f.provision()).status, 401);
    const item = f.service.get(1, 'catalog');
    assert.equal(item.status, 'disconnected'); assert.equal(item.connection_id, null);
    assert.equal(item.webhook_secret_encrypted, null); assert.equal(f.cursor(), null);
    assert.equal(f.saved().effects.length, 0);
    assert.deepEqual(f.state.requests.map(row => row.kind), ['current', 'entitlement']);
});

test('pending-zero compensation only clears unused key after exact fresh proof, and a proven refill never rotates on retry', async t => {
    const f = await fixture(t);
    assert.equal((await f.provision()).status, 200);
    const cursor = copy(f.cursor());
    assert.equal((await f.post('lifecycle', { connection: f.state.current, action: 'revoked' })).status, 200);
    assert.equal(f.service.get(1, 'catalog').status, 'pending_authorization');
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, null);
    const cleaned = f.cursor();
    for (const key of ['connectionId', 'version', 'status', 'scopes', 'binding', 'snapshotFingerprint']) {
        assert.deepEqual(cleaned[key], cursor[key]);
    }
    assert.equal(cleaned.pendingCleanupVersion, 0);
    assert.equal(cleaned.pendingCleanupFingerprint, cleaned.snapshotFingerprint);
    assert.equal((await f.provision()).status, 200);
    const encrypted = f.service.get(1, 'catalog').webhook_secret_encrypted;
    assert.ok(encrypted);
    const before = f.saved(); assert.equal((await f.provision()).status, 200); assert.deepEqual(f.saved(), before);
    // Retrying an already-applied cleanup must not erase a subsequently repaired
    // key for that same canonical pending tuple, including after lost ACK.
    assert.equal((await f.post('lifecycle', { connection: connection(), action: 'revoked' })).status, 200);
    assert.deepEqual(f.saved(), before);
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, encrypted);
    f.state.current = connection({ status: 'active', lifecycle_version: 1 });
    assert.equal((await f.post('lifecycle', { connection: connection(), action: 'revoked' })).status, 409);
    assert.deepEqual(f.saved(), before);
    assert.equal((await f.post('lifecycle', { connection: f.state.current, action: 'revoked' })).status, 503);
    assert.equal(f.service.get(1, 'catalog').webhook_secret_encrypted, encrypted);
});

const childProgram = `
import readline from 'node:readline';
import http from 'node:http';
const lines=readline.createInterface({input:process.stdin});
let server,db;
lines.on('line',async line=>{
  try {
    const input=JSON.parse(line);
    if(input.stop){await new Promise(done=>server.close(done));server.closeAllConnections();db.close();lines.close();return;}
    const [{default:Database},{default:express},{SavanaIntegrationService},{createConnectCallbacksRouter}]=await Promise.all([
      import(input.sqliteUrl),import(input.expressUrl),import(input.serviceUrl),import(input.routeUrl)]);
    db=new Database(input.filename);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
    const service=new SavanaIntegrationService({database:db,config:input.config,fetchImpl:globalThis.fetch});
    const app=express();app.use(express.json());app.use('/api/integrations/connect',createConnectCallbacksRouter({service}));
    server=http.createServer(app);await new Promise(done=>server.listen(0,'127.0.0.1',done));
    process.stdout.write(JSON.stringify({port:server.address().port,node:process.version})+'\\n');
  }catch{process.stderr.write('owned_lifecycle_child_failed\\n');process.exit(1);}
});
`;

test('lost HTTP ACK retries once as a duplicate, and a fresh OS process retains the committed cursor without replay', async t => {
    const f = await fixture(t); await f.activate(); f.seedProduct();
    const revoked = connection({ status: 'revoked', lifecycle_version: 2 });
    let committedBeforeDrop = false;
    f.state.lostAck = () => {
        assert.equal(f.cursor().version, 2); assert.equal(f.service.get(1, 'catalog').status, 'revoked');
        assert.equal(f.db.prepare('SELECT is_active FROM bot_products').get().is_active, 0);
        committedBeforeDrop = true;
    };
    await assert.rejects(f.deliver(revoked)); assert.equal(committedBeforeDrop, true);
    const before = f.saved(), requests = f.state.requests.length;
    assert.equal((await f.deliver(revoked)).status, 200); assert.deepEqual(f.saved(), before);
    await close(f.server); f.db.close();
    const env = { PATH: path.dirname(process.execPath), NODE_OPTIONS: '', TZ: 'UTC' };
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childProgram], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', data => { stderr += data; });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    const started = new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('owned child startup timed out')), 10_000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', data => {
            output += data;
            if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); }
        });
        child.once('exit', code => { clearTimeout(timer); if (!output.includes('\n')) reject(new Error(`owned child failed (${code}): ${stderr}`)); });
    });
    // Private credentials cross only the anonymous stdin pipe, never argv/env/log.
    child.stdin.write(`${JSON.stringify({ filename: f.filename, config: f.config, serviceUrl, routeUrl, sqliteUrl, expressUrl })}\n`);
    const ready = await started; assert.equal(ready.node, process.version);
    const target = `http://127.0.0.1:${ready.port}`;
    assert.equal((await f.post('lifecycle', { connection: revoked, action: 'revoked' }, {
        'X-Savana-Lifecycle-Delivery-Id': crypto.randomUUID(), 'X-Savana-Lifecycle-Version': '2',
    }, target)).status, 200);
    for (const value of [connection({ status: 'active', lifecycle_version: 1 }), connection({ status: 'active', lifecycle_version: 2 })]) {
        assert.equal((await f.post('lifecycle', { connection: value, action: 'active' }, {
            'X-Savana-Lifecycle-Delivery-Id': crypto.randomUUID(), 'X-Savana-Lifecycle-Version': String(value.lifecycle_version),
        }, target)).status, 409);
    }
    const exit = once(child, 'exit'); child.stdin.end('{"stop":true}\n');
    assert.deepEqual(await exit, [0, null]); assert.equal(stderr, '');
    const persisted = new Database(f.filename, { readonly: true });
    try {
        assert.deepEqual(persisted.prepare('SELECT * FROM savana_integrations WHERE tenant_id=1 AND platform_code=\'catalog\'').get(), before.integration);
        assert.deepEqual(persisted.prepare('SELECT * FROM savana_lifecycle_state ORDER BY connection_id').all(), before.cursor);
        assert.deepEqual(persisted.prepare('SELECT * FROM bot_products ORDER BY id').all(), before.products);
        assert.deepEqual(persisted.prepare('SELECT * FROM lifecycle_route_effects ORDER BY id').all(), before.effects);
    } finally { persisted.close(); }
    assert.equal(f.state.requests.length, requests);
});
