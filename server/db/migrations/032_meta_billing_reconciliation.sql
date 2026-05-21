-- ============================================
-- Migration 032: Meta billing reconciliation hardening
-- ============================================

ALTER TABLE billing_usage_events ADD COLUMN meta_status_payload_json TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_reconciliation_period_id INTEGER;
ALTER TABLE billing_usage_events ADD COLUMN meta_invoice_line_id INTEGER;

CREATE TABLE IF NOT EXISTS billing_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

INSERT OR IGNORE INTO billing_settings (key, value, description)
VALUES
    ('meta_cost_exchange_rate_to_lyd', '1', 'سعر تحويل تكلفة Meta من عملتها الأصلية إلى LYD للعرض الإداري فقط'),
    ('meta_cost_margin_note', '', 'ملاحظة داخلية حول هامش تكلفة Meta');

CREATE TABLE IF NOT EXISTS billing_meta_reconciliation_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    waba_id TEXT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'synced', 'needs_review', 'invoice_reconciled')),
    currency TEXT,
    meta_sent INTEGER DEFAULT 0,
    meta_delivered INTEGER DEFAULT 0,
    local_sent INTEGER DEFAULT 0,
    local_delivered INTEGER DEFAULT 0,
    diff_sent INTEGER DEFAULT 0,
    diff_delivered INTEGER DEFAULT 0,
    meta_cost_amount REAL DEFAULT 0,
    local_estimated_amount REAL DEFAULT 0,
    local_final_amount REAL DEFAULT 0,
    invoice_total_amount REAL DEFAULT 0,
    diff_meta_vs_local_cost REAL DEFAULT 0,
    diff_invoice_vs_local_cost REAL DEFAULT 0,
    pending_count INTEGER DEFAULT 0,
    estimated_count INTEGER DEFAULT 0,
    final_count INTEGER DEFAULT 0,
    not_charged_count INTEGER DEFAULT 0,
    rate_missing_count INTEGER DEFAULT 0,
    invoice_reconciled_count INTEGER DEFAULT 0,
    missing_wamid_count INTEGER DEFAULT 0,
    needs_action_count INTEGER DEFAULT 0,
    last_snapshot_id INTEGER,
    last_invoice_id INTEGER,
    summary_json TEXT,
    reviewed_at DATETIME,
    reviewed_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (last_snapshot_id) REFERENCES meta_usage_snapshots(id) ON DELETE SET NULL,
    FOREIGN KEY (last_invoice_id) REFERENCES meta_invoices(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(tenant_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_billing_meta_reconciliation_tenant
    ON billing_meta_reconciliation_periods(tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_billing_meta_reconciliation_status
    ON billing_meta_reconciliation_periods(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_billing_usage_meta_reconciliation
    ON billing_usage_events(meta_reconciliation_period_id);
