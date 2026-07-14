-- Add real ownership constraints while preserving global rules (tenant_id NULL),
-- cooldown state and the local-time insert trigger.

-- Orphaned tenant rules must never become active global rules.
UPDATE automation_rules
SET is_active = 0, tenant_id = NULL
WHERE tenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tenants WHERE tenants.id = automation_rules.tenant_id);

UPDATE automation_rules
SET target_page_id = NULL
WHERE target_page_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tenant_pages WHERE tenant_pages.id = automation_rules.target_page_id);

DROP TABLE IF EXISTS automation_cooldowns_039_backup;
CREATE TABLE automation_cooldowns_039_backup (
    id INTEGER PRIMARY KEY,
    rule_id INTEGER NOT NULL,
    contact_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    last_triggered_at DATETIME
);
INSERT INTO automation_cooldowns_039_backup
    (id, rule_id, contact_id, channel, last_triggered_at)
SELECT id, rule_id, contact_id, channel, last_triggered_at FROM automation_cooldowns;

CREATE TABLE automation_rules_039_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK(rule_type IN ('keyword', 'welcome', 'away', 'comment_reply')),
    channel TEXT NOT NULL DEFAULT 'all' CHECK(channel IN ('all', 'whatsapp', 'messenger', 'facebook')),
    is_active INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 100,
    match_type TEXT CHECK(match_type IN ('exact', 'contains', 'regex')),
    match_pattern TEXT,
    match_case_sensitive INTEGER DEFAULT 0,
    schedule_days TEXT,
    schedule_start_time TEXT,
    schedule_end_time TEXT,
    schedule_timezone TEXT DEFAULT 'Africa/Tripoli',
    response_type TEXT DEFAULT 'text' CHECK(response_type IN ('text', 'template')),
    response_text TEXT,
    response_template_name TEXT,
    response_template_language TEXT DEFAULT 'ar',
    cooldown_seconds INTEGER DEFAULT 300,
    trigger_count INTEGER DEFAULT 0,
    last_triggered_at DATETIME,
    target_post_id TEXT,
    target_page_id INTEGER,
    response_action TEXT DEFAULT 'comment' CHECK(response_action IN ('comment', 'dm', 'both')),
    dm_text TEXT,
    trigger_on TEXT DEFAULT 'comment' CHECK(trigger_on IN ('comment', 'reaction', 'both')),
    auto_like INTEGER DEFAULT 0,
    auto_like_type TEXT DEFAULT 'like',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (target_page_id) REFERENCES tenant_pages(id) ON DELETE SET NULL
);

INSERT INTO automation_rules_039_new (
    id, tenant_id, name, rule_type, channel, is_active, priority,
    match_type, match_pattern, match_case_sensitive,
    schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
    response_type, response_text, response_template_name, response_template_language,
    cooldown_seconds, trigger_count, last_triggered_at,
    target_post_id, target_page_id, response_action, dm_text, trigger_on,
    auto_like, auto_like_type, created_at, updated_at
)
SELECT
    id, tenant_id, name, rule_type, channel, is_active, priority,
    match_type, match_pattern, match_case_sensitive,
    schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
    response_type, response_text, response_template_name, response_template_language,
    cooldown_seconds, trigger_count, last_triggered_at,
    target_post_id, target_page_id, response_action, dm_text, trigger_on,
    auto_like, auto_like_type, created_at, updated_at
FROM automation_rules;

DROP TABLE automation_rules;
ALTER TABLE automation_rules_039_new RENAME TO automation_rules;

CREATE INDEX idx_automation_rules_tenant ON automation_rules(tenant_id);
CREATE INDEX idx_automation_rules_active ON automation_rules(is_active, rule_type);
CREATE INDEX idx_automation_rules_post ON automation_rules(target_post_id);
CREATE INDEX idx_automation_rules_page ON automation_rules(target_page_id);

INSERT OR REPLACE INTO automation_cooldowns
    (id, rule_id, contact_id, channel, last_triggered_at)
SELECT id, rule_id, contact_id, channel, last_triggered_at
FROM automation_cooldowns_039_backup;
DROP TABLE automation_cooldowns_039_backup;

CREATE TRIGGER trg_automation_rules_localtime_insert
AFTER INSERT ON automation_rules
WHEN NEW.created_at = CURRENT_TIMESTAMP OR NEW.updated_at = CURRENT_TIMESTAMP
BEGIN
    UPDATE automation_rules
    SET
        created_at = CASE WHEN NEW.created_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE created_at END,
        updated_at = CASE WHEN NEW.updated_at = CURRENT_TIMESTAMP THEN datetime('now', 'localtime') ELSE updated_at END
    WHERE id = NEW.id;
END;
