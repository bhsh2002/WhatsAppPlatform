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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
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
  CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);

// Insert sample data if tables are empty
const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get();
if (tenantCount.count === 0) {
  const insertTenant = db.prepare(`
    INSERT INTO tenants (name, phone, status, tier, credits, quality)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertActivity = db.prepare(`
    INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `);

  // Insert sample tenants
  insertTenant.run('مطاعم القمة', '+966500000001', 'Active', '1K', 500, 'High');
  insertTenant.run('متجر الأزياء', '+966500000002', 'Warning', '1K', 120, 'Medium');
  insertTenant.run('شركة التقنية الحديثة', '+966500000003', 'Active', '10K', 25000, 'High');
  insertTenant.run('خدمات التوصيل السريع', '+966500000004', 'Suspended', '1K', 0, 'Low');
  insertTenant.run('مجموعة العقار الدولية', '+966500000005', 'Active', 'Unlimited', 100000, 'High');

  // Insert sample activities
  insertActivity.run(1, 'مطاعم القمة', 'template_sent', 'إرسال حملة (Template)', 'success', '-2 minutes');
  insertActivity.run(4, 'خدمات التوصيل السريع', 'webhook_update', 'تحديث Webhook', 'error', '-15 minutes');
  insertActivity.run(2, 'متجر الأزياء', 'quality_drop', 'انخفاض الجودة (Quality Drop)', 'warning', '-1 hour');
}

export default db;
