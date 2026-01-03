import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, 'platform.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
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

  -- Users table for authentication
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'viewer')),
    is_active INTEGER DEFAULT 1,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Create indexes for better performance
  CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
  CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
`);

// Migration: Add new columns to existing messages table if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(messages)").all();
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes('media_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN media_id TEXT');
  }
  if (!columnNames.includes('media_url')) {
    db.exec('ALTER TABLE messages ADD COLUMN media_url TEXT');
  }
  if (!columnNames.includes('media_mime_type')) {
    db.exec('ALTER TABLE messages ADD COLUMN media_mime_type TEXT');
  }
} catch (e) {
  // Columns already exist or table is new
}

// Sample data insertion disabled by default
// const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get();
// if (tenantCount.count === 0) { ... }

export default db;
