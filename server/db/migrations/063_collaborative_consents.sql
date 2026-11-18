CREATE TABLE savana_collaborative_consents (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('sms', 'whatsapp', 'messenger', 'native')),
    account_ref TEXT NOT NULL,
    account_fingerprint TEXT NOT NULL,
    recipient_ref TEXT NOT NULL,
    recipient_fingerprint TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose IN ('service_response', 'transactional', 'marketing', 'customer_service', 'business_record', 'correction')),
    evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('owner_recorded', 'native_inbound', 'signed_source')),
    evidence_json TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    recorded_by_actor TEXT NOT NULL,
    recorded_by_user INTEGER REFERENCES users(id),
    recorded_at TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    revoked_at TEXT,
    revoked_by_actor TEXT,
    operation_key TEXT NOT NULL,
    operation_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, operation_key)
);
CREATE INDEX idx_savana_collaborative_consent_scope
    ON savana_collaborative_consents(tenant_id, scope_hash, channel, account_ref, recipient_ref, purpose);
CREATE TABLE savana_collaborative_consent_audit (
    id TEXT PRIMARY KEY,
    consent_id TEXT NOT NULL REFERENCES savana_collaborative_consents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('recorded', 'revoked')),
    actor_id TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    UNIQUE(consent_id, version)
);
