-- ============================================
-- Migration 004: Tenant-Aware Contacts
-- ============================================
-- Rebuilds the contacts table to be tenant-scoped.
-- Previously contacts were global (phone = PRIMARY KEY),
-- meaning two tenants talking to the same number shared contact data.

CREATE TABLE IF NOT EXISTS contacts_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    phone TEXT NOT NULL,
    profile_name TEXT,
    profile_picture_url TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, phone),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO contacts_new (tenant_id, phone, profile_name, profile_picture_url, updated_at)
    SELECT NULL, phone, profile_name, profile_picture_url, updated_at FROM contacts;

DROP TABLE IF EXISTS contacts;

ALTER TABLE contacts_new RENAME TO contacts;

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone ON contacts(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id)
