CREATE TABLE IF NOT EXISTS fb_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER NOT NULL,
    page_id TEXT NOT NULL,
    user_psid TEXT NOT NULL,
    user_name TEXT,
    user_profile_pic TEXT,
    last_message TEXT,
    last_message_time DATETIME,
    unread_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fb_conv_unique ON fb_conversations(linked_page_id, user_psid);
CREATE INDEX IF NOT EXISTS idx_fb_conv_tenant ON fb_conversations(tenant_id);

CREATE TABLE IF NOT EXISTS fb_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    mid TEXT,
    direction TEXT NOT NULL DEFAULT 'incoming',
    sender_id TEXT,
    sender_name TEXT,
    message_text TEXT,
    attachment_type TEXT,
    attachment_url TEXT,
    sticker_url TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (conversation_id) REFERENCES fb_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fb_msg_conversation ON fb_messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fb_msg_mid ON fb_messages(mid);
