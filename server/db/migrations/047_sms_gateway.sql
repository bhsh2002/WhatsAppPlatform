-- Direct, tenant-isolated multi-account SMS Gateway provider for Wa Savana.

CREATE TABLE IF NOT EXISTS sms_gateway_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    credential_fingerprint TEXT NOT NULL UNIQUE,
    webhook_secret_encrypted TEXT NOT NULL,
    webhook_key TEXT NOT NULL UNIQUE,
    default_devices_json TEXT NOT NULL DEFAULT '[]',
    default_sim_slot INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'active', 'error', 'disabled')),
    last_health_at TEXT,
    last_error TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_gateway_default_account
    ON sms_gateway_accounts(tenant_id)
    WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_sms_gateway_accounts_tenant
    ON sms_gateway_accounts(tenant_id, enabled, status);

CREATE TABLE IF NOT EXISTS sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    sms_account_id INTEGER,
    gateway_message_id TEXT NOT NULL,
    external_id TEXT,
    group_id TEXT,
    direction TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
    sender TEXT,
    recipient TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    device_id TEXT,
    sim_slot INTEGER,
    result_code TEXT,
    error_code TEXT,
    error_message TEXT,
    sent_at TEXT,
    delivered_at TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (sms_account_id) REFERENCES sms_gateway_accounts(id) ON DELETE SET NULL,
    UNIQUE(sms_account_id, gateway_message_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_messages_external
    ON sms_messages(sms_account_id, external_id)
    WHERE external_id IS NOT NULL AND external_id != '';
CREATE INDEX IF NOT EXISTS idx_sms_messages_conversation
    ON sms_messages(tenant_id, sms_account_id, sender, recipient, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status
    ON sms_messages(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS sms_webhook_deliveries (
    delivery_id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    sms_account_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    received_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (sms_account_id) REFERENCES sms_gateway_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sms_webhook_deliveries_tenant
    ON sms_webhook_deliveries(tenant_id, received_at);

INSERT OR IGNORE INTO billing_price_items (
    operation_key, channel, operation_type, display_name_ar,
    unit_price_credits, is_billable, is_active
) VALUES ('sms.text', 'sms', 'text', 'رسالة SMS نصية', 1, 1, 1);
