-- ============================================
-- Migration 045: Multiple WhatsApp numbers per tenant
-- ============================================
-- The legacy WhatsApp columns on tenants remain as a compatibility pointer to
-- the default number. New code resolves credentials from this table first.

CREATE TABLE IF NOT EXISTS tenant_whatsapp_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    phone_number_id TEXT NOT NULL,
    waba_id TEXT,
    business_id TEXT,
    display_phone_number TEXT,
    verified_name TEXT,
    label TEXT,
    quality_rating TEXT,
    platform_status TEXT,
    access_token_encrypted TEXT,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, phone_number_id),
    UNIQUE (phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_whatsapp_numbers_tenant
    ON tenant_whatsapp_numbers(tenant_id, is_active, is_default);
CREATE INDEX IF NOT EXISTS idx_tenant_whatsapp_numbers_waba
    ON tenant_whatsapp_numbers(waba_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_whatsapp_numbers_one_default
    ON tenant_whatsapp_numbers(tenant_id)
    WHERE is_default = 1;

-- Backfill every existing tenant number. Its encrypted credential remains on
-- tenants too because older deployments and rollback code still read it.
INSERT OR IGNORE INTO tenant_whatsapp_numbers (
    tenant_id,
    phone_number_id,
    waba_id,
    business_id,
    access_token_encrypted,
    is_default,
    is_active,
    created_at,
    updated_at
)
SELECT
    id,
    phone_number_id,
    NULLIF(waba_id, ''),
    business_id,
    access_token_encrypted,
    1,
    1,
    created_at,
    updated_at
FROM tenants
WHERE phone_number_id IS NOT NULL AND trim(phone_number_id) != '';

-- Conversation windows are number-specific. A customer can message one of a
-- tenant's numbers without opening the 24-hour service window on every number.
CREATE TABLE IF NOT EXISTS tenant_whatsapp_contact_windows (
    tenant_id INTEGER NOT NULL,
    phone_number_id TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    last_customer_message_at DATETIME NOT NULL,
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (tenant_id, phone_number_id, contact_phone),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (phone_number_id) REFERENCES tenant_whatsapp_numbers(phone_number_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_whatsapp_windows_lookup
    ON tenant_whatsapp_contact_windows(tenant_id, phone_number_id, contact_phone);

INSERT OR IGNORE INTO tenant_whatsapp_contact_windows (
    tenant_id, phone_number_id, contact_phone, last_customer_message_at, updated_at
)
SELECT
    contacts.tenant_id,
    tenant_whatsapp_numbers.phone_number_id,
    contacts.phone,
    contacts.last_customer_message_at,
    contacts.updated_at
FROM contacts
JOIN tenant_whatsapp_numbers
  ON tenant_whatsapp_numbers.tenant_id = contacts.tenant_id
 AND tenant_whatsapp_numbers.is_default = 1
WHERE contacts.last_customer_message_at IS NOT NULL;
