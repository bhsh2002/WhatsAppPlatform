-- ============================================
-- Migration 001: Initial Schema
-- ============================================
-- This captures the existing schema as the baseline migration.
-- It uses CREATE TABLE IF NOT EXISTS so it's safe to run on existing databases.

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Warning', 'Suspended')),
    tier TEXT DEFAULT '1K',
    credits INTEGER DEFAULT 0,
    quality TEXT DEFAULT 'High' CHECK(quality IN ('High', 'Medium', 'Low')),
    phone_number_id TEXT,
    access_token TEXT,
    webhook_secret TEXT,
    waba_id TEXT,
    business_id TEXT,
    dataset_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Messages log table
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    direction TEXT CHECK(direction IN ('incoming', 'outgoing')),
    recipient TEXT,
    sender TEXT,
    message_type TEXT,
    content TEXT,
    status TEXT DEFAULT 'pending',
    wamid TEXT,
    error_message TEXT,
    media_id TEXT,
    media_url TEXT,
    media_mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

-- Contacts table for profile information
CREATE TABLE IF NOT EXISTS contacts (
    phone TEXT PRIMARY KEY,
    profile_name TEXT,
    profile_picture_url TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Webhook logs table
CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    event_type TEXT,
    payload TEXT,
    processed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

-- Activity log for dashboard
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    tenant_name TEXT,
    event_type TEXT,
    description TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'user',
    tenant_id INTEGER,
    is_active INTEGER DEFAULT 1,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

-- Templates table for message templates
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    language TEXT DEFAULT 'ar',
    category TEXT DEFAULT 'UTILITY',
    header_type TEXT DEFAULT 'none' CHECK(header_type IN ('none', 'text', 'image', 'video', 'document')),
    header_content TEXT,
    body TEXT NOT NULL,
    footer TEXT,
    buttons TEXT,
    variables TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'pending', 'approved', 'rejected')),
    meta_template_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Tenant API settings table
CREATE TABLE IF NOT EXISTS tenant_api_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER UNIQUE NOT NULL,
    webhook_url TEXT,
    webhook_secret TEXT,
    api_key TEXT UNIQUE,
    callback_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Conversion events table for Conversions API tracking
CREATE TABLE IF NOT EXISTS conversion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    dataset_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_time DATETIME NOT NULL,
    phone TEXT,
    wamid TEXT,
    custom_data TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'local_only')),
    meta_response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_api_settings_key ON tenant_api_settings(api_key);
CREATE INDEX IF NOT EXISTS idx_conversion_events_tenant ON conversion_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_name ON conversion_events(event_name);
CREATE INDEX IF NOT EXISTS idx_conversion_events_created ON conversion_events(created_at)
