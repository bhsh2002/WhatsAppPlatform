import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSavanaLifecycleState, fingerprintSavanaLifecycleSnapshot } from '../services/savanaLifecycleState.js';

const start = Date.parse('2026-11-18T12:00:00Z');
const migrationDirectory = new URL('../db/migrations/', import.meta.url);
const moduleUrl = new URL('../services/savanaLifecycleState.js', import.meta.url).href;
const sqliteUrl = import.meta.resolve('better-sqlite3');
const binding = { integrationId: 1, tenantId: 1, platformCode: 'catalog', organizationId: 'synthetic-org',
    localPlatformTenantId: 'synthetic-wa-account', remotePlatformTenantId: 'synthetic-catalog-account', remoteExternalTenantId: 'synthetic-catalog-tenant' };
const snapshot = (extra = {}) => ({ connectionId: 'synthetic-connection', version: 1, status: 'active',
    scopes: ['catalog.products.projection'], binding: { ...binding }, ...extra });
const row = db => db.prepare('SELECT * FROM savana_integrations WHERE id=1').get();
const createSchema = db => {
    db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=5000');
    for (const name of fs.readdirSync(migrationDirectory).filter(name => name.endsWith('.sql') && name !== '071_savana_lifecycle_state.sql').sort()) {
        db.exec(fs.readFileSync(new URL(name, migrationDirectory), 'utf8'));
    }
    db.exec(`INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic lifecycle tenant','synthetic-only','Active');
        INSERT INTO savana_integrations(id,tenant_id,platform_code,organization_id,local_platform_tenant_id,remote_platform_tenant_id,
            remote_external_tenant_id,connection_id,status,scopes_json,webhook_secret_encrypted,entitlement_payload_json)
        VALUES(1,1,'catalog','synthetic-org','synthetic-wa-account','synthetic-catalog-account','synthetic-catalog-tenant',
            'synthetic-connection','revoked','[]','synthetic-encrypted-key','{"unchanged":"synthetic-grant"}');
        INSERT INTO savana_integration_events(integration_id,event_id,idempotency_key,event_type,payload_json,status)
        VALUES(1,'synthetic-historical-event','synthetic-historical-key','synthetic-history','{}','processed');
        CREATE TABLE lifecycle_test_effects(id INTEGER PRIMARY KEY,version INTEGER NOT NULL,status TEXT NOT NULL);
        CREATE TABLE lifecycle_test_visibility(id INTEGER PRIMARY KEY,is_active INTEGER NOT NULL);
        INSERT INTO lifecycle_test_visibility VALUES(1,0);`);
    db.exec(fs.readFileSync(new URL('071_savana_lifecycle_state.sql', migrationDirectory), 'utf8'));
};
const applyBusiness = db => value => {
    const b = value.binding;
    db.prepare(`UPDATE savana_integrations SET connection_id=?,organization_id=?,local_platform_tenant_id=?,remote_platform_tenant_id=?,
        remote_external_tenant_id=?,status=?,scopes_json=? WHERE id=?`).run(value.connectionId, b.organizationId, b.localPlatformTenantId,
        b.remotePlatformTenantId, b.remoteExternalTenantId, value.status === 'rejected' ? 'revoked' : value.status, JSON.stringify(value.scopes), b.integrationId);
    db.prepare('UPDATE lifecycle_test_visibility SET is_active=? WHERE id=1').run(value.status === 'active' ? 1 : 0);
    db.prepare('INSERT INTO lifecycle_test_effects(version,status) VALUES(?,?)').run(value.version, value.status);
};
const fixture = (t, filename = ':memory:') => {
    const db = new Database(filename); createSchema(db); t.after(() => { if (db.open) db.close(); });
    return { db, state: createSavanaLifecycleState({ database: db, now: () => start }), apply: applyBusiness(db) };
};
const options = (f, extra = {}) => ({ expectedConnectionId: 'synthetic-connection', onApply: f.apply, verifyCurrentState: () => true, ...extra });
const counts = db => db.prepare('SELECT COUNT(*) n FROM lifecycle_test_effects').get().n;

