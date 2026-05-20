-- ============================================
-- Migration 031: Messenger bot product gallery images
-- ============================================

CREATE TABLE IF NOT EXISTS bot_product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    alt_text TEXT,
    sort_order INTEGER DEFAULT 0,
    is_primary INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES bot_products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bot_product_images_product ON bot_product_images(product_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_bot_product_images_tenant ON bot_product_images(tenant_id, product_id);

INSERT INTO bot_product_images (tenant_id, product_id, image_url, alt_text, sort_order, is_primary)
SELECT tenant_id, id, image_url, name, 0, 1
FROM bot_products
WHERE image_url IS NOT NULL
  AND image_url != ''
  AND NOT EXISTS (
      SELECT 1
      FROM bot_product_images
      WHERE bot_product_images.product_id = bot_products.id
        AND bot_product_images.image_url = bot_products.image_url
  );
