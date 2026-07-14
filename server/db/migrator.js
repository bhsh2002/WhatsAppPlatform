import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const listMigrationFiles = () => {
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) return [];
    return fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
};

const migrationChecksum = (migrationsDir, file) => createHash('sha256')
    .update(fs.readFileSync(path.join(migrationsDir, file)))
    .digest('hex');

const ensureMigrationChecksumColumn = db => {
    const columns = db.pragma('table_info(_migrations)');
    if (!columns.some(column => column.name === 'checksum')) {
        db.exec('ALTER TABLE _migrations ADD COLUMN checksum TEXT');
    }
};

const verifyAndBackfillMigrationChecksums = (db, checksums) => {
    const appliedRows = db.prepare('SELECT name, checksum FROM _migrations').all();
    const missingChecksums = [];

    for (const row of appliedRows) {
        const expectedChecksum = checksums.get(row.name);
        if (!expectedChecksum) {
            throw new Error(`[Migrator] Applied migration file is missing: ${row.name}`);
        }
        if (row.checksum && row.checksum !== expectedChecksum) {
            throw new Error(`[Migrator] Checksum mismatch for applied migration: ${row.name}`);
        }
        if (!row.checksum) {
            missingChecksums.push([expectedChecksum, row.name]);
        }
    }

    if (missingChecksums.length > 0) {
        const backfill = db.prepare(`
            UPDATE _migrations
            SET checksum = ?
            WHERE name = ? AND checksum IS NULL
        `);
        db.transaction(rows => {
            for (const row of rows) backfill.run(...row);
        })(missingChecksums);
    }
};

export function getMigrationStatusSync(db) {
    const tableExists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'"
    ).get();
    const files = listMigrationFiles();
    const applied = tableExists
        ? new Set(db.prepare('SELECT name FROM _migrations').all().map(row => row.name))
        : new Set();
    return {
        total: files.length,
        applied: files.filter(file => applied.has(file)).length,
        pending: files.filter(file => !applied.has(file)).length,
    };
}

// ============================================
// Lightweight Migration Runner for SQLite
// ============================================

/**
 * Run all pending SQL migrations against the database (synchronous).
 * Migrations are .sql files in the migrations/ directory.
 * Applied migrations are tracked in the _migrations table.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ applied: number, skipped: number }}
 */
export function runMigrationsSync(db) {
    // Create migration tracking table
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            checksum TEXT,
            applied_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = listMigrationFiles();
    ensureMigrationChecksumColumn(db);
    const checksums = new Map(
        files.map(file => [file, migrationChecksum(migrationsDir, file)])
    );
    verifyAndBackfillMigrationChecksums(db, checksums);
    if (files.length === 0) {
        return { applied: 0, skipped: 0 };
    }

    // Get already applied migrations
    const applied = new Set(
        db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
    );

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
        if (applied.has(file)) {
            skippedCount++;
            continue;
        }

        console.log(`[Migrator] Applying: ${file}`);
        try {
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

            // Applying the schema change and recording it must be atomic. If the
            // process stops between those operations, the next startup could
            // replay a migration whose schema/data changes already committed.
            const transaction = db.transaction(() => {
                db.exec(sql);
                db.prepare(`
                    INSERT INTO _migrations (name, checksum)
                    VALUES (?, ?)
                `).run(file, checksums.get(file));
            });
            transaction();
            console.log(`[Migrator] Applied: ${file}`);
            appliedCount++;
        } catch (error) {
            console.error(`[Migrator] FAILED: ${file} —`, error.message);
            throw error;
        }
    }

    if (appliedCount > 0) {
        console.log(`[Migrator] Done: ${appliedCount} applied, ${skippedCount} skipped`);
    }

    // Ensure columns exist (safe for re-runs — catches duplicate column errors)
    ensureAutomationColumns(db);

    return { applied: appliedCount, skipped: skippedCount };
}

/**
 * Safely add a column to a table, ignoring "duplicate column" errors.
 */
function safeAddColumn(db, table, column, definition) {
    try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`[Migrator] Added column ${table}.${column}`);
    } catch (err) {
        if (err.message.includes('duplicate column')) {
            // Column already exists — no action needed
        } else {
            throw err;
        }
    }
}

/**
 * Ensure all automation_rules columns exist.
 * Handles cases where migration 018 ran before new columns were added.
 */
function ensureAutomationColumns(db) {
    // Check if automation_rules table exists
    const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='automation_rules'"
    ).get();
    if (!tableExists) return;

    safeAddColumn(db, 'automation_rules', 'target_post_id', 'TEXT');
    safeAddColumn(db, 'automation_rules', 'target_page_id', 'INTEGER');
    safeAddColumn(db, 'automation_rules', 'response_action', "TEXT DEFAULT 'comment'");
    safeAddColumn(db, 'automation_rules', 'dm_text', 'TEXT');
    safeAddColumn(db, 'automation_rules', 'trigger_on', "TEXT DEFAULT 'comment'");
    safeAddColumn(db, 'automation_rules', 'auto_like', 'INTEGER DEFAULT 0');
    safeAddColumn(db, 'automation_rules', 'auto_like_type', "TEXT DEFAULT 'like'");
}
