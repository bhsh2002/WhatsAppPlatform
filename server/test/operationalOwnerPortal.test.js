import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import express from 'express';
import { OperationalOwnerPortalService } from '../services/operationalOwnerPortal.js';
import { createOperationalOwnerPortalRouter } from '../routes/operationalOwnerPortal.js';
import { runMigrationsSync } from '../db/migrator.js';
import { seedSavanaUpgrade } from '../test-support/savanaMigrationFixture.js';

const START = Date.parse('2026-11-17T10:00:00Z');
const policy = 'explicit_current_exact_scope_actions; self_approval_permitted';
const actions = ['read.request', 'read.approve', 'fields.approve', 'read.manage', 'reviews.read', 'operations.inspect'];
const selected = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const inputScope = { activity_id: selected.activity_id, branch_id: null, warehouse_id: null };
const principal = (sessionId = 'synthetic-native-jti', userId = 1) => ({ userId, tenantId: 1, sessionId, authVersion: 0,
    role: 'tenant', sessionExpiresAt: START / 1000 + 300 });
const credentials = { username: 'synthetic-owner@example.invalid', password: 'synthetic-login-password' };
const createInput = key => ({ operation: 'request.create', idempotencyKey: key, body: { kind: 'consumer_registration', scope: inputScope,
    proposal: { enrollment_id: 'own-enrollment', enrollment_version: 1, installation_label: 'Synthetic native consumer' } } });
