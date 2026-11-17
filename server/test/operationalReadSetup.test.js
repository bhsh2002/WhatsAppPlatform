import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { OperationalReadSetupService, operationalReadConfigFromEnv } from '../services/operationalReadSetup.js';
import { SharedProductReadError } from '../services/centralProductRead.js';
import { SqliteDelegatedReadBindings } from '../services/delegatedReadSessionStore.js';
import { createOperationalReadSetupRouter } from '../routes/operationalReadSetup.js';
import { runMigrationsSync } from '../db/migrator.js';
import { seedSavanaUpgrade } from '../test-support/savanaMigrationFixture.js';

const now = Date.now();
const principal = { userId: 1, tenantId: 1, sessionId: 'synthetic-jti', authVersion: 0,
    sessionExpiresAt: Math.floor(now / 1000) + 300 };
const config = { enabled: true, centerOrigin: 'https://center.invalid', oidcIssuer: 'https://center.invalid',
    oidcClientId: 'synthetic-wa', oidcRedirectUri: 'https://wa.invalid/api/portal/integrations/shared-read-setup/callback',
    oidcAuthorizationEndpoint: 'https://portal.invalid/oauth/authorize', oidcTokenEndpoint: 'https://center.invalid/v1/oidc/token',
    oidcJwksUri: 'https://center.invalid/.well-known/jwks.json', oidcUserInfoEndpoint: 'https://center.invalid/v1/oidc/userinfo' };
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-kid', use: 'sig' };
const fixture = t => {
    const database = new Database(':memory:');
    seedSavanaUpgrade(database);
    runMigrationsSync(database);
    database.exec(`INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(1,'synthetic-owner','unused','tenant',1,1,0);`);
    t.after(() => database.close());
    const key = crypto.randomBytes(32);
    const encryption = {
        encrypt(value) {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([cipher.update(value), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
        },
        decrypt(value) {
            const body = Buffer.from(value, 'base64');
            const cipher = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
            cipher.setAuthTag(body.subarray(12, 28));
            return Buffer.concat([cipher.update(body.subarray(28)), cipher.final()]).toString();
        },
    };
    const store = new SqliteDelegatedReadBindings({ database, encryption, now: () => now });
    let auth;
    let current = true;
    let transform = (path, body) => body;
    const calls = [];
    const sign = (payload, options = {}) => jwt.sign({ sub: 'central-reader', organization_id: 'synthetic-org',
        iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 120, ...payload }, privateKey,
    { algorithm: 'RS256', keyid: jwk.kid, issuer: config.oidcIssuer, audience: config.oidcClientId, ...options });
    const fetchImpl = async (url, options) => {
        const path = new URL(url).pathname;
        calls.push({ path, options });
        let body;
        if (path === '/v1/oidc/token') body = { token_type: 'Bearer',
            access_token: sign({ token_use: 'access', scope: 'openid profile organization' }),
            id_token: sign({ token_use: 'id', nonce: auth.searchParams.get('nonce') }) };
        else if (path === '/.well-known/jwks.json') body = { keys: [jwk] };
        else if (path === '/v1/oidc/userinfo') body = { sub: 'central-reader', organization_id: 'synthetic-org' };
        else assert.fail(`Unpublished path ${path}`);
        return Response.json(await transform(path, body), { headers: { 'Cache-Control': 'no-store' } });
    };
    const service = new OperationalReadSetupService({ database, config, store, fetchImpl,
        verifyLocalPrincipal: () => current, now: () => now });
    return { database, store, service, calls, sign, setCurrent: value => { current = value; },
        mutate: value => { transform = value; }, async authorize() {
            auth = new URL((await service.authorize(principal)).authorization_url);
            return auth;
        } };
};

test('identity setup defaults off and makes no HTTP request or grant', async () => {
    assert.equal(operationalReadConfigFromEnv({}).enabled, false);
    let calls = 0;
    const service = new OperationalReadSetupService({ config: {}, verifyLocalPrincipal: () => true, fetchImpl: () => { calls++; } });
    const status = await service.status(principal);
    assert.equal(status.enabled, false);
    assert.equal(status.read_ready, false);
    await assert.rejects(service.authorize(principal), { code: 'shared_read_setup_disabled' });
    assert.equal(calls, 0);
});

test('PKCE callback validates actual signed ID/access identity but grants no owner action or product read', async t => {
    const f = fixture(t);
    const auth = await f.authorize();
    assert.equal(auth.origin, 'https://portal.invalid');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(auth.searchParams.has('code_verifier'), false);
    assert.equal(auth.searchParams.has('access_token'), false);
    assert.deepEqual(await f.service.callback(principal, { state: auth.searchParams.get('state'), code: 'synthetic-code' }),
        { redirect: '/portal/integrations?shared_read_setup=connected' });
    assert.deepEqual(f.calls.map(call => call.path), ['/v1/oidc/token', '/.well-known/jwks.json', '/v1/oidc/userinfo']);
    for (const call of f.calls) assert.equal(call.options.redirect, 'error');
    const exchange = new URLSearchParams(f.calls[0].options.body);
    assert.equal(crypto.createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
    const status = await f.service.status(principal);
    assert.equal(status.session.state, 'connected');
    assert.equal(status.read_ready, false);
    assert.deepEqual(status.requests, []);
    assert.equal(status.execution_ready, false);
    assert.equal(status.blockers[0].code, 'operational_owner_actions_in_control_center');
    assert.equal(JSON.stringify(status).includes('eyJ'), false);
    assert.equal(f.store.load(principal), null);
    await assert.rejects(f.service.callback(principal, { state: auth.searchParams.get('state'), code: 'replay' }),
        { code: 'shared_read_authorization_state_invalid' });
    assert.equal(f.calls.length, 3);
});

test('invalid identity nonce, audience, organization, signature or expiry cannot persist a session', async t => {
    const mutations = [
        body => ({ ...body, id_token: fsign({ token_use: 'id', nonce: 'wrong' }) }),
        body => ({ ...body, access_token: fsign({ token_use: 'access', scope: 'organization', organization_id: 'foreign' }) }),
        body => ({ ...body, access_token: fsign({ token_use: 'access', scope: 'organization' }, { audience: 'foreign' }) }),
        body => ({ ...body, access_token: body.access_token + 'bad' }),
        body => ({ ...body, access_token: fsign({ token_use: 'access', scope: 'organization', exp: Math.floor(now / 1000) - 1 }) }),
    ];
    let fsign;
    for (const mutation of mutations) {
        const f = fixture(t);
        fsign = f.sign;
        const auth = await f.authorize();
        f.mutate((path, body) => path.endsWith('/token') ? mutation(body) : body);
        await assert.rejects(f.service.callback(principal, { state: auth.searchParams.get('state'), code: 'synthetic-code' }),
            { code: 'shared_read_identity_response_invalid' });
        assert.equal(f.store.ownerSession(principal), null);
        assert.equal(f.store.flowSummary(principal).state, 'failed');
    }
});

test('a stored identity with unavailable ciphertext is unverified and can be locally disconnected', async t => {
    const f = fixture(t);
    const auth = await f.authorize();
    await f.service.callback(principal, { state: auth.searchParams.get('state'), code: 'synthetic-code' });
    f.database.prepare('UPDATE savana_operational_owner_sessions SET encrypted_session=?').run('unreadable-ciphertext');
    const status = await f.service.status(principal);
    assert.equal(status.session.state, 'unknown');
    assert.equal(status.read_ready, false);
    assert.equal(status.actions.disconnect, true);
    assert.equal(status.blockers[0].code, 'shared_read_identity_credentials_unavailable');
    f.service.disconnect(principal);
    assert.equal((await f.service.status(principal)).session.state, 'revoked');
    assert.equal(f.store.ownerSession(principal), null);
});

test('unavailable current identity verification cannot leave setup reporting connected or read-ready', async t => {
    const f = fixture(t);
    const auth = await f.authorize();
    await f.service.callback(principal, { state: auth.searchParams.get('state'), code: 'synthetic-code' });
    f.service.enrollmentService = { status: async () => { throw new SharedProductReadError('shared_read_identity_unavailable', 503); } };
    f.service.readService = { readiness: async () => assert.fail('No readiness fallback after identity verification failure') };
    const status = await f.service.status(principal);
    assert.equal(status.session.state, 'unknown');
    assert.equal(status.read_ready, false);
    assert.equal(status.actions.enroll_consumer, false);
    assert.equal(status.actions.disconnect, true);
});

test('lost token acknowledgement becomes unknown and cannot be automatically retried', async t => {
    const f = fixture(t);
    const auth = await f.authorize();
    f.mutate(() => { throw new Error('synthetic response lost after exchange'); });
    const args = { state: auth.searchParams.get('state'), code: 'synthetic-code' };
    await assert.rejects(f.service.callback(principal, args), { code: 'shared_read_authorization_unknown' });
    assert.equal(f.store.flowSummary(principal).state, 'unknown');
    await assert.rejects(f.service.callback(principal, args), { code: 'shared_read_authorization_state_invalid' });
    assert.equal(f.calls.length, 1);
    assert.equal(f.store.ownerSession(principal), null);
});

test('local logout or disconnect during awaited callback cannot reconnect a stale session', async t => {
    for (const action of ['logout', 'disconnect', 'reconnect']) {
        const f = fixture(t);
        const auth = await f.authorize();
        f.mutate(async (path, body) => {
            if (path.endsWith('/userinfo')) {
                if (action === 'logout') f.setCurrent(false);
                else if (action === 'disconnect') f.service.disconnect(principal);
                else await f.authorize();
            }
            return body;
        });
        await assert.rejects(f.service.callback(principal, { state: auth.searchParams.get('state'), code: 'old-code' }));
        assert.equal(f.store.ownerSession(principal), null);
        assert.equal(f.store.load(principal), null);
    }
});

test('native setup HTTP routes require explicit intent, reject browser claims and redact callback errors', async t => {
    const f = fixture(t);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 1, tenant_id: 1, jti: principal.sessionId,
        auth_version: 0, exp: principal.sessionExpiresAt }; next(); });
    app.use('/api/portal/integrations', createOperationalReadSetupRouter({ service: f.service }));
    const listener = app.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    t.after(() => new Promise(resolve => listener.close(resolve)));
    const base = `http://127.0.0.1:${listener.address().port}/api/portal/integrations/shared-read-setup`;
    const headers = { 'Content-Type': 'application/json', 'X-Savana-Owner-Intent': 'shared-read-setup-v1', Origin: 'https://wa.invalid' };
    for (const [extraHeaders, body, status] of [[{}, {}, 403],
        [{ ...headers, Origin: 'https://foreign.invalid' }, {}, 403],
        [headers, { actor_id: 'owner', approved: true, access_token: 'browser-secret' }, 422]]) {
        const response = await fetch(`${base}/authorization`, { method: 'POST', headers: extraHeaders, body: JSON.stringify(body) });
        assert.equal(response.status, status);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.text()).includes('browser-secret'), false);
    }
    const response = await fetch(`${base}/callback?state=wrong&code=private-code&error_description=secret`, { redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/portal/integrations?shared_read_setup=unverified');
    assert.equal(f.calls.length, 0);
});
