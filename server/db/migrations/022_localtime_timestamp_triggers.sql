-- ============================================
-- Migration 022: Localtime timestamp compatibility triggers
-- ============================================
-- Existing SQLite databases keep their original column defaults after older
-- migrations have already run. These triggers correct future inserts on
-- legacy tables that still default to UTC CURRENT_TIMESTAMP.

CREATE TRIGGER IF NOT EXISTS trg_tenants_localtime_insert
AFTER INSERT ON tenants
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE tenants
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_localtime_insert
AFTER INSERT ON messages
WHEN NEW.created_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE messages SET created_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_contacts_localtime_insert
AFTER INSERT ON contacts
WHEN NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE contacts SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_webhook_logs_localtime_insert
AFTER INSERT ON webhook_logs
WHEN NEW.created_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE webhook_logs SET created_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_activity_logs_localtime_insert
AFTER INSERT ON activity_logs
WHEN NEW.created_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE activity_logs SET created_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_users_localtime_insert
AFTER INSERT ON users
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE users
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_templates_localtime_insert
AFTER INSERT ON templates
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE templates
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_api_settings_localtime_insert
AFTER INSERT ON tenant_api_settings
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE tenant_api_settings
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_conversion_events_localtime_insert
AFTER INSERT ON conversion_events
WHEN NEW.created_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE conversion_events SET created_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_revoked_tokens_localtime_insert
AFTER INSERT ON revoked_tokens
WHEN NEW.revoked_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE revoked_tokens SET revoked_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_webhook_failures_localtime_insert
AFTER INSERT ON webhook_failures
WHEN NEW.created_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE webhook_failures SET created_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_pages_localtime_insert
AFTER INSERT ON tenant_pages
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE tenant_pages
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_fb_conversations_localtime_insert
AFTER INSERT ON fb_conversations
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE fb_conversations
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_fb_messages_localtime_insert
AFTER INSERT ON fb_messages
WHEN NEW.created_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE fb_messages SET created_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_broadcast_jobs_localtime_insert
AFTER INSERT ON broadcast_jobs
WHEN NEW.created_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE broadcast_jobs SET created_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_automation_rules_localtime_insert
AFTER INSERT ON automation_rules
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE automation_rules
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_automation_cooldowns_localtime_insert
AFTER INSERT ON automation_cooldowns
WHEN NEW.last_triggered_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE automation_cooldowns SET last_triggered_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;
