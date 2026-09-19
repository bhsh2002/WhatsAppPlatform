import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(testDirectory, '..', 'db', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort();
const migration = name => fs.readFileSync(path.join(migrationsDirectory, name), 'utf8');
const migration051 = '051_savana_product_snapshot_state.sql';

test('migration 051 creates isolated snapshot state with integration cascades', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const file of migrationFiles.filter(file => file < migration051)) {
        database.exec(migration(file));
    }
    database.prepare(`
        INSERT INTO tenants (id, name, phone, status)
        VALUES (1, 'Snapshot migration tenant', '218910000001', 'Active')
    `).run();
    database.prepare(`
        INSERT INTO savana_integrations (
            id, tenant_id, platform_code, connection_id, status
        ) VALUES (10, 1, 'catalog', 'connection-10', 'active')
    `).run();

    database.exec(migration(migration051));
    database.prepare(`
        INSERT INTO savana_product_snapshot_streams (
            integration_id, event_type, latest_snapshot_id, latest_generated_at
        ) VALUES (10, 'catalog.product_snapshot.v1', 'snapshot-1', '2026-08-16T10:00:00Z')
    `).run();
    database.prepare(`
        INSERT INTO savana_product_snapshot_pages (
            integration_id, event_type, snapshot_id, page_number,
            page_count, complete, products_json
        ) VALUES (10, 'catalog.product_snapshot.v1', 'snapshot-1', 1, 1, 1, '[]')
    `).run();
    database.prepare(`
        INSERT INTO savana_product_snapshot_memberships (
            integration_id, event_type, projection_key, snapshot_id, is_active
        ) VALUES (10, 'catalog.product_snapshot.v1', 'sku:one', 'snapshot-1', 1)
    `).run();
    assert.equal(database.pragma('foreign_key_check').length, 0);

    database.prepare('DELETE FROM savana_integrations WHERE id = 10').run();
    for (const table of [
        'savana_product_snapshot_streams',
        'savana_product_snapshot_pages',
        'savana_product_snapshot_memberships',
    ]) {
        assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0);
    }
    assert.equal(database.pragma('foreign_key_check').length, 0);
    database.close();
});
