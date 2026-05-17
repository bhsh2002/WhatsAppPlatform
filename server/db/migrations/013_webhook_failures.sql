-- ============================================
-- Migration 013: Webhook dead-letter queue
-- ============================================
-- Stores failed webhook deliveries for retry/debugging

CREATE TABLE IF NOT EXISTS webhook_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    last_retry_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    resolved_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_failures_tenant ON webhook_failures(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_failures_pending ON webhook_failures(resolved_at);