test('additive migration preserves existing connection key, grants and event history and leaves legacy version unknown', t => {
    const f = fixture(t);
    assert.equal(row(f.db).webhook_secret_encrypted, 'synthetic-encrypted-key');
    assert.equal(row(f.db).entitlement_payload_json, '{"unchanged":"synthetic-grant"}');
    assert.equal(f.state.read('synthetic-connection'), null);
    assert.equal(row(f.db).status, 'revoked');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_integration_events').get().n, 1);
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('unknown cursor and every negative or versionless input deny without fresh exact current-state proof', t => {
    const f = fixture(t), original = row(f.db);
    for (const version of [null, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0', '1', true]) {
        assert.throws(() => f.state.applyVerified(snapshot({ version }), options(f)), { code: 'lifecycle_version_required' });
    }
    for (const verifyCurrentState of [null, () => false, () => ({ verified: true })]) {
        assert.throws(() => f.state.applyVerified(snapshot(), options(f, { verifyCurrentState })), { code: 'lifecycle_current_state_required' });
    }
    assert.equal(counts(f.db), 0); assert.equal(f.state.read('synthetic-connection'), null); assert.deepEqual(row(f.db), original);
});

test('explicit version zero is retained and deduplicated, never supplied for unknown history, and becomes stale after version one', t => {
    const f = fixture(t), zero = snapshot({ version: 0, status: 'pending_authorization' });
    assert.equal(f.state.read(zero.connectionId), null);
    assert.throws(() => f.state.applyVerified(zero, options(f, { verifyCurrentState: null })), { code: 'lifecycle_current_state_required' });
    assert.equal(f.state.read(zero.connectionId), null);
    assert.equal(f.state.applyVerified(zero, options(f)).version, 0);
    assert.equal(f.state.read(zero.connectionId).version, 0);
    assert.equal(f.state.applyVerified(zero, options(f, { verifyCurrentState: null, onApply() { assert.fail('zero duplicate cannot repeat effects'); } })).duplicate, true);
    assert.throws(() => f.state.applyVerified({ ...zero, status: 'active' }, options(f)), { code: 'lifecycle_version_conflict' });
    f.state.applyVerified(snapshot({ version: 1 }), options(f, { verifyCurrentState: null }));
    assert.throws(() => f.state.applyVerified(zero, options(f)), { code: 'lifecycle_version_stale' });
    assert.equal(row(f.db).status, 'active'); assert.equal(f.state.read(zero.connectionId).version, 1); assert.equal(counts(f.db), 2);
});

test('bootstrap proof is fingerprint-bound and rechecked against the same frozen initial row; lost ACK duplicate has no effects', t => {
    const f = fixture(t); let checks = 0, initial;
    const input = snapshot({ scopes: ['scope.z', 'scope.a', 'scope.z'] });
    const verifyCurrentState = (value, proof) => {
        assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.binding), true); assert.equal(Object.isFrozen(value.scopes), true);
        assert.equal(Object.isFrozen(proof.initialRow), true); assert.equal(proof.snapshotFingerprint, fingerprintSavanaLifecycleSnapshot(input));
        assert.equal(proof.initialRow.status, 'revoked');
        if (initial) assert.equal(proof.initialRow, initial); else initial = proof.initialRow;
        checks += 1; return true;
    };
    const first = f.state.applyVerified(input, options(f, { verifyCurrentState }));
    assert.equal(first.applied, true); assert.equal(checks, 2); assert.equal(counts(f.db), 1);
    assert.deepEqual(f.state.read(input.connectionId).scopes, ['scope.a', 'scope.z']);
    const duplicate = f.state.applyVerified(snapshot({ scopes: ['scope.z', 'scope.a'] }), options(f, { verifyCurrentState: null,
        onApply() { assert.fail('exact duplicate must not reapply'); } }));
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.snapshotFingerprint, first.snapshotFingerprint); assert.equal(counts(f.db), 1);
    assert.equal(row(f.db).webhook_secret_encrypted, 'synthetic-encrypted-key');
});

test('newer revocation wins and older active/pending or equal changed snapshots cannot overwrite it', t => {
    const f = fixture(t);
    f.state.applyVerified(snapshot(), options(f));
    f.state.applyVerified(snapshot({ version: 3, status: 'revoked', scopes: [] }), options(f, { verifyCurrentState: null }));
    for (const status of ['active', 'pending_authorization']) {
        assert.throws(() => f.state.applyVerified(snapshot({ version: 2, status }), options(f)), { code: 'lifecycle_version_stale' });
    }
    for (const changed of [snapshot({ version: 3, status: 'active', scopes: [] }), snapshot({ version: 3, status: 'revoked' })]) {
        assert.throws(() => f.state.applyVerified(changed, options(f)), { code: 'lifecycle_version_conflict' });
    }
    assert.equal(row(f.db).status, 'revoked'); assert.equal(f.state.read('synthetic-connection').version, 3); assert.equal(counts(f.db), 2);
});

