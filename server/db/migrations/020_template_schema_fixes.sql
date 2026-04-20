-- ============================================
-- Migration 020: Template Schema Fixes
-- ============================================
-- - Remove restrictive status CHECK constraint (allow any Meta status)
-- - Expand header_type to include 'location' and 'gif'
-- - Add quality_score column (HIGH, MEDIUM, LOW, UNKNOWN)
-- - Add parameter_format column (named, positional)
-- - Add composite unique index for language variants (tenant_id, name, language)

CREATE TABLE IF NOT EXISTS templates_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    language TEXT DEFAULT 'ar',
    category TEXT DEFAULT 'UTILITY',
    header_type TEXT DEFAULT 'none',
    header_content TEXT,
    body TEXT NOT NULL,
    footer TEXT,
    buttons TEXT,
    variables TEXT,
    status TEXT DEFAULT 'draft',
    meta_template_id TEXT,
    quality_score TEXT DEFAULT 'UNKNOWN',
    parameter_format TEXT DEFAULT 'positional',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

INSERT INTO templates_new SELECT 
    id, tenant_id, name, language, category, header_type, header_content,
    body, footer, buttons, variables, status, meta_template_id,
    'UNKNOWN', 'positional', created_at, updated_at
FROM templates;

DROP TABLE templates;
ALTER TABLE templates_new RENAME TO templates;

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_tenant_name_lang 
    ON templates(tenant_id, name, language);