const cipher = () => {
    const key = crypto.randomBytes(32);
    return {
        encrypt(raw) {
            const iv = crypto.randomBytes(12); const aes = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([aes.update(raw), aes.final()]);
            return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64');
        },
        decrypt(raw) {
            const body = Buffer.from(raw, 'base64'); const aes = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
            aes.setAuthTag(body.subarray(12, 28)); return Buffer.concat([aes.update(body.subarray(28)), aes.final()]).toString();
        },
    };
};
const fixture = t => {
    const database = new Database(':memory:'); seedSavanaUpgrade(database); runMigrationsSync(database);
    database.exec(`INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(1,'synthetic-owner','unused','tenant',1,1,0),(2,'synthetic-employee','unused','tenant',1,1,0)`);
    t.after(() => database.close());
    let clock = START; let current = true; let cookieTtl = 120; let actualActor = 'synthetic-actor';
    const identity = { actorId: 'synthetic-actor', organizationId: 'synthetic-org', generation: 'synthetic-oidc-generation',
        expiresAt: new Date(START + 240_000).toISOString() };
    const membership = { account_id: identity.actorId, organization_id: identity.organizationId,
        role: 'owner', status: 'active', permissions: ['organization:members'] };
    const enrollment = external => ({ enrollment_id: external === 'wa_savana:tenant:1' ? 'own-enrollment' : 'foreign-enrollment',
        organization_id: identity.organizationId, platform: 'wa_savana', external_tenant_id: external, display_name: 'Synthetic',
        version: 1, accepted_scopes: ['savana.products.sync'], public_key_fingerprint: 'a'.repeat(64) });
    const wire = { organization_id: identity.organizationId, scopes: [{ scope: selected, label: 'Synthetic scope' }],
        scope_authorizations: [{ actor_id: identity.actorId, scope: selected, actions: [...actions], expires_at: null, version: 1, assigned_by: identity.actorId }],
        requests: [], installations: [
            { id: 'own-installation', installation_id: 'own-installation', enrollment_id: 'own-enrollment', scope: selected,
                tenant_id: 'native-platform-account', label: 'Own WA', platform: 'wa_savana' },
            { id: 'foreign-installation', installation_id: 'foreign-installation', enrollment_id: 'foreign-enrollment', scope: selected,
                tenant_id: 'foreign-platform-account', label: 'Foreign WA', platform: 'wa_savana' },
            { id: 'catalog-installation', installation_id: 'catalog-installation', enrollment_id: 'catalog-enrollment', scope: selected,
                tenant_id: 'catalog-platform-account', label: 'Catalog', platform: 'catalog' }],
        publisher_grants: [{ id: 'publisher', publisher_grant_id: 'publisher', request_id: 'source-request', scope: selected,
            installation_id: 'catalog-installation', enrollment_id: 'catalog-enrollment', revision: 1, active: true,
            expires_at: '2026-11-17T12:00:00Z', expired: false, policy: { fields: ['name', 'sku'] } }],
        read_grants: [], deliveries: [], enrollments: [enrollment('wa_savana:tenant:1'), enrollment('wa_savana:tenant:2')],
        origin_evidence: [], approval_policy: policy };
    const calls = []; let transform = (_path, payload) => payload; let after = async () => {};
    const response = (payload, init = {}) => Response.json(payload, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } });
    let requestNumber = 0;
    const fetchImpl = async (url, options) => {
        const path = new URL(url).pathname;
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ path, method: options.method, headers: options.headers, body: options.body });
        let payload; let headers = {};
        if (path === '/api/session' && options.method === 'POST') {
            assert.deepEqual(body, credentials);
            payload = { authenticated: true, username: credentials.username, display_name: 'Synthetic owner', role: 'organization_member' };
            headers = { 'Set-Cookie': `savana_control_session=synthetic.portal.cookie; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${cookieTtl}` };
        } else {
            assert.equal(options.headers.Cookie, 'savana_control_session=synthetic.portal.cookie');
            if (path === '/api/session') payload = { authenticated: true, username: credentials.username, display_name: 'Synthetic owner', role: 'organization_member', account_id: actualActor };
            else if (path.endsWith('/ui-context')) payload = { membership: structuredClone(membership),
                members: [{ account_id: identity.actorId, display_name: 'Synthetic owner', status: 'active' },
                    { account_id: 'synthetic-reader', display_name: 'Synthetic reader', status: 'active' }], integration_operational_enabled: true };
            else if (options.method === 'GET' && path.endsWith('/overview')) payload = structuredClone(wire);
            else if (path.endsWith('/scopes')) payload = { ...body, grants_created: false };
            else if (path.includes('/scope-authorizations/')) payload = { target_account_id: path.split('/').at(-1),
                scope: body.scope, actions: body.actions, expires_at: body.expires_at, version: body.expected_version + 1 };
            else if (path.endsWith('/requests') && options.method === 'POST') {
                payload = { request_id: `request-${++requestNumber}`, organization_id: identity.organizationId, scope: body.scope,
                    kind: body.kind, proposal: body.proposal, version: 1, state: 'pending', requested_by: identity.actorId,
                    reviewed_by: null, effective_version: null, effective_resource: null, reason: null,
                    updated_at: new Date(clock).toISOString(), approval_policy: policy };
                wire.requests.push(structuredClone(payload));
            } else if (path.includes('/requests/')) {
                const reference = path.split('/requests/')[1].split('/')[0];
                const row = wire.requests.find(r => r.request_id === reference); assert.ok(row);
                if (options.method === 'PATCH') Object.assign(row, { version: row.version + 1, state: 'pending', proposal: body.proposal, reviewed_by: null, reason: null });
                else if (path.endsWith('/approve')) Object.assign(row, { state: 'approved', reviewed_by: identity.actorId,
                    effective_version: row.version, effective_resource: row.kind === 'consumer_registration'
                        ? { installation_id: 'own-installation', enrollment_id: row.proposal.enrollment_id }
                        : { read_grant_id: 'synthetic-read-grant', revision: 1, ...row.proposal } });
                else if (path.endsWith('/reject')) Object.assign(row, { state: 'rejected', reviewed_by: identity.actorId, reason: body.reason });
                payload = structuredClone(row);
            } else throw new Error('Unexpected synthetic route');
        }
        payload = transform(path, payload);
        await after(path, payload);
        return response(payload, { headers });
    };
    const encryption = cipher();
    const make = (overrides = {}) => new OperationalOwnerPortalService({ database, encryption,
        config: { enabled: true, portalOrigin: 'https://portal.invalid' }, verifyLocalPrincipal: () => current,
        verifyIdentitySession: async () => ({ ...identity }), resolveNativeAccount: async () => ({ id: 'native-platform-account',
            platform_code: 'wa_savana', external_tenant_id: 'wa_savana:tenant:1', organization_id: identity.organizationId, status: 'active' }),
        fetchImpl, now: () => clock, ...overrides });
    const service = make();
    return { database, service, make, encryption, identity, membership, wire, calls,
        clock: value => { clock = value; }, local: value => { current = value; }, actor: value => { actualActor = value; },
        ttl: value => { cookieTtl = value; }, transform: value => { transform = value; }, after: value => { after = value; },
        login: p => service.login(p || principal(), credentials), mutations: () => calls.filter(c => c.path.includes('/integration/') && c.method !== 'GET') };
};