test('raw rejected status is retained in the fingerprint while the local row remains revoked', t => {
    const f = fixture(t), input = snapshot({ status: 'rejected', scopes: [] });
    f.state.applyVerified(input, options(f));
    assert.equal(row(f.db).status, 'revoked'); assert.equal(f.state.read(input.connectionId).status, 'rejected');
    assert.equal(f.state.applyVerified(input, options(f, { verifyCurrentState: null })).duplicate, true);
    assert.throws(() => f.state.applyVerified(snapshot({ status: 'revoked', scopes: [] }), options(f)), { code: 'lifecycle_version_conflict' });
    assert.equal(counts(f.db), 1);
});

test('explicit same-version active key fill requires current proof and cannot replace an existing ciphertext', t => {
    const f = fixture(t), input = snapshot();
    f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    f.state.applyVerified(input, options(f)); const cursor = f.state.read(input.connectionId); let calls = 0;
    const onDuplicate = () => { calls += 1; f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-filled-cipher' WHERE id=1").run(); };
    assert.throws(() => f.state.applyVerified(input, options(f, { onDuplicate, verifyCurrentState: null })), { code: 'lifecycle_current_state_required' });
    assert.equal(calls, 0);
    assert.equal(f.state.applyVerified(input, options(f, { onDuplicate })).duplicate, true);
    assert.equal(calls, 1); assert.equal(counts(f.db), 1); assert.deepEqual(f.state.read(input.connectionId), cursor);
    assert.equal(row(f.db).webhook_secret_encrypted, 'synthetic-filled-cipher');
    assert.throws(() => f.state.applyVerified(input, options(f, { onDuplicate })), { code: 'lifecycle_duplicate_key_fill_forbidden' });
    assert.equal(row(f.db).webhook_secret_encrypted, 'synthetic-filled-cipher'); assert.equal(calls, 1);
});

test('same-version pending zero may fill its first key only with current proof and cannot fill after a newer revocation', t => {
    const f = fixture(t), pending = snapshot({ version: 0, status: 'pending_authorization' });
    f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    f.state.applyVerified(pending, options(f)); const cursor = f.state.read(pending.connectionId); let fills = 0;
    const onDuplicate = () => { fills += 1; f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-pending-cipher' WHERE id=1").run(); };
    assert.throws(() => f.state.applyVerified(pending, options(f, { onDuplicate, verifyCurrentState: null })), { code: 'lifecycle_current_state_required' });
    assert.equal(fills, 0);
    assert.equal(f.state.applyVerified(pending, options(f, { onDuplicate })).duplicate, true);
    assert.deepEqual(f.state.read(pending.connectionId), cursor); assert.equal(row(f.db).status, 'pending_authorization');
    assert.equal(row(f.db).webhook_secret_encrypted, 'synthetic-pending-cipher'); assert.equal(counts(f.db), 1);
    f.state.applyVerified(snapshot({ version: 1, status: 'revoked', scopes: [] }), options(f, { onApply(value) {
        f.apply(value); f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    } }));
    assert.throws(() => f.state.applyVerified(pending, options(f, { onDuplicate })), { code: 'lifecycle_version_stale' });
    assert.equal(row(f.db).webhook_secret_encrypted, null); assert.equal(fills, 1);
});

test('fresh same-version degraded reprovision repairs only a missing key and cannot restore it after a newer revocation', t => {
    const f = fixture(t), degraded = snapshot({ version: 7, status: 'degraded' });
    f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    f.state.applyVerified(degraded, options(f));
    const cursor = f.state.read(degraded.connectionId), original = row(f.db); let fills = 0, checks = 0;
    const onDuplicate = () => { fills += 1; f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-degraded-repair-cipher' WHERE id=1").run(); };
    assert.throws(() => f.state.applyVerified(degraded, options(f, { onDuplicate, verifyCurrentState: null })), { code: 'lifecycle_current_state_required' });
    assert.equal(fills, 0);
    const result = f.state.applyVerified(degraded, options(f, { onDuplicate, verifyCurrentState(value, proof) {
        assert.equal(value.status, 'degraded'); assert.equal(value.version, 7); assert.equal(proof.initialRow.webhook_secret_encrypted, null);
        checks += 1; return true;
    } }));
    assert.equal(result.duplicate, true); assert.equal(checks, 2); assert.equal(fills, 1);
    assert.deepEqual(f.state.read(degraded.connectionId), cursor);
    assert.deepEqual(row(f.db), { ...original, webhook_secret_encrypted: 'synthetic-degraded-repair-cipher' });
    assert.equal(counts(f.db), 1);
    assert.throws(() => f.state.applyVerified(degraded, options(f, { onDuplicate })), { code: 'lifecycle_duplicate_key_fill_forbidden' });
    f.state.applyVerified(snapshot({ version: 8, status: 'revoked', scopes: [] }), options(f, { onApply(value) {
        f.apply(value); f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    } }));
    assert.throws(() => f.state.applyVerified(degraded, options(f, { onDuplicate })), { code: 'lifecycle_version_stale' });
    assert.equal(fills, 1); assert.equal(row(f.db).status, 'revoked'); assert.equal(row(f.db).webhook_secret_encrypted, null);
    assert.equal(f.state.read(degraded.connectionId).version, 8); assert.equal(counts(f.db), 2);
});

test('pending cleanup preserves the canonical zero tuple, repeats without effects, and permits fresh pending reprovision key fill', t => {
    const f = fixture(t), pending = snapshot({ version: 0, status: 'pending_authorization' });
    f.state.applyVerified(pending, options(f)); const cursor = { ...f.state.read(pending.connectionId),
        pendingCleanupVersion: 0, pendingCleanupFingerprint: fingerprintSavanaLifecycleSnapshot(pending) };
    f.db.prepare('UPDATE lifecycle_test_visibility SET is_active=1 WHERE id=1').run();
    let clears = 0, proofs = 0;
    const cleanup = { duplicateEffect: 'pending_key_clear', verifyCurrentState: () => { proofs += 1; return true; }, onDuplicate() {
        clears += 1; f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
        f.db.prepare('UPDATE lifecycle_test_visibility SET is_active=0 WHERE id=1').run();
    } };
    assert.equal(f.state.applyVerified(pending, options(f, cleanup)).duplicate, true);
    assert.equal(row(f.db).status, 'pending_authorization'); assert.equal(row(f.db).webhook_secret_encrypted, null);
    assert.equal(f.db.prepare('SELECT is_active FROM lifecycle_test_visibility WHERE id=1').get().is_active, 0);
    assert.deepEqual(f.state.read(pending.connectionId), cursor); assert.equal(clears, 1); assert.equal(proofs, 2);
    assert.equal(f.state.applyVerified(pending, options(f, cleanup)).duplicate, true);
    assert.equal(clears, 1); assert.equal(proofs, 4); assert.equal(counts(f.db), 1);
    assert.throws(() => f.state.applyVerified(pending, options(f, { ...cleanup, verifyCurrentState: null })), { code: 'lifecycle_current_state_required' });
    f.state.applyVerified(pending, options(f, { onDuplicate() {
        f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-reprovision-cipher' WHERE id=1").run();
    } }));
    assert.equal(row(f.db).webhook_secret_encrypted, 'synthetic-reprovision-cipher');
    assert.deepEqual(f.state.read(pending.connectionId), cursor); assert.equal(counts(f.db), 1);
    const repaired = row(f.db);
    assert.equal(f.state.applyVerified(pending, options(f, cleanup)).duplicate, true);
    assert.equal(clears, 1); assert.deepEqual(row(f.db), repaired); assert.deepEqual(f.state.read(pending.connectionId), cursor);
    assert.equal(f.db.prepare('SELECT pending_cleanup_version,pending_cleanup_sha256 FROM savana_lifecycle_state').get().pending_cleanup_version, 0);
});

test('receipt-only null-key cleanup changes the internal baseline and fences an older in-flight same-version key fill', t => {
    const f = fixture(t), pending = snapshot({ version: 0, status: 'pending_authorization' });
    f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    f.state.applyVerified(pending, options(f));
    const oldRow = row(f.db), oldCursor = f.state.read(pending.connectionId);
    assert.equal(oldCursor.pendingCleanupVersion, null); assert.equal(oldCursor.pendingCleanupFingerprint, null);
    f.state.applyVerified(pending, options(f, { duplicateEffect: 'pending_key_clear' }));
    assert.deepEqual(row(f.db), oldRow);
    assert.deepEqual(f.state.read(pending.connectionId), { ...oldCursor, pendingCleanupVersion: 0,
        pendingCleanupFingerprint: fingerprintSavanaLifecycleSnapshot(pending) });
    let fills = 0;
    assert.throws(() => f.state.applyVerified(pending, options(f, { verifyCurrentState(_snapshot, context) {
        return JSON.stringify(context.initialRow) === JSON.stringify(oldRow)
            && JSON.stringify(f.state.read(pending.connectionId)) === JSON.stringify(oldCursor);
    }, onDuplicate() {
        fills += 1; f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-stale-fill' WHERE id=1").run();
    } })), { code: 'lifecycle_current_state_required' });
    assert.equal(fills, 0); assert.equal(row(f.db).webhook_secret_encrypted, null); assert.equal(counts(f.db), 1);
});

test('first cleanup records a receipt even with a null key or unknown cursor and later retries preserve repaired ciphertext', t => {
    for (const knownCursor of [false, true]) {
        const f = fixture(t), pending = snapshot({ version: 0, status: 'pending_authorization' });
        f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
        if (knownCursor) f.state.applyVerified(pending, options(f));
        const cleanup = { duplicateEffect: 'pending_key_clear', onDuplicate() { assert.fail('a null key or recorded cleanup must not invoke effects'); } };
        f.state.applyVerified(pending, options(f, cleanup));
        const marker = f.db.prepare('SELECT pending_cleanup_version,pending_cleanup_sha256 FROM savana_lifecycle_state').get();
        assert.deepEqual(marker, { pending_cleanup_version: 0, pending_cleanup_sha256: fingerprintSavanaLifecycleSnapshot(pending) });
        f.state.applyVerified(pending, options(f, { onDuplicate() {
            f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-repaired-after-empty-cleanup' WHERE id=1").run();
        } }));
        const repaired = row(f.db);
        f.state.applyVerified(pending, options(f, cleanup));
        assert.deepEqual(row(f.db), repaired); assert.equal(counts(f.db), 1);
    }
});

test('normal newer versions retain the old cleanup marker and a new pending tuple gets its own receipt', t => {
    const f = fixture(t), pending = snapshot({ version: 0, status: 'pending_authorization' });
    const cleanupOptions = options(f, { duplicateEffect: 'pending_key_clear', onApply(value) {
        f.apply(value); f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    } });
    f.state.applyVerified(pending, cleanupOptions);
    const first = f.db.prepare('SELECT pending_cleanup_version,pending_cleanup_sha256 FROM savana_lifecycle_state').get();
    f.state.applyVerified(snapshot({ version: 1 }), options(f));
    assert.deepEqual(f.db.prepare('SELECT pending_cleanup_version,pending_cleanup_sha256 FROM savana_lifecycle_state').get(), first);
    const newer = { ...pending, version: 2 };
    f.state.applyVerified(newer, cleanupOptions);
    assert.deepEqual(f.db.prepare('SELECT pending_cleanup_version,pending_cleanup_sha256 FROM savana_lifecycle_state').get(), {
        pending_cleanup_version: 2, pending_cleanup_sha256: fingerprintSavanaLifecycleSnapshot(newer),
    });
});

test('pending cleanup rejects active or degraded tuples and a late pending zero after a newer revocation', t => {
    for (const status of ['active', 'degraded']) {
        const f = fixture(t), input = snapshot({ status }); f.state.applyVerified(input, options(f));
        assert.throws(() => f.state.applyVerified(input, options(f, { duplicateEffect: 'pending_key_clear', onDuplicate() {
            assert.fail('nonpending cleanup must not mutate');
        } })), { code: 'lifecycle_duplicate_key_clear_forbidden' });
        assert.equal(row(f.db).webhook_secret_encrypted, 'synthetic-encrypted-key'); assert.equal(counts(f.db), 1);
    }
    const f = fixture(t), pending = snapshot({ version: 0, status: 'pending_authorization' });
    f.state.applyVerified(pending, options(f));
    f.state.applyVerified(snapshot({ version: 1, status: 'revoked', scopes: [] }), options(f));
    assert.throws(() => f.state.applyVerified(pending, options(f, { duplicateEffect: 'pending_key_clear', onDuplicate() {
        assert.fail('late cleanup must not mutate newer state');
    } })), { code: 'lifecycle_version_stale' });
    assert.equal(f.state.read(pending.connectionId).version, 1); assert.equal(counts(f.db), 2);
});

test('pending cleanup proof withdrawal, callback failure or canonical tuple drift rolls back key and visibility', t => {
    const f = fixture(t), pending = snapshot({ version: 0, status: 'pending_authorization' });
    f.state.applyVerified(pending, options(f));
    f.db.prepare('UPDATE lifecycle_test_visibility SET is_active=1 WHERE id=1').run();
    const original = row(f.db), cursor = f.state.read(pending.connectionId); let checks = 0;
    const onDuplicate = () => {
        f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
        f.db.prepare('UPDATE lifecycle_test_visibility SET is_active=0 WHERE id=1').run();
    };
    assert.throws(() => f.state.applyVerified(pending, options(f, { duplicateEffect: 'pending_key_clear', onDuplicate,
        verifyCurrentState: () => ++checks === 1 })), { code: 'lifecycle_current_state_required' });
    assert.throws(() => f.state.applyVerified(pending, options(f, { duplicateEffect: 'pending_key_clear', onDuplicate() {
        onDuplicate(); throw new Error('synthetic-cleanup-failure');
    } })), /synthetic-cleanup-failure/);
    assert.throws(() => f.state.applyVerified(pending, options(f, { duplicateEffect: 'pending_key_clear', onDuplicate() {
        onDuplicate(); f.db.prepare("UPDATE savana_integrations SET status='revoked' WHERE id=1").run();
    } })), { code: 'lifecycle_apply_incomplete' });
    assert.deepEqual(row(f.db), original); assert.deepEqual(f.state.read(pending.connectionId), cursor); assert.equal(counts(f.db), 1);
    assert.equal(f.db.prepare('SELECT is_active FROM lifecycle_test_visibility WHERE id=1').get().is_active, 1);
    f.db.exec(`CREATE TRIGGER lifecycle_test_reject_marker AFTER UPDATE OF pending_cleanup_sha256 ON savana_lifecycle_state
        BEGIN SELECT RAISE(ABORT,'synthetic-cleanup-marker-failure'); END;`);
    assert.throws(() => f.state.applyVerified(pending, options(f, { duplicateEffect: 'pending_key_clear', onDuplicate })), /synthetic-cleanup-marker-failure/);
    assert.deepEqual(row(f.db), original); assert.deepEqual(f.state.read(pending.connectionId), cursor);
    assert.equal(f.db.prepare('SELECT is_active FROM lifecycle_test_visibility WHERE id=1').get().is_active, 1);
    assert.deepEqual(f.db.prepare('SELECT pending_cleanup_version,pending_cleanup_sha256 FROM savana_lifecycle_state').get(), {
        pending_cleanup_version: null, pending_cleanup_sha256: null,
    });
});

test('failed proof or changed state in duplicate key fill rolls the fill back without advancing cursor', t => {
    const f = fixture(t), input = snapshot(); f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    f.state.applyVerified(input, options(f)); const original = row(f.db), cursor = f.state.read(input.connectionId); let checks = 0;
    const fill = () => f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-filled-cipher' WHERE id=1").run();
    assert.throws(() => f.state.applyVerified(input, options(f, { onDuplicate: fill, verifyCurrentState: () => ++checks === 1 })), { code: 'lifecycle_current_state_required' });
    assert.throws(() => f.state.applyVerified(input, options(f, { onDuplicate() { fill(); f.db.prepare("UPDATE savana_integrations SET status='revoked' WHERE id=1").run(); } })), { code: 'lifecycle_apply_incomplete' });
    assert.deepEqual(row(f.db), original); assert.deepEqual(f.state.read(input.connectionId), cursor); assert.equal(counts(f.db), 1);
});

test('status/key-clear, visibility and ordering cursor all roll back on callback failure or incomplete apply', t => {
    const f = fixture(t); f.state.applyVerified(snapshot(), options(f)); const original = row(f.db), cursor = f.state.read('synthetic-connection');
    assert.throws(() => f.state.applyVerified(snapshot({ version: 2, status: 'revoked', scopes: [] }), options(f, { onApply(value) {
        f.apply(value); f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run(); throw new Error('synthetic-write-failed');
    } })), /synthetic-write-failed/);
    assert.throws(() => f.state.applyVerified(snapshot({ version: 2, status: 'revoked' }), options(f, { onApply(value) {
        f.apply(value); f.db.prepare("UPDATE savana_integrations SET scopes_json='[]' WHERE id=1").run();
    } })), { code: 'lifecycle_apply_incomplete' });
    assert.deepEqual(row(f.db), original); assert.deepEqual(f.state.read('synthetic-connection'), cursor); assert.equal(counts(f.db), 1);
    assert.equal(f.db.prepare('SELECT is_active FROM lifecycle_test_visibility WHERE id=1').get().is_active, 1);
});

test('withdrawn proof after writes rolls back and asynchronous proof/apply callbacks are not accepted', t => {
    const f = fixture(t), original = row(f.db); let checks = 0;
    assert.throws(() => f.state.applyVerified(snapshot(), options(f, { verifyCurrentState: () => ++checks === 1 })), { code: 'lifecycle_current_state_required' });
    for (const extra of [{ verifyCurrentState: async () => true }, { onApply: async () => { assert.fail('async apply must not start'); } }]) {
        assert.throws(() => f.state.applyVerified(snapshot(), options(f, extra)), { code: 'lifecycle_callback_invalid' });
    }
    assert.throws(() => f.state.applyVerified(snapshot(), options(f, { onApply(value) { f.apply(value); return { then() {} }; } })), { code: 'lifecycle_callback_invalid' });
    assert.equal(checks, 2); assert.deepEqual(row(f.db), original); assert.equal(counts(f.db), 0); assert.equal(f.state.read('synthetic-connection'), null);
});

test('pending bootstrap may fill missing binding only with proof and requires exact resulting row', t => {
    const f = fixture(t);
    f.db.prepare(`UPDATE savana_integrations SET connection_id=NULL,organization_id=NULL,local_platform_tenant_id=NULL,
        remote_platform_tenant_id=NULL,remote_external_tenant_id=NULL,status='pending_authorization' WHERE id=1`).run();
    const input = snapshot({ status: 'pending_authorization' });
    assert.equal(f.state.applyVerified(input, options(f, { expectedConnectionId: null })).applied, true);
    assert.equal(row(f.db).connection_id, input.connectionId); assert.equal(row(f.db).organization_id, binding.organizationId);
    assert.equal(f.state.read(input.connectionId).status, 'pending_authorization');
});

test('same connection cannot change any immutable binding or silently repair uncoordinated state drift', t => {
    const f = fixture(t); f.state.applyVerified(snapshot(), options(f));
    for (const [key, changed] of Object.entries({ integrationId: 2, tenantId: 2, platformCode: 'sawemly', organizationId: 'other-org',
        localPlatformTenantId: 'other-wa-account', remotePlatformTenantId: 'other-catalog-account', remoteExternalTenantId: 'other-external-tenant' })) {
        assert.throws(() => f.state.applyVerified(snapshot({ version: 2, binding: { ...binding, [key]: changed } }), options(f)));
    }
    f.db.prepare("UPDATE savana_integrations SET status='paused' WHERE id=1").run();
    assert.throws(() => f.state.applyVerified(snapshot({ version: 2 }), options(f)), { code: 'lifecycle_state_changed' });
    assert.equal(counts(f.db), 1); assert.equal(f.state.read('synthetic-connection').version, 1);
});

test('replacement requires restrictive current row, explicit captured connection and proof; retained old cursor never resurrects', t => {
    const f = fixture(t); f.state.applyVerified(snapshot({ status: 'revoked', scopes: [] }), options(f));
    const next = snapshot({ connectionId: 'synthetic-replacement', binding: { ...binding, organizationId: 'new-org',
        localPlatformTenantId: 'new-local-account', remotePlatformTenantId: 'new-remote-account', remoteExternalTenantId: 'new-external-tenant' } });
    assert.throws(() => f.state.applyVerified(next, options(f)), { code: 'lifecycle_binding_conflict' });
    assert.throws(() => f.state.applyVerified(next, options(f, { allowConnectionChange: true, verifyCurrentState: null })), { code: 'lifecycle_current_state_required' });
    f.state.applyVerified(next, options(f, { allowConnectionChange: true }));
    assert.equal(f.state.read('synthetic-connection').status, 'revoked'); assert.equal(f.state.read(next.connectionId).status, 'active');
    assert.throws(() => f.state.applyVerified(snapshot({ status: 'revoked', scopes: [] }), options(f, {
        expectedConnectionId: next.connectionId, allowConnectionChange: true })), { code: 'lifecycle_binding_conflict' });
    assert.equal(row(f.db).connection_id, next.connectionId); assert.equal(counts(f.db), 2);
    assert.throws(() => f.state.applyVerified({ ...next, connectionId: 'another-new-connection' }, options(f, {
        expectedConnectionId: next.connectionId, allowConnectionChange: true })), { code: 'lifecycle_binding_conflict' });
});

test('delayed expected connection and changed baseline proof fail without modifying newly current binding', t => {
    const f = fixture(t), original = row(f.db);
    assert.throws(() => f.state.applyVerified(snapshot(), options(f, { expectedConnectionId: null })), { code: 'lifecycle_binding_changed' });
    assert.throws(() => f.state.applyVerified(snapshot(), options(f, { verifyCurrentState() {
        f.db.prepare("UPDATE savana_integrations SET connection_id='changed-during-proof' WHERE id=1").run(); return true;
    } })), { code: 'lifecycle_binding_changed' });
    assert.deepEqual(row(f.db), original); assert.equal(counts(f.db), 0);
    f.db.prepare("UPDATE savana_integrations SET connection_id='already-replaced' WHERE id=1").run(); const replaced = row(f.db);
    assert.throws(() => f.state.applyVerified(snapshot(), options(f)), { code: 'lifecycle_binding_changed' });
    assert.deepEqual(row(f.db), replaced); assert.equal(counts(f.db), 0);
});

test('reentrant apply from another helper cannot dispatch nested state or overwrite the outer cursor', t => {
    const f = fixture(t), second = createSavanaLifecycleState({ database: f.db, now: () => start });
    f.state.applyVerified(snapshot(), options(f, { onApply(value) {
        assert.throws(() => second.applyVerified(snapshot({ version: 5, status: 'revoked' }), options(f)), { code: 'lifecycle_reentrant' });
        f.apply(value);
    } }));
    assert.equal(counts(f.db), 1); assert.equal(f.state.read('synthetic-connection').version, 1);
});

test('committed duplicate survives database/helper reopen while rolled-back writes leave no cursor', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lifecycle-state-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'owned.db'); const f = fixture(t, filename);
    f.state.applyVerified(snapshot(), options(f));
    assert.throws(() => f.state.applyVerified(snapshot({ version: 2, status: 'revoked' }), options(f, { onApply(value) {
        f.apply(value); throw new Error('synthetic-persistent-rollback');
    } })), /synthetic-persistent-rollback/);
    f.db.close();
    const db = new Database(filename); t.after(() => db.close());
    const state = createSavanaLifecycleState({ database: db, now: () => start });
    assert.equal(state.applyVerified(snapshot(), { expectedConnectionId: snapshot().connectionId, onApply() { assert.fail('lost ACK must not repeat effects'); } }).duplicate, true);
    assert.equal(counts(db), 1); assert.equal(state.read(snapshot().connectionId).version, 1);
});

test('cleanup receipt survives file reopen and an old pending retry cannot clear a repaired same-version key', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lifecycle-cleanup-restart-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'owned.db'), f = fixture(t, filename), pending = snapshot({ version: 0, status: 'pending_authorization' });
    f.state.applyVerified(pending, options(f, { duplicateEffect: 'pending_key_clear', onApply(value) {
        f.apply(value); f.db.prepare('UPDATE savana_integrations SET webhook_secret_encrypted=NULL WHERE id=1').run();
    } }));
    f.state.applyVerified(pending, options(f, { onDuplicate() {
        f.db.prepare("UPDATE savana_integrations SET webhook_secret_encrypted='synthetic-durable-repaired-cipher' WHERE id=1").run();
    } }));
    const repaired = row(f.db), beforeCursor = f.db.prepare('SELECT * FROM savana_lifecycle_state').get(); f.db.close();
    const db = new Database(filename); t.after(() => db.close()); const state = createSavanaLifecycleState({ database: db, now: () => start });
    const result = state.applyVerified(pending, { expectedConnectionId: pending.connectionId, duplicateEffect: 'pending_key_clear',
        verifyCurrentState: () => true, onApply() { assert.fail('old cleanup cannot apply'); }, onDuplicate() { assert.fail('old cleanup receipt must suppress effects'); } });
    assert.equal(result.duplicate, true); assert.deepEqual(row(db), repaired);
    assert.deepEqual(db.prepare('SELECT * FROM savana_lifecycle_state').get(), beforeCursor); assert.equal(counts(db), 1);
});

