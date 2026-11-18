import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { SavanaIntegrationService } from '../services/savanaIntegration.js';
import { createSavanaLifecycleFixture, savanaLifecycleDelivery } from '../test-support/savanaLifecycleFixture.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(testDirectory, '..', 'db', 'migrations');
const lifecycleConfig = { callbackToken: 'snapshot-callback-token', connectUrl: 'https://connect.test',
    connectPlatformToken: 'synthetic-snapshot-platform-token', timeoutMs: 1000 };
const catalogConnection = (status, version) => ({ id: 'connection-1', organization_id: 'organization-1',
    source_platform: 'catalog', target_platform: 'wa_savana', source_tenant_id: 'catalog-account', target_tenant_id: 'wa-account',
    source_external_tenant_id: 'catalog-tenant', target_external_tenant_id: 'wa_savana:tenant:1',
    status, lifecycle_version: version, scopes: [] });

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const file of fs.readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
        database.exec(fs.readFileSync(path.join(migrationsDirectory, file), 'utf8'));
    }
    database.prepare(`
        INSERT INTO tenants (id, name, phone, status)
        VALUES (1, 'Snapshot tenant', '218910000001', 'Active')
    `).run();
    database.prepare(`
        INSERT INTO savana_integrations (
            id, tenant_id, platform_code, organization_id, connection_id,
            status, scopes_json, webhook_secret_encrypted, local_platform_tenant_id,remote_platform_tenant_id,remote_external_tenant_id
        ) VALUES (1, 1, 'catalog', 'organization-1', 'connection-1',
            'active', '[]', 'encrypted','wa-account','catalog-account','catalog-tenant')
    `).run();
    return database;
};

const product = (suffix, overrides = {}) => ({
    canonical_product_id: `00000000-0000-4000-8000-00000000000${suffix}`,
    sku: `SKU-${suffix}`,
    name: `Product ${suffix}`,
    online_price: '10.000',
    currency: 'LYD',
    is_active: true,
    ...overrides,
});

const applyPage = (
    database,
    service,
    snapshotId,
    pageNumber,
    pageCount,
    products,
    {
        integrationId = 1,
        eventType = 'catalog.product_snapshot.v1',
        source = 'catalog',
        generatedAt = '2026-08-13T10:00:00Z',
    } = {},
) => {
    const data = {
        snapshot_id: snapshotId,
        generated_at: generatedAt,
        page_number: pageNumber,
        page_count: pageCount,
        complete: pageNumber === pageCount,
        products,
    };
    database.prepare(`
        INSERT INTO savana_integration_events (
            integration_id, event_id, idempotency_key, event_type, payload_json
        ) VALUES (?, ?, ?, ?, ?)
    `).run(
        integrationId,
        `event-${snapshotId}-${pageNumber}`,
        `key-${snapshotId}-${pageNumber}`,
        eventType,
        JSON.stringify({ event_type: eventType, data }),
    );
    service.applyProductSnapshot(1, data, {
        integrationId,
        source,
        eventType,
    });
};

test('multi-page product snapshots clean up only after every page is durable', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });

    applyPage(database, service, 'snapshot-1', 1, 2, [product('1'), product('2')]);
    applyPage(database, service, 'snapshot-1', 2, 2, [product('3')]);
    assert.deepEqual(
        database.prepare('SELECT sku, is_active FROM bot_products ORDER BY sku').all(),
        [
            { sku: 'SKU-1', is_active: 1 },
            { sku: 'SKU-2', is_active: 1 },
            { sku: 'SKU-3', is_active: 1 },
        ],
    );

    database.prepare(`
        INSERT INTO savana_integrations (
            id, tenant_id, platform_code, organization_id, connection_id,
            status, scopes_json, webhook_secret_encrypted
        ) VALUES (2, 1, 'pos', 'organization-1', 'connection-2',
            'active', '[]', 'encrypted')
    `).run();
    applyPage(database, service, 'pos-snapshot-1', 1, 1, [product('4')], {
        integrationId: 2,
        eventType: 'savana.product_snapshot.v1',
        source: 'pos',
    });

    // The final page may be delivered before an earlier retry. It must not hide
    // valid products until the complete page set has arrived.
    applyPage(database, service, 'snapshot-2', 2, 2, [product('3')], {
        generatedAt: '2026-08-13T11:00:00Z',
    });
    assert.deepEqual(
        database.prepare('SELECT sku, is_active FROM bot_products ORDER BY sku').all(),
        [
            { sku: 'SKU-1', is_active: 1 },
            { sku: 'SKU-2', is_active: 1 },
            { sku: 'SKU-3', is_active: 1 },
            { sku: 'SKU-4', is_active: 1 },
        ],
    );

    applyPage(database, service, 'snapshot-2', 1, 2, [product('1')], {
        generatedAt: '2026-08-13T11:00:00Z',
    });
    assert.deepEqual(
        database.prepare('SELECT sku, is_active, availability FROM bot_products ORDER BY sku').all(),
        [
            { sku: 'SKU-1', is_active: 1, availability: 'available' },
            { sku: 'SKU-2', is_active: 0, availability: 'hidden' },
            { sku: 'SKU-3', is_active: 1, availability: 'available' },
            { sku: 'SKU-4', is_active: 1, availability: 'available' },
        ],
    );
});

