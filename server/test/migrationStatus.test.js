import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getMigrationStatusSync } from '../db/migrator.js';

test('readiness reports pending migrations without exposing migration contents', () => {
    const db = new Database(':memory:');
    let status = getMigrationStatusSync(db);
    assert.equal(status.total >= 38, true);
    assert.equal(status.applied, 0);
    assert.equal(status.pending, status.total);

    db.exec('CREATE TABLE _migrations (name TEXT UNIQUE NOT NULL)');
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('001_initial_schema.sql');
    status = getMigrationStatusSync(db);
    assert.equal(status.applied, 1);
    assert.equal(status.pending, status.total - 1);
    db.close();
});
