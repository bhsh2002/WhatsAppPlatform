import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { WorkspaceIntentStore, canonicalWorkspaceJson } from '../services/workspaceIntents.js';

const START = Date.parse('2026-11-18T12:00:00Z');
const principal = (extra = {}) => ({ tenantId: 1, userId: 1, sessionId: 'synthetic-native-session', authVersion: 0,
    role: 'tenant', issuedAt: START / 1000 - 20, sessionExpiresAt: START / 1000 + 300, ...extra });
const identity = (extra = {}) => ({ actorId: 'synthetic-core-actor', organizationId: 'synthetic-org', nativeAccountId: 'synthetic-native-account',
    generation: 'synthetic-oidc-generation', expiresAt: new Date(START + 240_000).toISOString(), ...extra });
const input = (extra = {}) => ({ operation: 'activities.create', idempotencyKey: 'synthetic-request-key', inputHash: 'a'.repeat(64),
    request: { method: 'POST', path: '/v1/integration/workspace/activities', body: { label: 'Synthetic activity', nested: { z: 2, a: 1 } } }, ...extra });
const cipher = (key = crypto.randomBytes(32)) => ({
    encrypt(raw) { const iv = crypto.randomBytes(12); const aes = crypto.createCipheriv('aes-256-gcm', key, iv);
        const body = Buffer.concat([aes.update(raw), aes.final()]); return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64'); },
    decrypt(raw) { const body = Buffer.from(raw, 'base64'); const aes = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
        aes.setAuthTag(body.subarray(12, 28)); return Buffer.concat([aes.update(body.subarray(28)), aes.final()]).toString(); },
});
const createSchema = database => {
    database.pragma('foreign_keys = ON');
    database.exec(`CREATE TABLE tenants(id INTEGER PRIMARY KEY);
        CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,auth_version INTEGER NOT NULL,role TEXT NOT NULL,is_active INTEGER NOT NULL);
        INSERT INTO tenants VALUES(1),(2);
        INSERT INTO users VALUES(1,1,0,'tenant',1),(2,1,0,'tenant',1),(3,2,0,'tenant',1);`);
    database.exec(fs.readFileSync(new URL('../db/migrations/062_workspace_intents.sql', import.meta.url), 'utf8'));
};
const verifier = database => p => {
    const user = database.prepare('SELECT * FROM users WHERE id=?').get(p.userId);
    return user?.is_active === 1 && user.tenant_id === p.tenantId && user.auth_version === p.authVersion && user.role === p.role;
};
const fixture = t => {
    const database = new Database(':memory:'); createSchema(database); t.after(() => database.close());
    let clock = START; const encryption = cipher();
    const store = new WorkspaceIntentStore({ database, encryption, verifyLocalPrincipal: verifier(database), now: () => clock });
    return { database, encryption, store, setClock: value => { clock = value; } };
};
const stored = (f, id) => f.database.prepare('SELECT * FROM savana_workspace_intents WHERE id=?').get(id);

test('prepare atomically claims exact canonical request once and duplicate returns metadata only', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input());
    assert.equal(first.intent.state, 'inflight'); assert.equal(first.dispatch.bodyJson, JSON.stringify(first.dispatch.body));
    assert.equal(first.dispatch.bodyJson, '{"label":"Synthetic activity","nested":{"a":1,"z":2}}');
    const row = stored(f, first.intent.id);
    assert.equal(row.encrypted_request.includes('Synthetic activity'), false);
    const duplicate = f.store.prepare(principal(), identity(), input());
    assert.equal(duplicate.dispatch, null); assert.deepEqual(duplicate.intent, first.intent);
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM savana_workspace_intents').get().n, 1);
    assert.deepEqual(f.database.prepare('SELECT action FROM savana_workspace_intent_audit ORDER BY id').all().map(row => row.action), ['workspace_prepared', 'workspace_claimed_once']);
});

test('same key conflicts on changed input, operation, method, path or body without rewriting stored bytes', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input()); const before = stored(f, first.intent.id);
    for (const changed of [input({ inputHash: 'b'.repeat(64) }), input({ operation: 'requests.create' }),
        input({ request: { ...input().request, method: 'PUT' } }), input({ request: { ...input().request, path: '/v1/integration/workspace/requests' } }),
        input({ request: { ...input().request, body: { label: 'Different' } } })]) {
        assert.throws(() => f.store.prepare(principal(), identity(), changed), { code: 'workspace_intent_content_conflict' });
    }
    assert.deepEqual(stored(f, first.intent.id), before);
});

