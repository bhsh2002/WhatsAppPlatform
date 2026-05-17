CREATE TABLE IF NOT EXISTS tenant_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    platform TEXT NOT NULL DEFAULT 'facebook',
    page_id TEXT NOT NULL,
    page_name TEXT,
    page_access_token_encrypted TEXT,
    page_category TEXT,
    page_picture_url TEXT,
    is_active INTEGER DEFAULT 1,
    subscribed_fields TEXT DEFAULT '["feed","messages","messaging_postbacks"]',
    webhook_subscribed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_pages_unique ON tenant_pages(tenant_id, page_id);

CREATE INDEX IF NOT EXISTS idx_tenant_pages_page_id ON tenant_pages(page_id);