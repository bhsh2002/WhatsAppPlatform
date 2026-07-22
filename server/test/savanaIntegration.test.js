import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import {
    canonicalJson,
    SavanaIntegrationError,
    SavanaIntegrationService,
} from '../services/savanaIntegration.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(testDirectory, '..', 'db', 'migrations');
const signingSecret = 'wa-savana-central-subscription-signing-secret';
const callbackToken = 'wa-savana-connect-callback-token';
const organizationId = '68de1c4f-f540-44b7-b409-0aa1707ab1f7';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const file of fs.readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
        database.exec(fs.readFileSync(path.join(migrationsDirectory, file), 'utf8'));
    }
    database.prepare(`
        INSERT INTO tenants (id, name, phone, status)
        VALUES (1, 'Wa tenant', '218910000001', 'Active')
    `).run();
    return database;
};

const entitlementSnapshot = ({ entitled = true, secret = signingSecret } = {}) => {
    const payload = {
        spec_version: '1.0',
        organization_id: organizationId,
        platform_code: 'wa_savana',
        subscription_status: 'active',
        version: 1,
        issued_at: new Date().toISOString(),
        valid_until: new Date(Date.now() + 86_400_000).toISOString(),
        entitlements: {
            'wa_savana.integration.pos.enabled': entitled,
            'wa_savana.integration.catalog.enabled': entitled,
            'wa_savana.integration.sawemly.enabled': entitled,
        },
    };
    return {
        payload,
        signature: `v1=${crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex')}`,
    };
};

const createFetch = ({ entitled = true, badSignature = false } = {}) => async (url, options) => {
    const pathName = new URL(url).pathname;
    if (pathName.includes('/entitlements/')) {
        const snapshot = entitlementSnapshot({ entitled });
        if (badSignature) snapshot.signature = 'v1=invalid';
        return Response.json({ data: snapshot });
    }
    if (pathName === '/v1/organizations') {
        return Response.json({ id: organizationId }, { status: 201 });
    }
    if (pathName === '/v1/platform-tenants') {
        const body = JSON.parse(options.body);
        return Response.json({
            id: `${body.platform_code}-tenant-id`,
            platform_code: body.platform_code,
        }, { status: 201 });
    }
    if (pathName === '/v1/connections' && options.method === 'POST') {
        return Response.json({ id: 'connection-1', status: 'pending_authorization' }, { status: 201 });
    }
    if (pathName === '/v1/connections/connection-1/credentials') {
        return Response.json({ webhook_secret: 'wa-savana-connection-secret' });
    }
    if (pathName === '/v1/events' && options.method === 'POST') {
        return Response.json({ event_id: crypto.randomUUID(), duplicate: false }, { status: 202 });
    }
    if (pathName === '/v1/connections/connection-1' && options.method === 'GET') {
        return Response.json({ status: 'active', scopes: ['pos.sales.events'] });
    }
    if (pathName.endsWith('/pause')) return Response.json({ status: 'paused' });
    if (pathName.endsWith('/resume')) return Response.json({ status: 'active' });
    if (pathName.endsWith('/revoke')) return Response.json({ status: 'revoked' });
    return Response.json({ error: 'unexpected request' }, { status: 500 });
};

const config = {
    enabled: true,
    connectUrl: 'https://connect.test',
    connectAdminToken: 'connect-admin',
    callbackUrl: 'https://wa.test/integrations/connect/events',
    callbackToken,
    subscriptionsUrl: 'https://subscriptions.test',
    subscriptionsPlatformToken: 'platform-token',
    subscriptionsSigningSecret: signingSecret,
    timeoutMs: 1000,
};

const provision = async (database, fetchImpl = createFetch()) => {
    const service = new SavanaIntegrationService({ database, fetchImpl, config });
    const item = await service.requestConnection(1, {
        organization_id: organizationId,
        pos_external_tenant_id: 'pos-company-1',
    }, 'tenant-user');
    return { service, item };
};

