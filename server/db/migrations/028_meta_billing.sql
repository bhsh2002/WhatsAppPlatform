-- ============================================
-- Migration 028: Meta cost rates, invoices, and usage reconciliation
-- ============================================

ALTER TABLE billing_usage_events ADD COLUMN meta_charge_status TEXT DEFAULT 'not_applicable';
ALTER TABLE billing_usage_events ADD COLUMN meta_pricing_basis TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_charge_category TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_country_calling_code TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_charge_currency TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_estimated_amount REAL DEFAULT 0;
ALTER TABLE billing_usage_events ADD COLUMN meta_final_amount REAL DEFAULT 0;
ALTER TABLE billing_usage_events ADD COLUMN meta_rate_card_id INTEGER;
ALTER TABLE billing_usage_events ADD COLUMN meta_charge_reason TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_invoice_id INTEGER;
ALTER TABLE billing_usage_events ADD COLUMN meta_delivered_at DATETIME;
ALTER TABLE billing_usage_events ADD COLUMN meta_priced_at DATETIME;

CREATE TABLE IF NOT EXISTS meta_whatsapp_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country_calling_code TEXT NOT NULL,
    market_name TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    category TEXT NOT NULL,
    rate_amount REAL NOT NULL DEFAULT 0,
    volume_tier_min INTEGER DEFAULT 1,
    volume_tier_max INTEGER,
    effective_from DATE NOT NULL DEFAULT (date('now')),
    effective_to DATE,
    source TEXT DEFAULT 'manual',
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(country_calling_code, currency, category, effective_from, volume_tier_min)
);

CREATE TABLE IF NOT EXISTS meta_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    business_id TEXT,
    waba_id TEXT,
    invoice_number TEXT,
    provider TEXT DEFAULT 'meta',
    period_start DATE,
    period_end DATE,
    currency TEXT DEFAULT 'USD',
    subtotal_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'received',
    invoice_url TEXT,
    notes TEXT,
    metadata_json TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meta_invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    tenant_id INTEGER,
    channel TEXT DEFAULT 'whatsapp',
    category TEXT,
    country_calling_code TEXT,
    quantity INTEGER DEFAULT 0,
    unit_rate REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    meta_rate_card_id INTEGER,
    description TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (invoice_id) REFERENCES meta_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
    FOREIGN KEY (meta_rate_card_id) REFERENCES meta_whatsapp_rates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_rates_match
    ON meta_whatsapp_rates(country_calling_code, category, currency, is_active);
CREATE INDEX IF NOT EXISTS idx_meta_invoices_tenant ON meta_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meta_invoices_period ON meta_invoices(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_meta_invoice_lines_invoice ON meta_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_usage_meta_status ON billing_usage_events(meta_charge_status);
CREATE INDEX IF NOT EXISTS idx_billing_usage_meta_invoice ON billing_usage_events(meta_invoice_id);