test('independent SQLite processes serialize newer versions and reject late older version without duplicate effects', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lifecycle-concurrent-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'owned.db'), f = fixture(t, filename);
    f.state.applyVerified(snapshot(), options(f)); f.db.close();
    const worker = `import Database from ${JSON.stringify(sqliteUrl)};import{createSavanaLifecycleState}from ${JSON.stringify(moduleUrl)};
        const [filename,inputJson]=process.argv.slice(1),input=JSON.parse(inputJson),db=new Database(filename);db.pragma('busy_timeout=5000');
        const state=createSavanaLifecycleState({database:db});try{const result=state.applyVerified(input,{expectedConnectionId:input.connectionId,onApply(value){
        db.prepare('UPDATE savana_integrations SET status=?,scopes_json=? WHERE id=1').run(value.status,JSON.stringify(value.scopes));
        db.prepare('INSERT INTO lifecycle_test_effects(version,status) VALUES(?,?)').run(value.version,value.status);}});console.log(JSON.stringify(result));}
        catch(error){console.log(JSON.stringify({code:error.code}));}finally{db.close();}`;
    const run = value => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', worker, filename, JSON.stringify(value)], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
        child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0, err); resolve(JSON.parse(out)); } catch (error) { reject(error); } });
    });
    const results = await Promise.all([run(snapshot({ version: 3, status: 'revoked', scopes: [] })), run(snapshot({ version: 2, status: 'paused' }))]);
    assert.equal(results[0].applied, true); assert.ok(results[1].applied === true || results[1].code === 'lifecycle_version_stale');
    const db = new Database(filename); t.after(() => db.close()); const state = createSavanaLifecycleState({ database: db });
    assert.equal(state.read(snapshot().connectionId).version, 3); assert.equal(row(db).status, 'revoked');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM lifecycle_test_effects WHERE version=3').get().n, 1);
    assert.throws(() => state.applyVerified(snapshot({ version: 2 }), { expectedConnectionId: snapshot().connectionId, onApply: applyBusiness(db) }), { code: 'lifecycle_version_stale' });
});
