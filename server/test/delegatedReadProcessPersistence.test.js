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
import { seedSavanaUpgrade, sourceState } from '../test-support/savanaMigrationFixture.js';

const probePath = fileURLToPath(new URL('../test-support/delegatedReadProcessProbe.mjs', import.meta.url));
const fixture = t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-process-durability-'));
    fs.chmodSync(directory, 0o700);
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic-only.db');
    const database = new Database(filename);
    seedSavanaUpgrade(database);
    runMigrationsSync(database);
    database.exec(`INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(1,'synthetic-process-user','unused','tenant',1,1,0);`);
    const before = sourceState(database);
    database.close();
    return { filename, before, keyHex: crypto.randomBytes(32).toString('hex') };
};
const runProbe = (f, mode) => {
    const result = spawnSync(process.execPath, [probePath, f.filename, mode], {
        input: JSON.stringify({ keyHex: f.keyHex }), encoding: 'utf8', timeout: 15_000,
        maxBuffer: 64 * 1024,
        // Do not inherit runtime credentials, NODE_OPTIONS or application paths.
        env: { PATH: path.dirname(process.execPath), LANG: 'en_US.UTF-8', TZ: 'UTC', NODE_ENV: 'test' },
        cwd: path.dirname(probePath),
    });
    assert.equal(result.error, undefined, 'The owned child process must start and finish');
    assert.equal(result.status, 0, `Synthetic ${mode} probe must pass`);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes(f.keyHex), false);
    assert.equal(result.stdout.includes('synthetic-process-read-token'), false);
    assert.equal(result.stdout.includes('synthetic-process-identity-token'), false);
    const report = JSON.parse(result.stdout);
    assert.notEqual(report.pid, process.pid);
    assert.equal(report.runtime, process.execPath);
    assert.equal(report.key_source, 'stdin');
    assert.equal(report.remote_dispatch_attempts, 0);
    return report;
};
const inspect = (f, operation) => {
    const database = new Database(f.filename, { readonly: true, fileMustExist: true });
    try { return operation(database); } finally { database.close(); }
};

test('encrypted identity/read sessions survive process exit with principal and exact expiry boundaries', t => {
    const f = fixture(t);
    const writer = runProbe(f, 'write-and-exit');
    assert.equal(writer.committed, true);
    assert.equal(writer.database_closed_explicitly, false);
    const reader = runProbe(f, 'read-sessions');
    assert.notEqual(reader.pid, writer.pid);
    assert.equal(reader.identity_and_read_restored, true);
    assert.equal(reader.principal_boundaries_checked, 4);
    assert.equal(reader.expired_at_exact_local_session_boundary, true);
    inspect(f, database => {
        assert.deepEqual(sourceState(database), f.before);
        assert.deepEqual(database.pragma('foreign_key_check'), []);
        assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_delegated_read_sessions').get().count, 1);
        assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_operational_owner_sessions').get().count, 1);
    });
    const bytes = fs.readFileSync(f.filename);
    for (const value of [f.keyHex, 'synthetic-process-read-token', 'synthetic-process-identity-token']) {
        assert.equal(bytes.includes(Buffer.from(value)), false);
    }
});

test('prepare and claim committed before process exit reopen as uncertain without reclaim or remote dispatch', t => {
    const f = fixture(t);
    const writer = runProbe(f, 'write-and-exit');
    assert.equal(writer.state, 'inflight');
    const before = inspect(f, database => ({
        intent: database.prepare('SELECT * FROM savana_operational_read_actions').get(),
        audit: database.prepare('SELECT * FROM savana_delegated_read_audit ORDER BY id').all(),
    }));
    const firstRestart = runProbe(f, 'inspect-intent');
    const secondRestart = runProbe(f, 'inspect-intent');
    assert.notEqual(firstRestart.pid, writer.pid);
    assert.notEqual(secondRestart.pid, firstRestart.pid);
    for (const reopened of [firstRestart, secondRestart]) {
        assert.equal(reopened.intent_id, writer.intent_id);
        assert.equal(reopened.state, 'inflight');
        assert.equal(reopened.uncertain_after_exit, true);
        assert.equal(reopened.reclaimed, false);
        assert.equal(reopened.immutable_record_sha256,
            crypto.createHash('sha256').update(JSON.stringify(before.intent)).digest('hex'));
    }
    inspect(f, database => {
        assert.deepEqual(database.prepare('SELECT * FROM savana_operational_read_actions').get(), before.intent);
        assert.deepEqual(database.prepare('SELECT * FROM savana_delegated_read_audit ORDER BY id').all(), before.audit);
        assert.deepEqual(sourceState(database), f.before);
    });
});
