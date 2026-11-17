import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';

const probe = fileURLToPath(new URL('../test-support/operationalOwnerProcessProbe.mjs', import.meta.url));
const fixture = t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-owner-cold-process-'));
    fs.chmodSync(directory, 0o700);
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic-empty-owner.db');
    const database = new Database(filename);
    runMigrationsSync(database);
    // Fresh local identities only: no enrollment, installation, publisher,
    // source policy, central read grant, legacy products or business records.
    database.exec(`INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic cold owner','synthetic-only','Active');
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(1,'synthetic-cold-owner','unused','tenant',1,1,0);`);
    database.close(); fs.chmodSync(filename, 0o600);
    return { filename, keyHex: crypto.randomBytes(32).toString('hex') };
};
const run = (f, mode, keyHex = f.keyHex) => {
    const result = spawnSync(process.execPath, [probe, f.filename, mode], {
        input: JSON.stringify({ keyHex }), encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
        env: { PATH: path.dirname(process.execPath), LANG: 'en_US.UTF-8', TZ: 'UTC', NODE_ENV: 'test' },
        cwd: path.dirname(probe),
    });
    assert.equal(result.error, undefined, 'The private owner probe must start and finish');
    assert.equal(result.status, 0, `Synthetic owner ${mode} probe must pass`);
    assert.equal(result.signal, null); assert.equal(result.stderr, '');
    for (const secret of [f.keyHex, keyHex, 'synthetic.cold.owner.cookie', 'synthetic-cold-login-password']) assert.equal(result.stdout.includes(secret), false);
    const report = JSON.parse(result.stdout);
    assert.notEqual(report.pid, process.pid); assert.equal(report.runtime, process.execPath);
    assert.equal(report.key_source, 'stdin'); assert.equal(report.central_transport, 'explicit_mock_http');
    assert.equal(report.actual_network_attempts, 0); assert.equal(report.database_closed_explicitly, false);
    return report;
};
const inspect = (f, read) => {
    const database = new Database(f.filename, { readonly: true, fileMustExist: true });
    try { return read(database); } finally { database.close(); }
};

test('060 cookie and claimed owner intent survive real process exit; new JWT/login cannot reclaim', t => {
    const f = fixture(t);
    const writer = run(f, 'write-and-exit');
    assert.equal(writer.committed_before_exit, true); assert.equal(writer.mock_mutation_dispatches, 1);
    const before = inspect(f, db => ({ intent: db.prepare('SELECT * FROM savana_owner_portal_intents').get(),
        audit: db.prepare('SELECT * FROM savana_owner_portal_audit ORDER BY id').all() }));
    const reader = run(f, 'reopen');
    assert.notEqual(reader.pid, writer.pid);
    assert.equal(reader.saved_cookie_restored, true); assert.equal(reader.fresh_mock_membership_verified, true);
    assert.equal(reader.new_native_jti_and_portal_login_preserve_hold, true);
    assert.equal(reader.intent_id, writer.intent_id); assert.equal(reader.intent_state, 'inflight');
    assert.equal(reader.reclaimed, false); assert.equal(reader.mock_mutation_dispatches, 0);
    assert.equal(reader.immutable_intent_sha256, writer.immutable_intent_sha256);
    inspect(f, db => {
        assert.deepEqual(db.prepare('SELECT * FROM savana_owner_portal_intents').get(), before.intent);
        const audit = db.prepare('SELECT * FROM savana_owner_portal_audit ORDER BY id').all();
        assert.deepEqual(audit.slice(0, before.audit.length), before.audit);
        assert.ok(audit.length > before.audit.length, 'The new portal login appends history');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM savana_owner_portal_sessions').get().n, 2);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM savana_delegated_read_sessions').get().n, 0);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM savana_operational_consumer_enrollments').get().n, 0);
        assert.deepEqual(db.pragma('foreign_key_check'), []);
    });
    const bytes = fs.readFileSync(f.filename);
    for (const secret of [f.keyHex, 'synthetic.cold.owner.cookie', 'synthetic-cold-login-password']) assert.equal(bytes.includes(Buffer.from(secret)), false);
});

test('060 cold reopen with wrong AES key reports unknown and cannot use cookie or dispatch', t => {
    const f = fixture(t); const writer = run(f, 'write-and-exit');
    const before = inspect(f, db => ({ session: db.prepare('SELECT * FROM savana_owner_portal_sessions').all(),
        intent: db.prepare('SELECT * FROM savana_owner_portal_intents').all(), audit: db.prepare('SELECT * FROM savana_owner_portal_audit ORDER BY id').all() }));
    const wrong = run(f, 'wrong-key', crypto.randomBytes(32).toString('hex'));
    assert.notEqual(wrong.pid, writer.pid); assert.equal(wrong.wrong_key_state, 'unknown');
    assert.equal(wrong.no_connected_fallback, true); assert.equal(wrong.mock_mutation_dispatches, 0);
    assert.equal(wrong.reclaimed, false); assert.equal(wrong.immutable_intent_sha256, writer.immutable_intent_sha256);
    inspect(f, db => {
        assert.deepEqual(db.prepare('SELECT * FROM savana_owner_portal_sessions').all(), before.session);
        assert.deepEqual(db.prepare('SELECT * FROM savana_owner_portal_intents').all(), before.intent);
        assert.deepEqual(db.prepare('SELECT * FROM savana_owner_portal_audit ORDER BY id').all(), before.audit);
    });
});
