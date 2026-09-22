-- Managed SMS Gateway assignments, provisioning idempotency and audit history.

ALTER TABLE sms_gateway_accounts
    ADD COLUMN management_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK(management_mode IN ('manual', 'managed'));

ALTER TABLE sms_gateway_accounts ADD COLUMN gateway_assignment_id TEXT;
ALTER TABLE sms_gateway_accounts ADD COLUMN managed_resources_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sms_gateway_accounts ADD COLUMN provisioned_at TEXT;
ALTER TABLE sms_gateway_accounts ADD COLUMN revoked_at TEXT;
ALTER TABLE sms_gateway_accounts ADD COLUMN history_cursor TEXT;
ALTER TABLE sms_gateway_accounts ADD COLUMN history_backfill_cursor TEXT;
ALTER TABLE sms_gateway_accounts ADD COLUMN history_backfill_complete INTEGER NOT NULL DEFAULT 0
    CHECK(history_backfill_complete IN (0, 1));
ALTER TABLE sms_gateway_accounts ADD COLUMN last_history_sync_at TEXT;
ALTER TABLE sms_gateway_accounts ADD COLUMN last_history_sync_attempt_at TEXT;
ALTER TABLE sms_gateway_accounts ADD COLUMN last_history_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_gateway_assignment
    ON sms_gateway_accounts(gateway_assignment_id)
    WHERE gateway_assignment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sms_gateway_provision_deliveries (
    delivery_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('upsert', 'revoke')),
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK(status IN ('processing', 'complete')),
    response_json TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sms_gateway_provision_assignment
    ON sms_gateway_provision_deliveries(assignment_id, created_at);

CREATE TABLE IF NOT EXISTS sms_gateway_management_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    sms_account_id INTEGER,
    assignment_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'error')),
    details_json TEXT,
    error_code TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
    FOREIGN KEY (sms_account_id) REFERENCES sms_gateway_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sms_gateway_management_audit_assignment
    ON sms_gateway_management_audit(assignment_id, created_at);

CREATE TABLE IF NOT EXISTS sms_api_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    sms_account_id INTEGER,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK(status IN ('processing', 'accepted', 'failed')),
    attempt INTEGER NOT NULL DEFAULT 1,
    billing_usage_id INTEGER,
    response_json TEXT,
    last_error_code TEXT,
    lease_expires_at TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (sms_account_id) REFERENCES sms_gateway_accounts(id) ON DELETE SET NULL,
    FOREIGN KEY (billing_usage_id) REFERENCES billing_usage_events(id) ON DELETE SET NULL,
    UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sms_api_requests_status
    ON sms_api_requests(status, lease_expires_at);

-- Durable tenant callbacks. The exact serialized body and its HMAC are kept so
-- retries deliver the same bytes and consumers can deduplicate by delivery_id.
CREATE TABLE IF NOT EXISTS tenant_api_callback_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id TEXT NOT NULL UNIQUE,
    dedupe_key TEXT UNIQUE,
    tenant_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    callback_url TEXT NOT NULL,
    body_json TEXT NOT NULL,
    signature TEXT,
    legacy_signature TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'processing', 'failed', 'delivered', 'dead_letter')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    locked_at TEXT,
    delivered_at TEXT,
    response_status INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_callback_outbox_due
    ON tenant_api_callback_outbox(status, available_at, id);
