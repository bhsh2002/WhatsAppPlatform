-- ============================================
-- Migration 011: Critical Performance Indexes
-- ============================================
-- Adds indexes that were missing after migration 008 and for hot paths

-- Index for message status updates (hot path)
CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages(wamid);

-- Index for conversation queries (hot path)
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone ON contacts(tenant_id, phone);

-- Index for credential lookups
CREATE INDEX IF NOT EXISTS idx_tenants_phone_number_id ON tenants(phone_number_id);

-- Index for webhook logging
CREATE INDEX IF NOT EXISTS idx_webhook_logs_tenant ON webhook_logs(tenant_id, created_at);

-- Index for user tenant lookups
CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON users(tenant_id, is_active);