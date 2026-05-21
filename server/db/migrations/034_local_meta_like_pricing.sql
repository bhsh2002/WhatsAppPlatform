-- ============================================
-- Migration 034: Local Meta-like pricing modes
-- ============================================

ALTER TABLE billing_price_items ADD COLUMN local_pricing_model TEXT DEFAULT 'fixed';
ALTER TABLE billing_price_items ADD COLUMN local_pricing_description TEXT;

UPDATE billing_price_items
SET local_pricing_model = 'meta_like',
    local_pricing_description = 'يتبع قواعد WhatsApp Meta: service مجاني، utility داخل نافذة 24 ساعة مجاني، وCTWA خلال 72 ساعة مجاني.'
WHERE operation_key IN (
    'whatsapp.text',
    'whatsapp.template',
    'whatsapp.media',
    'whatsapp.interactive',
    'whatsapp.broadcast_recipient',
    'whatsapp.contact_verification_template'
);
