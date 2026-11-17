-- Forward correction: preserve 055/056 and all source/event identities. The
-- product-snapshot v1 contract permits an explicit nonnegative decimal with
-- at most three fractional digits and an uppercase three-letter currency.
-- Never reactivate a copy, infer an installation mapping or rewrite sources.
WITH assessed AS (
    SELECT product.id,
        projection.id IS NOT NULL AS source_found,
        projection.price AS source_price,
        projection.currency AS source_currency,
        CASE WHEN projection.price IS NOT NULL
            AND CAST(projection.price AS TEXT) != ''
            AND CAST(projection.price AS TEXT) NOT GLOB '*[^0-9.]*'
            AND CAST(projection.price AS TEXT) NOT LIKE '%.%.%'
            AND CAST(projection.price AS TEXT) GLOB '[0-9]*'
            AND CAST(projection.price AS TEXT) NOT GLOB '0[0-9]*'
            AND (instr(CAST(projection.price AS TEXT), '.') = 0
                OR length(substr(CAST(projection.price AS TEXT),
                    instr(CAST(projection.price AS TEXT), '.') + 1)) BETWEEN 1 AND 3)
            AND CAST(projection.price AS REAL) <= 1.7976931348623157e308
            THEN 1 ELSE 0 END AS price_valid,
        CASE WHEN typeof(projection.currency) = 'text'
            AND length(projection.currency) = 3
            AND projection.currency NOT GLOB '*[^A-Z]*'
            THEN 1 ELSE 0 END AS currency_valid,
        CASE WHEN typeof(product.price) IN ('integer', 'real')
            AND product.price = CAST(projection.price AS REAL)
            AND product.currency = projection.currency
            THEN 1 ELSE 0 END AS copy_matches_source,
        product.is_active,
        product.availability,
        product.savana_projection_key
    FROM bot_products product
    LEFT JOIN savana_product_projection projection
      ON projection.tenant_id = product.tenant_id
     AND projection.projection_key = product.savana_projection_key
    WHERE product.savana_projection_key IS NOT NULL
      AND product.savana_projection_key != ''
), affected AS (
    SELECT * FROM assessed
    WHERE price_valid = 0 OR currency_valid = 0 OR copy_matches_source = 0
)
UPDATE bot_products
SET price = (SELECT CASE WHEN price_valid = 1 THEN source_price ELSE NULL END
             FROM affected WHERE affected.id = bot_products.id),
    currency = (SELECT CASE WHEN currency_valid = 1 THEN source_currency ELSE NULL END
                FROM affected WHERE affected.id = bot_products.id),
    is_active = 0,
    availability = 'hidden',
    approval_status = 'draft',
    updated_at = datetime('now', 'localtime')
WHERE id IN (SELECT id FROM affected);
