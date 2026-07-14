import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createVerifiedBackup, verifyBackupArchive } from '../services/databaseBackup.js';

function createFixtureDatabase(databasePath) {
    const db = new Database(databasePath);
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            body TEXT NOT NULL
        );
        INSERT INTO tenants (id, name) VALUES (1, 'fixture');
        INSERT INTO messages (tenant_id, body) VALUES (1, 'preserved');
    `);
    db.close();
}

test('backup creation validates and restores an isolated SQLite snapshot', async (t) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'database-backup-test-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

    const databasePath = path.join(temporaryDirectory, 'fixture.db');
    const backupDirectory = path.join(temporaryDirectory, 'backups');
    createFixtureDatabase(databasePath);

    const result = await createVerifiedBackup({ databasePath, backupDirectory, retention: 2 });
    assert.equal(result.quickCheck, 'ok');
    assert.equal(result.foreignKeyViolations, 0);
    assert.equal(result.tableCount, 2);
    assert.equal(result.restoredBytes > 0, true);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(result.archivePath), true);
    assert.equal(fs.readdirSync(backupDirectory).some((name) => name.endsWith('.partial')), false);

    const verifiedAgain = await verifyBackupArchive(result.archivePath);
    assert.equal(verifiedAgain.sha256, result.sha256);
});

test('backup retention removes only older recognized backup archives', async (t) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'database-retention-test-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

    const databasePath = path.join(temporaryDirectory, 'fixture.db');
    const backupDirectory = path.join(temporaryDirectory, 'backups');
    createFixtureDatabase(databasePath);

    for (let index = 0; index < 3; index += 1) {
        await createVerifiedBackup({
            databasePath,
            backupDirectory,
            retention: 2,
            now: new Date(Date.UTC(2026, 6, 13, 12, 0, index)),
        });
    }
    fs.writeFileSync(path.join(backupDirectory, 'operator-note.txt'), 'preserve');

    const files = fs.readdirSync(backupDirectory);
    assert.equal(files.filter((name) => name.endsWith('.db.gz')).length, 2);
    assert.equal(files.includes('operator-note.txt'), true);
});

test('restore drill rejects corrupt archives', async (t) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'database-corrupt-test-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
    const archivePath = path.join(temporaryDirectory, 'corrupt.db.gz');
    fs.writeFileSync(archivePath, 'not a gzip archive');

    await assert.rejects(() => verifyBackupArchive(archivePath));
});
