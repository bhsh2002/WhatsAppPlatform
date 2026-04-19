-- ============================================
-- Migration 018: Automation Post Scope
-- ============================================
-- Adds per-post comment auto-reply support to automation rules.
-- Recreates the table to update CHECK constraint for rule_type.

-- Step 1: Create new table with updated schema
CREATE TABLE IF NOT EXISTS automation_rules_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK(rule_type IN ('keyword', 'welcome', 'away', 'comment_reply')),
    channel TEXT NOT NULL DEFAULT 'all' CHECK(channel IN ('all', 'whatsapp', 'messenger', 'facebook')),
    is_active INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 100,

    -- Keyword rule config
    match_type TEXT CHECK(match_type IN ('exact', 'contains', 'regex')),
    match_pattern TEXT,
    match_case_sensitive INTEGER DEFAULT 0,

    -- Away rule config (schedule)
    schedule_days TEXT,
    schedule_start_time TEXT,
    schedule_end_time TEXT,
    schedule_timezone TEXT DEFAULT 'Africa/Tripoli',

    -- Response config
    response_type TEXT DEFAULT 'text' CHECK(response_type IN ('text', 'template')),
    response_text TEXT,
    response_template_name TEXT,
    response_template_language TEXT DEFAULT 'ar',

    -- Cooldown
    cooldown_seconds INTEGER DEFAULT 300,

    -- Stats
    trigger_count INTEGER DEFAULT 0,
    last_triggered_at DATETIME,

    -- Post scoping (comment_reply rules)
    target_post_id TEXT,
    target_page_id INTEGER,
    response_action TEXT DEFAULT 'comment' CHECK(response_action IN ('comment', 'dm', 'both')),
    dm_text TEXT,
    trigger_on TEXT DEFAULT 'comment' CHECK(trigger_on IN ('comment', 'reaction', 'both')),

    -- Auto-like/react to the comment
    auto_like INTEGER DEFAULT 0,
    auto_like_type TEXT DEFAULT 'like',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Copy existing data
INSERT INTO automation_rules_new (
    id, tenant_id, name, rule_type, channel, is_active, priority,
    match_type, match_pattern, match_case_sensitive,
    schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
    response_type, response_text, response_template_name, response_template_language,
    cooldown_seconds, trigger_count, last_triggered_at,
    created_at, updated_at
)
SELECT
    id, tenant_id, name, rule_type, channel, is_active, priority,
    match_type, match_pattern, match_case_sensitive,
    schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
    response_type, response_text, response_template_name, response_template_language,
    cooldown_seconds, trigger_count, last_triggered_at,
    created_at, updated_at
FROM automation_rules;

-- Step 3: Drop old table and rename
DROP TABLE automation_rules;
ALTER TABLE automation_rules_new RENAME TO automation_rules;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_automation_rules_tenant ON automation_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_active ON automation_rules(is_active, rule_type);
CREATE INDEX IF NOT EXISTS idx_automation_rules_post ON automation_rules(target_post_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_page ON automation_rules(target_page_id);
