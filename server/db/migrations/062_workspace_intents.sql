-- Outgoing OIDC-guided workspace mutations; no grants or native business facts.
CREATE TABLE savana_workspace_intents (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    session_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL,
    native_role TEXT NOT NULL,
    native_expires_at TEXT NOT NULL,
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    native_account_id TEXT NOT NULL,
    identity_generation TEXT NOT NULL,
    identity_expires_at TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    encrypted_request TEXT NOT NULL,
    encrypted_result TEXT,
    state TEXT NOT NULL CHECK(state IN ('prepared','inflight','unknown','completed','failed')),
    error_code TEXT,
    remote_status INTEGER,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id,central_actor_id,organization_id,idempotency_key)
);
CREATE INDEX idx_savana_workspace_unresolved
    ON savana_workspace_intents(tenant_id,central_actor_id,organization_id,state);
CREATE INDEX idx_savana_workspace_owner
    ON savana_workspace_intents(tenant_id,user_id,central_actor_id,organization_id,created_at);
CREATE TRIGGER savana_workspace_intent_immutable
BEFORE UPDATE OF id,tenant_id,user_id,session_hash,auth_version,native_role,native_expires_at,
    central_actor_id,organization_id,native_account_id,identity_generation,identity_expires_at,
    operation,idempotency_key,input_sha256,request_sha256,encrypted_request,created_at
ON savana_workspace_intents
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.user_id IS NOT OLD.user_id
    OR NEW.session_hash IS NOT OLD.session_hash OR NEW.auth_version IS NOT OLD.auth_version
    OR NEW.native_role IS NOT OLD.native_role OR NEW.native_expires_at IS NOT OLD.native_expires_at
    OR NEW.central_actor_id IS NOT OLD.central_actor_id OR NEW.organization_id IS NOT OLD.organization_id
    OR NEW.native_account_id IS NOT OLD.native_account_id OR NEW.identity_generation IS NOT OLD.identity_generation
    OR NEW.identity_expires_at IS NOT OLD.identity_expires_at OR NEW.operation IS NOT OLD.operation
    OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.input_sha256 IS NOT OLD.input_sha256
    OR NEW.request_sha256 IS NOT OLD.request_sha256 OR NEW.encrypted_request IS NOT OLD.encrypted_request
    OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'workspace intent is immutable'); END;
CREATE TRIGGER savana_workspace_intent_transition
BEFORE UPDATE OF state,encrypted_result,error_code,remote_status,finished_at ON savana_workspace_intents
WHEN OLD.state IN ('completed','failed')
    OR NOT ((OLD.state='prepared' AND NEW.state IN ('inflight','unknown','completed','failed'))
        OR (OLD.state='inflight' AND NEW.state IN ('completed','failed','unknown'))
        OR (OLD.state='unknown' AND NEW.state IN ('completed','failed')))
BEGIN SELECT RAISE(ABORT,'workspace intent transition is forbidden'); END;
CREATE TABLE savana_workspace_intent_audit (
    id INTEGER PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES savana_workspace_intents(id) ON DELETE RESTRICT,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
);
