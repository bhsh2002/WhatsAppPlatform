-- ============================================
-- Migration 035: WhatsApp Meta cost-plus customer pricing
-- ============================================

INSERT OR IGNORE INTO billing_settings (key, value, description)
VALUES
    ('credit_value_lyd', '0.1', 'قيمة credit واحد بالدينار الليبي عند تحويل تكلفة Meta إلى رصيد العميل'),
    ('meta_cost_margin_percent', '20', 'هامش الربح الافتراضي فوق تكلفة Meta قبل تحويلها إلى credits'),
    ('strict_meta_rate_required', 'true', 'منع إرسال رسائل WhatsApp المدفوعة عندما لا توجد rate card مطابقة'),
    ('whatsapp_pricing_source_priority', 'status_webhook_then_estimate', 'مصدر قرار تسعير WhatsApp: status webhook أولا ثم التقدير المحلي');

ALTER TABLE billing_usage_events ADD COLUMN reserved_credits INTEGER DEFAULT 0;
ALTER TABLE billing_usage_events ADD COLUMN final_credits INTEGER DEFAULT 0;
ALTER TABLE billing_usage_events ADD COLUMN meta_cost_lyd REAL DEFAULT 0;
ALTER TABLE billing_usage_events ADD COLUMN customer_charge_lyd REAL DEFAULT 0;
ALTER TABLE billing_usage_events ADD COLUMN customer_service_window_open INTEGER;
ALTER TABLE billing_usage_events ADD COLUMN ctwa_free_entry_open INTEGER;
ALTER TABLE billing_usage_events ADD COLUMN template_category_sent TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_pricing_category TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_pricing_type TEXT;
ALTER TABLE billing_usage_events ADD COLUMN meta_billable INTEGER;
ALTER TABLE billing_usage_events ADD COLUMN pricing_decision_reason TEXT;
ALTER TABLE billing_usage_events ADD COLUMN billing_formula_json TEXT;

UPDATE billing_price_items
SET local_pricing_model = 'meta_cost_plus_credits',
    local_pricing_description = 'يتم الحجز تقديريا، ثم الخصم النهائي عند delivered/read حسب تكلفة Meta + هامش، مع تحويلها إلى credits.'
WHERE operation_key IN (
    'whatsapp.text',
    'whatsapp.template',
    'whatsapp.media',
    'whatsapp.interactive',
    'whatsapp.broadcast_recipient',
    'whatsapp.contact_verification_template'
);
