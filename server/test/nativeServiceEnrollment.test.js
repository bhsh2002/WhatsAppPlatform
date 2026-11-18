import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { NativeServiceEnrollment } from '../services/nativeServiceEnrollment.js';
import { NativeOwnerProofs } from '../services/nativeOwnerProofs.js';
import { NativeCommandProtocolError } from '../services/nativeCommandProtocol.js';
import { validateNativeCommandModel } from '../services/nativeCommandModels.js';
import { EgressMaintenanceError } from '../runtime/egressMaintenance.js';
import { runMigrationsSync } from '../db/migrator.js';
import { seedSavanaUpgrade, sourceState } from '../test-support/savanaMigrationFixture.js';

const now = Date.parse('2026-11-18T10:00:00Z');
const config = { centerOrigin: 'https://synthetic-core.invalid', platformToken: 'synthetic-native-platform-credential' };
const context = () => ({ actor_id: 'synthetic-source-owner', organization_id: 'synthetic-org', activity_id: 'synthetic-activity',
    branch_id: null, warehouse_id: null, external_tenant_id: 'wa_savana:tenant:1', session_version: 1 });
const input = {};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const immutable = row => Object.fromEntries(['id', 'tenant_id', 'organization_id', 'external_tenant_id', 'center_origin',
    'encrypted_private_key', 'request_json', 'request_sha256', 'public_key_fingerprint'].map(key => [key, row[key]]));
const cipher = () => {
    const key = crypto.randomBytes(32);
    return {
        encrypt(value) {
            const iv = crypto.randomBytes(12); const aes = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([aes.update(value), aes.final()]);
            return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64');
        },
        decrypt(value) {
            const bytes = Buffer.from(value, 'base64');
            const aes = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            aes.setAuthTag(bytes.subarray(12, 28));
            return Buffer.concat([aes.update(bytes.subarray(28)), aes.final()]).toString();
        },
    };
};
const registration = request => ({ enrollment_id: 'synthetic-central-enrollment', organization_id: request.organization_id,
    platform: 'wa_savana', external_tenant_id: request.external_tenant_id, display_name: request.display_name,
    version: 1, accepted_scopes: [...request.accepted_scopes], public_key_fingerprint: sha(request.public_key_pem) });

const fixture = (t, { filename = ':memory:', encryption = cipher() } = {}) => {
    const database = new Database(filename);
    seedSavanaUpgrade(database); runMigrationsSync(database);
    database.prepare(`INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(1,'synthetic-native-owner','unused','tenant',1,1,0)`).run();
    database.prepare(`INSERT INTO savana_native_owner_proofs
        (tenant_id,user_id,native_auth_version,native_role,central_actor_id,organization_id,oidc_issuer,oidc_client_id,identity_generation,verified_at)
        VALUES(1,1,0,'tenant','synthetic-source-owner','synthetic-org','https://synthetic-issuer.invalid','synthetic-client','synthetic-generation',?)`)
        .run(new Date(now).toISOString());
    const before = sourceState(database);
    t.after(() => { if (database.open) database.close(); });
    const calls = []; const proofCalls = [];
    let fetchHook = async () => {};
    let proofHook = async () => {};
    let transform = value => value;
    let status = 201;
    let headers = { 'Cache-Control': 'no-store' };
    let bindingId = 'synthetic-native-binding';
    const make = (overrides = {}) => {
        const db = overrides.database || database;
        const proofStore = new NativeOwnerProofs({ database: db, verifyLocalPrincipal: () => false,
            currentIdentity: async () => { throw new Error('NativeRPC must not fabricate a native JWT or call PKCE capture'); },
            resolveBinding: async ({ nativeTenantId, organizationId }) => ({ id: bindingId, platform_code: 'wa_savana', status: 'active',
                organization_id: organizationId, external_tenant_id: `wa_savana:tenant:${nativeTenantId}` }),
            issuer: 'https://synthetic-issuer.invalid', clientId: 'synthetic-client', now: () => now });
        return new NativeServiceEnrollment({ database: db, encryption, config, now: () => now,
            verifyOwnerAuthority: async args => { proofCalls.push(args); await proofHook(args); return proofStore.authority(args); },
            fetchImpl: async (url, options) => {
                calls.push({ url, options }); await fetchHook();
                return Response.json(transform(registration(JSON.parse(options.body))), { status, headers });
            }, ...overrides });
    };
    const service = make();
    return { database, encryption, before, calls, proofCalls, make, service,
        row: () => database.prepare('SELECT * FROM savana_operational_consumer_enrollments WHERE tenant_id=1').get(),
        audit: () => database.prepare('SELECT * FROM savana_native_enrollment_service_audit ORDER BY id').all(),
        duringFetch: hook => { fetchHook = hook; }, duringProof: hook => { proofHook = hook; },
        transform: fn => { transform = fn; }, responseStatus: value => { status = value; },
        responseHeaders: value => { headers = value; }, changeBinding: value => { bindingId = value; } };
};