test('unknown/inflight hold survives new JWT, new OIDC generation and another native user sharing the Core actor', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input());
    f.store.finish(principal(), identity(), first.intent.id, { state: 'unknown' });
    const renewed = principal({ sessionId: 'synthetic-new-jti' }); const renewedIdentity = identity({ generation: 'synthetic-new-oidc' });
    assert.equal(f.store.readByKey(renewed, renewedIdentity, input().idempotencyKey).intent.state, 'unknown');
    assert.equal(f.store.prepare(renewed, renewedIdentity, input()).dispatch, null);
    for (const p of [renewed, principal({ userId: 2, sessionId: 'synthetic-other-user' })]) {
        assert.equal(f.store.hasUnresolved(p, renewedIdentity), true);
        assert.throws(() => f.store.prepare(p, renewedIdentity, input({ idempotencyKey: 'synthetic-fresh-key' })), { code: 'workspace_unresolved_intent' });
    }
    assert.throws(() => f.store.readById(principal({ userId: 2 }), identity(), first.intent.id), { code: 'workspace_intent_not_found' });
    assert.throws(() => f.store.prepare(principal({ userId: 2 }), identity(), input()), { code: 'workspace_intent_not_found' });
});

test('first current completion returns a result once; later lookups and finish calls return no cached result', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input());
    const result = { command: { id: 'synthetic-command', state: 'pending' } };
    const done = f.store.finish(principal(), identity(), first.intent.id, { state: 'completed', result });
    assert.deepEqual(done.result, result); assert.equal(done.intent.result, null);
    assert.equal(stored(f, first.intent.id).encrypted_result.includes('synthetic-command'), false);
    assert.equal(f.store.readById(principal(), identity(), first.intent.id).intent.result, null);
    assert.equal(f.store.finish(principal(), identity(), first.intent.id, { state: 'completed', result: { changed: true } }).result, null);
    assert.equal(f.store.prepare(principal({ sessionId: 'renewed' }), identity({ generation: 'renewed' }), input()).dispatch, null);
});

test('expiry or revocation after dispatch durably records unknown then throws without releasing private result', t => {
    for (const expire of [false, true]) {
        const f = fixture(t); const first = f.store.prepare(principal(), identity(), input());
        if (expire) f.setClock(START + 240_000);
        else f.database.prepare('UPDATE users SET is_active=0 WHERE id=1').run();
        assert.throws(() => f.store.finish(principal(), identity(), first.intent.id, { state: 'completed', result: { private: 'not-returned' } }), { code: 'workspace_context_changed' });
        assert.equal(stored(f, first.intent.id).state, 'unknown');
        assert.equal(stored(f, first.intent.id).encrypted_result, null);
        assert.equal(f.store.finish(principal(), identity(), first.intent.id, { state: 'unknown' }).result, null);
    }
});

test('known Core rejection may fail; timeout/unproven rejection stays unknown and cannot be reclaimed', t => {
    const known = fixture(t); const first = known.store.prepare(principal(), identity(), input());
    assert.equal(known.store.finish(principal(), identity(), first.intent.id, { state: 'failed', errorCode: 'workspace_rejected', remoteStatus: 422 }).intent.state, 'failed');
    assert.equal(known.store.hasUnresolved(principal(), identity()), false);
    const unknown = fixture(t); const second = unknown.store.prepare(principal(), identity(), input());
    assert.equal(unknown.store.finish(principal(), identity(), second.intent.id, { state: 'failed', errorCode: 'workspace_rejected', remoteStatus: 503 }).intent.state, 'unknown');
    assert.equal(unknown.store.hasUnresolved(principal(), identity()), true);
});

