import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { cleanupExpiredData } from '../services/maintenance.js';

test('maintenance expires only terminal SMS API and callback records', (t) => {
    const database = new Database(':memory:');
    t.after(() => database.close());
    database.exec(`
        CREATE TABLE webhook_logs (created_at TEXT);
        CREATE TABLE activity_logs (created_at TEXT);
        CREATE TABLE meta_review_checks (created_at TEXT);
        CREATE TABLE revoked_tokens (expires_at TEXT);
        CREATE TABLE sms_api_requests (status TEXT, updated_at TEXT);
        CREATE TABLE tenant_api_callback_outbox (
            status TEXT,
            delivered_at TEXT,
            updated_at TEXT
        );

        INSERT INTO webhook_logs VALUES (datetime('now'));
        INSERT INTO activity_logs VALUES (datetime('now'));
        INSERT INTO meta_review_checks VALUES (datetime('now'));
        INSERT INTO revoked_tokens VALUES (datetime('now', '+1 day'));

        INSERT INTO sms_api_requests VALUES
            ('accepted', datetime('now', '-91 days')),
            ('failed', datetime('now', '-91 days')),
            ('processing', datetime('now', '-200 days')),
            ('accepted', datetime('now', '-1 day'));

        INSERT INTO tenant_api_callback_outbox VALUES
            ('delivered', datetime('now', '-31 days'), datetime('now', '-31 days')),
            ('dead_letter', NULL, datetime('now', '-181 days')),
            ('pending', NULL, datetime('now', '-300 days')),
            ('processing', NULL, datetime('now', '-300 days')),
            ('failed', NULL, datetime('now', '-300 days')),
            ('delivered', datetime('now', '-1 day'), datetime('now', '-1 day'));
    `);

    assert.equal(cleanupExpiredData(database), 4);
    assert.deepEqual(
        database.prepare('SELECT status FROM sms_api_requests ORDER BY rowid').all()
            .map(row => row.status),
        ['processing', 'accepted'],
    );
    assert.deepEqual(
        database.prepare('SELECT status FROM tenant_api_callback_outbox ORDER BY rowid').all()
            .map(row => row.status),
        ['pending', 'processing', 'failed', 'delivered'],
    );
});
