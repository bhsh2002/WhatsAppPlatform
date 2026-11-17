-- Older imports synthesized LYD/zero when pricing metadata was absent. Keep
-- the read model and identity, but quarantine it from bot/content activation
-- until the authoritative projection provides an explicit price and currency.
UPDATE bot_products
SET price = (
        SELECT CASE
            WHEN trim(CAST(projection.price AS TEXT)) NOT GLOB '*[^0-9.]*'
              AND trim(CAST(projection.price AS TEXT)) NOT LIKE '%.%.%'
              AND trim(CAST(projection.price AS TEXT)) GLOB '*[0-9]*'
            THEN projection.price ELSE NULL END
        FROM savana_product_projection projection
        WHERE projection.tenant_id = bot_products.tenant_id
          AND projection.projection_key = bot_products.savana_projection_key
    ),
    currency = (
        SELECT projection.currency FROM savana_product_projection projection
        WHERE projection.tenant_id = bot_products.tenant_id
          AND projection.projection_key = bot_products.savana_projection_key
    ),
    is_active = 0,
    availability = 'hidden',
    approval_status = 'draft',
    updated_at = datetime('now', 'localtime')
WHERE savana_projection_key IS NOT NULL AND savana_projection_key != ''
  AND NOT EXISTS (
      SELECT 1 FROM savana_product_projection projection
      WHERE projection.tenant_id = bot_products.tenant_id
        AND projection.projection_key = bot_products.savana_projection_key
        AND projection.price IS NOT NULL
        AND trim(CAST(projection.price AS TEXT)) != ''
        -- A cast alone accepts text such as 'abc' as zero. Conservatively
        -- accept nonnegative decimal notation; retain all raw source metadata
        -- in the projection for an explicit mapping or later synchronization.
        AND trim(CAST(projection.price AS TEXT)) NOT GLOB '*[^0-9.]*'
        AND trim(CAST(projection.price AS TEXT)) NOT LIKE '%.%.%'
        AND trim(CAST(projection.price AS TEXT)) GLOB '*[0-9]*'
        AND CAST(projection.price AS REAL) >= 0
        AND projection.currency IS NOT NULL
        AND length(trim(projection.currency)) = 3
        AND upper(trim(projection.currency)) NOT GLOB '*[^A-Z]*'
  );
