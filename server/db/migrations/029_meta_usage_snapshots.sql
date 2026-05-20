-- ============================================
-- Migration 029: Meta usage snapshots for reconciliation
-- ============================================

CREATE TABLE IF NOT EXISTS meta_usage_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    waba_id TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    granularity TEXT DEFAULT 'MONTHLY',
    source TEXT DEFAULT 'whatsapp_business_management_api',
    status TEXT DEFAULT 'synced' CHECK(status IN ('synced', 'partial', 'failed')),
    currency TEXT,
    meta_sent INTEGER DEFAULT 0,
    meta_delivered INTEGER DEFAULT 0,
    meta_conversations INTEGER DEFAULT 0,
    meta_cost_amount REAL DEFAULT 0,
    local_sent INTEGER DEFAULT 0,
    local_delivered INTEGER DEFAULT 0,
    local_estimated_amount REAL DEFAULT 0,
    local_final_amount REAL DEFAULT 0,
    invoice_total_amount REAL DEFAULT 0,
    diff_sent INTEGER DEFAULT 0,
    diff_delivered INTEGER DEFAULT 0,
    diff_cost_amount REAL DEFAULT 0,
    summary_json TEXT,
    raw_meta_json TEXT,
    error_message TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_usage_snapshots_tenant
    ON meta_usage_snapshots(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meta_usage_snapshots_period
    ON meta_usage_snapshots(tenant_id, period_start, period_end);
