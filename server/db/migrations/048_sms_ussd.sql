-- Tenant-isolated USSD requests executed through linked SMS Gateway accounts.

CREATE TABLE IF NOT EXISTS sms_ussd_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    sms_account_id INTEGER NOT NULL,
    gateway_ussd_id TEXT NOT NULL,
    idempotency_key TEXT,
    request_code TEXT NOT NULL,
    response_text TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'completed', 'failed')),
    device_id TEXT NOT NULL,
    sim_slot INTEGER,
    sent_at TEXT,
    response_at TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (sms_account_id) REFERENCES sms_gateway_accounts(id) ON DELETE CASCADE,
    UNIQUE(sms_account_id, gateway_ussd_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_ussd_idempotency
    ON sms_ussd_requests(sms_account_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_sms_ussd_tenant_history
    ON sms_ussd_requests(tenant_id, sms_account_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sms_ussd_pending
    ON sms_ussd_requests(tenant_id, status, updated_at);

INSERT OR IGNORE INTO billing_price_items (
    operation_key, channel, operation_type, display_name_ar,
    unit_price_credits, is_billable, is_active
) VALUES ('sms.ussd', 'sms', 'ussd', 'طلب USSD', 1, 1, 1);
