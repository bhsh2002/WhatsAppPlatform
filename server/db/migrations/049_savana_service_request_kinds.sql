-- Add explicit command kinds while preserving existing reviewed requests.

CREATE TABLE savana_service_requests_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    integration_id INTEGER NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    request_kind TEXT NOT NULL CHECK(request_kind IN (
        'order_notification',
        'contact_reference',
        'campaign',
        'notification_request',
        'campaign_request',
        'content_publication'
    )),
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

INSERT INTO savana_service_requests_v2 (
    id, tenant_id, integration_id, event_id, request_kind, request_key,
    payload_json, status, created_at, updated_at
)
SELECT
    id, tenant_id, integration_id, event_id, request_kind, request_key,
    payload_json, status, created_at, updated_at
FROM savana_service_requests;

DROP TABLE savana_service_requests;
ALTER TABLE savana_service_requests_v2 RENAME TO savana_service_requests;

CREATE INDEX idx_savana_service_requests_tenant
    ON savana_service_requests(tenant_id, status);
