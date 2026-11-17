import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createMessengerBotProductsRouter } from '../routes/messengerBotProducts.js';
import { SavanaIntegrationService } from '../services/savanaIntegration.js';

const migrationsDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const createDatabase = t => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const file of fs.readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
        database.exec(fs.readFileSync(path.join(migrationsDirectory, file), 'utf8'));
    }
    database.exec(`
        INSERT INTO tenants (id, name, phone, status) VALUES
            (1, 'Synthetic A', '218910000001', 'Active'),
            (2, 'Synthetic B', '218910000002', 'Active');
        INSERT INTO bot_products (id, tenant_id, sku, name, price, currency, savana_projection_key)
        VALUES (1, 1, 'SHARED', 'Shared product', 8, 'USD', 'canonical:shared-a'),
               (2, 1, 'LOCAL', 'Local product', 5, 'USD', NULL),
               (3, 2, 'OTHER', 'Other activity', 7, 'USD', 'canonical:shared-b');
        INSERT INTO bot_product_images (tenant_id, product_id, image_url, is_primary)
        VALUES (1, 1, 'https://images.test/shared.jpg', 1);
    `);
    t.after(() => database.close());
    return database;
};

const invoke = (router, method, routePath, request = {}) => {
    const handler = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods?.[method])
        .route.stack.at(-1).handle;
    const res = {
        statusCode: 200,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; },
    };
    handler({ user: { role: 'tenant', tenant_id: 1 }, body: {}, query: {}, params: {}, ...request }, res);
    return res;
};

test('shared product list explains local read-only state within the current tenant', t => {
    const database = createDatabase(t);
    const router = createMessengerBotProductsRouter({ database });
    const response = invoke(router, 'get', '/products');
    const shared = response.body.find(row => row.id === 1);
    assert.equal(response.body.length, 2);
    assert.equal(shared.savana_projection_key, 'canonical:shared-a');
    assert.deepEqual(shared.integration_management, {
        read_only: true,
        reason_code: 'shared_change_contract_unavailable',
        change_request_available: false,
    });
    assert.equal(response.body.find(row => row.id === 2).integration_management, null);
});

test('patch and deletion cannot mutate synchronized fields or images, including attempted detachment', t => {
    const database = createDatabase(t);
    const router = createMessengerBotProductsRouter({ database });
    const before = database.prepare('SELECT * FROM bot_products WHERE id = 1').get();
    const update = invoke(router, 'patch', '/products/:id', {
        params: { id: '1' },
        body: { savana_projection_key: null, name: 'Overwrite', price: 100, images: [] },
    });
    const deletion = invoke(router, 'delete', '/products/:id', { params: { id: '1' } });
    const duplicateCreate = invoke(router, 'post', '/products', { body: { sku: 'SHARED', name: 'Overwrite by create' } });
    for (const response of [update, deletion, duplicateCreate]) {
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.code, 'SHARED_PRODUCT_READ_ONLY');
    }
    assert.deepEqual(database.prepare('SELECT * FROM bot_products WHERE id = 1').get(), before);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bot_product_images WHERE product_id = 1').get().count, 1);
    assert.equal(invoke(router, 'patch', '/products/:id', { params: { id: '3' }, body: { name: 'Steal' } }).statusCode, 404);
    assert.equal(invoke(router, 'delete', '/products/:id', { params: { id: '3' } }).statusCode, 404);
    const local = invoke(router, 'patch', '/products/:id', { params: { id: '2' }, body: { name: 'Local edit' } });
    assert.equal(local.statusCode, 200);
    assert.equal(local.body.name, 'Local edit');
});

