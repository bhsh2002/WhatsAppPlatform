-- Token health columns for tenants
ALTER TABLE tenants ADD COLUMN token_status TEXT DEFAULT 'unchecked';
ALTER TABLE tenants ADD COLUMN token_expires_at DATETIME;
ALTER TABLE tenants ADD COLUMN token_checked_at DATETIME;

-- Token health columns for tenant_pages
ALTER TABLE tenant_pages ADD COLUMN token_status TEXT DEFAULT 'unchecked';
ALTER TABLE tenant_pages ADD COLUMN token_expires_at DATETIME;
ALTER TABLE tenant_pages ADD COLUMN token_checked_at DATETIME;

-- Broadcast jobs table for async processing
CREATE TABLE IF NOT EXISTS broadcast_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    status TEXT DEFAULT 'pending',
    template_name TEXT,
    template_language TEXT,
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    progress_pct REAL DEFAULT 0,
    results TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_tenant ON broadcast_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_status ON broadcast_jobs(status);