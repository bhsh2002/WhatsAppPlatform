import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test('billing reserve/commit/release lifecycle is atomic on an isolated migrated database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-billing-lifecycle-'));
    const databasePath = path.join(directory, 'billing.db');
    const fixture = path.join(testDirectory, '..', 'test-fixtures', 'billingLifecycle.js');
    const result = spawnSync(process.execPath, [fixture], {
        cwd: path.join(testDirectory, '..'),
        env: { ...process.env, DATABASE_PATH: databasePath },
        encoding: 'utf8',
        timeout: 20_000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const lastLine = result.stdout.trim().split('\n').at(-1);
    assert.deepEqual(JSON.parse(lastLine), { committed: 'committed', released: 'released', balance: 97 });
});