test('CSV updates local products while explicitly reporting skipped shared products', t => {
    const database = createDatabase(t);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-shared-products-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'synthetic.csv');
    fs.writeFileSync(file, 'sku,name,price,currency\nSHARED,Forbidden overwrite,90,LYD\nLOCAL,Allowed local edit,11,USD\n');
    const router = createMessengerBotProductsRouter({ database, cleanupUploadedFile: value => fs.unlinkSync(value) });
    const response = invoke(router, 'post', '/products/import', { file: { path: file } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.imported, 1);
    assert.equal(response.body.skipped, 1);
    assert.equal(response.body.skipped_managed, 1);
    assert.equal(response.body.code, 'SHARED_PRODUCTS_SKIPPED');
    assert.equal(database.prepare('SELECT name FROM bot_products WHERE id = 1').get().name, 'Shared product');
    assert.equal(database.prepare('SELECT name FROM bot_products WHERE id = 2').get().name, 'Allowed local edit');
    assert.equal(fs.existsSync(file), false);
});

test('synchronization rejects SKU-only identity adoption and preserves both local and shared rows', t => {
    const database = createDatabase(t);
    const service = new SavanaIntegrationService({ database, config: {}, fetchImpl: async () => { throw new Error('No network allowed'); } });
    for (const sku of ['LOCAL', 'SHARED']) {
        assert.throws(() => database.transaction(() => service.upsertProduct(1, {
            canonical_product_id: `other-${sku}`, sku, name: 'Incoming conflicting identity',
            price: 99, currency: 'USD',
        }, '2026-11-17T09:00:00Z'))(), error => error.code === 'product_identity_conflict');
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_product_projection').get().count, 0);
    assert.equal(database.prepare('SELECT name FROM bot_products WHERE id = 1').get().name, 'Shared product');
    assert.equal(database.prepare('SELECT name FROM bot_products WHERE id = 2').get().name, 'Local product');
    assert.equal(database.prepare('SELECT savana_projection_key FROM bot_products WHERE id = 2').get().savana_projection_key, null);
});


test('equal barcodes cannot merge different explicit local product identities', t => {
    const database = createDatabase(t);
    const service = new SavanaIntegrationService({ database, config: {}, fetchImpl: async () => { throw new Error('No network allowed'); } });
    service.upsertProduct(1, {
        local_product_id: 'source-product-a', barcode: '1234567890', name: 'Original identity',
        price: 10, currency: 'USD',
    }, '2026-11-17T09:00:00Z');
    assert.throws(() => service.upsertProduct(1, {
        local_product_id: 'source-product-b', barcode: '1234567890', name: 'Unlinked identity',
        price: 90, currency: 'USD',
    }, '2026-11-17T09:01:00Z'), error => error.code === 'product_identity_conflict');
    const stored = database.prepare('SELECT * FROM savana_product_projection WHERE projection_key = ?').get('barcode:1234567890');
    assert.equal(stored.local_product_id, 'source-product-a');
    assert.equal(stored.name, 'Original identity');
});


test('missing price or currency stays unknown and cannot activate a bot product', t => {
    const database = createDatabase(t);
    const service = new SavanaIntegrationService({ database, config: {}, fetchImpl: async () => { throw new Error('No network allowed'); } });
    service.applyProductSnapshot(1, { complete: true, products: [
        { canonical_product_id: 'missing-currency', name: 'No currency', price: 12, is_active: true },
        { canonical_product_id: 'missing-price', name: 'No price', currency: 'USD', is_active: true },
        { canonical_product_id: 'explicit-free', name: 'Explicit zero', price: 0, currency: 'USD', is_active: true },
    ] });
    const missingCurrency = database.prepare('SELECT * FROM bot_products WHERE savana_projection_key = ?').get('canonical:missing-currency');
    assert.equal(missingCurrency.currency, null);
    assert.equal(missingCurrency.is_active, 0);
    assert.equal(missingCurrency.availability, 'hidden');
    const missingPrice = database.prepare('SELECT * FROM bot_products WHERE savana_projection_key = ?').get('canonical:missing-price');
    assert.equal(missingPrice.price, null);
    assert.equal(missingPrice.is_active, 0);
    assert.equal(missingPrice.approval_status, 'draft');
    assert.equal(database.prepare('SELECT is_active FROM bot_products WHERE savana_projection_key = ?').get('canonical:explicit-free').is_active, 1);
});

test('complete snapshot membership cannot reactivate an incomplete priced product', t => {
    const database = createDatabase(t);
    database.exec(`INSERT INTO savana_integrations (id, tenant_id, platform_code, status) VALUES (1, 1, 'pos', 'active');`);
    const service = new SavanaIntegrationService({ database, config: {}, fetchImpl: async () => { throw new Error('No network allowed'); } });
    const snapshot = {
        snapshot_id: 'incomplete-pricing', generated_at: '2026-11-17T09:00:00Z',
        page_number: 1, page_count: 1, complete: true,
        products: [{ local_product_id: 'pos-incomplete', name: 'Unmapped currency', price: 15, is_active: true }],
    };
    service.applyProductSnapshot(1, snapshot, { integrationId: 1, source: 'pos', eventType: 'savana.product_snapshot.v1' });
    service.reconcileIntegrationMembershipVisibility(1);
    const stored = database.prepare('SELECT * FROM bot_products WHERE savana_projection_key = ?').get('local:pos-incomplete');
    assert.equal(stored.is_active, 0);
    assert.equal(stored.currency, null);
    assert.equal(stored.availability, 'hidden');
});

test('pricing migration quarantines legacy synthesized amounts without changing local products or valid imports', t => {
    const database = createDatabase(t);
    database.exec(`
        INSERT INTO savana_product_projection (tenant_id, projection_key, canonical_product_id, name, price, currency)
        VALUES (1, 'canonical:shared-a', 'shared-a', 'No source currency', '12', NULL),
               (2, 'canonical:shared-b', 'shared-b', 'Valid source price', '7', 'USD'),
               (1, 'canonical:invalid-price', 'invalid-price', 'Invalid source price', 'abc', 'USD');
        UPDATE bot_products SET currency = 'LYD', price = 12 WHERE id = 1;
        INSERT INTO bot_products (id, tenant_id, name, price, currency, savana_projection_key)
        VALUES (4, 1, 'Missing source price', 0, 'LYD', 'canonical:no-projection'),
               (5, 1, 'Invalid source price', 0, 'USD', 'canonical:invalid-price');
    `);
    const localBefore = database.prepare('SELECT * FROM bot_products WHERE id = 2').get();
    const validBefore = database.prepare('SELECT * FROM bot_products WHERE id = 3').get();
    const migration = fs.readFileSync(path.join(migrationsDirectory, '056_savana_incomplete_product_pricing.sql'), 'utf8');
    database.exec(migration);
    const missingCurrency = database.prepare('SELECT * FROM bot_products WHERE id = 1').get();
    assert.equal(missingCurrency.currency, null);
    assert.equal(missingCurrency.price, 12);
    assert.equal(missingCurrency.is_active, 0);
    assert.equal(missingCurrency.approval_status, 'draft');
    assert.equal(missingCurrency.savana_projection_key, 'canonical:shared-a');
    const missingProjection = database.prepare('SELECT * FROM bot_products WHERE id = 4').get();
    assert.equal(missingProjection.price, null);
    assert.equal(missingProjection.currency, null);
    assert.equal(missingProjection.availability, 'hidden');
    const invalidPrice = database.prepare('SELECT * FROM bot_products WHERE id = 5').get();
    assert.equal(invalidPrice.is_active, 0);
    assert.equal(invalidPrice.price, null);
    assert.equal(invalidPrice.approval_status, 'draft');
    assert.equal(database.prepare("SELECT price FROM savana_product_projection WHERE projection_key = 'canonical:invalid-price'").get().price, 'abc');
    assert.deepEqual(database.prepare('SELECT * FROM bot_products WHERE id = 2').get(), localBefore);
    assert.deepEqual(database.prepare('SELECT * FROM bot_products WHERE id = 3').get(), validBefore);
    database.exec(migration);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bot_products').get().count, 5);
});
