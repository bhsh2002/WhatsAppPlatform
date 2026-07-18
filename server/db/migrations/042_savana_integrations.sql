-- Savana Connect adapter state. Wa Savana remains fully usable without it.

CREATE TABLE IF NOT EXISTS savana_integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    platform_code TEXT NOT NULL,
    organization_id TEXT,
    local_platform_tenant_id TEXT,
    remote_platform_tenant_id TEXT,
    remote_external_tenant_id TEXT,
    connection_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'disconnected'
        CHECK(status IN ('disconnected', 'pending_authorization', 'active', 'paused', 'revoked', 'error')),
    scopes_json TEXT NOT NULL DEFAULT '[]',
    entitlement_payload_json TEXT,
    entitlement_signature TEXT,
    entitlement_valid_until TEXT,
    last_sync_at TEXT,
    last_error TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(tenant_id, platform_code),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS savana_integration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK(status IN ('processing', 'processed', 'failed')),
    error_message TEXT,
    received_at DATETIME DEFAULT (datetime('now', 'localtime')),
    processed_at DATETIME,
    FOREIGN KEY (integration_id) REFERENCES savana_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS savana_product_projection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    projection_key TEXT NOT NULL,
    canonical_product_id TEXT,
    local_product_id TEXT,
    sku TEXT,
    barcode TEXT,
    name TEXT,
    description TEXT,
    price TEXT,
    currency TEXT,
    image_url TEXT,
    quantity_on_hand TEXT,
    quantity_available TEXT,
    unit_code TEXT,
    source_updated_at TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(tenant_id, projection_key),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS savana_pos_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('sale', 'return')),
    local_transaction_id TEXT NOT NULL,
    original_local_sale_id TEXT,
    reference_number TEXT,
    branch_id TEXT,
    terminal_id TEXT,
    occurred_at TEXT NOT NULL,
    currency TEXT,
    total TEXT,
    customer_phone_e164 TEXT,
    receipt_notification_consent INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(tenant_id, transaction_type, local_transaction_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS savana_notification_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    transaction_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('pos_receipt', 'pos_return')),
    recipient_phone_e164 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK(status IN ('pending_review', 'approved', 'sent', 'dismissed', 'failed')),
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(transaction_id, kind),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES savana_pos_transactions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_savana_integrations_tenant ON savana_integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_savana_events_integration ON savana_integration_events(integration_id, received_at);
CREATE INDEX IF NOT EXISTS idx_savana_products_tenant ON savana_product_projection(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_savana_transactions_tenant ON savana_pos_transactions(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_savana_notifications_tenant ON savana_notification_candidates(tenant_id, status);
