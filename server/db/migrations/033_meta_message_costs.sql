-- ============================================
-- Migration 033: Per-message Meta cost tracking
-- ============================================

CREATE TABLE IF NOT EXISTS billing_meta_message_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    usage_event_id INTEGER,
    broadcast_job_id INTEGER,
    meta_reconciliation_period_id INTEGER,
    meta_invoice_id INTEGER,
    wamid TEXT UNIQUE,
    recipient TEXT,
    operation_key TEXT,
    message_type TEXT,
    template_name TEXT,
    template_category TEXT,
    pricing_type TEXT,
    pricing_model TEXT,
    billable INTEGER,
    country_calling_code TEXT,
    currency TEXT,
    estimated_amount REAL DEFAULT 0,
    final_amount REAL DEFAULT 0,
    rate_card_id INTEGER,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'estimated', 'final', 'not_charged', 'rate_missing', 'invoice_reconciled')),
    charge_reason TEXT,
    calculation_basis TEXT,
    status_payload_json TEXT,
    metadata_json TEXT,
    sent_at DATETIME DEFAULT (datetime('now', 'localtime')),
    delivered_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (usage_event_id) REFERENCES billing_usage_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_meta_message_costs_tenant
    ON billing_meta_message_costs(tenant_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_billing_meta_message_costs_status
    ON billing_meta_message_costs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_billing_meta_message_costs_usage
    ON billing_meta_message_costs(usage_event_id);
CREATE INDEX IF NOT EXISTS idx_billing_meta_message_costs_broadcast
    ON billing_meta_message_costs(broadcast_job_id);
CREATE INDEX IF NOT EXISTS idx_billing_meta_message_costs_reconciliation
    ON billing_meta_message_costs(meta_reconciliation_period_id);
