-- ============================================
-- Migration 040: Facebook Content Studio
-- ============================================

CREATE TABLE IF NOT EXISTS facebook_content_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER,
    timezone TEXT NOT NULL DEFAULT 'Africa/Tripoli',
    language TEXT NOT NULL DEFAULT 'ar',
    tone TEXT NOT NULL DEFAULT 'professional',
    brand_voice TEXT,
    audience TEXT,
    default_cta TEXT,
    required_terms_json TEXT NOT NULL DEFAULT '[]',
    banned_terms_json TEXT NOT NULL DEFAULT '[]',
    hashtags_json TEXT NOT NULL DEFAULT '[]',
    emoji_level TEXT NOT NULL DEFAULT 'light'
        CHECK(emoji_level IN ('none', 'light', 'medium')),
    approval_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK(approval_mode IN ('manual', 'approved_only', 'automatic')),
    allowed_days_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    posting_start_time TEXT NOT NULL DEFAULT '08:00',
    posting_end_time TEXT NOT NULL DEFAULT '22:00',
    daily_post_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_post_limit BETWEEN 1 AND 24),
    no_repeat_days INTEGER NOT NULL DEFAULT 14 CHECK(no_repeat_days BETWEEN 0 AND 365),
    ai_enabled INTEGER NOT NULL DEFAULT 1,
    auto_pause_failures INTEGER NOT NULL DEFAULT 3 CHECK(auto_pause_failures BETWEEN 1 AND 20),
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fb_content_settings_tenant_default
    ON facebook_content_settings(tenant_id)
    WHERE linked_page_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fb_content_settings_page
    ON facebook_content_settings(tenant_id, linked_page_id)
    WHERE linked_page_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS facebook_content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER,
    product_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'manual'
        CHECK(kind IN ('manual', 'product', 'ai')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link_url TEXT,
    media_url TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'review', 'approved', 'archived')),
    source_text TEXT,
    prompt_version TEXT,
    approved_by INTEGER,
    approved_at DATETIME,
    created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES bot_products(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fb_content_items_tenant_status
    ON facebook_content_items(tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_fb_content_items_page
    ON facebook_content_items(linked_page_id, status);
CREATE INDEX IF NOT EXISTS idx_fb_content_items_product
    ON facebook_content_items(product_id);

CREATE TABLE IF NOT EXISTS facebook_content_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    source_mode TEXT NOT NULL DEFAULT 'library'
        CHECK(source_mode IN ('library', 'products', 'mixed')),
    rotation_mode TEXT NOT NULL DEFAULT 'sequential'
        CHECK(rotation_mode IN ('sequential', 'random')),
    product_category TEXT,
    product_template TEXT,
    timezone TEXT NOT NULL DEFAULT 'Africa/Tripoli',
    allowed_days_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    schedule_times_json TEXT NOT NULL DEFAULT '["09:00"]',
    no_repeat_days INTEGER NOT NULL DEFAULT 14 CHECK(no_repeat_days BETWEEN 0 AND 365),
    max_posts_per_day INTEGER NOT NULL DEFAULT 2 CHECK(max_posts_per_day BETWEEN 1 AND 24),
    approval_required INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'active', 'paused', 'completed')),
    cursor_position INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    next_run_at DATETIME,
    last_run_at DATETIME,
    last_error TEXT,
    created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fb_content_campaigns_due
    ON facebook_content_campaigns(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_fb_content_campaigns_tenant
    ON facebook_content_campaigns(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS facebook_content_campaign_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    content_item_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 100),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES facebook_content_campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (content_item_id) REFERENCES facebook_content_items(id) ON DELETE CASCADE,
    UNIQUE(campaign_id, content_item_id)
);

CREATE INDEX IF NOT EXISTS idx_fb_content_campaign_items_order
    ON facebook_content_campaign_items(campaign_id, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS facebook_content_publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER NOT NULL,
    campaign_id INTEGER,
    content_item_id INTEGER,
    product_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'processing', 'published', 'failed', 'skipped', 'cancelled')),
    scheduled_for DATETIME NOT NULL,
    next_attempt_at DATETIME,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 10),
    claimed_at DATETIME,
    claimed_by TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    rendered_message TEXT,
    link_url TEXT,
    media_url TEXT,
    meta_post_id TEXT,
    error_code TEXT,
    error_message TEXT,
    published_at DATETIME,
    created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES facebook_content_campaigns(id) ON DELETE SET NULL,
    FOREIGN KEY (content_item_id) REFERENCES facebook_content_items(id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES bot_products(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fb_content_publications_due
    ON facebook_content_publications(status, next_attempt_at, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_fb_content_publications_tenant
    ON facebook_content_publications(tenant_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_fb_content_publications_campaign
    ON facebook_content_publications(campaign_id, status, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS facebook_content_ai_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    linked_page_id INTEGER,
    product_id INTEGER,
    action TEXT NOT NULL
        CHECK(action IN ('generate', 'rewrite', 'variants')),
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

CREATE INDEX IF NOT EXISTS idx_fb_content_ai_tenant
    ON facebook_content_ai_generations(tenant_id, created_at DESC);

INSERT OR IGNORE INTO billing_price_items (
    operation_key,
    channel,
    operation_type,
    display_name_ar,
    unit_price_credits,
    is_billable,
    is_active,
    local_pricing_model,
    local_pricing_description,
    meta_cost_basis,
    tenant_visible_usage,
    pricing_note
) VALUES (
    'facebook.ai_generation',
    'facebook',
    'ai_generation',
    'توليد أو إعادة صياغة محتوى Facebook',
    5,
    1,
    1,
    'fixed',
    'رسوم منصة ثابتة لكل طلب توليد أو إعادة صياغة مكتمل.',
    'platform_fee',
    1,
    'تكلفة تشغيل مساعد المحتوى وليست تكلفة تفرضها Meta.'
);