test('strict canonical JSON rejects nonfinite, cyclic, getter, sparse and undefined values before claim', t => {
    const f = fixture(t); let readGetter = false;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { readGetter = true; return 1; } });
    const arrayGetter = []; Object.defineProperty(arrayGetter, '0', { enumerable: true, get() { readGetter = true; return 1; } });
    const cyclic = {}; cyclic.self = cyclic;
    for (const body of [{ amount: NaN }, { amount: Infinity }, { value: undefined }, cyclic, getter, arrayGetter, new Array(1), new Date()]) {
        assert.throws(() => f.store.prepare(principal(), identity(), input({ request: { ...input().request, body } })), { code: 'workspace_request_invalid' });
    }
    assert.equal(readGetter, false); assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM savana_workspace_intents').get().n, 0);
    assert.equal(canonicalWorkspaceJson({ z: 2, a: 1 }), '{"a":1,"z":2}');
});

test('one-megabyte body boundary and source-owned method/path restrictions are enforced', t => {
    const f = fixture(t);
    assert.throws(() => f.store.prepare(principal(), identity(), input({ request: { ...input().request, body: 'x'.repeat(1_048_576) } })), { code: 'workspace_request_invalid' });
    for (const path of ['https://outside.invalid/v1/integration/workspace', '/v1/integration/workspace/../foreign', '/v1/integration/workspace/%2e%2e', '/v1/integration/workspace\n']) {
        assert.throws(() => f.store.prepare(principal(), identity(), input({ request: { ...input().request, path } })), { code: 'workspace_request_invalid' });
    }
    const nearLimit = f.store.prepare(principal(), identity(), input({ request: { ...input().request, body: 'x'.repeat(1_048_574) } }));
    assert.equal(Buffer.byteLength(nearLimit.dispatch.bodyJson), 1_048_576);
});

test('migration protects original identity/request bytes and forbids replay or replacement of terminal history', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input());
    for (const field of ['operation', 'native_account_id', 'identity_generation', 'request_sha256', 'encrypted_request']) {
        assert.throws(() => f.database.prepare(`UPDATE savana_workspace_intents SET ${field}='changed' WHERE id=?`).run(first.intent.id), /immutable/);
    }
    f.store.finish(principal(), identity(), first.intent.id, { state: 'unknown' });
    assert.throws(() => f.database.prepare("UPDATE savana_workspace_intents SET state='inflight' WHERE id=?").run(first.intent.id), /forbidden/);
    assert.throws(() => f.database.prepare('DELETE FROM users WHERE id=1').run(), /FOREIGN KEY/);
});

test('wrong cipher cannot complete or replace retained request/history', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input()); const encrypted = stored(f, first.intent.id).encrypted_request;
    const wrong = new WorkspaceIntentStore({ database: f.database, encryption: cipher(), verifyLocalPrincipal: verifier(f.database), now: () => START });
    assert.throws(() => wrong.finish(principal(), identity(), first.intent.id, { state: 'completed', result: {} }), { code: 'workspace_encryption_unavailable' });
    assert.equal(stored(f, first.intent.id).state, 'unknown'); assert.equal(stored(f, first.intent.id).encrypted_request, encrypted);
    assert.equal(wrong.prepare(principal(), identity(), input()).dispatch, null);
});

test('new local auth version can inspect metadata but cannot finish the original principal claim', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input());
    f.database.prepare('UPDATE users SET auth_version=1 WHERE id=1').run();
    const current = principal({ authVersion: 1, sessionId: 'new-auth-jti' });
    assert.equal(f.store.readById(current, identity(), first.intent.id).intent.state, 'inflight');
    assert.throws(() => f.store.finish(current, identity(), first.intent.id, { state: 'completed', result: {} }), { code: 'workspace_context_changed' });
    assert.throws(() => f.store.readById(principal({ tenantId: 2, userId: 3 }), identity(), first.intent.id), { code: 'workspace_intent_not_found' });
});

