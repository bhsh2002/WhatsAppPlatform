import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test('tenant billing reads remain bounded and scoped on an isolated database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-tenant-billing-'));
    const databasePath = path.join(directory, 'platform.db');
    const fixture = path.join(testDirectory, '..', 'test-fixtures', 'tenantBillingIsolation.js');

    try {
        const result = spawnSync(process.execPath, [fixture], {
            cwd: path.join(testDirectory, '..'),
            env: {
                ...process.env,
                DATABASE_PATH: databasePath,
                JWT_SECRET: 'tenant-billing-test-secret-that-is-long-enough',
                CRYPTO_KEY: 'de'.repeat(32),
                NODE_ENV: 'test',
            },
            encoding: 'utf8',
            timeout: 30_000,
        });

        assert.equal(result.status, 0, result.stderr || result.stdout);
        const lastLine = result.stdout.trim().split('\n').at(-1);
        assert.deepEqual(JSON.parse(lastLine), {
            summaryIsolation: true,
            internalMetricsHidden: true,
            ledgerIsolation: true,
            invoiceIsolation: true,
            boundedPagination: true,
            periodAndFilterValidation: true,
        });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
