-- ============================================
-- Migration 017: Automation Rules
-- ============================================
-- Auto-reply engine: keyword matching, welcome messages, away messages.

-- Automation rules table
CREATE TABLE IF NOT EXISTS automation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK(rule_type IN ('keyword', 'welcome', 'away')),
    channel TEXT NOT NULL DEFAULT 'all' CHECK(channel IN ('all', 'whatsapp', 'messenger')),
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

    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

-- Cooldown tracking table
CREATE TABLE IF NOT EXISTS automation_cooldowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    contact_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    last_triggered_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE,
    UNIQUE(rule_id, contact_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_tenant ON automation_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_active ON automation_rules(is_active, rule_type);
CREATE INDEX IF NOT EXISTS idx_automation_cooldowns_lookup ON automation_cooldowns(rule_id, contact_id, channel);
