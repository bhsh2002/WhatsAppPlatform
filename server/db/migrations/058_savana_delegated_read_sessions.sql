-- Local encrypted delegated sessions/PKCE state only. Central requests, grants,
-- field authority and publisher credentials are never established by this DDL.
CREATE TABLE savana_delegated_read_sessions (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL CHECK(auth_version >= 0),
    generation TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('connected', 'revoked', 'expired')),
    encrypted_credentials TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, user_id, session_hash, auth_version)
);
CREATE TABLE savana_delegated_read_flows (
    id TEXT PRIMARY KEY,
    state_hash TEXT UNIQUE NOT NULL,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL CHECK(auth_version >= 0),
    state TEXT NOT NULL CHECK(state IN ('pending', 'exchanging', 'completed', 'unknown', 'failed', 'expired')),
    encrypted_flow TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE savana_operational_owner_sessions (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL CHECK(auth_version >= 0),
    generation TEXT NOT NULL,
    encrypted_session TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, user_id, session_hash, auth_version)
);
CREATE TABLE savana_operational_read_actions (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL CHECK(auth_version >= 0),
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    encrypted_request TEXT NOT NULL,
    encrypted_result TEXT,
    state TEXT NOT NULL CHECK(state IN ('prepared', 'inflight', 'unknown', 'completed', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, user_id, session_hash, auth_version, idempotency_key)
);
CREATE TABLE savana_delegated_read_audit (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER,
    user_id INTEGER,
    session_reference TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_savana_delegated_flows_principal
    ON savana_delegated_read_flows(tenant_id, user_id, session_hash, auth_version, created_at);
CREATE INDEX idx_savana_delegated_audit_reference
    ON savana_delegated_read_audit(session_reference, id);