test('missing or empty inventory remains unknown instead of becoming out of stock', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });

    applyPage(database, service, 'snapshot-null-inventory', 1, 1, [
        product('5', { quantity_on_hand: null, quantity_available: null }),
        product('6', { quantity_on_hand: '', quantity_available: '' }),
        product('7', { quantity_on_hand: '0', quantity_available: '0' }),
    ]);

    assert.deepEqual(
        database.prepare('SELECT sku, availability FROM bot_products ORDER BY sku').all(),
        [
            { sku: 'SKU-5', availability: 'available' },
            { sku: 'SKU-6', availability: 'available' },
            { sku: 'SKU-7', availability: 'out_of_stock' },
        ],
    );

    applyPage(database, service, 'snapshot-null-after-zero', 1, 1, [
        product('7', { quantity_on_hand: null, quantity_available: null }),
    ], { generatedAt: '2026-08-13T11:00:00Z' });
    assert.deepEqual(database.prepare(`
        SELECT quantity_on_hand, quantity_available
        FROM savana_product_projection WHERE sku = 'SKU-7'
    `).get(), {
        quantity_on_hand: null,
        quantity_available: null,
    });
    assert.equal(
        database.prepare("SELECT availability FROM bot_products WHERE sku = 'SKU-7'").get().availability,
        'available',
    );
});

test('a late page from an older snapshot cannot overwrite or hide a newer snapshot', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });

    applyPage(database, service, 'snapshot-old', 1, 2, [product('1')], {
        generatedAt: '2026-08-13T10:00:00Z',
    });
    applyPage(database, service, 'snapshot-new', 1, 1, [product('1'), product('2')], {
        generatedAt: '2026-08-13T11:00:00Z',
    });
    applyPage(database, service, 'snapshot-old', 2, 2, [product('3')], {
        generatedAt: '2026-08-13T10:00:00Z',
    });

    assert.deepEqual(
        database.prepare('SELECT sku, is_active FROM bot_products ORDER BY sku').all(),
        [
            { sku: 'SKU-1', is_active: 1 },
            { sku: 'SKU-2', is_active: 1 },
        ],
    );
    assert.equal(
        database.prepare(`
            SELECT COUNT(*) count FROM savana_product_snapshot_pages
            WHERE integration_id = 1 AND event_type = 'catalog.product_snapshot.v1'
        `).get().count,
        1,
    );
});

test('shared products remain visible until every integrated source removes them', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });
    database.prepare(`
        INSERT INTO savana_integrations (
            id, tenant_id, platform_code, organization_id, connection_id,
            status, scopes_json, webhook_secret_encrypted
        ) VALUES (2, 1, 'pos', 'organization-1', 'connection-2',
            'active', '[]', 'encrypted')
    `).run();

    applyPage(database, service, 'catalog-1', 1, 1, [product('1'), product('2')], {
        generatedAt: '2026-08-13T10:00:00Z',
    });
    applyPage(database, service, 'pos-1', 1, 1, [product('1'), product('3')], {
        integrationId: 2,
        eventType: 'savana.product_snapshot.v1',
        source: 'pos',
        generatedAt: '2026-08-13T10:30:00Z',
    });
    applyPage(database, service, 'catalog-partial', 1, 2, [
        product('1', { is_active: false }),
    ], { generatedAt: '2026-08-13T10:45:00Z' });
    assert.equal(
        database.prepare("SELECT is_active FROM bot_products WHERE sku = 'SKU-1'").get().is_active,
        1,
    );
    applyPage(database, service, 'catalog-2', 1, 1, [product('2')], {
        generatedAt: '2026-08-13T11:00:00Z',
    });

    assert.deepEqual(
        database.prepare('SELECT sku, is_active FROM bot_products ORDER BY sku').all(),
        [
            { sku: 'SKU-1', is_active: 1 },
            { sku: 'SKU-2', is_active: 1 },
            { sku: 'SKU-3', is_active: 1 },
        ],
    );

    applyPage(database, service, 'pos-2', 1, 1, [product('3')], {
        integrationId: 2,
        eventType: 'savana.product_snapshot.v1',
        source: 'pos',
        generatedAt: '2026-08-13T11:30:00Z',
    });
    assert.equal(
        database.prepare("SELECT is_active FROM bot_products WHERE sku = 'SKU-1'").get().is_active,
        0,
    );
});

