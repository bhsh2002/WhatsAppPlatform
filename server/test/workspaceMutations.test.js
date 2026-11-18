import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { seedSavanaUpgrade } from '../test-support/savanaMigrationFixture.js';
import { WorkspaceChoices } from '../services/workspaceChoices.js';
import { WorkspaceIntentStore } from '../services/workspaceIntents.js';
import { WorkspaceMutations } from '../services/workspaceMutations.js';
import { SharedProductReadError } from '../services/centralProductRead.js';

const fixture = t => {
    const database = new Database(':memory:'); seedSavanaUpgrade(database); runMigrationsSync(database);
    database.exec("INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version) VALUES(1,'synthetic','unused','tenant',1,1,0)");
    t.after(() => database.close());
    const now = Date.parse('2026-11-18T12:00:00Z'); let active = true;
    const principal = { tenantId: 1, userId: 1, sessionId: 'owned-native-session', authVersion: 0,
        role: 'tenant', sessionExpiresAt: now / 1000 + 600 };
    const identity = { actorId: 'actual-core-actor', organizationId: 'actual-core-org', nativeAccountId: 'actual-account',
        generation: 'actual-oidc-generation', expiresAt: new Date(now + 300_000).toISOString() };
    const context = { actorId: identity.actorId, organizationId: identity.organizationId, nativeAccountId: identity.nativeAccountId,
        identityGeneration: identity.generation, revision: 'current-authority-revision', validUntil: identity.expiresAt };
    const key = crypto.randomBytes(32);
    const encryption = {
        encrypt(raw) {
            const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([cipher.update(raw), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
        },
        decrypt(raw) {
            const value = Buffer.from(raw, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
            decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
        },
    };
    const choices = new WorkspaceChoices({ encryption, now: () => now, verifyLocalPrincipal: () => active, loadContext: async () => context });
    const intents = new WorkspaceIntentStore({ database, encryption, verifyLocalPrincipal: () => active, now: () => now });
    let send = async () => ({ payload: { state: 'pending_review' } }); let plan = async reviewed => ({
        method: 'POST', path: '/v1/integration/workspace/commands', body: { ...reviewed.payload, idempotency_key: reviewed.idempotencyKey } });
    let sends = 0;
    const transport = { currentIdentity: async () => ({ ...identity }), request: async () => { sends++; return send(); } };
    const service = new WorkspaceMutations({ choices, transport, intents, planners: { 'command.create': {
        request: async value => plan(value), result: async ({ response }) => {
            if (response.state !== 'pending_review') throw new SharedProductReadError('workspace_response_invalid', 502);
            return response;
        },
        rejected: async ({ error }) => error.remotePayload?.outcome === 'not_applied',
    } } });
    const review = () => choices.issueReview(principal, context, { operation: 'command.create', payload: { action: 'product.create', fields: { name: 'قهوة' } } });
    return { database, service, principal, context, identity, review, sends: () => sends,
        send: callback => { send = callback; }, plan: callback => { plan = callback; }, revoke: () => { active = false; } };
};

test('concurrent submits claim one immutable reviewed request and return its result only once', async t => {
    const f = fixture(t); const review = f.review(); let release; let started;
    const dispatched = new Promise(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    f.send(async () => { started(); await pending; return { payload: { state: 'pending_review' } }; });
    const first = f.service.submit(f.principal, { review }); await dispatched;
    const second = await f.service.submit(f.principal, { review });
    assert.equal(second.intent.state, 'inflight'); assert.equal(second.result, null); assert.equal(f.sends(), 1);
    release(); assert.deepEqual((await first).result, { state: 'pending_review' });
    assert.equal((await f.service.submit(f.principal, { review })).result, null);
    assert.equal(f.sends(), 1);
});

test('a changed authority during source planning requires a new review before any durable claim or dispatch', async t => {
    const f = fixture(t); const review = f.review();
    f.plan(async () => { f.context.revision = 'permission-revoked'; return { method: 'POST', path: '/v1/integration/workspace/commands', body: {} }; });
    await assert.rejects(f.service.submit(f.principal, { review }), { code: 'workspace_choice_changed' });
    assert.equal(f.sends(), 0);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
});

test('a changed Core native-account binding cannot dispatch a sealed review even when its external WA tenant is unchanged', async t => {
    const f = fixture(t); f.context.coreAccountId = 'original-core-binding'; f.identity.coreAccountId = 'original-core-binding';
    const review = f.review();
    f.plan(async () => { f.identity.coreAccountId = 'replacement-core-binding'; return { method: 'POST', path: '/v1/integration/workspace/commands', body: {} }; });
    await assert.rejects(f.service.submit(f.principal, { review }), { code: 'workspace_context_changed', status: 403 });
    assert.equal(f.sends(), 0);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
});

test('lost reply remains unknown and neither the same review nor a new key resends it', async t => {
    const f = fixture(t); const review = f.review();
    f.send(async () => { throw new SharedProductReadError('workspace_outcome_unknown', 503); });
    await assert.rejects(f.service.submit(f.principal, { review }), { code: 'workspace_outcome_unknown' });
    assert.equal((await f.service.submit(f.principal, { review })).intent.state, 'unknown');
    await assert.rejects(f.service.submit(f.principal, { review: f.review() }), { code: 'workspace_unresolved_intent' });
    assert.equal(f.sends(), 1);
});

test('only definitive Core rejection is failed; malformed acknowledgement is unknown', async t => {
    for (const [send, expected] of [
        [async () => { throw Object.assign(new SharedProductReadError('workspace_rejected', 403), { remotePayload: { outcome: 'not_applied' } }); }, 'failed'],
        [async () => { throw new SharedProductReadError('workspace_rejected', 403); }, 'unknown'],
        [async () => ({ payload: { state: 'invalid-or-unverified' } }), 'unknown'],
    ]) {
        const f = fixture(t); f.send(send);
        await assert.rejects(f.service.submit(f.principal, { review: f.review() }));
        assert.equal(f.database.prepare('SELECT state FROM savana_workspace_intents').get().state, expected);
    }
});

test('revocation after dispatch retains unknown without exposing completion', async t => {
    const f = fixture(t);
    f.send(async () => { f.revoke(); return { payload: { state: 'pending_review' } }; });
    await assert.rejects(f.service.submit(f.principal, { review: f.review() }), { code: 'workspace_context_changed' });
    const row = f.database.prepare('SELECT state,encrypted_result FROM savana_workspace_intents').get();
    assert.equal(row.state, 'unknown'); assert.equal(row.encrypted_result, null); assert.equal(f.sends(), 1);
});
