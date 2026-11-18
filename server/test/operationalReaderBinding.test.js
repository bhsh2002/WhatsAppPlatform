import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { createOperationalReadServices } from '../services/operationalReadSetup.js';
import { createOperationalReadSetupRouter } from '../routes/operationalReadSetup.js';
import {runMigrationsSync} from '../db/migrator.js';

// Contract-response unit fixtures only. Live owner HTTP enrollment/approval is
// verified separately; these tests never seed a central registry/read grant.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-reader-binding', use: 'sig' };
const selection = { consumer_installation_id: 'approved-wa-installation', activity_id: 'approved-activity' };
const scope = { organization_id: 'verified-org', activity_id: selection.activity_id, branch_id: null, warehouse_id: null };
const nativeAccount = 'server-resolved-native-account';
const centralActor = 'verified-central-reader';

const cipher = () => {
    const key = crypto.randomBytes(32);
    return {
        encrypt(value) {
            const iv = crypto.randomBytes(12);
            const aes = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([aes.update(value), aes.final()]);
            return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64');
        },
        decrypt(value) {
            const body = Buffer.from(value, 'base64');
            const aes = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
            aes.setAuthTag(body.subarray(12, 28));
            return Buffer.concat([aes.update(body.subarray(28)), aes.final()]).toString();
        },
    };
};

