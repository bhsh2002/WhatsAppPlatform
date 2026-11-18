-- Native service enrollment uses actual Core actor/source-owner proof, never
-- an invented WA user or the legacy PKCE-user audit table. No grants are added.
CREATE TABLE savana_native_enrollment_service_audit (
    id INTEGER PRIMARY KEY,
    enrollment_id TEXT NOT NULL REFERENCES savana_operational_consumer_enrollments(id) ON DELETE RESTRICT,
    tenant_id INTEGER NOT NULL,
    organization_id TEXT NOT NULL,
    central_actor_id TEXT NOT NULL,
    authority_revision TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('prepared','dispatch_started','completed','unknown','failed','registration_reconciled','registration_extended')),
    state TEXT NOT NULL CHECK(state IN ('prepared','inflight','unknown','completed','failed')),
    created_at TEXT NOT NULL
);
CREATE INDEX idx_savana_native_enrollment_service_audit
    ON savana_native_enrollment_service_audit(enrollment_id,id);
CREATE TRIGGER savana_native_enrollment_service_audit_immutable
BEFORE UPDATE ON savana_native_enrollment_service_audit
BEGIN SELECT RAISE(ABORT,'native enrollment service audit is immutable'); END;
CREATE TRIGGER savana_native_enrollment_service_audit_retained
BEFORE DELETE ON savana_native_enrollment_service_audit
BEGIN SELECT RAISE(ABORT,'native enrollment service audit is retained'); END;
