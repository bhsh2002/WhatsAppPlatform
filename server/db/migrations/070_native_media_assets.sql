CREATE TABLE savana_native_media_assets (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 organization_id TEXT NOT NULL,
 scope_json TEXT NOT NULL,
 account_ref TEXT NOT NULL,
 account_fingerprint TEXT NOT NULL,
 created_by_actor TEXT NOT NULL,
 created_by_user INTEGER NOT NULL REFERENCES users(id),
 stage_key TEXT NOT NULL,
 stage_sha256 TEXT NOT NULL,
 filename TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size>0),
 content_sha256 TEXT NOT NULL,
 purpose TEXT NOT NULL,
 rights_reference TEXT NOT NULL,
 rights_valid_until TEXT NOT NULL,
 encrypted_payload TEXT NOT NULL,
 source_revision INTEGER NOT NULL DEFAULT 1 CHECK(source_revision>=1),
 state TEXT NOT NULL CHECK(state IN ('staged','uploading','uploaded','unknown','rejected')),
 upload_effect_id TEXT UNIQUE REFERENCES savana_collaborative_effects(id),
 provider_media_id TEXT,
 provider_receipt_sha256 TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,created_by_user,stage_key)
);
CREATE INDEX savana_native_media_assets_owner ON savana_native_media_assets(tenant_id,account_ref,state,created_at);
CREATE TRIGGER savana_native_media_asset_identity BEFORE UPDATE OF tenant_id,organization_id,scope_json,account_ref,account_fingerprint,
 created_by_actor,created_by_user,stage_key,stage_sha256,filename,mime_type,byte_size,content_sha256,purpose,rights_reference,rights_valid_until,encrypted_payload,created_at
 ON savana_native_media_assets BEGIN SELECT RAISE(ABORT,'native media identity is immutable'); END;