test('reconciliation needs a trusted exact correlated outcome, never a browser status or new dispatch', async t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input()); f.store.finish(principal(), identity(), first.intent.id, { state: 'unknown' });
    await assert.rejects(f.store.reconcile(principal(), identity(), first.intent.id), { code: 'workspace_reconciliation_unavailable' });
    let verified = false;
    const store = new WorkspaceIntentStore({ database: f.database, encryption: f.encryption, verifyLocalPrincipal: verifier(f.database), now: () => START,
        loadOutcome: async context => ({ state: 'completed', result: { command: 'synthetic-resolved' }, correlation: {
            intentId: context.intentId, inputHash: context.inputHash, requestHash: verified ? context.requestHash : 'b'.repeat(64),
            actorId: context.identity.actorId, organizationId: context.identity.organizationId, nativeAccountId: context.identity.nativeAccountId,
        } }) });
    await assert.rejects(store.reconcile(principal(), identity(), first.intent.id), { code: 'workspace_reconciliation_unverified' });
    assert.equal(stored(f, first.intent.id).state, 'unknown'); verified = true;
    const resolved = await store.reconcile(principal({ sessionId: 'current-jti' }), identity({ generation: 'current-generation' }), first.intent.id);
    assert.equal(resolved.intent.state, 'completed'); assert.equal(resolved.result, null);
    assert.equal(f.store.hasUnresolved(principal(), identity()), false);
});

test('two SQLite connections cannot claim two competing keys for the same unresolved actor context', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-workspace-concurrency-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.sqlite'); const firstDb = new Database(filename); createSchema(firstDb); const secondDb = new Database(filename);
    t.after(() => { secondDb.close(); firstDb.close(); }); const encryption = cipher();
    const one = new WorkspaceIntentStore({ database: firstDb, encryption, verifyLocalPrincipal: verifier(firstDb), now: () => START });
    const two = new WorkspaceIntentStore({ database: secondDb, encryption, verifyLocalPrincipal: verifier(secondDb), now: () => START });
    const claimed = one.prepare(principal(), identity(), input());
    assert.throws(() => two.prepare(principal(), identity(), input({ idempotencyKey: 'other-key' })), { code: 'workspace_unresolved_intent' });
    assert.equal(two.prepare(principal(), identity(), input()).dispatch, null);
    assert.equal(secondDb.prepare('SELECT COUNT(*) AS n FROM savana_workspace_intents').get().n, 1);
    assert.equal(two.readById(principal(), identity(), claimed.intent.id).intent.state, 'inflight');
});

test('fresh OS processes preserve claimed uncertainty, encrypted history and wrong-key refusal without replay', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-workspace-cold-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.sqlite'); const seed = new Database(filename); createSchema(seed); seed.close();
    const key = crypto.randomBytes(32);
    const source = `
        import crypto from 'node:crypto';
        import Database from 'better-sqlite3';
        import { WorkspaceIntentStore } from ${JSON.stringify(new URL('../services/workspaceIntents.js', import.meta.url).href)};
        const cipher = ${cipher.toString()};
        const principal = ${principal.toString()};
        const identity = ${identity.toString()};
        const input = ${input.toString()};
        const START = ${START};
        const parts=[]; for await (const part of process.stdin) parts.push(part);
        const privateKey=Buffer.from(Buffer.concat(parts).toString('utf8').trim(),'hex');
        if(privateKey.byteLength!==32) throw new Error('Private test input rejected');
        const [filename,mode]=process.argv.slice(1);
        const database=new Database(filename);
        const verify=p=>{ const u=database.prepare('SELECT * FROM users WHERE id=?').get(p.userId);return u?.is_active===1&&u.tenant_id===p.tenantId&&u.auth_version===p.authVersion&&u.role===p.role; };
        const store=new WorkspaceIntentStore({database,encryption:cipher(privateKey),verifyLocalPrincipal:verify,now:()=>START});
        if(mode==='writer'){
            const prepared=store.prepare(principal(),identity(),input());
            process.stdout.write(JSON.stringify({state:prepared.intent.state,claimed:!!prepared.dispatch}),()=>process.exit(0));
        }else{
            const current=principal({sessionId:'cold-reader-jti'}),owner=identity({generation:'cold-reader-oidc'});
            const row=store.readByKey(current,owner,input().idempotencyKey).intent;
            const before=database.prepare('SELECT encrypted_request FROM savana_workspace_intents WHERE id=?').get(row.id).encrypted_request;
            let keyRejected=false;
            if(mode==='wrong-key'){
                try{store.finish(principal(),identity(),row.id,{state:'completed',result:{incorrect:true}});}catch(error){keyRejected=error.code==='workspace_encryption_unavailable';}
            }
            const repeated=store.prepare(current,owner,input());
            let newKeyBlocked=false;try{store.prepare(current,owner,input({idempotencyKey:'cold-new-key'}));}catch(error){newKeyBlocked=error.code==='workspace_unresolved_intent';}
            const after=database.prepare('SELECT encrypted_request FROM savana_workspace_intents WHERE id=?').get(row.id).encrypted_request;
            const result={state:store.readById(current,owner,row.id).intent.state,result:repeated.intent.result,
                dispatch:repeated.dispatch,hold:store.hasUnresolved(current,owner),newKeyBlocked,keyRejected,encryptedRequestUnchanged:before===after};
            database.close();process.stdout.write(JSON.stringify(result));
        }
    `;
    const run = (mode, privateKey) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', source, filename, mode], {
            cwd: fileURLToPath(new URL('..', import.meta.url)), env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = ''; let errors = '';
        const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Owned process deadline')); }, 10_000);
        child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
        child.on('error', error => { clearTimeout(timeout); reject(error); });
        child.on('close', code => { clearTimeout(timeout); if (code !== 0) reject(new Error(`Owned process failed (${code}): ${errors}`)); else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } } });
        child.stdin.end(privateKey.toString('hex') + '\n');
    });
    assert.deepEqual(await run('writer', key), { state: 'inflight', claimed: true });
    const cold = await run('reader', key);
    assert.equal(cold.state, 'inflight'); assert.equal(cold.dispatch, null); assert.equal(cold.result, null);
    assert.equal(cold.hold, true); assert.equal(cold.newKeyBlocked, true);
    const wrong = await run('wrong-key', crypto.randomBytes(32));
    assert.equal(wrong.state, 'unknown'); assert.equal(wrong.keyRejected, true);
    assert.equal(wrong.encryptedRequestUnchanged, true); assert.equal(wrong.dispatch, null);
});

