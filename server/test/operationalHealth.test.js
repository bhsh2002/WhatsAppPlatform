import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { getOperationalSignals, renderPrometheusMetrics } from '../services/operationalHealth.js';

test('operational signals aggregate failures without tenant labels or payloads', (t) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'operational-health-test-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
    const db = new Database(path.join(temporaryDirectory, 'signals.db'));
    t.after(() => db.close());

    db.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, status TEXT, token_status TEXT);
        CREATE TABLE tenant_pages (id INTEGER PRIMARY KEY, is_active INTEGER, token_status TEXT);
        CREATE TABLE webhook_failures (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            payload TEXT,
            created_at DATETIME,
            resolved_at DATETIME
        );
        CREATE TABLE broadcast_jobs (id INTEGER PRIMARY KEY, status TEXT, created_at DATETIME);
        INSERT INTO tenants VALUES (1, 'Active', 'invalid');
        INSERT INTO tenant_pages VALUES (1, 1, 'valid');
        INSERT INTO webhook_failures VALUES (1, 1, 'secret payload', datetime('now', 'localtime'), NULL);
        INSERT INTO broadcast_jobs VALUES (1, 'running', datetime('now', 'localtime', '-20 minutes'));
    `);

    const metrics = {
        uptime_seconds: 60,
        requests_total: 30,
        server_errors_total: 2,
        window_5m: { requests: 30, errors: 2, error_ratio: 0.0667 },
    };
    const result = getOperationalSignals(db, metrics);

    assert.equal(result.status, 'critical');
    assert.equal(result.values.unresolved_webhook_failures, 1);
    assert.equal(result.values.stuck_broadcast_jobs, 1);
    assert.equal(result.values.unhealthy_meta_tokens, 1);
    assert.deepEqual(result.alerts.map((alert) => alert.code), [
        'HIGH_HTTP_5XX_RATE',
        'RECENT_WEBHOOK_FAILURES',
        'STUCK_BROADCAST_JOBS',
        'UNHEALTHY_META_TOKENS',
    ]);
    assert.equal(JSON.stringify(result).includes('secret payload'), false);

    const prometheus = renderPrometheusMetrics(metrics, result);
    assert.match(prometheus, /whatsapp_http_server_error_ratio_5m 0\.0667/);
    assert.match(prometheus, /whatsapp_broadcast_jobs_stuck 1/);
    assert.doesNotMatch(prometheus, /tenant_id|secret payload/);
});
