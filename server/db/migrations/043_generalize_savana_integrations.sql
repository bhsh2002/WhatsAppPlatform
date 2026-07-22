-- Generalize Savana integration records for direct platform-to-platform links.

ALTER TABLE savana_integrations ADD COLUMN webhook_secret_encrypted TEXT;
ALTER TABLE savana_product_projection ADD COLUMN shelf_code TEXT;

CREATE TABLE IF NOT EXISTS savana_service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    integration_id INTEGER NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    request_kind TEXT NOT NULL CHECK(request_kind IN ('order_notification', 'contact_reference', 'campaign')),
    request_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK(status IN ('pending_review', 'approved', 'sent', 'dismissed', 'failed')),
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(integration_id, request_key),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (integration_id) REFERENCES savana_integrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_savana_service_requests_tenant
    ON savana_service_requests(tenant_id, status);
