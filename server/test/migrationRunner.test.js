import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getMigrationStatusSync, runMigrationsSync } from '../db/migrator.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(testDirectory, '..', 'db', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort();

const createDatabase = () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    return db;
};

const tableExists = (db, name) => Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
`).get(name));

const prepareMigrationTracking = db => {
    db.exec(`
        CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            applied_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);
};

const applyTrackedMigration = (db, file) => {
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8');
    db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    })();
};

test('migration SQL rolls back when its tracking row cannot be committed', () => {
    const db = createDatabase();
    prepareMigrationTracking(db);
    db.exec(`
        CREATE TRIGGER fail_migration_tracking
        BEFORE INSERT ON _migrations
        BEGIN
            SELECT RAISE(ABORT, 'forced migration tracking failure');
        END
    `);

    assert.throws(
        () => runMigrationsSync(db),
        /forced migration tracking failure/
    );
    assert.equal(tableExists(db, 'tenants'), false);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM _migrations').get().count, 0);
    db.close();
});

test('latest migration upgrades a tracked production-like snapshot without data loss', () => {
    const latestMigration = '045_savana_integration_outbox.sql';
    assert.equal(migrationFiles.at(-1), latestMigration);

    const db = createDatabase();
    prepareMigrationTracking(db);

    const billingMigrationIndex = migrationFiles.indexOf('027_billing_system.sql');
    const latestMigrationIndex = migrationFiles.indexOf(latestMigration);
    for (const file of migrationFiles.slice(0, billingMigrationIndex)) {
        applyTrackedMigration(db, file);
    }

    db.prepare(`
        INSERT INTO tenants (id, name, phone, credits)
        VALUES (41, 'upgrade tenant', '218910000041', 73)
    `).run();
    db.prepare(`
        INSERT INTO tenant_pages (id, tenant_id, page_id, page_name)
        VALUES (77, 41, 'page-77', 'Upgrade page')
    `).run();
    db.prepare(`
        INSERT INTO automation_rules (
            id, tenant_id, name, rule_type, channel, target_page_id, response_text
        ) VALUES (91, 41, 'upgrade rule', 'comment_reply', 'facebook', 77, 'reply')
    `).run();
    db.prepare(`
        INSERT INTO automation_cooldowns (
            id, rule_id, contact_id, channel, last_triggered_at
        ) VALUES (92, 91, 'contact-92', 'facebook', '2026-07-12 12:00:00')
    `).run();

    for (const file of migrationFiles.slice(billingMigrationIndex, latestMigrationIndex)) {
        applyTrackedMigration(db, file);
    }
    db.prepare(`
        INSERT INTO data_deletion_requests (
            id, confirmation_code_hash, subject_hash, status, records_deleted
        ) VALUES (93, 'confirmation-hash', 'subject-hash', 'completed', 4)
    `).run();

    const result = runMigrationsSync(db);

    assert.deepEqual(result, {
        applied: 1,
        skipped: migrationFiles.length - 1,
    });
    assert.deepEqual(getMigrationStatusSync(db), {
        total: migrationFiles.length,
        applied: migrationFiles.length,
        pending: 0,
    });
    assert.equal(
        db.prepare(`
            SELECT COUNT(*) count
            FROM _migrations
            WHERE length(checksum) = 64
        `).get().count,
        migrationFiles.length
    );
    assert.deepEqual(
        db.prepare('SELECT id, name, credits FROM tenants WHERE id = 41').get(),
        { id: 41, name: 'upgrade tenant', credits: 73 }
    );
    assert.deepEqual(
        db.prepare(`
            SELECT wallet_balance_credits, status
            FROM tenant_billing_accounts
            WHERE tenant_id = 41
        `).get(),
        { wallet_balance_credits: 73, status: 'active' }
    );
    assert.deepEqual(
        db.prepare(`
            SELECT credits_delta, balance_after_credits
            FROM billing_ledger
            WHERE tenant_id = 41 AND related_type = 'tenant_migration'
        `).get(),
        { credits_delta: 73, balance_after_credits: 73 }
    );
    assert.deepEqual(
        db.prepare(`
            SELECT tenant_id, target_page_id, is_active
            FROM automation_rules
            WHERE id = 91
        `).get(),
        { tenant_id: 41, target_page_id: 77, is_active: 1 }
    );
    assert.deepEqual(
        db.prepare(`
            SELECT rule_id, contact_id, last_triggered_at
            FROM automation_cooldowns
            WHERE id = 92
        `).get(),
        {
            rule_id: 91,
            contact_id: 'contact-92',
            last_triggered_at: '2026-07-12 12:00:00',
        }
    );
    assert.deepEqual(
        db.prepare(`
            SELECT status, records_deleted
            FROM data_deletion_requests
            WHERE id = 93
        `).get(),
        { status: 'completed', records_deleted: 4 }
    );
    assert.equal(tableExists(db, 'facebook_content_settings'), true);
    assert.equal(tableExists(db, 'facebook_content_items'), true);
    assert.equal(tableExists(db, 'facebook_content_campaigns'), true);
    assert.equal(tableExists(db, 'facebook_content_publications'), true);
    assert.equal(tableExists(db, 'facebook_content_ai_generations'), true);
    assert.equal(tableExists(db, 'facebook_comment_reply_templates'), true);
    assert.equal(tableExists(db, 'facebook_comment_followups'), true);
    assert.equal(tableExists(db, 'savana_integrations'), true);
    assert.equal(tableExists(db, 'savana_integration_events'), true);
    assert.equal(tableExists(db, 'savana_product_projection'), true);
    assert.equal(tableExists(db, 'savana_pos_transactions'), true);
    assert.equal(tableExists(db, 'savana_notification_candidates'), true);
    assert.equal(
        db.pragma('table_info(bot_products)')
            .some(column => column.name === 'approval_status'),
        true
    );
    assert.equal(
        db.pragma('table_info(facebook_content_items)')
            .some(column => column.name === 'source_post_id'),
        true
    );
    assert.deepEqual(
        db.prepare(`
            SELECT channel, operation_type, unit_price_credits
            FROM billing_price_items
            WHERE operation_key = 'facebook.ai_generation'
        `).get(),
        { channel: 'facebook', operation_type: 'ai_generation', unit_price_credits: 5 }
    );
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.deepEqual(runMigrationsSync(db), {
        applied: 0,
        skipped: migrationFiles.length,
    });
    db.prepare(`
        UPDATE _migrations
        SET checksum = ?
        WHERE name = '001_initial_schema.sql'
    `).run('0'.repeat(64));
    assert.throws(
        () => runMigrationsSync(db),
        /Checksum mismatch for applied migration: 001_initial_schema\.sql/
    );
    db.close();
});
