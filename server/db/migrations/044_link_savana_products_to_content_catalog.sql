-- Make products imported through Savana Connect available to Messenger Bot and
-- Facebook Content Studio without creating a second isolated product catalog.

ALTER TABLE bot_products ADD COLUMN savana_projection_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_products_savana_projection
    ON bot_products(tenant_id, savana_projection_key)
    WHERE savana_projection_key IS NOT NULL AND savana_projection_key != '';