test('expired prepare and changed original Core/native-account bindings cannot claim or finish work', t => {
    const f = fixture(t);
    assert.throws(() => f.store.prepare(principal(), identity({ expiresAt: new Date(START).toISOString() }), input()), { code: 'workspace_context_changed' });
    const first = f.store.prepare(principal(), identity(), input());
    for (const owner of [identity({ generation: 'different' }), identity({ nativeAccountId: 'different' }), identity({ actorId: 'different' })]) {
        assert.throws(() => f.store.finish(principal(), owner, first.intent.id, { state: 'completed', result: {} }));
    }
    assert.equal(stored(f, first.intent.id).state, 'inflight');
});

test('revocation during trusted reconciliation preserves unknown and never returns its private result', async t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input()); f.store.finish(principal(), identity(), first.intent.id, { state: 'unknown' });
    const store = new WorkspaceIntentStore({ database: f.database, encryption: f.encryption, verifyLocalPrincipal: verifier(f.database), now: () => START,
        loadOutcome: async context => {
            f.database.prepare('UPDATE users SET is_active=0 WHERE id=1').run();
            return { state: 'completed', result: { private: 'never-returned' }, correlation: { intentId: context.intentId,
                inputHash: context.inputHash, requestHash: context.requestHash, actorId: context.identity.actorId,
                organizationId: context.identity.organizationId, nativeAccountId: context.identity.nativeAccountId } };
        } });
    await assert.rejects(store.reconcile(principal(), identity(), first.intent.id), { code: 'workspace_context_changed' });
    assert.equal(stored(f, first.intent.id).state, 'unknown'); assert.equal(stored(f, first.intent.id).encrypted_result, null);
});

test('owner list exposes only same current native user/account metadata and internal key for fresh reference issuance', t => {
    const f = fixture(t); const first = f.store.prepare(principal(), identity(), input());
    const rows = f.store.listForOwner(principal({ sessionId: 'new' }), identity({ generation: 'new' }));
    assert.equal(rows[0].id, first.intent.id); assert.equal(rows[0].idempotencyKey, input().idempotencyKey);
    assert.equal(rows[0].result, null); assert.equal(Object.keys(rows[0]).some(key => key.includes('encrypted')), false);
    assert.deepEqual(f.store.listForOwner(principal({ userId: 2 }), identity()), []);
    assert.deepEqual(f.store.listForOwner(principal(), identity({ nativeAccountId: 'other-account' })), []);
});

