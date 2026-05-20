-- ============================================
-- Migration 027: Billing, pricing, wallet, and ledger
-- ============================================

CREATE TABLE IF NOT EXISTS billing_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    monthly_price_lyd REAL DEFAULT 0,
    monthly_included_credits INTEGER DEFAULT 0,
    default_credit_limit INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS billing_price_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_key TEXT UNIQUE NOT NULL,
    channel TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    display_name_ar TEXT NOT NULL,
    unit_price_credits INTEGER DEFAULT 1,
    is_billable INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS tenant_billing_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER UNIQUE NOT NULL,
    plan_id INTEGER,
    wallet_balance_credits INTEGER DEFAULT 0,
    plan_balance_credits INTEGER DEFAULT 0,
    credit_limit_credits INTEGER DEFAULT 0,
    credit_used_credits INTEGER DEFAULT 0,
    billing_cycle_start DATETIME DEFAULT (datetime('now', 'localtime')),
    billing_cycle_end DATETIME,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'closed')),
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES billing_plans(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS billing_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    price_item_id INTEGER,
    operation_key TEXT NOT NULL,
    channel TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price_credits INTEGER DEFAULT 0,
    total_credits INTEGER DEFAULT 0,
    status TEXT DEFAULT 'reserved' CHECK(status IN ('reserved', 'committed', 'released', 'failed')),
    reference_type TEXT,
    reference_id TEXT,
    idempotency_key TEXT UNIQUE,
    metadata_json TEXT,
    error_message TEXT,
    reserved_at DATETIME DEFAULT (datetime('now', 'localtime')),
    committed_at DATETIME,
    released_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (price_item_id) REFERENCES billing_price_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS billing_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    entry_type TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('credit', 'debit')),
    credits_delta INTEGER NOT NULL,
    amount_lyd REAL,
    balance_after_credits INTEGER,
    related_type TEXT,
    related_id TEXT,
    description TEXT,
    metadata_json TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS billing_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    period_start DATETIME,
    period_end DATETIME,
    subtotal_credits INTEGER DEFAULT 0,
    subtotal_lyd REAL DEFAULT 0,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'issued', 'paid', 'void')),
    due_date DATETIME,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS billing_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    invoice_id INTEGER,
    amount_lyd REAL DEFAULT 0,
    credits INTEGER DEFAULT 0,
    method TEXT DEFAULT 'manual',
    reference TEXT,
    note TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_billing_accounts_tenant ON tenant_billing_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_usage_events_tenant ON billing_usage_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_usage_events_status ON billing_usage_events(status);
CREATE INDEX IF NOT EXISTS idx_billing_usage_events_operation ON billing_usage_events(operation_key);
CREATE INDEX IF NOT EXISTS idx_billing_ledger_tenant ON billing_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_ledger_created ON billing_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant ON billing_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_tenant ON billing_payments(tenant_id);

INSERT OR IGNORE INTO billing_plans (
    code, name, description, monthly_price_lyd, monthly_included_credits, default_credit_limit, is_active
) VALUES (
    'legacy',
    'Legacy Balance',
    'خطة توافق للرصيد الحالي قبل نظام الفوترة المركزي',
    0,
    0,
    0,
    1
);

INSERT OR IGNORE INTO billing_price_items (operation_key, channel, operation_type, display_name_ar, unit_price_credits, is_billable, is_active)
VALUES
    ('whatsapp.text', 'whatsapp', 'text', 'رسالة WhatsApp نصية', 1, 1, 1),
    ('whatsapp.template', 'whatsapp', 'template', 'رسالة WhatsApp قالب', 1, 1, 1),
    ('whatsapp.media', 'whatsapp', 'media', 'رسالة WhatsApp وسائط', 1, 1, 1),
    ('whatsapp.interactive', 'whatsapp', 'interactive', 'رسالة WhatsApp تفاعلية', 1, 1, 1),
    ('whatsapp.broadcast_recipient', 'whatsapp', 'broadcast_recipient', 'بث WhatsApp لكل مستلم', 1, 1, 1),
    ('whatsapp.contact_verification_template', 'whatsapp', 'contact_verification_template', 'قالب تحقق جهة اتصال WhatsApp', 1, 1, 1),
    ('messenger.reply', 'messenger', 'reply', 'رد Messenger', 1, 1, 1),
    ('messenger.utility', 'messenger', 'utility', 'رسالة Messenger موسومة', 1, 1, 1),
    ('facebook.post_create', 'facebook', 'post_create', 'إنشاء منشور Facebook', 1, 1, 1),
    ('facebook.post_edit', 'facebook', 'post_edit', 'تعديل منشور Facebook', 1, 1, 1),
    ('facebook.post_delete', 'facebook', 'post_delete', 'حذف منشور Facebook', 1, 1, 1),
    ('facebook.photo_post_create', 'facebook', 'photo_post_create', 'نشر صورة Facebook', 1, 1, 1),
    ('facebook.comment_reply', 'facebook', 'comment_reply', 'رد على تعليق Facebook', 1, 1, 1),
    ('facebook.comment_hide', 'facebook', 'comment_hide', 'إخفاء أو إظهار تعليق Facebook', 1, 1, 1),
    ('facebook.comment_like', 'facebook', 'comment_like', 'إعجاب تعليق Facebook', 1, 1, 1),
    ('facebook.comment_unlike', 'facebook', 'comment_unlike', 'إلغاء إعجاب تعليق Facebook', 1, 1, 1),
    ('facebook.comment_delete', 'facebook', 'comment_delete', 'حذف تعليق Facebook', 1, 1, 1),
    ('whatsapp.event_conversion', 'whatsapp', 'event_conversion', 'حدث WhatsApp Events API ناجح', 1, 1, 1);

INSERT OR IGNORE INTO tenant_billing_accounts (
    tenant_id,
    plan_id,
    wallet_balance_credits,
    plan_balance_credits,
    credit_limit_credits,
    credit_used_credits,
    status
)
SELECT
    t.id,
    (SELECT id FROM billing_plans WHERE code = 'legacy'),
    COALESCE(t.credits, 0),
    0,
    0,
    0,
    CASE WHEN t.status = 'Suspended' THEN 'suspended' ELSE 'active' END
FROM tenants t;

INSERT INTO billing_ledger (
    tenant_id,
    entry_type,
    direction,
    credits_delta,
    balance_after_credits,
    related_type,
    description,
    metadata_json
)
SELECT
    t.id,
    'opening_balance',
    CASE WHEN COALESCE(t.credits, 0) >= 0 THEN 'credit' ELSE 'debit' END,
    COALESCE(t.credits, 0),
    COALESCE(t.credits, 0),
    'tenant_migration',
    'ترحيل الرصيد الافتتاحي من tenants.credits',
    '{"source":"tenants.credits"}'
FROM tenants t
WHERE COALESCE(t.credits, 0) != 0
  AND NOT EXISTS (
      SELECT 1
      FROM billing_ledger bl
      WHERE bl.tenant_id = t.id
        AND bl.entry_type = 'opening_balance'
        AND bl.related_type = 'tenant_migration'
  );
