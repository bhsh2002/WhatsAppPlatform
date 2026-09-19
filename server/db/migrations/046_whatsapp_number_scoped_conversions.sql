-- Keep number-specific Meta settings and conversion history isolated when one
-- tenant controls multiple WhatsApp Business phone numbers.

ALTER TABLE tenant_whatsapp_numbers ADD COLUMN dataset_id TEXT;

UPDATE tenant_whatsapp_numbers
SET dataset_id = (
    SELECT tenants.dataset_id
    FROM tenants
    WHERE tenants.id = tenant_whatsapp_numbers.tenant_id
)
WHERE is_default = 1 AND dataset_id IS NULL;

ALTER TABLE conversion_events ADD COLUMN phone_number_id TEXT;

UPDATE conversion_events
SET phone_number_id = (
    SELECT tenant_whatsapp_numbers.phone_number_id
    FROM tenant_whatsapp_numbers
    WHERE tenant_whatsapp_numbers.tenant_id = conversion_events.tenant_id
      AND tenant_whatsapp_numbers.is_default = 1
    LIMIT 1
)
WHERE phone_number_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversion_events_tenant_number
    ON conversion_events(tenant_id, phone_number_id, created_at);
