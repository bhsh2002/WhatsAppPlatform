-- ============================================
-- Migration 024: Meta review token evidence
-- ============================================
-- Persist token diagnostics and optional review snapshots so readiness can
-- distinguish stored configuration from verified operational evidence.

ALTER TABLE tenants ADD COLUMN facebook_user_token_status TEXT DEFAULT 'unchecked';
ALTER TABLE tenants ADD COLUMN facebook_user_token_expires_at DATETIME;
ALTER TABLE tenants ADD COLUMN facebook_user_token_checked_at DATETIME;
ALTER TABLE tenants ADD COLUMN facebook_user_token_app_id TEXT;

ALTER TABLE tenant_pages ADD COLUMN token_app_id TEXT;
ALTER TABLE tenant_pages ADD COLUMN token_scopes TEXT;

CREATE TABLE IF NOT EXISTS meta_review_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    check_type TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meta_review_checks_tenant ON meta_review_checks(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_review_checks_type ON meta_review_checks(check_type, created_at DESC);
