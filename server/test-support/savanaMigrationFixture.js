import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const migrationDirectory = new URL('../db/migrations/', import.meta.url);
export const migrationFiles = fs.readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort();
export const migrationText = name => fs.readFileSync(new URL(name, migrationDirectory), 'utf8');

export function applyThrough(database, last) {
    database.pragma('foreign_keys = ON');
    database.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, checksum TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    for (const name of migrationFiles.filter(name => name <= last)) {
        if (database.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)) continue;
        const sql = migrationText(name);
        database.transaction(() => {
            database.exec(sql);
            database.prepare('INSERT INTO _migrations (name, checksum) VALUES (?, ?)')
                .run(name, createHash('sha256').update(sql).digest('hex'));
        }).immediate();
    }
}

export function seedSavanaUpgrade(database) {
    applyThrough(database, '054_meta_page_ownership.sql');
    database.exec(`
        INSERT INTO tenants (id, name, phone) VALUES (1, 'Synthetic upgrade', '218910000001');
        INSERT INTO savana_integrations (id, tenant_id, platform_code, status, connection_id)
        VALUES (1, 1, 'catalog', 'active', 'synthetic-catalog');
        INSERT INTO savana_integration_events (integration_id, event_id, idempotency_key, event_type, payload_json, status)
        VALUES (1, 'source-audit', 'source-audit-key', 'pos.inventory_adjusted.v1',
            '{"synthetic_source_payload":"retain exactly","quantity":"-1"}', 'processed');
        INSERT INTO savana_service_requests (tenant_id, integration_id, event_id, request_kind, request_key, payload_json, status)
        VALUES (1, 1, 'review-before-upgrade', 'notification_request', 'stable-review',
            '{"request_id":"stable-review","message":"synthetic review","consent_asserted":false}', 'approved');
        INSERT INTO bot_products (id, tenant_id, sku, name, price, currency)
        VALUES (1, 1, 'LOCAL', 'Synthetic local', 11, 'USD');
    `);
    const cases = [
        { id: 2, key: 'canonical:valid', price: '12.500', currency: 'USD', copy: 12.5 },
        { id: 3, key: 'canonical:missing-price', price: null, currency: 'USD', copy: 99 },
        { id: 4, key: 'canonical:missing-currency', price: '8', currency: null, copy: 99 },
        { id: 5, key: 'canonical:malformed', price: 'abc', currency: 'USD', copy: 99 },
        { id: 6, key: 'canonical:archived', price: '7', currency: 'USD', copy: 7, active: 0 },
        { id: 7, key: 'canonical:duplicate-a', price: '3', currency: 'USD', copy: 3, barcode: 'same-legacy-barcode' },
        { id: 8, key: 'canonical:duplicate-b', price: '4', currency: 'USD', copy: 4, barcode: 'same-legacy-barcode' },
        { id: 9, key: 'local:orphan', copy: 99, orphan: true },
        { id: 10, key: 'canonical:stale-copy', price: '12', currency: 'USD', copy: 99 },
        { id: 11, key: 'barcode:leading-zero', price: '01.2', currency: 'USD', copy: 1.2 },
        { id: 12, key: 'sku:trailing-dot', price: '12.', currency: 'USD', copy: 12 },
        { id: 13, key: 'canonical:precision', price: '1.2345', currency: 'USD', copy: 1.2345 },
        { id: 14, key: 'canonical:currency-case', price: '5', currency: 'usd', copy: 5 },
        { id: 15, key: 'canonical:too-large', price: '9'.repeat(310), currency: 'USD', copy: 99 },
        { id: 16, key: 'canonical:explicit-zero', price: '0.000', currency: 'USD', copy: 0 },
    ];
    const projection = database.prepare(`INSERT INTO savana_product_projection
        (tenant_id, projection_key, canonical_product_id, local_product_id, barcode, name, price, currency, unit_code)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL)`);
    const product = database.prepare(`INSERT INTO bot_products
        (id, tenant_id, sku, name, price, currency, savana_projection_key, is_active, availability, updated_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, '2026-01-01 00:00:00')`);
    for (const item of cases) {
        if (!item.orphan) projection.run(item.key, item.key.startsWith('canonical:') ? item.key.slice(10) : null,
            `explicit-local-${item.id}`, item.barcode || null, `Synthetic ${item.id}`, item.price, item.currency);
        product.run(item.id, `SYN-${item.id}`, `Synthetic ${item.id}`, item.copy, item.currency || 'LYD',
            item.key, item.active ?? 1, item.active === 0 ? 'hidden' : 'available');
    }
    database.exec(`
        INSERT INTO savana_product_snapshot_memberships (integration_id, event_type, projection_key, snapshot_id, is_active)
        VALUES (1, 'catalog.product_snapshot.v1', 'canonical:archived', 'archived-source', 0);
        INSERT INTO savana_product_snapshot_memberships (integration_id, event_type, projection_key, snapshot_id, is_active)
        VALUES (1, 'catalog.product_snapshot.v1', 'canonical:stale-copy', 'old-active-source', 1);
        INSERT INTO bot_product_images (tenant_id, product_id, image_url, is_primary)
        VALUES (1, 3, 'https://images.invalid/synthetic.jpg', 1);
    `);
    return cases;
}

export const sourceState = database => ({
    projections: database.prepare('SELECT * FROM savana_product_projection ORDER BY id').all(),
    events: database.prepare('SELECT * FROM savana_integration_events ORDER BY id').all(),
    memberships: database.prepare('SELECT * FROM savana_product_snapshot_memberships ORDER BY projection_key').all(),
    images: database.prepare('SELECT * FROM bot_product_images ORDER BY id').all(),
});
