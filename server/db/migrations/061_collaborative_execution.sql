-- A reviewed source request is not a provider receipt. Keep execution authority,
-- immutable content/account approval and uncertain effects separate from ingress.
CREATE TABLE savana_collaborative_executions (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    request_id INTEGER UNIQUE REFERENCES savana_service_requests(id) ON DELETE CASCADE,
    source_command_id TEXT,
    source_command_version INTEGER,
    source_fingerprint TEXT,
    capability_code TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    selection_hash TEXT NOT NULL,
    selection_json TEXT NOT NULL,
    resources_json TEXT NOT NULL DEFAULT '{}',
    authorization_json TEXT NOT NULL,
    principal_json TEXT NOT NULL,
    approved_by INTEGER REFERENCES users(id),
    approval_version INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL CHECK(state IN (
        'approved', 'scheduled', 'paused', 'executing',
        'completed', 'failed', 'unknown', 'cancelled'
    )),
    idempotency_key TEXT,
    execution_hash TEXT,
    scheduled_for TEXT,
    started_at TEXT,
    finished_at TEXT,
    result_json TEXT,
    result_outbox_event_id TEXT,
    result_publication_state TEXT NOT NULL DEFAULT 'pending'
        CHECK(result_publication_state IN ('pending', 'queued', 'published')),
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, idempotency_key),
    UNIQUE(source_command_id, source_command_version)
);
CREATE INDEX idx_savana_collaborative_schedule
    ON savana_collaborative_executions(state, scheduled_for);
CREATE INDEX idx_savana_collaborative_tenant
    ON savana_collaborative_executions(tenant_id, state);

CREATE TABLE savana_collaborative_effects (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES savana_collaborative_executions(id) ON DELETE CASCADE,
    effect_key TEXT NOT NULL,
    native_kind TEXT NOT NULL,
    native_id TEXT,
    native_idempotency_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('prepared', 'dispatching', 'accepted', 'rejected', 'unknown')),
    billing_usage_id INTEGER,
    receipt_json TEXT,
    error_code TEXT,
    reconcile_cursor TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(execution_id, effect_key)
);

-- Collaborative publications are claimed by their execution ledger and must
-- never be replayed by the ordinary scheduled-publication recovery worker.
ALTER TABLE facebook_content_publications ADD COLUMN collaborative_execution_id TEXT
    REFERENCES savana_collaborative_executions(id);
CREATE UNIQUE INDEX idx_facebook_publication_collaborative_execution
    ON facebook_content_publications(collaborative_execution_id)
    WHERE collaborative_execution_id IS NOT NULL;
ALTER TABLE broadcast_jobs ADD COLUMN collaborative_execution_id TEXT
    REFERENCES savana_collaborative_executions(id);
CREATE UNIQUE INDEX idx_broadcast_collaborative_execution
    ON broadcast_jobs(collaborative_execution_id)
    WHERE collaborative_execution_id IS NOT NULL;

CREATE TABLE savana_collaborative_nonces (
    nonce TEXT PRIMARY KEY,
    request_sha256 TEXT NOT NULL,
    consumed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX idx_savana_collaborative_nonce_expiry
    ON savana_collaborative_nonces(expires_at);

CREATE TABLE savana_collaborative_command_receipts (
    command_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version >= 1),
    fingerprint TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    execution_id TEXT NOT NULL UNIQUE REFERENCES savana_collaborative_executions(id),
    command_json TEXT NOT NULL,
    context_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('executing', 'applied', 'not_applied', 'rejected', 'conflict', 'pending', 'unknown')),
    receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(command_id, version)
);

CREATE TRIGGER savana_collaborative_command_identity_immutable
BEFORE UPDATE OF command_id,version,fingerprint,attempt_id,tenant_id,execution_id,command_json,context_json,created_at
ON savana_collaborative_command_receipts
WHEN NEW.command_id IS NOT OLD.command_id OR NEW.version IS NOT OLD.version
    OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.attempt_id IS NOT OLD.attempt_id
    OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.execution_id IS NOT OLD.execution_id
    OR NEW.command_json IS NOT OLD.command_json OR NEW.context_json IS NOT OLD.context_json
    OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'collaborative_command_identity_immutable'); END;
CREATE TRIGGER savana_collaborative_effect_identity_immutable
BEFORE UPDATE OF execution_id,effect_key,native_kind,native_idempotency_key,created_at ON savana_collaborative_effects
WHEN NEW.execution_id IS NOT OLD.execution_id OR NEW.effect_key IS NOT OLD.effect_key
    OR NEW.native_kind IS NOT OLD.native_kind OR NEW.native_idempotency_key IS NOT OLD.native_idempotency_key
    OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'collaborative_effect_identity_immutable'); END;

-- Provider callbacks may settle a lost HTTP acknowledgement only when they
-- prove this exact, pre-dispatch native account/recipient/command capture.
CREATE TABLE savana_collaborative_correlations (
    effect_id TEXT PRIMARY KEY REFERENCES savana_collaborative_effects(id),
    channel TEXT NOT NULL CHECK(channel IN ('whatsapp','messenger')),
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    account_ref TEXT NOT NULL,
    account_fingerprint TEXT NOT NULL,
    recipient_sha256 TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    token_sha256 TEXT NOT NULL UNIQUE,
    encrypted_mac_key TEXT NOT NULL,
    encrypted_capture TEXT NOT NULL,
    billing_usage_id INTEGER REFERENCES billing_usage_events(id),
    created_at TEXT NOT NULL
);
CREATE TABLE savana_collaborative_provider_evidence (
    id TEXT PRIMARY KEY,
    effect_id TEXT NOT NULL REFERENCES savana_collaborative_effects(id),
    provider_id TEXT NOT NULL,
    provider_status TEXT NOT NULL,
    webhook_sha256 TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE(effect_id,provider_id,provider_status)
);
CREATE TRIGGER savana_collaborative_correlation_immutable BEFORE UPDATE ON savana_collaborative_correlations
BEGIN SELECT RAISE(ABORT, 'collaborative_correlation_immutable'); END;
