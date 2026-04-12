-- ============================================
-- Migration 003: Schema Hardening
-- ============================================
-- Adds critical missing indexes and constraints.

-- Critical index: wamid is used in WHERE clause on every webhook status update
CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages(wamid);

-- Unique constraint: prevent duplicate templates per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_tenant_name ON templates(tenant_id, name);

-- Index for faster message thread lookups
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- Index for webhook log processing
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed ON webhook_logs(processed)
