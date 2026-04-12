-- ============================================
-- Migration 005: Cascading Deletes for Messages
-- ============================================
-- Changes messages FK from ON DELETE SET NULL to ON DELETE CASCADE.
-- Requires table rebuild since SQLite can't alter FK constraints.

CREATE TABLE IF NOT EXISTS messages_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    direction TEXT CHECK(direction IN ('incoming', 'outgoing')),
    recipient TEXT,
    sender TEXT,
    message_type TEXT,
    content TEXT,
    status TEXT DEFAULT 'pending',
    wamid TEXT,
    error_message TEXT,
    media_id TEXT,
    media_url TEXT,
    media_mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

INSERT INTO messages_new SELECT * FROM messages;

DROP TABLE messages;

ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages(wamid);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction)
