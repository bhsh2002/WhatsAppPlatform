import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { configureDatabaseConnection } from '../db/configure.js';

test('file-backed SQLite connections enable WAL, FK checks and a busy timeout', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-db-config-'));
    const filename = path.join(directory, 'test.db');
    const db = new Database(filename);
    const state = configureDatabaseConnection(db, { busyTimeoutMs: 7500 });

    assert.deepEqual(state, {
        foreignKeys: 1,
        journalMode: 'wal',
        synchronous: 1,
        busyTimeoutMs: 7500,
    });
    db.close();
});
