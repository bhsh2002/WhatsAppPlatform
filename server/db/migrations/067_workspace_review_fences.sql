-- An issued review is not an attempted business operation. This local fence
-- lets an expired/unusable review be proven unsent, atomically against the
-- first durable dispatch claim. It creates no shared permission or approval.
CREATE TABLE savana_workspace_review_fences (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    native_account_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    context_revision TEXT NOT NULL,
    owner_fingerprint TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('reviewed','claimed','failed')),
    reason_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,central_actor_id,organization_id,idempotency_key)
);
CREATE TRIGGER savana_workspace_review_fence_immutable
BEFORE UPDATE OF tenant_id,user_id,central_actor_id,organization_id,native_account_id,idempotency_key,
    operation,input_sha256,context_revision,owner_fingerprint,expires_at,created_at
ON savana_workspace_review_fences BEGIN SELECT RAISE(ABORT,'workspace review identity is immutable'); END;
CREATE TRIGGER savana_workspace_review_fence_transition
BEFORE UPDATE OF state,reason_code ON savana_workspace_review_fences
WHEN OLD.state <> 'reviewed' OR NEW.state NOT IN ('claimed','failed')
BEGIN SELECT RAISE(ABORT,'workspace review fence is final'); END;