test('owner portal defaults closed and requires current native/OIDC identity before credential login', async t => {
    const f = fixture(t);
    const disabled = f.make({ config: {} });
    assert.equal((await disabled.status(principal())).enabled, false);
    await assert.rejects(disabled.login(principal(), credentials), { code: 'owner_portal_disabled' });
    f.local(false);
    await assert.rejects(f.login(), { code: 'shared_product_read_session_required' });
    assert.equal(f.calls.length, 0);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_owner_portal_sessions').get().n, 0);
});

test('actual cookie login verifies same actor and current membership then encrypts cookie with bounded expiry', async t => {
    const f = fixture(t); f.ttl(30);
    const result = await f.login();
    assert.equal(result.session.state, 'connected');
    assert.equal(result.session.expires_at, new Date(START + 30_000).toISOString());
    assert.deepEqual(f.calls.map(c => c.path), ['/api/session', '/api/session', '/api/member/organizations/synthetic-org/integration/ui-context']);
    const row = f.database.prepare('SELECT * FROM savana_owner_portal_sessions').get();
    assert.equal(JSON.stringify(row).includes('synthetic.portal.cookie'), false);
    assert.equal(JSON.stringify(row).includes(credentials.password), false);
    assert.equal(JSON.stringify(result).includes('synthetic.portal.cookie'), false);
    assert.equal(JSON.stringify(result).includes(credentials.password), false);
    const envelope = JSON.parse(f.encryption.decrypt(row.encrypted_cookie));
    assert.equal(envelope.purpose, 'central_portal_cookie');
    assert.equal(envelope.payload.cookie, 'savana_control_session=synthetic.portal.cookie');
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_operational_owner_sessions').get().n, 0);
});

test('valid cookie for another central actor cannot become native owner session', async t => {
    const f = fixture(t); f.actor('another-central-actor');
    await assert.rejects(f.login(), { code: 'owner_portal_response_invalid' });
    assert.equal(f.database.prepare('SELECT encrypted_cookie,state FROM savana_owner_portal_sessions').get().encrypted_cookie, null);
    assert.equal(f.mutations().length, 0);
});

test('fresh ui-context is required after login and owner role alone creates no scoped request actions', async t => {
    const f = fixture(t); await f.login();
    f.wire.scope_authorizations = [];
    const view = await f.service.overview(principal());
    assert.equal(view.actions.create_scope, true);
    assert.equal(view.options.scopes[0].actions.request_consumer_registration, false);
    await assert.rejects(f.service.perform(principal(), createInput('no-explicit-actions')), { code: 'owner_portal_request_invalid' });
    assert.equal(f.mutations().length, 0);
    f.membership.status = 'revoked';
    await assert.rejects(f.service.status(principal()), { code: 'owner_portal_response_invalid' });
});

