import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { findDataDeletionStatus, processDataDeletion } from '../services/dataDeletion.js';

const createDb = () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE data_deletion_requests (
            id INTEGER PRIMARY KEY, confirmation_code_hash TEXT UNIQUE NOT NULL,
            subject_hash TEXT NOT NULL, status TEXT DEFAULT 'pending', records_deleted INTEGER DEFAULT 0,
            records_redacted INTEGER DEFAULT 0, error_code TEXT, requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        );
        CREATE TABLE fb_conversations (id INTEGER PRIMARY KEY, user_psid TEXT NOT NULL);
        CREATE TABLE fb_messages (
            id INTEGER PRIMARY KEY, conversation_id INTEGER, sender_id TEXT,
            FOREIGN KEY (conversation_id) REFERENCES fb_conversations(id) ON DELETE CASCADE
        );
        CREATE TABLE bot_sessions (id INTEGER PRIMARY KEY, conversation_id INTEGER, user_psid TEXT NOT NULL);
        CREATE TABLE bot_events (id INTEGER PRIMARY KEY, conversation_id INTEGER, session_id INTEGER, payload_json TEXT);
        CREATE TABLE webhook_logs (id INTEGER PRIMARY KEY, payload TEXT);
        CREATE TABLE webhook_failures (id INTEGER PRIMARY KEY, payload TEXT);
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY, metadata_json TEXT, meta_status_payload_json TEXT, billing_formula_json TEXT
        );
        CREATE TABLE billing_ledger (id INTEGER PRIMARY KEY, metadata_json TEXT);
        CREATE TABLE billing_meta_message_costs (
            id INTEGER PRIMARY KEY, recipient TEXT, status_payload_json TEXT, metadata_json TEXT
        );
        CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, event_type TEXT, description TEXT);
    `);
    return db;
};

test('data deletion removes operational identity data and redacts retained financial metadata', () => {
    const db = createDb();
    const psid = 'psid-sensitive';
    db.prepare('INSERT INTO fb_conversations VALUES (1, ?)').run(psid);
    db.prepare('INSERT INTO fb_messages VALUES (1, 1, ?)').run(psid);
    db.prepare('INSERT INTO bot_sessions VALUES (1, 1, ?)').run(psid);
    db.prepare('INSERT INTO bot_events VALUES (1, 1, 1, ?)').run(JSON.stringify({ sender: { id: psid } }));
    db.prepare('INSERT INTO webhook_logs VALUES (1, ?)').run(JSON.stringify({ entry: [{ messaging: [{ sender: { id: psid } }] }] }));
    db.prepare('INSERT INTO webhook_failures VALUES (1, ?)').run(JSON.stringify({ unrelated: 'keep-me' }));
    db.prepare('INSERT INTO billing_usage_events VALUES (1, ?, NULL, NULL)')
        .run(JSON.stringify({ user_psid: psid, operation: 'messenger' }));
    db.prepare('INSERT INTO billing_ledger VALUES (1, ?)').run(JSON.stringify({ unrelated: 'keep-me' }));
    db.prepare('INSERT INTO billing_meta_message_costs VALUES (1, ?, NULL, ?)')
        .run(psid, JSON.stringify({ recipient: psid }));
    db.prepare("INSERT INTO activity_logs VALUES (1, 'data_deletion', ?)")
        .run(`Meta data deletion request for user ${psid} — old log`);

    const result = processDataDeletion(db, psid, {
        confirmationCode: '0123456789abcdef0123456789abcdef',
        identitySecret: 'privacy-test-secret',
    });

    assert.equal(result.status, 'completed');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM fb_conversations').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM fb_messages').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM bot_sessions').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM bot_events').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM webhook_logs').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM webhook_failures').get().count, 1);
    assert.equal(JSON.parse(db.prepare('SELECT metadata_json FROM billing_usage_events').get().metadata_json).user_psid, '[deleted]');
    assert.equal(db.prepare('SELECT recipient FROM billing_meta_message_costs').get().recipient, '[deleted]');
    assert.equal(JSON.parse(db.prepare('SELECT metadata_json FROM billing_meta_message_costs').get().metadata_json).recipient, '[deleted]');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM activity_logs').get().count, 0);

    const status = findDataDeletionStatus(db, '0123456789abcdef0123456789abcdef');
    assert.equal(status.status, 'completed');
    assert.equal(findDataDeletionStatus(db, '<script>alert(1)</script>'), null);
    assert.equal(db.prepare('SELECT length(subject_hash) length FROM data_deletion_requests').get().length, 64);
    db.close();
});
