import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, 'platform.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Run database migrations
import { runMigrationsSync } from './migrator.js';
runMigrationsSync(db);

// Helper function to generate API key
export const generateApiKey = () => {
  return 'wp_' + crypto.randomBytes(32).toString('hex');
};

// Sample data insertion disabled by default
// const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get();
// if (tenantCount.count === 0) { ... }

export default db;