test('overview excludes foreign-native enrollment, installation and requests even under central review authority', async t => {
    const f = fixture(t); await f.login();
    f.wire.requests.push({ request_id: 'foreign-request', organization_id: 'synthetic-org', scope: selected,
        kind: 'consumer_registration', proposal: { enrollment_id: 'foreign-enrollment', enrollment_version: 1, installation_label: 'Other WA' },
        version: 1, state: 'pending', requested_by: 'synthetic-actor', reviewed_by: null, effective_version: null,
        effective_resource: null, reason: null, updated_at: '2026-11-17T10:00:00Z', approval_policy: policy });
    const view = await f.service.overview(principal());
    assert.deepEqual(view.options.enrollments.map(e => e.enrollment_id), ['own-enrollment']);
    assert.deepEqual(view.options.consumer_installations.map(i => i.installation_id), ['own-installation']);
    assert.deepEqual(view.options.source_installations[0].fields, ['name', 'sku']);
    assert.deepEqual(view.requests, []);
    await assert.rejects(f.service.perform(principal(), { operation: 'request.approve', idempotencyKey: 'foreign-approve', requestId: 'foreign-request',
        body: { expected_version: 1 } }), { code: 'owner_portal_request_invalid' });
    assert.equal(f.mutations().length, 0);
});

test('native authorization replacement refuses existing source/origin authority instead of deleting it', async t => {
    const f = fixture(t); await f.login();
    f.wire.scope_authorizations[0].actions.push('source.request');
    const view = await f.service.overview(principal());
    assert.equal(view.scope_authorizations[0].native_editable, false);
    await assert.rejects(f.service.perform(principal(), { operation: 'scope.authorize', idempotencyKey: 'no-drop',
        targetAccountId: 'synthetic-actor', body: { scope: inputScope, actions, expires_at: null, expected_version: 1 } }),
    { code: 'owner_portal_control_center_required' });
    assert.equal(f.mutations().length, 0);
    assert.ok(f.wire.scope_authorizations[0].actions.includes('source.request'));
});

test('typed consumer revision and approval return distinct current/effective versions with immutable audit bytes', async t => {
    const f = fixture(t); await f.login();
    const created = await f.service.perform(principal(), createInput('create-1'));
    const reference = created.intent.result.request.request_id;
    const edited = await f.service.perform(principal(), { operation: 'request.edit', idempotencyKey: 'edit-2', requestId: reference,
        body: { expected_version: 1, proposal: { ...createInput('x').body.proposal, installation_label: 'Reviewed version two' } } });
    assert.equal(edited.intent.result.request.version, 2);
    assert.equal(edited.intent.result.request.effective_version, null);
    const approval = { operation: 'request.approve', idempotencyKey: 'approve-2', requestId: reference, body: { expected_version: 2 } };
    const approved = await f.service.perform(principal(), approval);
    assert.equal(approved.intent.result.request.effective_version, 2);
    assert.equal(approved.intent.result.request.state, 'approved');
    const repeated = await f.service.perform(principal(), approval);
    assert.equal(repeated.intent.id, approved.intent.id);
    assert.equal(repeated.intent.result, null);
    assert.equal(f.mutations().length, 3);
    const intent = f.database.prepare('SELECT * FROM savana_owner_portal_intents WHERE id=?').get(created.intent.id);
    assert.throws(() => f.database.prepare('UPDATE savana_owner_portal_intents SET request_sha256=? WHERE id=?').run('changed', intent.id), /intent is immutable/);
});

test('well-formed but mismatched central response remains unknown rather than completed', async t => {
    const f = fixture(t); await f.login();
    f.transform((path, payload) => path.endsWith('/requests') ? { ...payload, version: 2 } : payload);
    await assert.rejects(f.service.perform(principal(), createInput('tampered-version')), { code: 'owner_portal_response_invalid' });
    const row = f.database.prepare('SELECT * FROM savana_owner_portal_intents').get();
    assert.equal(row.state, 'unknown'); assert.equal(row.encrypted_result, null);
    await assert.rejects(f.service.perform(principal(), createInput('force-new-key')), { code: 'owner_portal_unresolved_intent' });
    assert.equal(f.mutations().length, 1);
});

