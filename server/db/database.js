import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, 'platform.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Run migrations first (before CREATE TABLE IF NOT EXISTS statements)
// This handles adding columns to existing tables
try {
  // Check if users table exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();

  if (tableExists) {
    // Users table migrations
    const userColumns = db.prepare("PRAGMA table_info(users)").all();
    const userColumnNames = userColumns.map(c => c.name);

    if (!userColumnNames.includes('tenant_id')) {
      db.exec('ALTER TABLE users ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)');
      console.log('[DB] Added tenant_id column to users table');
    }
  }

  // Check if tenants table exists and add waba_id column
  const tenantsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'").get();

  if (tenantsTableExists) {
    const tenantColumns = db.prepare("PRAGMA table_info(tenants)").all();
    const tenantColumnNames = tenantColumns.map(c => c.name);

    if (!tenantColumnNames.includes('waba_id')) {
      db.exec('ALTER TABLE tenants ADD COLUMN waba_id TEXT');
      console.log('[DB] Added waba_id column to tenants table');
    }
  }

  // Check if messages table exists
  const messagesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get();

  if (messagesTableExists) {
    const messageColumns = db.prepare("PRAGMA table_info(messages)").all();
    const messageColumnNames = messageColumns.map(c => c.name);

    if (!messageColumnNames.includes('media_id')) {
      db.exec('ALTER TABLE messages ADD COLUMN media_id TEXT');
    }
    if (!messageColumnNames.includes('media_url')) {
      db.exec('ALTER TABLE messages ADD COLUMN media_url TEXT');
    }
    if (!messageColumnNames.includes('media_mime_type')) {
      db.exec('ALTER TABLE messages ADD COLUMN media_mime_type TEXT');
    }
  }
} catch (e) {
  console.log('[DB] Migration note:', e.message);
}

// Create tables (IF NOT EXISTS means they won't modify existing tables)
db.exec(`
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

  -- Users table for authentication (note: CHECK constraint won't be updated on existing table)
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

  -- Create indexes for better performance
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
`);

// Helper function to generate API key
export const generateApiKey = () => {
  return 'wp_' + crypto.randomBytes(32).toString('hex');
};

// Sample data insertion disabled by default
// const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get();
// if (tenantCount.count === 0) { ... }

export default db;


