import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { WorkspaceIntentStore } from '../services/workspaceIntents.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const principal = { tenantId: 1, userId: 1, role: 'tenant', authVersion: 0, sessionId: 'current-native-session', sessionExpiresAt: NOW / 1000 + 3600 };
const identity = { actorId: 'current-core-actor', organizationId: 'current-org', nativeAccountId: 'wa_savana:tenant:1', generation: 'current-pkce', expiresAt: new Date(NOW + 600_000).toISOString() };
const reviewed = { idempotencyKey: 'original-reviewed-identity', operation: 'command_create', inputHash: 'a'.repeat(64),
    contextRevision: 'original-core-context', reviewExpiresAt: NOW + 10_000 };
const request = { operation: reviewed.operation, idempotencyKey: reviewed.idempotencyKey, inputHash: reviewed.inputHash,
    request: { method: 'POST', path: '/v1/integration/workspace/commands', body: { activity_id: 'actual-selected-activity' } }, reviewExpiresAt: reviewed.reviewExpiresAt };
const fixture = t => {
    const db = new Database(':memory:'); db.exec('CREATE TABLE tenants(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO tenants VALUES(1); INSERT INTO users VALUES(1)');
    for (const name of ['062_workspace_intents.sql', '067_workspace_review_fences.sql']) db.exec(fs.readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
    t.after(() => db.close()); let clock = NOW;
    const key = crypto.randomBytes(32);
    const encryption = { encrypt(value) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
        const bytes = Buffer.concat([c.update(value), c.final()]); return Buffer.concat([iv, bytes, c.getAuthTag()]).toString('base64'); },
    decrypt(value) { const bytes = Buffer.from(value, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        d.setAuthTag(bytes.subarray(-16)); return Buffer.concat([d.update(bytes.subarray(12, -16)), d.final()]).toString(); } };
    return { db, store: new WorkspaceIntentStore({ database: db, encryption, verifyLocalPrincipal: () => true, now: () => clock }), clock: value => { clock = value; } };
};
test('an issued review has no attempted effect or active hold and missing identities remain unknown404', t => {
    const f = fixture(t); f.store.registerReview(principal, identity, reviewed);
    assert.equal(f.store.hasUnresolved(principal, identity), false);
    assert.deepEqual(f.store.reviewOutcome(principal, identity, reviewed.idempotencyKey, { contextRevision: reviewed.contextRevision }), { intent: { state: 'reviewed' } });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
    assert.throws(() => f.store.reviewOutcome(principal, identity, 'never-issued-key'), { code: 'workspace_intent_not_found', status: 404 });
});
test('expiry closes a proven unclaimed review and permanently fences a later dispatch claim', t => {
    const f = fixture(t); f.store.registerReview(principal, identity, reviewed); f.clock(NOW + 10_001);
    assert.equal(f.store.reviewOutcome(principal, identity, reviewed.idempotencyKey).intent.state, 'failed');
    f.clock(NOW + 1); // Even clock reversal cannot revive the finalized fence.
    assert.throws(() => f.store.prepare(principal, identity, request), { code: 'workspace_review_expired', status: 409 });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
});
test('fresh changed policy or reauthentication can fence an old unclaimed review without claiming a source rejection', t => {
    const f = fixture(t); f.store.registerReview(principal, identity, reviewed);
    assert.equal(f.store.reviewOutcome(principal, identity, reviewed.idempotencyKey, { contextRevision: 'withdrawn-current-context' }).intent.state, 'failed');
    assert.throws(() => f.store.prepare(principal, identity, request), { code: 'workspace_review_expired' });
    assert.equal(f.db.prepare('SELECT reason_code FROM savana_workspace_review_fences').get().reason_code, 'workspace_context_changed');
});
test('a first durable claim wins atomically; subsequent expiry can never manufacture no-effect proof', t => {
    const f = fixture(t); f.store.registerReview(principal, identity, reviewed);
    const claimed = f.store.prepare(principal, identity, request); assert.ok(claimed.dispatch);
    f.clock(NOW + 10_001);
    const outcome = f.store.reviewOutcome(principal, identity, reviewed.idempotencyKey, { contextRevision: 'changed' });
    assert.equal(outcome.intent.state, 'inflight');
    assert.equal(f.db.prepare('SELECT state FROM savana_workspace_review_fences').get().state, 'claimed');
    assert.equal(f.store.hasUnresolved(principal, identity), true);
});
test('an issued identity cannot change content or migrate to a different native owner', t => {
    const f = fixture(t); f.store.registerReview(principal, identity, reviewed);
    assert.throws(() => f.store.registerReview(principal, identity, { ...reviewed, inputHash: 'b'.repeat(64) }), { code: 'workspace_intent_content_conflict' });
    assert.throws(() => f.store.prepare(principal, identity, { ...request, inputHash: 'b'.repeat(64) }), { code: 'workspace_context_changed' });
    assert.throws(() => f.store.reviewOutcome({ ...principal, userId: 2 }, identity, reviewed.idempotencyKey), { code: 'workspace_intent_not_found', status: 404 });
});

test('rebound Core account fences an unclaimed review while the external WA tenant and source context stay the same', t => {
    const f = fixture(t); const bound = { ...identity, coreAccountId: 'original-core-account' };
    f.store.registerReview(principal, bound, reviewed);
    assert.equal(f.store.reviewOutcome(principal, { ...bound, coreAccountId: 'replacement-core-account' }, reviewed.idempotencyKey,
        { contextRevision: reviewed.contextRevision }).intent.state, 'failed');
    assert.throws(() => f.store.prepare(principal, bound, request), { code: 'workspace_review_expired' });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
});