const seedRetained = (f, state = 'prepared') => {
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
        publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
    const displayName = f.database.prepare('SELECT name FROM tenants WHERE id=1').get().name;
    const body = { organization_id: 'synthetic-org', external_tenant_id: 'wa_savana:tenant:1', display_name: displayName,
        public_key_pem: keys.publicKey, accepted_scopes: ['savana.products.sync'] };
    const request = JSON.stringify(body);
    const envelope = JSON.stringify({ purpose: 'wa_consumer_enrollment_key', enrollment_id: 'synthetic-retained-key', tenant_id: 1,
        organization_id: 'synthetic-org', private_key_pem: keys.privateKey });
    f.database.prepare(`INSERT INTO savana_operational_consumer_enrollments
        (id,tenant_id,organization_id,external_tenant_id,center_origin,encrypted_private_key,request_json,request_sha256,
        public_key_fingerprint,state,attempt_count,response_json,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run('synthetic-retained-key', 'synthetic-org', 'wa_savana:tenant:1', config.centerOrigin, f.encryption.encrypt(envelope), request,
            sha(request), sha(keys.publicKey), state, state === 'prepared' ? 0 : 1,
            state === 'completed' ? JSON.stringify(registration(body)) : null, new Date(now).toISOString(), new Date(now).toISOString());
    return body;
};

test('initial GET lists no enrollment without creating a key, sending HTTP or changing business state', async t => {
    const f = fixture(t);
    assert.deepEqual(await f.service.read(context()), { spec_version: '1.0', platform: 'wa_savana', enrollments: [] });
    assert.equal(f.row(), undefined); assert.equal(f.calls.length, 0); assert.equal(f.audit().length, 0);
    assert.deepEqual(sourceState(f.database), f.before);
    for (const centerOrigin of ['https://bad.invalid/path', 'https://bad.invalid?query=1', 'https://user:password@bad.invalid', 'http://public.invalid']) {
        assert.throws(() => f.make({ config: { ...config, centerOrigin } }), TypeError);
    }
});

test('new NativeRPC enrollment requires actual source owner and has no fabricated native identity or grants', async t => {
    const f = fixture(t);
    const staff = { ...context(), actor_id: 'synthetic-delegate', grant_approved_by: 'synthetic-source-owner' };
    await assert.rejects(f.service.enroll(staff, input), { code: 'native_service_enrollment_initial_owner_required', status: 403 });
    assert.equal(f.row(), undefined); assert.equal(f.calls.length, 0);
    f.database.prepare("UPDATE savana_native_owner_proofs SET revoked_at=?").run(new Date(now).toISOString());
    await assert.rejects(f.service.enroll(context(), input), { code: 'native_service_enrollment_owner_unavailable', status: 403 });
    assert.equal(f.row(), undefined); assert.equal(f.audit().length, 0);
    assert.equal(f.proofCalls.some(args => 'principal' in args || 'userId' in args || 'sessionId' in args), false);
    assert.deepEqual(sourceState(f.database), f.before);
});

test('new registration uses exact existing059 RSA envelope/request and only public AdapterEnrollment metadata', async t => {
    const f = fixture(t);
    const result = await f.service.enroll(context(), input);
    validateNativeCommandModel('AdapterEnrollment', result);
    assert.equal(result.enrollment_id, 'synthetic-central-enrollment'); assert.equal(result.enrollment_version, 1);
    assert.equal(f.calls.length, 1);
    const [{ url, options }] = f.calls;
    assert.equal(url, `${config.centerOrigin}/v1/integration/operational/enrollments`);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', 'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': config.platformToken });
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    const row = f.row(); const request = JSON.parse(row.request_json); const secret = JSON.parse(f.encryption.decrypt(row.encrypted_private_key));
    assert.deepEqual(request.accepted_scopes, ['savana.collaboration.v1']);
    assert.deepEqual(result.accepted_scopes, ['savana.collaboration.v1']);
    assert.deepEqual(Object.keys(request), ['organization_id', 'external_tenant_id', 'display_name', 'public_key_pem', 'accepted_scopes']);
    assert.equal(secret.purpose, 'wa_consumer_enrollment_key'); assert.equal(secret.enrollment_id, row.id);
    assert.equal(secret.tenant_id, 1); assert.equal(secret.organization_id, 'synthetic-org');
    const privateKey = crypto.createPrivateKey(secret.private_key_pem);
    assert.equal(privateKey.asymmetricKeyType, 'rsa'); assert.equal(privateKey.asymmetricKeyDetails.modulusLength, 2048);
    assert.equal(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }), result.public_key_pem);
    assert.equal(options.body, row.request_json); assert.equal(sha(options.body), row.request_sha256);
    assert.equal(sha(result.public_key_pem), row.public_key_fingerprint);
    for (const value of [JSON.stringify(row), JSON.stringify(result), JSON.stringify(f.audit()), options.body]) assert.equal(value.includes('BEGIN PRIVATE KEY'), false);
    assert.equal(f.database.prepare('SELECT COUNT(*) count FROM savana_operational_consumer_enrollment_audit').get().count, 0);
    assert.deepEqual(f.audit().map(event => [event.action, event.state, event.central_actor_id]), [
        ['prepared', 'prepared', 'synthetic-source-owner'], ['dispatch_started', 'inflight', 'synthetic-source-owner'], ['completed', 'completed', 'synthetic-source-owner'],
    ]);
    const list = await f.service.read(context()); validateNativeCommandModel('AdapterEnrollments', list);
    assert.deepEqual(list.enrollments, [result]); assert.deepEqual(sourceState(f.database), f.before);
    assert.equal(f.database.prepare('SELECT COUNT(*) count FROM savana_delegated_read_sessions').get().count, 0);
});

test('actual owner-confirmed product enrollment extension preserves same059 key/request and accepts only next exact Core version', async t => {
    const f = fixture(t); const request = seedRetained(f, 'completed'); const before = immutable(f.row());
    const prior = await f.service.read(context()); assert.deepEqual(prior.enrollments[0].accepted_scopes, ['savana.products.sync']);
    const next = { ...registration(request), version: 2, accepted_scopes: ['savana.products.sync', 'savana.collaboration.v1'] };
    const result = await f.service.acceptVerifiedRegistration(context(), { registration: next, expectedEnrollmentVersion: 1 });
    assert.deepEqual(result.accepted_scopes, next.accepted_scopes); assert.equal(result.enrollment_version, 2);
    assert.deepEqual(immutable(f.row()), before); assert.equal(f.calls.length, 0); assert.equal(f.row().attempt_count, 1);
    assert.deepEqual(JSON.parse(f.row().request_json).accepted_scopes, ['savana.products.sync']);
    assert.equal(f.audit().at(-1).action, 'registration_extended');
    assert.equal(f.audit().at(-1).central_actor_id, context().actor_id);
    assert.equal((await f.make().read(context())).enrollments[0].enrollment_version, 2);
    const auditLength=f.audit().length;const saved={...f.row()};
    assert.deepEqual(await f.service.acceptVerifiedRegistration(context(), { registration: next, expectedEnrollmentVersion: 1 }),result);
    assert.deepEqual(await f.service.acceptVerifiedRegistration(context(), { registration: next, expectedEnrollmentVersion: 2 }),result);
    assert.deepEqual(f.row(),saved);assert.equal(f.audit().length,auditLength);
});

test('machine delegation, unknown enrollment, wrong scope/key/account/name and non-next versions cannot extend accepted scope', async t => {
    const f = fixture(t); const request = seedRetained(f, 'completed'); const before = { ...f.row() };
    const next = { ...registration(request), version: 2, accepted_scopes: ['savana.products.sync', 'savana.collaboration.v1'] };
    const delegated = { ...context(), actor_id: 'synthetic-delegate', grant_approved_by: context().actor_id };
    await assert.rejects(f.service.acceptVerifiedRegistration(delegated, { registration: next, expectedEnrollmentVersion: 1 }),
        { code: 'native_service_enrollment_initial_owner_required' });
    for (const change of [{ enrollment_id: 'different-registration' }, { version: 1 }, { version: 3 },
        { accepted_scopes: ['savana.collaboration.v1'] }, { accepted_scopes: ['savana.products.sync'] },
        { accepted_scopes: ['savana.products.sync', 'savana.collaboration.v1', '*'] }, { organization_id: 'other-org' },
        { display_name: 'other-name' }, { external_tenant_id: 'wa_savana:tenant:2' }, { public_key_fingerprint: 'd'.repeat(64) }]) {
        await assert.rejects(f.service.acceptVerifiedRegistration(context(), { registration: { ...next, ...change }, expectedEnrollmentVersion: 1 }));
        assert.deepEqual(f.row(), before);
    }
    f.database.prepare("UPDATE savana_operational_consumer_enrollments SET state='unknown'").run();
    await assert.rejects(f.service.acceptVerifiedRegistration(context(), { registration: next, expectedEnrollmentVersion: 1 }),
        { code: 'native_service_enrollment_version_conflict' });
    assert.equal(f.calls.length, 0); assert.equal(f.audit().length, 0);
});

test('fresh owner-proof change during extension rejects complete metadata without changing enrollment bytes', async t => {
    const f = fixture(t); const request = seedRetained(f, 'completed'); const before = { ...f.row() };
    f.duringProof(async () => { f.database.prepare('UPDATE users SET auth_version=1 WHERE id=1').run(); });
    await assert.rejects(f.service.acceptVerifiedRegistration(context(), { registration: { ...registration(request), version: 2,
        accepted_scopes: ['savana.products.sync', 'savana.collaboration.v1'] }, expectedEnrollmentVersion: 1 }),
    { code: 'native_service_enrollment_owner_unavailable' });
    assert.deepEqual(f.row(), before); assert.equal(f.calls.length, 0);
});

test('actual full Core acknowledgement reconciles inflight or unknown initial registration without another key or registration POST',async t=>{
    for(const state of ['inflight','unknown'])await t.test(state,async child=>{
        const f=fixture(child);const request=seedRetained(f,state);const before=immutable(f.row());const accepted={...registration(request),version:4};
        const result=await f.service.acceptVerifiedRegistration(context(),{registration:accepted,expectedEnrollmentVersion:null});
        assert.equal(result.enrollment_version,4);assert.equal(result.enrollment_id,accepted.enrollment_id);
        assert.deepEqual(immutable(f.row()),before);assert.equal(f.row().attempt_count,1);assert.equal(f.row().state,'completed');assert.equal(f.calls.length,0);
        assert.deepEqual(f.audit().map(row=>row.action),['registration_reconciled']);const saved={...f.row()};
        assert.deepEqual(await f.service.acceptVerifiedRegistration(context(),{registration:accepted,expectedEnrollmentVersion:null}),result);
        assert.deepEqual(f.row(),saved);assert.equal(f.audit().length,1);
    });
});

test('lost initial response can confirm actual owner-approved product scope extension while retaining original product request and RSA identity',async t=>{
    const f=fixture(t);const request=seedRetained(f,'unknown');const before=immutable(f.row());
    const accepted={...registration(request),version:2,accepted_scopes:['savana.collaboration.v1','savana.products.sync']};
    const result=await f.service.acceptVerifiedRegistration(context(),{registration:accepted,expectedEnrollmentVersion:null});
    assert.deepEqual(result.accepted_scopes,accepted.accepted_scopes);assert.equal(result.enrollment_version,2);assert.deepEqual(immutable(f.row()),before);
    assert.deepEqual(JSON.parse(f.row().request_json).accepted_scopes,['savana.products.sync']);
    assert.deepEqual(f.audit().map(row=>row.action),['registration_reconciled','registration_extended']);assert.equal(f.calls.length,0);
    const auditLength=f.audit().length;
    assert.equal((await f.service.acceptVerifiedRegistration(context(),{registration:{...accepted,accepted_scopes:[...accepted.accepted_scopes].reverse()},expectedEnrollmentVersion:2})).enrollment_version,2);
    assert.equal(f.audit().length,auditLength);
});

test('initial acknowledgement cannot be substituted across key, organization, native account, name, scopes or unconfirmed local states',async t=>{
    const f=fixture(t);const request=seedRetained(f,'unknown');const before={...f.row()};const accepted=registration(request);
    for(const patch of [{public_key_fingerprint:'f'.repeat(64)},{organization_id:'other-org'},{external_tenant_id:'wa_savana:tenant:2'},
        {display_name:'Other name'},{accepted_scopes:['savana.collaboration.v1']},{accepted_scopes:['savana.products.sync','savana.collaboration.v1'],version:1},{version:0}]){
        await assert.rejects(f.service.acceptVerifiedRegistration(context(),{registration:{...accepted,...patch},expectedEnrollmentVersion:null}));assert.deepEqual(f.row(),before);
    }
    const delegated={...context(),actor_id:'synthetic-delegate',grant_approved_by:context().actor_id};
    await assert.rejects(f.service.acceptVerifiedRegistration(delegated,{registration:{...accepted,version:2,accepted_scopes:['savana.products.sync','savana.collaboration.v1']},expectedEnrollmentVersion:null}),{code:'native_service_enrollment_initial_owner_required'});
    assert.deepEqual(f.row(),before);assert.equal(f.audit().length,0);assert.equal(f.calls.length,0);
    f.database.prepare("UPDATE savana_operational_consumer_enrollments SET state='prepared',attempt_count=0").run();
    await assert.rejects(f.service.acceptVerifiedRegistration(context(),{registration:accepted,expectedEnrollmentVersion:null}),{code:'native_service_enrollment_state_changed'});
});

test('same current ACK is idempotent but stale, changed or future-version acknowledgements cannot replace committed enrollment metadata',async t=>{
    const f=fixture(t);const request=seedRetained(f,'completed');const accepted=registration(request);const before={...f.row()};
    assert.equal((await f.service.acceptVerifiedRegistration(context(),{registration:accepted,expectedEnrollmentVersion:1})).enrollment_version,1);
    for(const [registration,expected]of [[{...accepted,enrollment_id:'other-id'},1],[accepted,2],[{...accepted,version:2},1],[{...accepted,version:0},1]]){
        await assert.rejects(f.service.acceptVerifiedRegistration(context(),{registration,expectedEnrollmentVersion:expected}));assert.deepEqual(f.row(),before);
    }
    assert.equal(f.audit().length,0);assert.equal(f.calls.length,0);
});

test('internal original BFF session fence rejects revocation during either owner await without enrollment or audit changes',async t=>{
    for(const revokeAt of [1,2])await t.test(`authority await ${revokeAt}`,async child=>{
        const f=fixture(child);const request=seedRetained(f,'completed');const before={...f.row()};let current=true;let calls=0;
        f.duringProof(async()=>{if(++calls===revokeAt)current=false;});
        await assert.rejects(f.service.acceptVerifiedRegistration(context(),{registration:{...registration(request),version:2,
            accepted_scopes:['savana.products.sync','savana.collaboration.v1']},expectedEnrollmentVersion:1},{assertCurrent:()=>current}),{code:'native_service_enrollment_session_changed'});
        assert.deepEqual(f.row(),before);assert.equal(f.audit().length,0);assert.equal(f.calls.length,0);
    });
});

test('internal session fence after receipt writes rolls back the actual SQLite update and audit atomically',async t=>{
    const f=fixture(t);const request=seedRetained(f,'completed');const before={...f.row()};let current=true;
    f.database.function('synthetic_session_revoked',()=>{current=false;return 1;});
    f.database.exec(`CREATE TEMP TRIGGER synthetic_session_change AFTER UPDATE OF response_json ON savana_operational_consumer_enrollments
        BEGIN SELECT synthetic_session_revoked(); END;`);
    await assert.rejects(f.service.acceptVerifiedRegistration(context(),{registration:{...registration(request),version:2,
        accepted_scopes:['savana.products.sync','savana.collaboration.v1']},expectedEnrollmentVersion:1},{assertCurrent:()=>current}),{code:'native_service_enrollment_session_changed'});
    assert.deepEqual(f.row(),before);assert.equal(f.audit().length,0);
});

test('actual concurrent services claim one key and one POST; the second returns inflight public key without invented success', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-native-enrollment-concurrency-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.db');
    const f = fixture(t, { filename });
    const secondConnection = new Database(filename); t.after(() => { if (secondConnection.open) secondConnection.close(); });
    let release; let started;
    const entered = new Promise(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    f.duringFetch(async () => { started(); await pending; });
    const first = f.service.enroll(context(), input);
    await entered;
    const immutableBefore = immutable(f.row());
    const second = await f.make({ database: secondConnection }).enroll(context(), input);
    assert.equal(second.enrollment_id, null); assert.equal(second.enrollment_version, null);
    assert.equal(f.calls.length, 1); assert.equal(f.row().attempt_count, 1);
    assert.deepEqual(immutable(f.row()), immutableBefore);
    release(); const completed = await first;
    assert.equal(completed.public_key_pem, second.public_key_pem);
    assert.equal(completed.enrollment_version, 1); assert.equal(f.calls.length, 1);
});

test('stale signed native-owner revision and authority changes during readonly lookup cannot complete registration', async t => {
    await t.test('signed ownership revision', async child => {
        const f = fixture(child);
        await assert.rejects(f.service.enroll({ ...context(), native_authority_revision: 'stale-native-owner-revision' }, input), { code: 'native_service_enrollment_owner_changed' });
        assert.equal(f.row(), undefined); assert.equal(f.calls.length, 0);
    });
    for (const kind of ['owner', 'scope']) await t.test(`lookup ${kind}`, async child => {
        const f = fixture(child); const request = seedRetained(f, 'unknown'); const before = { ...f.row() }; const signed = context();
        const service = f.make({ lookupRegistration: async () => {
            if (kind === 'owner') f.database.prepare('UPDATE users SET auth_version=1 WHERE id=1').run();
            else signed.activity_id = 'different-signed-scope';
            return registration(request);
        } });
        await assert.rejects(service.read(signed), error => error instanceof NativeCommandProtocolError && error.status === 403);
        assert.deepEqual(f.row(), before); assert.equal(f.calls.length, 0); assert.equal(f.audit().length, 0);
    });
});

test('all retained states reuse059 bytes and never trigger another POST or key generation', async t => {
    for (const state of ['prepared', 'inflight', 'unknown', 'completed', 'failed']) await t.test(state, async child => {
        const f = fixture(child); const body = seedRetained(f, state); const before = { ...f.row() };
        const result = await f.service.enroll(context(), input);
        assert.equal(result.public_key_pem, body.public_key_pem); assert.equal(f.calls.length, 0);
        assert.equal(result.enrollment_version, state === 'completed' ? 1 : null);
        assert.equal(result.enrollment_id, state === 'completed' ? 'synthetic-central-enrollment' : null);
        assert.deepEqual(f.row(), before); assert.equal(f.audit().length, 0);
        const delegate = { ...context(), actor_id: 'synthetic-delegate', grant_approved_by: 'synthetic-source-owner' };
        assert.equal((await f.service.read(delegate)).enrollments[0].public_key_pem, body.public_key_pem);
        assert.equal(f.calls.length, 0);
    });
});

test('lost inner acknowledgement survives process-style DB reopen and exact-key readonly reconciliation without POST', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-native-service-enrollment-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.db');
    const f = fixture(t, { filename });
    f.duringFetch(async () => { throw new Error('Synthetic commit followed by lost ACK'); });
    await assert.rejects(f.service.enroll(context(), input), { code: 'native_service_enrollment_outcome_unknown' });
    assert.equal(f.row().state, 'unknown'); const before = immutable(f.row());
    f.database.close(); const reopened = new Database(filename); t.after(() => { if (reopened.open) reopened.close(); });
    const withoutLookup = f.make({ database: reopened });
    const unknown = await withoutLookup.read(context());
    assert.equal(unknown.enrollments[0].enrollment_id, null); assert.equal(unknown.enrollments[0].enrollment_version, null);
    let lookupCount = 0;
    const recovered = f.make({ database: reopened, lookupRegistration: async selection => {
        lookupCount += 1; assert.equal(selection.organizationId, 'synthetic-org');
        assert.equal(selection.externalTenantId, 'wa_savana:tenant:1'); assert.equal(selection.publicKeyFingerprint, before.public_key_fingerprint);
        assert.equal(selection.requestSha256, before.request_sha256); assert.equal(selection.signal instanceof AbortSignal, true);
        assert.equal(JSON.stringify(selection).includes('BEGIN PRIVATE KEY'), false);
        return registration(JSON.parse(before.request_json));
    } });
    const list = await recovered.read(context());
    assert.equal(list.enrollments[0].enrollment_id, 'synthetic-central-enrollment'); assert.equal(list.enrollments[0].enrollment_version, 1);
    assert.equal(lookupCount, 1); assert.equal(f.calls.length, 1);
    const after = reopened.prepare('SELECT * FROM savana_operational_consumer_enrollments').get();
    assert.equal(after.state, 'completed'); assert.equal(after.attempt_count, 1); assert.deepEqual(immutable(after), before);
});

test('unknown lookup absence and uncorrelated no-effect metadata cannot establish success or authorize a resend', async t => {
    const f = fixture(t); seedRetained(f, 'unknown'); const before = { ...f.row() };
    const unavailable = f.make({ lookupRegistration: async () => null });
    assert.equal((await unavailable.read(context())).enrollments[0].enrollment_id, null);
    const lostLookup = f.make({ lookupRegistration: async () => { throw new Error('Synthetic lookup unavailable'); } });
    assert.equal((await lostLookup.read(context())).enrollments[0].enrollment_id, null);
    const uncorrelated = f.make({ lookupRegistration: async () => ({ no_effect: true, status: 'not_found' }) });
    await assert.rejects(uncorrelated.read(context()), { code: 'native_service_enrollment_registration_invalid' });
    assert.deepEqual(f.row(), before); assert.equal(f.calls.length, 0); assert.equal(f.audit().length, 0);
});

test('source proof expiring while RSA material is prepared cannot persist a key or dispatch', async t => {
    const f = fixture(t); let clock = now;
    const encryption = { ...f.encryption, encrypt(value) { const encrypted = f.encryption.encrypt(value); clock = now + 31_000; return encrypted; } };
    const service = f.make({ encryption, now: () => clock });
    await assert.rejects(service.enroll(context(), input), { code: 'native_service_enrollment_owner_changed', status: 403 });
    assert.equal(f.row(), undefined); assert.equal(f.calls.length, 0); assert.equal(f.audit().length, 0);
});

test('all eight central metadata fields must match before an unknown registration can complete', async t => {
    const f = fixture(t); const request = seedRetained(f, 'unknown'); const before = { ...f.row() };
    const changes = [{ organization_id: 'another-org' }, { external_tenant_id: 'wa_savana:tenant:2' }, { platform: 'catalog' },
        { display_name: 'Changed' }, { public_key_fingerprint: 'b'.repeat(64) }, { version: 0 }, { enrollment_id: '' }, { accepted_scopes: ['*'] }, { extra: true }];
    for (const change of changes) {
        const service = f.make({ lookupRegistration: async () => ({ ...registration(request), ...change }) });
        await assert.rejects(service.read(context()), { code: 'native_service_enrollment_registration_invalid' });
        assert.deepEqual(f.row(), before);
    }
    assert.equal(f.calls.length, 0);
});

test('changed real064 owner proof, binding or signed context during HTTP leaves durable unknown and never exposes a completion', async t => {
    for (const kind of ['owner', 'binding', 'scope']) await t.test(kind, async child => {
        const f = fixture(child); const requestContext = context();
        f.duringFetch(async () => {
            if (kind === 'owner') f.database.prepare('UPDATE users SET auth_version=1 WHERE id=1').run();
            else if (kind === 'binding') f.changeBinding('changed-current-binding');
            else requestContext.activity_id = 'changed-scope';
        });
        await assert.rejects(f.service.enroll(requestContext, input), error => error instanceof NativeCommandProtocolError && error.status === 403);
        assert.equal(f.row().state, 'unknown'); assert.equal(f.row().response_json, null); assert.equal(f.calls.length, 1);
        assert.equal(f.audit().at(-1).central_actor_id, 'synthetic-source-owner');
    });
});

test('authority lost immediately before dispatch records definitive local no-effect without later retry', async t => {
    const f = fixture(t); let proofs = 0;
    f.duringProof(async () => { if (++proofs === 2) f.database.prepare('UPDATE users SET is_active=0 WHERE id=1').run(); });
    await assert.rejects(f.service.enroll(context(), input), { code: 'native_service_enrollment_owner_unavailable' });
    assert.equal(f.calls.length, 0); assert.equal(f.row().state, 'failed');
    const before = immutable(f.row());
    f.database.prepare('UPDATE users SET is_active=1 WHERE id=1').run(); f.duringProof(async () => {});
    assert.equal((await f.service.enroll(context(), input)).enrollment_id, null);
    assert.equal(f.calls.length, 0); assert.deepEqual(immutable(f.row()), before);
});

test('binding/display conflicts and wrong cipher fail before HTTP and retain original encrypted key', async t => {
    const f = fixture(t); seedRetained(f, 'completed'); const before = { ...f.row() };
    await assert.rejects(f.make({ encryption: cipher() }).read(context()), { code: 'native_service_enrollment_key_unavailable' });
    await assert.rejects(f.make({ config: { ...config, centerOrigin: 'https://different-core.invalid' } }).read(context()), { code: 'native_service_enrollment_binding_conflict' });
    f.database.prepare(`INSERT INTO savana_native_owner_proofs
        (tenant_id,user_id,native_auth_version,native_role,central_actor_id,organization_id,oidc_issuer,oidc_client_id,identity_generation,verified_at)
        VALUES(1,1,0,'tenant','synthetic-source-owner','another-current-org','https://synthetic-issuer.invalid','synthetic-client','synthetic-second-generation',?)`)
        .run(new Date(now).toISOString());
    await assert.rejects(f.service.read({ ...context(), organization_id: 'another-current-org' }), { code: 'native_service_enrollment_binding_conflict' });
    f.database.prepare("UPDATE tenants SET name='Renamed native tenant' WHERE id=1").run();
    await assert.rejects(f.service.read(context()), { code: 'native_service_enrollment_content_conflict' });
    await assert.rejects(f.service.enroll(context(), input), { code: 'native_service_enrollment_content_conflict' });
    assert.equal(f.calls.length, 0); assert.deepEqual(f.row(), before);
});

test('malformed remote success and generic HTTP rejection remain unknown; maintenance is local proven no-effect', async t => {
    await t.test('malformed success', async child => {
        const f = fixture(child); f.transform(value => ({ ...value, public_key_fingerprint: 'c'.repeat(64) }));
        await assert.rejects(f.service.enroll(context(), input), { code: 'native_service_enrollment_registration_invalid' });
        assert.equal(f.row().state, 'unknown'); await f.service.enroll(context(), input); assert.equal(f.calls.length, 1);
    });
    await t.test('uncorrelated HTTP409', async child => {
        const f = fixture(child); f.responseStatus(409); f.transform(() => ({ no_effect: true }));
        await assert.rejects(f.service.enroll(context(), input), { code: 'native_service_enrollment_outcome_unknown' });
        assert.equal(f.row().state, 'unknown'); await f.service.enroll(context(), input); assert.equal(f.calls.length, 1);
    });
    await t.test('maintenance transport block', async child => {
        const f = fixture(child); f.duringFetch(async () => { throw new EgressMaintenanceError(); });
        await assert.rejects(f.service.enroll(context(), input), { code: 'WA_EGRESS_MAINTENANCE' });
        assert.equal(f.row().state, 'failed'); await f.service.enroll(context(), input); assert.equal(f.calls.length, 1);
    });
});

test('plaintext cipher and malformed input cannot create a key row, and native service audit cannot impersonate a WA user', async t => {
    const f = fixture(t);
    await assert.rejects(f.make({ encryption: { encrypt: value => value, decrypt: value => value } }).enroll(context(), input), { code: 'native_service_enrollment_encryption_unavailable' });
    assert.equal(f.row(), undefined); assert.equal(f.calls.length, 0);
    await assert.rejects(f.service.enroll(context(), { ...input, userId: 1 }), { code: 'native_service_enrollment_request_invalid' });
    await assert.rejects(f.service.enroll(context(), { providerRef: 'Core-private-reference' }), { code: 'native_service_enrollment_request_invalid' });
    await assert.rejects(f.service.read({ ...context(), external_tenant_id: 'wa_savana:tenant:01' }), { code: 'native_service_enrollment_context_invalid' });
    await f.service.enroll(context(), input);
    const columns = f.database.prepare('PRAGMA table_info(savana_native_enrollment_service_audit)').all().map(column => column.name);
    assert.equal(columns.includes('actor_user_id'), false); assert.equal(columns.includes('session_reference'), false);
    assert.throws(() => f.database.prepare("UPDATE savana_native_enrollment_service_audit SET central_actor_id='changed'").run(), /immutable/);
    assert.throws(() => f.database.prepare('DELETE FROM savana_native_enrollment_service_audit').run(), /retained/);
});