test('read sharing accepts only current native consumer, active source fields and current organization readers', async t => {
    const f = fixture(t); await f.login();
    const request = { operation: 'request.create', idempotencyKey: 'read-sharing', body: { kind: 'read_sharing', scope: inputScope,
        proposal: { source_installation_id: 'catalog-installation', consumer_installation_id: 'own-installation',
            fields: ['name'], reader_account_ids: ['synthetic-reader'], expires_at: '2026-11-17T11:00:00+00:00' } } };
    for (const invalid of [{ fields: ['price'] }, { reader_account_ids: ['foreign-reader'] }, { consumer_installation_id: 'foreign-installation' }]) {
        await assert.rejects(f.service.perform(principal(), { ...request, body: { ...request.body, proposal: { ...request.body.proposal, ...invalid } } }),
            { code: 'owner_portal_request_invalid' });
    }
    const created = await f.service.perform(principal(), request);
    assert.equal(created.intent.result.request.effective_version, null);
    const approved = await f.service.perform(principal(), { operation: 'request.approve', idempotencyKey: 'approve-read',
        requestId: created.intent.result.request.request_id, body: { expected_version: 1 } });
    const resource = approved.intent.result.request.effective_resource;
    assert.equal(resource.read_grant_id, 'synthetic-read-grant');
    assert.deepEqual(resource.fields, ['name']);
    assert.deepEqual(resource.reader_account_ids, ['synthetic-reader']);
    assert.equal(resource.expires_at, '2026-11-17T11:00:00.000Z');
    assert.equal(f.mutations().length, 2);
});

test('lost acknowledgement blocks new keys across new native JWT, local user and portal login', async t => {
    const f = fixture(t); await f.login();
    f.after(async path => { if (path.endsWith('/requests')) throw new Error('Synthetic lost acknowledgement'); });
    await assert.rejects(f.service.perform(principal(), createInput('lost-first')), { code: 'owner_portal_outcome_unknown' });
    const row = f.database.prepare('SELECT * FROM savana_owner_portal_intents').get();
    f.after(async () => {});
    const other = principal('new-native-jti', 2);
    await f.login(other);
    await assert.rejects(f.service.perform(other, createInput('different-key-after-login')), { code: 'owner_portal_unresolved_intent' });
    assert.equal((await f.service.status(other)).intents.unknown_count, 1);
    await assert.rejects(f.service.intent(other, row.id), { code: 'owner_portal_intent_unavailable' });
    assert.equal(f.mutations().length, 1);
    assert.equal(f.database.prepare('SELECT encrypted_request FROM savana_owner_portal_intents').get().encrypted_request, row.encrypted_request);
});

test('same-key conflict never rewrites intent and changed scope actions cannot expose cached result', async t => {
    const f = fixture(t); await f.login();
    const created = await f.service.perform(principal(), createInput('same-key'));
    f.wire.scope_authorizations = [];
    const result = await f.service.intent(principal(), created.intent.id);
    assert.equal(result.intent.state, 'completed'); assert.equal(result.intent.result, null);
    const byKey = await f.service.intentByKey(principal(), 'same-key');
    assert.equal(byKey.intent.id, created.intent.id); assert.equal(byKey.intent.result, null);
    await assert.rejects(f.service.intentByKey(principal('different-native-jti'), 'same-key'), { code: 'owner_portal_session_required' });
    await assert.rejects(f.service.perform(principal(), { ...createInput('same-key'), body: { ...createInput('same-key').body,
        proposal: { ...createInput('same-key').body.proposal, installation_label: 'Different bytes' } } }), { code: 'owner_portal_intent_content_conflict' });
    assert.equal(f.mutations().length, 1);
});

