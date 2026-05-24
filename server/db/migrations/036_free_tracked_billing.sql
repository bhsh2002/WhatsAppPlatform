-- ============================================
-- Migration 036: Free tracked usage and Meta cost basis
-- ============================================

ALTER TABLE billing_price_items ADD COLUMN meta_cost_basis TEXT DEFAULT 'not_applicable';
ALTER TABLE billing_price_items ADD COLUMN tenant_visible_usage INTEGER DEFAULT 1;
ALTER TABLE billing_price_items ADD COLUMN pricing_note TEXT;

ALTER TABLE billing_usage_events ADD COLUMN customer_charge_type TEXT DEFAULT 'paid';
ALTER TABLE billing_usage_events ADD COLUMN tenant_visible_usage INTEGER DEFAULT 1;

UPDATE billing_price_items
SET meta_cost_basis = 'meta_billed',
    pricing_note = 'WhatsApp message pricing follows Meta delivery status and rate card.'
WHERE operation_key IN (
    'whatsapp.text',
    'whatsapp.template',
    'whatsapp.media',
    'whatsapp.interactive',
    'whatsapp.broadcast_recipient',
    'whatsapp.contact_verification_template'
);

UPDATE billing_price_items
SET local_pricing_model = 'free_tracked',
    local_pricing_description = 'Meta-free operation: tracked for usage reports and charged 0 credits by default. Admin can switch to fixed platform fee.',
    meta_cost_basis = 'meta_free',
    unit_price_credits = 0,
    is_billable = 0,
    tenant_visible_usage = 1,
    pricing_note = 'Facebook comment engagement is not directly billed by Meta; default customer charge is 0 credits.'
WHERE operation_key IN (
    'facebook.comment_reply',
    'facebook.comment_hide',
    'facebook.comment_like',
    'facebook.comment_unlike',
    'facebook.comment_delete'
);

UPDATE billing_price_items
SET meta_cost_basis = 'platform_fee',
    pricing_note = 'Local platform fee; not a direct Meta message cost.'
WHERE operation_key IN (
    'messenger.reply',
    'messenger.utility',
    'messenger.bot_reply',
    'facebook.post_create',
    'facebook.post_edit',
    'facebook.post_delete',
    'facebook.photo_post_create',
    'whatsapp.event_conversion'
)
AND COALESCE(meta_cost_basis, 'not_applicable') = 'not_applicable';

UPDATE billing_usage_events
SET customer_charge_type = CASE
        WHEN COALESCE(final_credits, 0) > 0 OR COALESCE(total_credits, 0) > 0 THEN 'paid'
        WHEN meta_charge_status = 'not_charged' THEN 'free_meta'
        ELSE customer_charge_type
    END,
    tenant_visible_usage = 1;

CREATE INDEX IF NOT EXISTS idx_billing_usage_customer_charge_type
    ON billing_usage_events(customer_charge_type);
