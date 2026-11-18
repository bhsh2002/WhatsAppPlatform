-- Native-owned correlation and authenticated peer receipts. These records are
-- never an authorization grant; current Core/native policy is checked on use.
CREATE TABLE savana_workspace_receipts (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    central_actor_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    native_account_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    receipt_key TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,user_id,central_actor_id,organization_id,native_account_id,kind,receipt_key)
);
CREATE INDEX idx_savana_workspace_receipt_native
ON savana_workspace_receipts(tenant_id,organization_id,kind,receipt_key);