test('stable native reference and same-actor by-key metadata survive new JWT but never cross native tenant', async t => {
    const f = fixture(t);
    const firstStatus = await f.login();
    assert.match(firstStatus.native_reference, /^[0-9a-f]{64}$/);
    const created = await f.service.perform(principal(), createInput('partitioned-key'));
    const freshJwt = principal('fresh-jwt-for-same-native-user');
    const refreshed = await f.login(freshJwt);
    assert.equal(refreshed.native_reference, firstStatus.native_reference);
    f.wire.scope_authorizations = [];
    const lookup = await f.service.intentByKey(freshJwt, 'partitioned-key');
    assert.equal(lookup.intent.id, created.intent.id);
    assert.equal(lookup.intent.state, 'completed');
    assert.equal(lookup.intent.result, null);
    assert.deepEqual(Object.keys(lookup.intent).sort(), ['id', 'operation', 'state', 'request_sha256', 'created_at', 'updated_at', 'result'].sort());
    const otherLocalUser = principal('fresh-jwt-for-another-native-user', 2);
    const otherUserStatus = await f.login(otherLocalUser);
    assert.notEqual(otherUserStatus.native_reference, firstStatus.native_reference);
    assert.equal((await f.service.intentByKey(otherLocalUser, 'partitioned-key')).intent.result, null);
    await assert.rejects(f.service.intent(freshJwt, created.intent.id), { code: 'owner_portal_intent_unavailable' });
    f.database.exec(`INSERT INTO tenants(id,name,phone,status) VALUES(2,'Synthetic other tenant','synthetic-partition-two','Active');
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(3,'synthetic-other-tenant-user','unused','tenant',2,1,0)`);
    const otherTenant = { ...principal('fresh-jwt-for-other-tenant', 3), tenantId: 2 };
    const otherTenantStatus = await f.login(otherTenant);
    assert.notEqual(otherTenantStatus.native_reference, firstStatus.native_reference);
    await assert.rejects(f.service.intentByKey(otherTenant, 'partitioned-key'), { code: 'owner_portal_intent_unavailable' });
    assert.equal(f.mutations().length, 1);
});

test('cookie expiry or disconnect during a mutation prevents result attachment and preserves uncertain history', async t => {
    const f = fixture(t); f.ttl(1); await f.login();
    f.after(async path => { if (path.endsWith('/requests')) f.clock(START + 1000); });
    await assert.rejects(f.service.perform(principal(), createInput('cookie-expired')), { code: 'owner_portal_session_changed' });
    const row = f.database.prepare('SELECT * FROM savana_owner_portal_intents').get();
    assert.equal(row.state, 'unknown'); assert.equal(row.encrypted_result, null);
    const disconnected = f.service.disconnect(principal());
    assert.equal(disconnected.central_session_revoked, false);
    assert.equal(disconnected.intents.unknown_count, 1);
    assert.equal(disconnected.intents.mutations_blocked, true);
    assert.equal(f.database.prepare('SELECT encrypted_cookie FROM savana_owner_portal_sessions').get().encrypted_cookie, null);
});

test('disconnect fences an unfinished login so returned cookie cannot recreate local session', async t => {
    const f = fixture(t);
    f.after(async path => { if (path === '/api/session') f.service.disconnect(principal()); });
    await assert.rejects(f.login(), { code: 'owner_portal_session_changed' });
    const row = f.database.prepare('SELECT state,encrypted_cookie FROM savana_owner_portal_sessions').get();
    assert.equal(row.state, 'revoked'); assert.equal(row.encrypted_cookie, null);
});

test('wrong-purpose or wrong-key cookie fails closed without plaintext fallback or credential exposure', async t => {
    const f = fixture(t); await f.login();
    const before = f.database.prepare('SELECT * FROM savana_owner_portal_sessions').get();
    const wrong = f.make({ encryption: cipher() });
    const status = await wrong.status(principal());
    assert.equal(status.session.state, 'unknown'); assert.equal(status.actions.overview, false);
    await assert.rejects(wrong.overview(principal()), { code: 'owner_portal_credentials_unavailable' });
    assert.deepEqual(f.database.prepare('SELECT * FROM savana_owner_portal_sessions').get(), before);
});