const envelope = (eventType, data, eventId, idempotencyKey) => ({
    spec_version: '1.0',
    event_id: eventId,
    event_type: eventType,
    source: eventType.startsWith('catalog.') ? 'catalog' : 'pos',
    organization_id: organizationId,
    platform_tenant_id: 'pos-tenant-id',
    entity_id: null,
    entity_version: 1,
    occurred_at: new Date().toISOString(),
    idempotency_key: idempotencyKey,
    correlation_id: 'b2848353-dcbf-4779-9fe4-b14ccb72ff49',
    causation_id: null,
    data,
});

test('migrations create isolated integration, projection and service request tables', () => {
    const database = createDatabase();
    const tables = new Set(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'savana_%'
    `).all().map(row => row.name));
    assert.deepEqual(tables, new Set([
        'savana_integrations',
        'savana_integration_events',
        'savana_product_projection',
        'savana_pos_transactions',
        'savana_notification_candidates',
        'savana_service_requests',
    ]));
    assert.equal(database.pragma('foreign_key_check').length, 0);
    database.close();
});

test('POS provisioning is centrally entitled and supports explicit lifecycle control', async () => {
    const database = createDatabase();
    const { service, item } = await provision(database);
    assert.equal(item.status, 'pending_authorization');
    assert.equal(service.hasEntitlement(item), true);
    assert.equal(service.serialize(item).independent_mode, true);
    assert.equal((await service.refreshStatus(item)).status, 'active');
    assert.equal((await service.transition(service.get(1), 'pause', 'tenant')).status, 'paused');
    assert.equal((await service.transition(service.get(1), 'resume', 'tenant')).status, 'active');
    assert.equal((await service.transition(service.get(1), 'revoke', 'tenant')).status, 'revoked');
    database.close();
});

test('missing entitlement and invalid signed snapshots fail closed', async () => {
    for (const fetchImpl of [createFetch({ entitled: false }), createFetch({ badSignature: true })]) {
        const database = createDatabase();
        const service = new SavanaIntegrationService({ database, fetchImpl, config });
        await assert.rejects(
            () => service.requestConnection(1, {
                organization_id: organizationId,
                pos_external_tenant_id: 'pos-company-1',
            }, 'tenant-user'),
            error => error instanceof SavanaIntegrationError && [401, 402].includes(error.statusCode),
        );
        database.close();
    }
});

test('POS simulator sales, returns and inventory are idempotent and consent aware', async () => {
    const database = createDatabase();
    const { service } = await provision(database);
    database.prepare("UPDATE savana_integrations SET status = 'active' WHERE tenant_id = 1").run();

    const sale = envelope('pos.retail_sale_completed.v1', {
        local_sale_id: '1001',
        sale_number: 'POS-2026-1001',
        branch_id: '1',
        warehouse_id: '1',
        terminal_id: 'terminal-01',
        session_id: 'session-501',
        sold_at: '2026-07-18T12:00:00Z',
        currency: 'LYD',
        subtotal: '25.000',
        discount: '0.000',
        tax: '0.000',
        total: '25.000',
        customer: {
            local_customer_id: 'customer-1',
            canonical_customer_id: null,
            phone_e164: '+218910000001',
            receipt_notification_consent: true,
        },
        items: [{
            canonical_product_id: 'ea0191d3-c153-45ab-8744-79e3d61b1fe0',
            local_product_id: '42',
            sku: 'SKU-42',
            barcode: '100000000042',
            name: 'منتج تجريبي',
            unit_code: 'PCS',
            quantity: '2.000000',
            unit_price: '12.500',
            line_total: '25.000',
        }],
        payments: [{ method: 'cash', amount: '25.000', reference: null }],
    }, '7f754f8c-c0c8-4a21-aedd-0cd7b8ab90ca', 'pos:sale:branch-1:1001');
    const rawSale = Buffer.from(JSON.stringify(sale));
    assert.equal(service.receiveEvent('connection-1', callbackToken, rawSale).duplicate, false);
    assert.equal(service.receiveEvent('connection-1', callbackToken, rawSale).duplicate, true);

    const inventory = envelope('pos.inventory_snapshot.v1', {
        snapshot_id: '5499a20e-39b8-413e-9bb9-ac34c4aec37e',
        branch_id: '1',
        warehouse_id: '1',
        captured_at: '2026-07-18T14:00:00Z',
        cursor: 'inventory-1001',
        items: [{
            canonical_product_id: 'ea0191d3-c153-45ab-8744-79e3d61b1fe0',
            local_product_id: '42',
            sku: 'SKU-42',
            barcode: '100000000042',
            quantity_on_hand: '18.000000',
            quantity_reserved: '0.000000',
            quantity_available: '18.000000',
            unit_code: 'PCS',
        }],
    }, '004a2c66-5b9c-488a-a5fe-7e8e2a056f90', 'pos:inventory:snapshot:branch-1:one');
    service.receiveEvent('connection-1', callbackToken, Buffer.from(JSON.stringify(inventory)));

    const returned = envelope('pos.retail_sale_returned.v1', {
        local_return_id: '2001',
        original_local_sale_id: '1001',
        branch_id: '1',
        warehouse_id: '1',
        returned_at: '2026-07-18T15:00:00Z',
        currency: 'LYD',
        total: '12.500',
        reason: 'إرجاع تجريبي',
        items: [{
            canonical_product_id: 'ea0191d3-c153-45ab-8744-79e3d61b1fe0',
            local_product_id: '42',
            quantity: '1.000000',
            refund_amount: '12.500',
            restock: true,
        }],
    }, '508ed5ca-16ad-43ad-baad-2b24530f2e9d', 'pos:return:branch-1:2001');
    service.receiveEvent('connection-1', callbackToken, Buffer.from(JSON.stringify(returned)));

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_integration_events').get().count, 3);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_pos_transactions').get().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_notification_candidates').get().count, 2);
    assert.equal(database.prepare('SELECT quantity_available FROM savana_product_projection').get().quantity_available, '18.000000');
    assert.throws(
        () => service.receiveEvent('connection-1', 'wrong-token', rawSale),
        error => error instanceof SavanaIntegrationError && error.statusCode === 401,
    );
    assert.deepEqual(service.diagnostics(service.get(1)).counts, {
        products: 1,
        transactions: 2,
        pending_notification_candidates: 2,
        pending_service_requests: 0,
    });
    database.close();
});

test('Catalog connects directly and creates reviewed Wa service requests without POS', async () => {
    const database = createDatabase();
    const service = new SavanaIntegrationService({ database, fetchImpl: createFetch(), config });
    const item = await service.requestConnection(1, {
        organization_id: organizationId,
        remote_external_tenant_id: 'catalog-shop-1',
    }, 'tenant-user', 'catalog');
    assert.equal(item.platform_code, 'catalog');
    database.prepare("UPDATE savana_integrations SET status = 'active' WHERE id = ?").run(item.id);

    const product = envelope('catalog.product_snapshot.v1', {
        snapshot_id: crypto.randomUUID(),
        generated_at: new Date().toISOString(),
        products: [{
            canonical_product_id: crypto.randomUUID(),
            sku: 'CAT-1',
            name: 'Catalog product',
            online_price: '12.500',
            currency: 'LYD',
            is_active: true,
        }],
    }, crypto.randomUUID(), 'catalog:products:direct-1');
    service.receiveEvent('connection-1', callbackToken, Buffer.from(JSON.stringify(product)));

    const order = envelope('catalog.order_status_changed.v1', {
        order_id: 'ORDER-1',
        status: 'ready',
        recipient_phone_e164: '+218910000001',
        notification_consent: true,
    }, crypto.randomUUID(), 'catalog:order:ORDER-1:ready');
    service.receiveEvent('connection-1', callbackToken, Buffer.from(JSON.stringify(order)));

    assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_product_projection').get().count, 1);
    const request = database.prepare('SELECT * FROM savana_service_requests').get();
    assert.equal(request.request_kind, 'order_notification');
    assert.equal(request.status, 'pending_review');
    assert.equal(service.diagnostics(service.get(1, 'catalog')).counts.pending_service_requests, 1);
    database.close();
});
