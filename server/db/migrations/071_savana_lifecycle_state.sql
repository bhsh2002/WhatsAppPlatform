-- Internal ordering cursor only. Existing connection keys, event history,
-- entitlements and grants are untouched; old connections have unknown versions.
CREATE TABLE savana_lifecycle_state (
    connection_id TEXT PRIMARY KEY NOT NULL,
    integration_id INTEGER NOT NULL REFERENCES savana_integrations(id) ON DELETE CASCADE,
    lifecycle_version INTEGER CHECK(lifecycle_version IS NULL OR (typeof(lifecycle_version) = 'integer' AND lifecycle_version >= 0 AND lifecycle_version <= 9007199254740991)),
    binding_sha256 TEXT NOT NULL CHECK(length(binding_sha256) = 64),
    snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256) = 64),
    binding_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending_authorization','active','paused','degraded','revoked','rejected','error','disconnected')),
    scopes_json TEXT NOT NULL,
    pending_cleanup_version INTEGER CHECK(pending_cleanup_version IS NULL OR (typeof(pending_cleanup_version) = 'integer' AND pending_cleanup_version >= 0 AND pending_cleanup_version <= 9007199254740991)),
    pending_cleanup_sha256 TEXT CHECK(pending_cleanup_sha256 IS NULL OR length(pending_cleanup_sha256) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((pending_cleanup_version IS NULL) = (pending_cleanup_sha256 IS NULL))
);
CREATE INDEX idx_savana_lifecycle_state_integration ON savana_lifecycle_state(integration_id,connection_id);
