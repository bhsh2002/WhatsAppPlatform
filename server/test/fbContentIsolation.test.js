import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test('shared Facebook content router enforces tenant ownership and normalizes Meta errors', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-fb-content-'));
    const databasePath = path.join(directory, 'platform.db');
    const fixture = path.join(testDirectory, '..', 'test-fixtures', 'fbContentIsolation.js');

    try {
        const result = spawnSync(process.execPath, [fixture], {
            cwd: path.join(testDirectory, '..'),
            env: {
                ...process.env,
                DATABASE_PATH: databasePath,
                CRYPTO_KEY: 'ab'.repeat(32),
            },
            encoding: 'utf8',
            timeout: 20_000,
        });

        assert.equal(result.status, 0, result.stderr || result.stdout);
        const lastLine = result.stdout.trim().split('\n').at(-1);
        assert.deepEqual(JSON.parse(lastLine), {
            tenantIsolation: true,
            normalizedErrors: true,
            adminAccess: true,
        });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
