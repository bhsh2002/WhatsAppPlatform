-- Accept the degraded lifecycle state emitted by Savana Connect.
--
-- SQLite cannot alter a CHECK constraint in place. Preserve the rows in every
-- table that references savana_integrations before replacing the parent table.
-- Emptying the child tables first avoids ON DELETE CASCADE data loss while
-- keeping their schemas, indexes, foreign keys and cascade actions unchanged.

CREATE TEMP TABLE savana_integration_events_050_backup AS
SELECT * FROM savana_integration_events;

CREATE TEMP TABLE savana_integration_outbox_050_backup AS
SELECT * FROM savana_integration_outbox;

CREATE TEMP TABLE savana_service_requests_050_backup AS
SELECT * FROM savana_service_requests;

DELETE FROM savana_integration_events;
DELETE FROM savana_integration_outbox;
DELETE FROM savana_service_requests;

CREATE TABLE savana_integrations_050 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    platform_code TEXT NOT NULL,
    organization_id TEXT,
    local_platform_tenant_id TEXT,
    remote_platform_tenant_id TEXT,
    remote_external_tenant_id TEXT,
    connection_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'disconnected'
        CHECK(status IN (
            'disconnected',
            'pending_authorization',
            'active',
            'paused',
            'degraded',
            'revoked',
            'error'
        )),
    scopes_json TEXT NOT NULL DEFAULT '[]',
    entitlement_payload_json TEXT,
    entitlement_signature TEXT,
    entitlement_valid_until TEXT,
    last_sync_at TEXT,
    last_error TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    webhook_secret_encrypted TEXT,
    UNIQUE(tenant_id, platform_code),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

INSERT INTO savana_integrations_050 (
    id,
    tenant_id,
    platform_code,
    organization_id,
    local_platform_tenant_id,
    remote_platform_tenant_id,
    remote_external_tenant_id,
    connection_id,
    status,
    scopes_json,
    entitlement_payload_json,
    entitlement_signature,
    entitlement_valid_until,
    last_sync_at,
    last_error,
    created_at,
    updated_at,
    webhook_secret_encrypted
)
SELECT
    id,
    tenant_id,
    platform_code,
    organization_id,
    local_platform_tenant_id,
    remote_platform_tenant_id,
    remote_external_tenant_id,
    connection_id,
    status,
    scopes_json,
    entitlement_payload_json,
    entitlement_signature,
    entitlement_valid_until,
    last_sync_at,
    last_error,
    created_at,
    updated_at,
    webhook_secret_encrypted
FROM savana_integrations;

DROP TABLE savana_integrations;
ALTER TABLE savana_integrations_050 RENAME TO savana_integrations;

CREATE INDEX idx_savana_integrations_tenant
    ON savana_integrations(tenant_id);

INSERT INTO savana_integration_events (
    id,
    integration_id,
    event_id,
    idempotency_key,
    event_type,
    payload_json,
    status,
    error_message,
    received_at,
    processed_at
)
SELECT
    id,
    integration_id,
    event_id,
    idempotency_key,
    event_type,
    payload_json,
    status,
    error_message,
    received_at,
    processed_at
FROM savana_integration_events_050_backup;

INSERT INTO savana_integration_outbox (
    id,
    integration_id,
    event_id,
    idempotency_key,
    event_type,
    payload_json,
    status,
    attempts,
    available_at,
    locked_at,
    published_at,
    last_error,
    created_at,
    updated_at
)
SELECT
    id,
    integration_id,
    event_id,
    idempotency_key,
    event_type,
    payload_json,
    status,
    attempts,
    available_at,
    locked_at,
    published_at,
    last_error,
    created_at,
    updated_at
FROM savana_integration_outbox_050_backup;

INSERT INTO savana_service_requests (
    id,
    tenant_id,
    integration_id,
    event_id,
    request_kind,
    request_key,
    payload_json,
    status,
    created_at,
    updated_at
)
SELECT
    id,
    tenant_id,
    integration_id,
    event_id,
    request_kind,
    request_key,
    payload_json,
    status,
    created_at,
    updated_at
FROM savana_service_requests_050_backup;

DROP TABLE savana_integration_events_050_backup;
DROP TABLE savana_integration_outbox_050_backup;
DROP TABLE savana_service_requests_050_backup;