test('reconciliation cannot turn a correlated HTTP rejection into no-effect proof by status alone', async t => {
    const f = fixture(t); const prepared = f.store.prepare(principal(), identity(), input());
    f.store.finish(principal(), identity(), prepared.intent.id, { state: 'unknown' });
    let definitive = false;
    const store = new WorkspaceIntentStore({ database: f.database, encryption: f.encryption, verifyLocalPrincipal: verifier(f.database), now: () => START,
        loadOutcome: async context => ({ state: 'failed', errorCode: 'workspace_rejected', remoteStatus: 403, definitiveNoEffect: definitive,
            correlation: { intentId: context.intentId, inputHash: context.inputHash, requestHash: context.requestHash,
                actorId: context.identity.actorId, organizationId: context.identity.organizationId, nativeAccountId: context.identity.nativeAccountId } }) });
    assert.equal((await store.reconcile(principal(), identity(), prepared.intent.id)).intent.state, 'unknown');
    definitive = true;
    assert.equal((await store.reconcile(principal(), identity(), prepared.intent.id)).intent.state, 'failed');
});

test('identity expiring during reconciliation encryption cannot commit a completed result', async t => {
    const f = fixture(t); const prepared = f.store.prepare(principal(), identity(), input());
    f.store.finish(principal(), identity(), prepared.intent.id, { state: 'unknown' });
    const encryption = { decrypt: raw => f.encryption.decrypt(raw), encrypt: raw => {
        const sealed = f.encryption.encrypt(raw); f.setClock(START + 240_000); return sealed;
    } };
    let clock = START;
    const store = new WorkspaceIntentStore({ database: f.database, encryption, verifyLocalPrincipal: verifier(f.database), now: () => clock,
        loadOutcome: async context => ({ state: 'completed', result: {}, correlation: { intentId: context.intentId,
            inputHash: context.inputHash, requestHash: context.requestHash, actorId: context.identity.actorId,
            organizationId: context.identity.organizationId, nativeAccountId: context.identity.nativeAccountId } }) });
    encryption.encrypt = raw => { const sealed = f.encryption.encrypt(raw); clock = START + 240_000; return sealed; };
    await assert.rejects(store.reconcile(principal(), identity(), prepared.intent.id), { code: 'workspace_context_changed' });
    assert.equal(stored(f, prepared.intent.id).state, 'unknown'); assert.equal(stored(f, prepared.intent.id).encrypted_result, null);
});

test('review expiry before DB or during encryption rolls back prepare without any claimed orphan', t => {
    const f = fixture(t);
    assert.throws(() => f.store.prepare(principal(), identity(), input({ reviewExpiresAt: START })), { code: 'workspace_review_expired' });
    let clock = START;
    const encryption = { decrypt: raw => f.encryption.decrypt(raw), encrypt: raw => {
        const sealed = f.encryption.encrypt(raw); clock += 2; return sealed;
    } };
    const store = new WorkspaceIntentStore({ database: f.database, encryption, verifyLocalPrincipal: verifier(f.database), now: () => clock });
    assert.throws(() => store.prepare(principal(), identity(), input({ reviewExpiresAt: START + 1 })), { code: 'workspace_review_expired' });
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intent_audit').get().n, 0);
});

test('only an internal explicit never-dispatched proof can fail a local postclaim rejection', t => {
    for (const validProof of [true, false]) {
        const f = fixture(t); const prepared = f.store.prepare(principal(), identity(), input());
        const result = f.store.finish(principal(), identity(), prepared.intent.id, { state: 'failed',
            errorCode: 'workspace_review_expired', definitiveNoEffect: true, dispatchAttempted: !validProof });
        assert.equal(result.intent.state, validProof ? 'failed' : 'unknown'); assert.equal(result.result, null);
    }
});

test('proved local no-effect auth rejection may close its original claim after local revocation without returning data', t => {
    const f = fixture(t); const prepared = f.store.prepare(principal(), identity(), input());
    f.database.prepare('UPDATE users SET is_active=0 WHERE id=1').run();
    const result = f.store.finish(principal(), identity(), prepared.intent.id, { state: 'failed', errorCode: 'workspace_context_changed',
        definitiveNoEffect: true, dispatchAttempted: false });
    assert.equal(result.intent.state, 'failed'); assert.equal(result.result, null);
});
