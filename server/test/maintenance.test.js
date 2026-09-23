import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { cleanupExpiredData } from '../services/maintenance.js';

test('maintenance expires only terminal SMS API and callback records', (t) => {
    const database = new Database(':memory:');
    t.after(() => database.close());
    database.pragma('foreign_keys = ON');
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
        CREATE TABLE web_push_events (
            id INTEGER PRIMARY KEY,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        CREATE TABLE web_push_subscriptions (
            id INTEGER PRIMARY KEY,
            session_expires_at INTEGER NOT NULL
        );
        CREATE TABLE web_push_deliveries (
            id INTEGER PRIMARY KEY,
            event_id INTEGER NOT NULL,
            subscription_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY (event_id) REFERENCES web_push_events(id) ON DELETE CASCADE,
            FOREIGN KEY (subscription_id) REFERENCES web_push_subscriptions(id) ON DELETE CASCADE
        );
        CREATE TABLE web_push_alert_states (
            scope_key TEXT NOT NULL,
            alert_code TEXT NOT NULL,
            is_active INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (scope_key, alert_code)
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

        INSERT INTO web_push_events VALUES
            (1, 'delivered', datetime('now', '-100 days'), datetime('now', '-100 days')),
            (2, 'failed', datetime('now', '-100 days'), datetime('now', '-100 days')),
            (3, 'pending', datetime('now', '-100 days'), NULL),
            (4, 'partial', datetime('now', '-1 day'), datetime('now', '-1 day')),
            (5, 'pending', datetime('now', '-1 day'), NULL),
            (6, 'pending', datetime('now', '-1 day'), NULL),
            (7, 'pending', datetime('now', '-1 day'), NULL),
            (8, 'pending', datetime('now', '-1 day'), NULL);
        INSERT INTO web_push_subscriptions VALUES
            (1, CAST(strftime('%s', 'now') AS INTEGER) - 1),
            (2, CAST(strftime('%s', 'now') AS INTEGER) + 3600);
        INSERT INTO web_push_deliveries VALUES
            (1, 1, 1, 'delivered'),
            (2, 3, 2, 'pending'),
            (3, 5, 1, 'pending'),
            (4, 6, 2, 'delivered'),
            (5, 6, 2, 'skipped'),
            (6, 7, 2, 'dead_letter'),
            (7, 8, 2, 'skipped');
        INSERT INTO web_push_alert_states VALUES
            ('admin', 'OLD_RESOLVED', 0, datetime('now', '-100 days')),
            ('admin', 'OLD_ACTIVE', 1, datetime('now', '-100 days')),
            ('admin', 'RECENT_RESOLVED', 0, datetime('now', '-1 day'));
    `);

    assert.equal(cleanupExpiredData(database), 8);
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
    assert.deepEqual(
        database.prepare('SELECT id, status FROM web_push_events ORDER BY id').all(),
        [
            { id: 3, status: 'pending' },
            { id: 4, status: 'partial' },
            { id: 5, status: 'no_recipients' },
            { id: 6, status: 'partial' },
            { id: 7, status: 'failed' },
            { id: 8, status: 'no_recipients' },
        ],
    );
    assert.deepEqual(
        database.prepare('SELECT id FROM web_push_subscriptions ORDER BY id').all(),
        [{ id: 2 }],
    );
    assert.deepEqual(
        database.prepare(`
            SELECT id, event_id, subscription_id FROM web_push_deliveries ORDER BY id
        `).all(),
        [
            { id: 2, event_id: 3, subscription_id: 2 },
            { id: 4, event_id: 6, subscription_id: 2 },
            { id: 5, event_id: 6, subscription_id: 2 },
            { id: 6, event_id: 7, subscription_id: 2 },
            { id: 7, event_id: 8, subscription_id: 2 },
        ],
    );
    assert.deepEqual(
        database.prepare('SELECT alert_code, is_active FROM web_push_alert_states ORDER BY alert_code').all(),
        [
            { alert_code: 'OLD_ACTIVE', is_active: 1 },
            { alert_code: 'RECENT_RESOLVED', is_active: 0 },
        ],
    );
});