test('first post-migration snapshot backfills source membership from durable events', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });
    database.prepare(`
        INSERT INTO savana_integrations (
            id, tenant_id, platform_code, organization_id, connection_id,
            status, scopes_json, webhook_secret_encrypted
        ) VALUES (2, 1, 'pos', 'organization-1', 'connection-2',
            'active', '[]', 'encrypted')
    `).run();
    applyPage(database, service, 'catalog-before-migration', 1, 1, [product('1'), product('2')], {
        generatedAt: '2026-08-13T10:00:00Z',
    });
    applyPage(database, service, 'pos-before-migration', 1, 1, [product('1'), product('3')], {
        integrationId: 2,
        eventType: 'savana.product_snapshot.v1',
        source: 'pos',
        generatedAt: '2026-08-13T10:30:00Z',
    });

    database.exec(`
        DELETE FROM savana_product_snapshot_pages;
        DELETE FROM savana_product_snapshot_memberships;
        DELETE FROM savana_product_snapshot_streams;
    `);
    applyPage(database, service, 'catalog-after-migration', 1, 1, [product('2')], {
        generatedAt: '2026-08-13T11:00:00Z',
    });

    assert.equal(
        database.prepare("SELECT is_active FROM bot_products WHERE sku = 'SKU-1'").get().is_active,
        1,
    );
    assert.equal(
        database.prepare(`
            SELECT COUNT(*) count FROM savana_product_snapshot_memberships
            WHERE integration_id = 2 AND projection_key = 'canonical:00000000-0000-4000-8000-000000000001'
        `).get().count,
        1,
    );
});

test('membership backfill immediately restores visibility from every source', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });
    database.prepare(`
        INSERT INTO savana_integrations (
            id, tenant_id, platform_code, organization_id, connection_id,
            status, scopes_json, webhook_secret_encrypted
        ) VALUES (2, 1, 'pos', 'organization-1', 'connection-2',
            'active', '[]', 'encrypted')
    `).run();
    applyPage(database, service, 'catalog-before-reset', 1, 1, [product('1')], {
        generatedAt: '2026-08-13T10:00:00Z',
    });
    applyPage(database, service, 'pos-before-reset', 1, 1, [product('3')], {
        integrationId: 2,
        eventType: 'savana.product_snapshot.v1',
        source: 'pos',
        generatedAt: '2026-08-13T10:30:00Z',
    });
    database.exec(`
        DELETE FROM savana_product_snapshot_pages;
        DELETE FROM savana_product_snapshot_memberships;
        DELETE FROM savana_product_snapshot_streams;
        UPDATE bot_products SET is_active = 0, availability = 'hidden'
        WHERE sku = 'SKU-1';
    `);

    applyPage(database, service, 'pos-after-reset', 1, 1, [product('3')], {
        integrationId: 2,
        eventType: 'savana.product_snapshot.v1',
        source: 'pos',
        generatedAt: '2026-08-13T11:00:00Z',
    });
    assert.deepEqual(database.prepare(`
        SELECT is_active, availability FROM bot_products WHERE sku = 'SKU-1'
    `).get(), {
        is_active: 1,
        availability: 'available',
    });
});

