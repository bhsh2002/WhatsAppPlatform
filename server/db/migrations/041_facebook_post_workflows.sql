-- ============================================
-- Migration 041: Facebook post workflows
-- ============================================

ALTER TABLE bot_products
    ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
        CHECK(approval_status IN ('draft', 'approved'));
ALTER TABLE bot_products ADD COLUMN source_linked_page_id INTEGER;
ALTER TABLE bot_products ADD COLUMN source_post_id TEXT;
ALTER TABLE bot_products ADD COLUMN source_post_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_products_source_post
    ON bot_products(tenant_id, source_linked_page_id, source_post_id)
    WHERE source_post_id IS NOT NULL AND source_post_id != '';

ALTER TABLE facebook_content_items ADD COLUMN source_post_id TEXT;
ALTER TABLE facebook_content_items ADD COLUMN source_post_url TEXT;

CREATE INDEX IF NOT EXISTS idx_fb_content_items_source_post
    ON facebook_content_items(tenant_id, linked_page_id, source_post_id, created_at DESC);

-- Rebuild the AI history table so the action constraint can cover the direct
-- post and comment tools while preserving all existing generation history.
ALTER TABLE facebook_content_ai_generations
    RENAME TO facebook_content_ai_generations_040;

CREATE TABLE facebook_content_ai_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER,
    product_id INTEGER,
    source_post_id TEXT,
    source_post_url TEXT,
    action TEXT NOT NULL
        CHECK(action IN (
            'generate',
            'rewrite',
            'variants',
            'improve_cta',
            'hashtags',
            'shorten',
            'tone',
            'comment_reply'
        )),
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    input_text TEXT,
    output_json TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'completed', 'failed', 'refused')),
    error_code TEXT,
    error_message TEXT,
    created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES bot_products(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO facebook_content_ai_generations (
    id, tenant_id, linked_page_id, product_id, action, model, prompt_version,
    input_text, output_json, input_tokens, output_tokens, status, error_code,
    error_message, created_by, created_at
)
SELECT
    id, tenant_id, linked_page_id, product_id, action, model, prompt_version,
    input_text, output_json, input_tokens, output_tokens, status, error_code,
    error_message, created_by, created_at
FROM facebook_content_ai_generations_040;

DROP TABLE facebook_content_ai_generations_040;

CREATE INDEX idx_fb_content_ai_tenant
    ON facebook_content_ai_generations(tenant_id, created_at DESC);
CREATE INDEX idx_fb_content_ai_source_post
    ON facebook_content_ai_generations(
        tenant_id,
        linked_page_id,
        source_post_id,
        created_at DESC
    );

CREATE TABLE facebook_comment_reply_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_fb_comment_templates_tenant_name
    ON facebook_comment_reply_templates(tenant_id, name)
    WHERE linked_page_id IS NULL;
CREATE UNIQUE INDEX idx_fb_comment_templates_page_name
    ON facebook_comment_reply_templates(tenant_id, linked_page_id, name)
    WHERE linked_page_id IS NOT NULL;
CREATE INDEX idx_fb_comment_templates_scope
    ON facebook_comment_reply_templates(tenant_id, linked_page_id, is_active, updated_at DESC);

CREATE TABLE facebook_comment_followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER NOT NULL,
    post_id TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'resolved')),
    note TEXT,
    created_by INTEGER,
    resolved_by INTEGER,
    resolved_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(tenant_id, linked_page_id, comment_id)
);

CREATE INDEX idx_fb_comment_followups_scope
    ON facebook_comment_followups(tenant_id, linked_page_id, status, updated_at DESC);
