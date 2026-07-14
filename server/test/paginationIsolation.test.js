import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test('list routes enforce bounded pagination on an isolated migrated database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-pagination-'));
    const databasePath = path.join(directory, 'platform.db');
    const fixture = path.join(testDirectory, '..', 'test-fixtures', 'paginationIsolation.js');

    try {
        const result = spawnSync(process.execPath, [fixture], {
            cwd: path.join(testDirectory, '..'),
            env: {
                ...process.env,
                DATABASE_PATH: databasePath,
                JWT_SECRET: 'pagination-test-secret-that-is-long-enough',
                CRYPTO_KEY: 'ef'.repeat(32),
                NODE_ENV: 'test',
            },
            encoding: 'utf8',
            timeout: 30_000,
        });

        assert.equal(result.status, 0, result.stderr || result.stdout);
        const lastLine = result.stdout.trim().split('\n').at(-1);
        assert.deepEqual(JSON.parse(lastLine), {
            defaultAndMaximumLimits: true,
            chronologicalMessageWindow: true,
            combinedInboxPagination: true,
            tenantReadIsolation: true,
        });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