test('membership backfill restores legacy complete snapshots without paging metadata', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });
    const data = {
        generated_at: '2026-08-13T10:00:00Z',
        complete: true,
        products: [product('6')],
    };
    database.prepare(`
        INSERT INTO savana_integration_events (
            integration_id, event_id, idempotency_key, event_type, payload_json
        ) VALUES (1, 'legacy-event-6', 'legacy-key-6',
            'catalog.product_snapshot.v1', ?)
    `).run(JSON.stringify({ data }));
    service.applyProductSnapshot(1, data);
    database.prepare(`
        UPDATE bot_products SET is_active = 0, availability = 'hidden'
        WHERE sku = 'SKU-6'
    `).run();

    service.ensureSnapshotMembershipBackfill(1);

    assert.deepEqual(database.prepare(`
        SELECT snapshot_id, is_active
        FROM savana_product_snapshot_memberships
        WHERE integration_id = 1
    `).get(), {
        snapshot_id: 'legacy:2026-08-13T10:00:00Z',
        is_active: 1,
    });
    assert.deepEqual(database.prepare(`
        SELECT is_active, availability FROM bot_products WHERE sku = 'SKU-6'
    `).get(), {
        is_active: 1,
        availability: 'available',
    });
});

test('revoking an integration immediately hides its unique snapshot products', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const connection = catalogConnection('revoked', 2);
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: createSavanaLifecycleFixture({ connections: [connection] }),
        config: lifecycleConfig,
    });
    applyPage(database, service, 'catalog-before-revoke', 1, 1, [product('9')]);

    await service.applyLifecycle({
        connection,
        action: 'revoked',
    }, lifecycleConfig.callbackToken, savanaLifecycleDelivery(connection));
    assert.deepEqual(database.prepare(`
        SELECT is_active, availability FROM bot_products WHERE sku = 'SKU-9'
    `).get(), {
        is_active: 0,
        availability: 'hidden',
    });
});

test('unsupported error and disconnected callback states reject without changing product visibility', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: createSavanaLifecycleFixture({ connections: [catalogConnection('active', 1)] }),
        config: lifecycleConfig,
    });
    applyPage(database, service, 'catalog-before-error', 1, 1, [product('8')]);

    const original = database.prepare('SELECT * FROM savana_integrations WHERE id=1').get();
    for (const status of ['error', 'disconnected']) {
        const connection = catalogConnection(status, 2);
        await assert.rejects(() => service.applyLifecycle({ connection, action: status }, lifecycleConfig.callbackToken,
            savanaLifecycleDelivery(connection)), error => error.statusCode === 422 && error.code === 'lifecycle_payload_invalid');
        assert.deepEqual(database.prepare('SELECT * FROM savana_integrations WHERE id=1').get(), original);
        assert.equal(database.prepare('SELECT COUNT(*) n FROM savana_lifecycle_state').get().n, 0);
        assert.deepEqual(database.prepare(`
            SELECT is_active, availability FROM bot_products WHERE sku = 'SKU-8'
        `).get(), {
            is_active: 1,
            availability: 'available',
        });
    }
});

test('canonical revocation backfills membership before reconciling a migrated tenant', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const connection = catalogConnection('revoked', 2);
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: createSavanaLifecycleFixture({ connections: [connection] }),
        config: lifecycleConfig,
    });
    applyPage(database, service, 'catalog-before-state-migration', 1, 1, [product('7')]);
    database.exec(`
        DELETE FROM savana_product_snapshot_pages;
        DELETE FROM savana_product_snapshot_memberships;
        DELETE FROM savana_product_snapshot_streams;
    `);

    await service.applyLifecycle({ connection, action: 'revoked' }, lifecycleConfig.callbackToken, savanaLifecycleDelivery(connection));

    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count
        FROM savana_product_snapshot_memberships
        WHERE integration_id = 1
    `).get().count, 1);
    assert.deepEqual(database.prepare(`
        SELECT is_active, availability FROM bot_products WHERE sku = 'SKU-7'
    `).get(), {
        is_active: 0,
        availability: 'hidden',
    });
});

test('legacy complete snapshots initialize bounded stream state', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({}),
        config: {},
    });
    const integrationId = 1;
    service.applyProductSnapshot(1, {
        generated_at: '2026-08-16T09:00:00.000Z',
        complete: true,
        products: [product('legacy')],
    }, {
        integrationId,
        source: 'catalog',
        eventType: 'catalog.product_snapshot.v1',
    });

    const stream = database.prepare(`
        SELECT latest_snapshot_id, applied_snapshot_id
        FROM savana_product_snapshot_streams
        WHERE integration_id = ? AND event_type = 'catalog.product_snapshot.v1'
    `).get(integrationId);
    assert.deepEqual(stream, {
        latest_snapshot_id: 'legacy:2026-08-16T09:00:00.000Z',
        applied_snapshot_id: 'legacy:2026-08-16T09:00:00.000Z',
    });
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count
        FROM savana_product_snapshot_memberships
        WHERE integration_id = ?
    `).get(integrationId).count, 1);
});
