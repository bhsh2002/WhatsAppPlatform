-- Every native writer advances the same CRM revision, including imports and
-- ordinary owner edits. Collaborative changes compare this actual revision.
ALTER TABLE contacts ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1 CHECK(source_revision >= 1);
CREATE TRIGGER contacts_source_revision
AFTER UPDATE OF phone,profile_name,profile_picture_url,label,notes ON contacts
WHEN NEW.phone IS NOT OLD.phone OR NEW.profile_name IS NOT OLD.profile_name
 OR NEW.profile_picture_url IS NOT OLD.profile_picture_url OR NEW.label IS NOT OLD.label OR NEW.notes IS NOT OLD.notes
BEGIN
 UPDATE contacts SET source_revision=OLD.source_revision+1 WHERE id=NEW.id AND tenant_id=NEW.tenant_id;
END;

-- A local mutation and its recovery fact are committed atomically. Sensitive
-- source results remain encrypted; a lost process reply never permits replay.
CREATE TABLE savana_native_action_facts (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 native_idempotency_key TEXT NOT NULL UNIQUE,
 request_sha256 TEXT NOT NULL,
 action TEXT NOT NULL,
 resource_ref TEXT NOT NULL,
 source_revision INTEGER,
 scope_json TEXT NOT NULL,
 encrypted_result TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX savana_native_action_facts_tenant ON savana_native_action_facts(tenant_id,action,resource_ref);
CREATE TRIGGER savana_native_action_fact_immutable BEFORE UPDATE ON savana_native_action_facts
BEGIN SELECT RAISE(ABORT,'native_action_fact_immutable'); END;