test('source/publisher operations and browser organization/actor claims cannot pass native facade', async t => {
    const f = fixture(t); await f.login();
    for (const input of [
        { operation: 'publisher.rotate', idempotencyKey: 'bad-source', body: {} },
        { ...createInput('bad-org'), body: { ...createInput('x').body, scope: { ...inputScope, organization_id: 'synthetic-org' } } },
        { ...createInput('bad-actor'), actor_id: 'browser-owner' },
        { ...createInput('bad-kind'), body: { ...createInput('x').body, kind: 'source_registration' } },
    ]) await assert.rejects(f.service.perform(principal(), input), { code: 'owner_portal_request_invalid' });
    assert.equal(f.mutations().length, 0);
});

test('concurrent new owner intents claim only one dispatch and never bypass unresolved hold', async t => {
    const f = fixture(t); await f.login();
    let release; let started;
    const dispatched = new Promise(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    f.after(async path => { if (path.endsWith('/requests')) { started(); await pending; } });
    const first = f.service.perform(principal(), createInput('concurrent-first'));
    await dispatched;
    await assert.rejects(f.service.perform(principal(), createInput('concurrent-second')), { code: 'owner_portal_unresolved_intent' });
    assert.equal(f.mutations().length, 1);
    release();
    assert.equal((await first).intent.state, 'completed');
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_owner_portal_intents').get().n, 1);
});

const routerFixture = async t => {
    const calls = [];
    const service = {
        login: async (p, body) => { calls.push({ kind: 'login', p, body }); throw new Error('Never expose synthetic private-cookie/password detail'); },
        status: async () => ({ enabled: false }), disconnect: async () => ({}), overview: async () => ({}),
        perform: async () => ({}), intent: async () => ({}),
        intentByKey: async (p, key) => { calls.push({ kind: 'by-key', p, key }); return { intent: { state: 'unknown', result: null } }; },
    };
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1, tenant_id: 1, jti: 'synthetic-route-jti', auth_version: 0, exp: START / 1000 + 300 }; next(); });
    app.use('/api/portal/integrations', createOperationalOwnerPortalRouter({ service, appOrigin: 'https://wa.invalid' }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return { calls, url: `http://127.0.0.1:${server.address().port}/api/portal/integrations/shared-read-setup/owner` };
};

test('owner facade requires explicit same-origin intent and preserves read-only by-key lookup', async t => {
    const f = await routerFixture(t);
    const request = headers => fetch(`${f.url}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(credentials) });
    assert.equal((await request({})).status, 403);
    assert.equal((await request({ 'X-Savana-Owner-Intent': 'shared-read-setup-v1', Origin: 'https://foreign.invalid' })).status, 403);
    assert.equal(f.calls.length, 0);
    const result = await fetch(`${f.url}/intents/by-key/${encodeURIComponent('saved intent key')}`);
    assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await result.json()).intent.result, null);
    assert.equal(f.calls[0].key, 'saved intent key');
    assert.equal((await fetch(`${f.url}/overview?actor_id=browser-owner`)).status, 422);
});

test('owner credential login limits local attempts and returns fixed redacted errors', async t => {
    const f = await routerFixture(t);
    for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(`${f.url}/login`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Savana-Owner-Intent': 'shared-read-setup-v1', Origin: 'https://wa.invalid' },
            body: JSON.stringify(credentials) });
        assert.equal(response.status, 503);
        assert.equal((await response.text()).includes('private-cookie'), false);
    }
    const limited = await fetch(`${f.url}/login`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Savana-Owner-Intent': 'shared-read-setup-v1' }, body: JSON.stringify(credentials) });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'owner_portal_login_rate_limited');
    assert.equal(f.calls.filter(c => c.kind === 'login').length, 8);
});
