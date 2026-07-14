import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { configureDatabaseConnection } from './configure.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const databasePath = process.env.DATABASE_PATH
    ? resolve(process.env.DATABASE_PATH)
    : join(__dirname, 'platform.db');
const db = new Database(databasePath);

// Configure durability and lock contention before running migrations.
configureDatabaseConnection(db, {
    busyTimeoutMs: process.env.SQLITE_BUSY_TIMEOUT_MS,
});

// Run database migrations
import { runMigrationsSync } from './migrator.js';
runMigrationsSync(db);

// Sample data insertion disabled by default
// const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get();
// if (tenantCount.count === 0) { ... }

export default db;
