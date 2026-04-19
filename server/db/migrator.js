import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        return { applied: 0, skipped: 0 };
    }

    // Get all migration files sorted by name
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

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

            // Split by semicolons, strip comment-only lines, filter empty
            const statements = sql
                .split(';')
                .map(s => s.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim())
                .filter(s => s.length > 0);

            const transaction = db.transaction(() => {
                for (const stmt of statements) {
                    db.exec(stmt);
                }
            });
            transaction();

            db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
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
