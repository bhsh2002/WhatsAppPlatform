-- Native service enrollment only: no central installation, owner authority,
-- publisher credential, read grant or business operation is established here.
CREATE TABLE savana_operational_consumer_enrollments (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
    organization_id TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL,
    center_origin TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    public_key_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('prepared', 'inflight', 'unknown', 'completed', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    response_json TEXT,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TRIGGER savana_consumer_enrollment_binding_immutable
BEFORE UPDATE OF tenant_id, organization_id, external_tenant_id, center_origin,
    encrypted_private_key, request_json, request_sha256, public_key_fingerprint
ON savana_operational_consumer_enrollments
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.organization_id IS NOT OLD.organization_id
    OR NEW.external_tenant_id IS NOT OLD.external_tenant_id OR NEW.center_origin IS NOT OLD.center_origin
    OR NEW.encrypted_private_key IS NOT OLD.encrypted_private_key OR NEW.request_json IS NOT OLD.request_json
    OR NEW.request_sha256 IS NOT OLD.request_sha256 OR NEW.public_key_fingerprint IS NOT OLD.public_key_fingerprint
BEGIN
    SELECT RAISE(ABORT, 'consumer enrollment binding is immutable');
END;
CREATE TABLE savana_operational_consumer_enrollment_audit (
    id INTEGER PRIMARY KEY,
    enrollment_id TEXT NOT NULL REFERENCES savana_operational_consumer_enrollments(id) ON DELETE RESTRICT,
    actor_user_id INTEGER NOT NULL,
    session_reference TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_savana_consumer_enrollment_audit
    ON savana_operational_consumer_enrollment_audit(enrollment_id, id);
