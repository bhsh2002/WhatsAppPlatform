-- Dedicated ControlCenter cookie sessions, never an OIDC token or read grant.
-- Immutable intent history survives local JWT/portal-session changes.
CREATE TABLE savana_owner_portal_sessions (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    session_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL,
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    portal_origin TEXT NOT NULL,
    generation TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('authorizing','connected','revoked','failed')),
    encrypted_cookie TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_savana_owner_portal_principal
    ON savana_owner_portal_sessions(tenant_id,user_id,session_hash,auth_version,created_at);
CREATE TABLE savana_owner_portal_intents (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    session_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL,
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    encrypted_request TEXT NOT NULL,
    encrypted_result TEXT,
    state TEXT NOT NULL CHECK(state IN ('prepared','inflight','unknown','completed','failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id,central_actor_id,organization_id,idempotency_key)
);
CREATE INDEX idx_savana_owner_portal_unresolved
    ON savana_owner_portal_intents(tenant_id,central_actor_id,organization_id,state);
CREATE TRIGGER savana_owner_portal_intent_immutable
BEFORE UPDATE OF tenant_id,user_id,session_hash,auth_version,central_actor_id,organization_id,
    operation,idempotency_key,input_sha256,request_sha256,encrypted_request ON savana_owner_portal_intents
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.user_id IS NOT OLD.user_id
    OR NEW.session_hash IS NOT OLD.session_hash OR NEW.auth_version IS NOT OLD.auth_version
    OR NEW.central_actor_id IS NOT OLD.central_actor_id OR NEW.organization_id IS NOT OLD.organization_id
    OR NEW.operation IS NOT OLD.operation OR NEW.idempotency_key IS NOT OLD.idempotency_key
    OR NEW.input_sha256 IS NOT OLD.input_sha256
    OR NEW.request_sha256 IS NOT OLD.request_sha256 OR NEW.encrypted_request IS NOT OLD.encrypted_request
BEGIN SELECT RAISE(ABORT,'owner portal intent is immutable'); END;
CREATE TABLE savana_owner_portal_audit (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    central_actor_id TEXT,
    organization_id TEXT,
    session_reference TEXT NOT NULL,
    resource_reference TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
);
