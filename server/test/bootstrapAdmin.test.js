import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

import { BootstrapAdminError, ensureBootstrapAdmin } from '../services/bootstrapAdmin.js';

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-admin-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const db = new Database(path.join(directory, 'bootstrap.db'));
    t.after(() => db.close());
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT,
            role TEXT,
            is_active INTEGER
        )
    `);
    return db;
}

test('empty installations require an explicit strong bootstrap password', async (t) => {
    const db = fixture(t);

    await assert.rejects(
        () => ensureBootstrapAdmin(db),
        error => error instanceof BootstrapAdminError && error.code === 'BOOTSTRAP_PASSWORD_REQUIRED'
    );
    await assert.rejects(
        () => ensureBootstrapAdmin(db, { password: 'admin123' }),
        error => error instanceof BootstrapAdminError && error.code === 'BOOTSTRAP_PASSWORD_WEAK'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});

test('bootstrap stores only a password hash and is idempotent after the first user', async (t) => {
    const db = fixture(t);
    const password = 'correct-horse-battery-staple';
    const created = await ensureBootstrapAdmin(db, {
        password,
        username: 'platform-admin',
        email: 'operator@example.test',
    });
    const user = db.prepare('SELECT * FROM users').get();

    assert.deepEqual(created, { created: true, username: 'platform-admin' });
    assert.equal(user.role, 'admin');
    assert.equal(user.is_active, 1);
    assert.notEqual(user.password_hash, password);
    assert.equal(await bcrypt.compare(password, user.password_hash), true);

    const second = await ensureBootstrapAdmin(db, { password: '' });
    assert.deepEqual(second, { created: false });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
});
