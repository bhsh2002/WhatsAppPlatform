-- Retained evidence of a real native-user/Core-actor identity link. This is
-- neither a business permission nor a capability/source delegation grant.
CREATE TABLE savana_native_owner_proofs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    native_auth_version INTEGER NOT NULL CHECK(native_auth_version >= 0),
    native_role TEXT NOT NULL CHECK(native_role = 'tenant'),
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    oidc_issuer TEXT NOT NULL,
    oidc_client_id TEXT NOT NULL,
    identity_generation TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE UNIQUE INDEX idx_savana_native_owner_current
    ON savana_native_owner_proofs(tenant_id,user_id,native_auth_version,central_actor_id,organization_id,oidc_issuer,oidc_client_id)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_savana_native_owner_actor
    ON savana_native_owner_proofs(tenant_id,organization_id,central_actor_id);
CREATE TRIGGER savana_native_owner_proof_immutable
BEFORE UPDATE OF user_id,tenant_id,native_auth_version,native_role,central_actor_id,organization_id,oidc_issuer,oidc_client_id,identity_generation,verified_at
ON savana_native_owner_proofs
WHEN (NEW.user_id IS NOT OLD.user_id AND NEW.user_id IS NOT NULL)
    OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.native_auth_version IS NOT OLD.native_auth_version
    OR NEW.native_role IS NOT OLD.native_role OR NEW.central_actor_id IS NOT OLD.central_actor_id
    OR NEW.organization_id IS NOT OLD.organization_id OR NEW.oidc_issuer IS NOT OLD.oidc_issuer
    OR NEW.oidc_client_id IS NOT OLD.oidc_client_id OR NEW.identity_generation IS NOT OLD.identity_generation OR NEW.verified_at IS NOT OLD.verified_at
BEGIN SELECT RAISE(ABORT,'native owner evidence is immutable'); END;
CREATE TRIGGER savana_native_owner_proof_withdrawn
BEFORE UPDATE OF revoked_at ON savana_native_owner_proofs
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at
BEGIN SELECT RAISE(ABORT,'withdrawn native evidence cannot be restored'); END;
CREATE TABLE savana_native_owner_proof_audit (
    id INTEGER PRIMARY KEY,
    proof_id INTEGER NOT NULL REFERENCES savana_native_owner_proofs(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('identity_verified','identity_withdrawn')),
    created_at TEXT NOT NULL
);