const fixture = async t => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys=ON');
    runMigrationsSync(database);
    database.exec(`INSERT INTO tenants(id,name,phone,status) VALUES
        (1,'Synthetic binding activity','15550000001','Active'),
        (2,'Synthetic foreign activity','15550000002','Active');
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version) VALUES
        (1,'binding-owner','unused-unit-hash','tenant',1,1,0),
        (2,'binding-employee','unused-unit-hash','tenant',1,1,0),
        (3,'binding-foreign','unused-unit-hash','tenant',2,1,0);
        INSERT INTO bot_products(tenant_id,name,sku,price,currency,is_active,availability,approval_status)
        VALUES(1,'Preserved native product','NATIVE-KEEP',17,'USD',0,'hidden','draft');`);
    t.after(() => database.close());
    const now = Date.now();
    const principal = { userId: 1, tenantId: 1, sessionId: crypto.randomUUID(), authVersion: 0,
        issuedAt: Math.floor(now / 1000), role: 'tenant', sessionExpiresAt: Math.floor(now / 1000) + 3600 };
    const config = { enabled: true, sharedReadsEnabled: true, centerOrigin: 'https://center.invalid',
        platformToken: 'synthetic-private-platform-service', oidcIssuer: 'https://center.invalid',
        oidcClientId: 'synthetic-wa-reader-binding',
        oidcRedirectUri: 'https://wa.invalid/api/portal/integrations/shared-read-setup/callback',
        oidcAuthorizationEndpoint: 'https://portal.invalid/oauth/authorize',
        oidcTokenEndpoint: 'https://center.invalid/v1/oidc/token',
        oidcJwksUri: 'https://center.invalid/.well-known/jwks.json',
        oidcUserInfoEndpoint: 'https://center.invalid/v1/oidc/userinfo' };
    let authorization;
    let token;
    let transform = (path, payload) => payload;
    const calls = [];
    const context = () => ({ scope, actor_id: centralActor, consumer_platform: 'wa_savana',
        consumer_account_id: nativeAccount, consumer_installation_id: selection.consumer_installation_id,
        checked_at: new Date(now).toISOString(), valid_until: new Date(now + 120_000).toISOString(),
        authorization_revision: 'a'.repeat(64), permissions: ['data.read'], freshness_max_age_seconds: 300 });
    const native = () => ({ id: nativeAccount, organization_id: scope.organization_id,
        platform_code: 'wa_savana', external_tenant_id: 'wa_savana:tenant:1', status: 'active',
        binding_method: 'operational_owner_review', organization_name: 'Public synthetic organization' });
    const fetchImpl = async (input, options = {}) => {
        const url = new URL(input);
        calls.push({ url, options });
        let payload;
        switch (url.pathname) {
        case '/v1/oidc/token': {
            const sign = value => jwt.sign({ sub: centralActor, organization_id: scope.organization_id,
                iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300, ...value }, privateKey,
            { algorithm: 'RS256', keyid: jwk.kid, issuer: config.oidcIssuer, audience: config.oidcClientId });
            token = sign({ token_use: 'access', scope: 'openid profile organization' });
            payload = { token_type: 'Bearer', access_token: token,
                id_token: sign({ token_use: 'id', nonce: authorization.searchParams.get('nonce') }) };
            break;
        }
        case '/.well-known/jwks.json': payload = { keys: [jwk] }; break;
        case '/v1/oidc/userinfo': payload = { sub: centralActor, organization_id: scope.organization_id }; break;
        case '/v1/platform-bindings': payload = [native()]; break;
        case '/v1/integration/context': payload = { spec_version: '1.0', context: context() }; break;
        case '/v1/integration/capabilities': payload = { spec_version: '1.0', platforms: ['pos', 'catalog', 'wa_savana', 'sawemly'],
            capabilities: [{ code: 'products.read' }] }; break;
        case '/v1/integration/eligibility': payload = { spec_version: '1.0', scope, actor_id: centralActor,
            consumer_platform: 'wa_savana', capability_code: 'products.read', view_requirements: true,
            request_review: false, execute: false, authorization_token: false, blockers: [] }; break;
        default: assert.fail('Reader setup attempted an undeclared data/business request');
        }
        const result = await transform(url.pathname, payload, options);
        return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    };
    const { setupService: service, readService, store } = createOperationalReadServices({
        database, config, fetchImpl, encryption: cipher(),
    });
    authorization = new URL((await service.authorize(principal)).authorization_url);
    await service.callback(principal, { state: authorization.searchParams.get('state'), code: 'unit-signed-code' });
    calls.length = 0;
    const effects = () => Object.fromEntries(['bot_products', 'messages', 'savana_product_projection',
        'savana_service_requests', 'savana_integration_outbox', 'billing_usage_events', 'billing_ledger',
        'facebook_content_campaigns', 'facebook_content_publications','billing_payments',
        'savana_collaborative_executions','savana_collaborative_effects','savana_native_action_facts','savana_native_media_assets'].map(table => [table,
        database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    return { database, principal, config, service, readService, store, calls, context, native, effects,
        token: () => token, mutate: value => { transform = value; } };
};

test('native reader binding verifies server account/current actor/exact scope and stores only encrypted credentials without effects', async t => {
    const f = await fixture(t);
    const before = f.effects();
    assert.equal(f.store.load(f.principal), null);
    const verifiedOwner=f.database.prepare('SELECT user_id,central_actor_id,organization_id,native_role FROM savana_native_owner_proofs').all();
    assert.deepEqual(verifiedOwner,[{user_id:1,central_actor_id:centralActor,organization_id:scope.organization_id,native_role:'tenant'}]);
    const result = await f.service.bindReader(f.principal, selection);
    assert.equal(result.bound, true);
    assert.equal(result.read_ready, true);
    assert.equal(result.execution_ready, false);
    assert.equal(result.pricing_use_allowed, false);
    assert.equal(JSON.stringify(result).includes(f.token()), false);
    assert.equal(JSON.stringify(result).includes(f.config.platformToken), false);
    assert.deepEqual(f.calls.map(call => call.url.pathname), ['/v1/oidc/userinfo', '/v1/platform-bindings',
        '/v1/integration/context', '/v1/integration/capabilities', '/v1/integration/eligibility']);
    const native = f.calls[1];
    assert.equal(native.url.searchParams.get('external_tenant_id'), 'wa_savana:tenant:1');
    assert.equal(native.options.headers['X-Savana-Platform-Code'], 'wa_savana');
    assert.equal(native.options.headers['X-Savana-Platform-Token'], f.config.platformToken);
    assert.equal(native.options.cache, 'no-store');
    for (const { options } of f.calls) assert.equal(options.redirect, 'error');
    assert.deepEqual(f.store.load(f.principal).scope, scope);
    assert.equal(f.store.load(f.principal).consumerAccountId, nativeAccount);
    const encrypted = f.database.prepare('SELECT encrypted_credentials FROM savana_delegated_read_sessions').get().encrypted_credentials;
    assert.equal(encrypted.includes(f.token()), false);
    assert.deepEqual(f.effects(), before);
    assert.equal((await f.service.status(f.principal)).read_ready, true);
});

test('missing, ambiguous or foreign native account rows cannot become a local read binding', async t => {
    for (const change of [() => [], row => [row, { ...row, id: 'ambiguous-other' }],
        row => [{ ...row, id: '' }], row => [{ ...row, status: 'suspended' }],
        row => [{ ...row, external_tenant_id: 'wa_savana:tenant:2' }],
        row => [{ ...row, platform_code: 'catalog' }], row => [{ ...row, organization_id: 'foreign-org' }]]) {
        const f = await fixture(t);
        f.mutate((path, payload) => path === '/v1/platform-bindings' ? change(payload[0]) : payload);
        await assert.rejects(f.service.bindReader(f.principal, selection), { code: 'shared_read_native_binding_required', status: 403 });
        assert.equal(f.store.load(f.principal), null);
        assert.equal(f.calls.some(call => call.url.pathname === '/v1/integration/context'), false);
    }
});

test('foreign context identity/install/scope, missing data grant or expired context cannot authorize selection', async t => {
    for (const change of [{ consumer_account_id: 'foreign-native-account' }, { consumer_installation_id: 'foreign-install' },
        { actor_id: 'foreign-actor' }, { consumer_platform: 'sawemly' },
        { scope: { ...scope, organization_id: 'foreign-org' } }, { scope: { ...scope, activity_id: 'other-activity' } },
        { scope: { ...scope, branch_id: 'other-branch' } }, { permissions: [] },
        { valid_until: new Date(Date.now() - 1000).toISOString() }]) {
        const f = await fixture(t);
        f.mutate((path, payload) => path === '/v1/integration/context' ? { ...payload, context: { ...payload.context, ...change } } : payload);
        await assert.rejects(f.service.bindReader(f.principal, selection), { code: 'shared_product_response_scope_invalid', status: 403 });
        assert.equal(f.store.load(f.principal), null);
    }
});

test('pending reader approval and central current-membership/session failures never persist a binding', async t => {
    for (const [status, code] of [[403, 'integration_grant_required'], [403, 'integration_scope_forbidden'],
        [401, 'invalid_token'], [503, 'integration_runtime_unavailable']]) {
        const f = await fixture(t);
        f.mutate((path, payload) => path === '/v1/integration/context'
            ? Response.json({ error: { code, message: 'private upstream detail is not authority' } }, { status }) : payload);
        await assert.rejects(f.service.bindReader(f.principal, selection), { code, status });
        assert.equal(f.store.load(f.principal), null);
    }
});

test('a changed OIDC actor or organization cannot be borrowed from a stored owner session', async t => {
    for (const changed of [{ sub: 'another-actor' }, { organization_id: 'another-org' }]) {
        const f = await fixture(t);
        f.mutate((path, payload) => path === '/v1/oidc/userinfo' ? { ...payload, ...changed } : payload);
        await assert.rejects(f.service.bindReader(f.principal, selection), { code: 'shared_product_read_session_required' });
        assert.equal(f.store.load(f.principal), null);
        assert.equal(f.calls.length, 1);
    }
});

test('employee, foreign native user, changed session/auth generation and expired local sessions cannot borrow an owner identity', async t => {
    const f = await fixture(t);
    for (const change of [{ userId: 2 }, { userId: 3, tenantId: 2 }, { tenantId: 2 },
        { sessionId: 'other-native-session' }, { authVersion: 1 }, { sessionExpiresAt: Math.floor(Date.now() / 1000) - 1 }]) {
        await assert.rejects(f.service.bindReader({ ...f.principal, ...change }, selection), { code: 'shared_product_read_session_required', status: 403 });
    }
    assert.equal(f.calls.length, 0);
    assert.equal(f.store.load(f.principal), null);
});

test('reader selection accepts no actor, account, organization, permission, approved flag or token claim', async t => {
    const f = await fixture(t);
    for (const [name, value] of Object.entries({ actor_id: centralActor, organization_id: scope.organization_id,
        consumer_account_id: nativeAccount, enrollment_id: 'claimed-enrollment', fields: ['name'],
        permissions: ['data.read'], approved: true, access_token: 'browser-private-token' })) {
        await assert.rejects(f.service.bindReader(f.principal, { ...selection, [name]: value }),
            { code: 'shared_read_setup_request_invalid', status: 422 });
    }
    for (const value of [null, [], {}, { ...selection, warehouse_id: 'warehouse-without-branch' },
        { ...selection, branch_id: 42 }, { ...selection, consumer_installation_id: '' }]) {
        await assert.rejects(f.service.bindReader(f.principal, value), { code: 'shared_read_setup_request_invalid', status: 422 });
    }
    assert.equal(f.calls.length, 0);
    assert.equal(f.store.load(f.principal), null);
});

test('logout, disconnect and reconnect while readiness awaits cannot save a stale reader session', async t => {
    for (const action of ['logout', 'disconnect', 'reconnect']) {
        const f = await fixture(t);
        f.mutate(async (path, payload) => {
            if (path === '/v1/integration/eligibility') {
                if (action === 'logout') f.database.prepare('UPDATE users SET auth_version=auth_version+1 WHERE id=?').run(f.principal.userId);
                else if (action === 'disconnect') f.service.disconnect(f.principal);
                else await f.service.authorize(f.principal);
            }
            return payload;
        });
        await assert.rejects(f.service.bindReader(f.principal, selection), { code: 'shared_product_read_session_required' });
        assert.equal(f.store.load(f.principal), null);
    }
});

test('a former successful binding never makes status ready after the actual grant is removed', async t => {
    const f = await fixture(t);
    await f.service.bindReader(f.principal, selection);
    assert.equal((await f.service.status(f.principal)).read_ready, true);
    f.mutate((path, payload) => path === '/v1/integration/context'
        ? Response.json({ error: { code: 'integration_grant_required' } }, { status: 403 }) : payload);
    const status = await f.service.status(f.principal);
    assert.equal(status.read_ready, false);
    assert.equal(status.read_context, undefined);
    assert.equal(status.blockers.some(item => item.code === 'integration_grant_required'), true);
});

test('a newer reader selection supersedes an older awaited response without overwriting the new binding', async t => {
    const f = await fixture(t);
    let entered;
    let release;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    let eligibilityCalls = 0;
    f.mutate(async (path, payload) => {
        if (path === '/v1/integration/eligibility' && eligibilityCalls++ === 0) {
            entered();
            await gate;
        }
        return payload;
    });
    const older = f.service.bindReader(f.principal, selection).then(result => ({ result }), error => ({ error }));
    await waiting;
    assert.equal((await f.service.bindReader(f.principal, selection)).bound, true);
    const newest = f.store.load(f.principal).bindingId;
    release();
    const completed = await older;
    assert.equal(completed.result, undefined);
    assert.equal(['shared_product_read_session_required', 'shared_read_selection_superseded'].includes(completed.error?.code), true);
    assert.equal(f.store.load(f.principal).bindingId, newest);
});

test('starting a valid new selection clears a previous local read binding even when the new grant is pending', async t => {
    const f = await fixture(t);
    await f.service.bindReader(f.principal, selection);
    assert.ok(f.store.load(f.principal));
    f.mutate((path, payload) => path === '/v1/integration/context'
        ? Response.json({ error: { code: 'integration_grant_required' } }, { status: 403 }) : payload);
    await assert.rejects(f.service.bindReader(f.principal, { ...selection, activity_id: 'new-pending-activity' }),
        { code: 'integration_grant_required' });
    assert.equal(f.store.load(f.principal), null);
    assert.equal((await f.service.status(f.principal)).read_ready, false);
});

test('actual native reader HTTP route requires intent and strict selectors, with no-store safe responses', async t => {
    const f = await fixture(t);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: f.principal.userId, tenant_id: f.principal.tenantId,
        jti: f.principal.sessionId, auth_version: f.principal.authVersion, iat: f.principal.issuedAt,
        exp: f.principal.sessionExpiresAt, role: f.principal.role }; next(); });
    app.use('/api/portal/integrations', createOperationalReadSetupRouter({ service: f.service }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const route = `http://127.0.0.1:${server.address().port}/api/portal/integrations/shared-read-setup/reader`;
    const headers = { 'Content-Type': 'application/json', Origin: 'https://wa.invalid',
        'X-Savana-Owner-Intent': 'shared-read-setup-v1' };
    for (const [extra, body, suffix, expected] of [
        [{ 'X-Savana-Owner-Intent': 'invalid' }, selection, '', 403],
        [{ Origin: 'https://foreign.invalid' }, selection, '', 403],
        [{}, { ...selection, access_token: 'private-browser-claim', approved: true }, '', 422],
        [{}, selection, '?actor_id=claimed-owner', 422],
    ]) {
        const response = await fetch(route + suffix, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
        assert.equal(response.status, expected);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.text()).includes('private-browser-claim'), false);
    }
    assert.equal(f.calls.length, 0);
    const response = await fetch(route, { method: 'POST', headers, body: JSON.stringify(selection) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).bound, true);
});
