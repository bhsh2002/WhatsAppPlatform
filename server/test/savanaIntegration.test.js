import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import express from 'express';

import { createAdminSubscriptionsRouter } from '../routes/savanaIntegrations.js';
import {
    canonicalJson,
    SavanaIntegrationError,
    SavanaIntegrationService,
    validateIntegrationConfig,
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
            'wa_savana.credits.monthly': 10000,
            'wa_savana.credit_limit.default': 250,
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

test('production callback policy permits only HTTPS or the canonical private Docker service', () => {
    assert.doesNotThrow(() => validateIntegrationConfig(config, { NODE_ENV: 'production' }));
    assert.doesNotThrow(() => validateIntegrationConfig({
        ...config,
        callbackUrl: 'http://wa-savana-server:3031/integrations/connect/events',
    }, { NODE_ENV: 'production' }));
    assert.throws(
        () => validateIntegrationConfig({
            ...config,
            callbackUrl: 'http://wa.example.com/integrations/connect/events',
        }, { NODE_ENV: 'production' }),
        /must use HTTPS/
    );
    assert.throws(
        () => validateIntegrationConfig({
            ...config,
            callbackUrl: 'not-a-url',
        }, { NODE_ENV: 'production' }),
        /valid absolute URL/
    );
});

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

test('one-click linking discovers and activates the target platform automatically', async () => {
    const database = createDatabase();
    const sourceTenantId = crypto.randomUUID();
    const targetTenantId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const snapshot = entitlementSnapshot();
    const fetchImpl = async (url, options = {}) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/v1/platform-tenants' && options.method === 'GET') {
            return Response.json([{
                id: sourceTenantId,
                organization_id: organizationId,
                platform_code: 'wa_savana',
                external_tenant_id: 'wa_savana:tenant:1',
            }]);
        }
        if (parsed.pathname === '/v1/connection-candidates' && options.method === 'GET') {
            return Response.json({
                organization: { id: organizationId, name: 'Savana tenant' },
                source_tenant: {
                    id: sourceTenantId,
                    organization_id: organizationId,
                    platform_code: 'wa_savana',
                    external_tenant_id: 'wa_savana:tenant:1',
                },
                target_platform_code: 'catalog',
                candidates: [{
                    id: targetTenantId,
                    display_name: 'Catalog Shop',
                    connectable: true,
                }],
            });
        }
        if (parsed.pathname.endsWith('/subscription-context/wa_savana')) {
            return Response.json({ data: {
                source: 'savana_subscriptions',
                managed_centrally: true,
                organization: { id: organizationId, name: 'Savana tenant' },
                platform_code: 'wa_savana',
                subscription_status: 'active',
                subscriptions: [],
                active_items: [],
                plans: [],
                bundles: [],
                entitlement_snapshot: snapshot,
                invoices: [],
                ui: {},
            } });
        }
        if (parsed.pathname.includes('/entitlements/')) {
            return Response.json({ data: snapshot });
        }
        if (parsed.pathname === '/v1/connections/one-click' && options.method === 'POST') {
            assert.deepEqual(JSON.parse(options.body), {
                source_tenant_id: sourceTenantId,
                target_platform_code: 'catalog',
                actor_id: 'tenant-user',
                provision_source: false,
            });
            return Response.json({
                connection: {
                    id: connectionId,
                    organization_id: organizationId,
                    source_tenant_id: sourceTenantId,
                    target_tenant_id: targetTenantId,
                    source_platform: 'wa_savana',
                    target_platform: 'catalog',
                    source_external_tenant_id: 'wa_savana:tenant:1',
                    target_external_tenant_id: 'catalog:shop:42',
                    status: 'active',
                    scopes: ['catalog.products.projection'],
                },
                webhook_secret: 'one-click-secret',
            }, { status: 201 });
        }
        return Response.json({ error: 'unexpected request' }, { status: 500 });
    };
    const service = new SavanaIntegrationService({
        database,
        fetchImpl,
        config: { ...config, subscriptionsMode: 'central' },
    });

    const item = await service.requestConnection(1, {}, 'tenant-user', 'catalog');
    assert.equal(item.status, 'active');
    assert.equal(item.connection_id, connectionId);
    assert.equal(item.remote_external_tenant_id, 'catalog:shop:42');
    assert.equal(service.serialize(item, 'catalog').entitled, true);
    database.close();
});

test('authenticated one-click provisioning configures Wa Savana as the target', async () => {
    const database = createDatabase();
    const snapshot = entitlementSnapshot();
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async url => {
            if (new URL(url).pathname.includes('/entitlements/')) {
                return Response.json({ data: snapshot });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
        config,
    });
    const connectionId = crypto.randomUUID();
    const item = await service.provisionConnection({
        connection: {
            id: connectionId,
            organization_id: organizationId,
            source_tenant_id: crypto.randomUUID(),
            target_tenant_id: crypto.randomUUID(),
            source_platform: 'catalog',
            target_platform: 'wa_savana',
            source_external_tenant_id: 'catalog:shop:42',
            target_external_tenant_id: 'wa_savana:tenant:1',
            status: 'active',
            scopes: ['catalog.products.projection'],
        },
        webhook_secret: 'target-provision-secret',
    }, callbackToken);

    assert.equal(item.connection_id, connectionId);
    assert.equal(item.platform_code, 'catalog');
    assert.equal(item.remote_external_tenant_id, 'catalog:shop:42');
    assert.equal(item.status, 'active');
    const revoked = service.applyLifecycle({
        connection: {
            id: connectionId,
            scopes: ['catalog.products.projection'],
        },
        action: 'revoked',
    }, callbackToken);
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.webhook_secret_encrypted, null);
    await assert.rejects(
        () => service.provisionConnection({
            connection: { target_platform: 'wa_savana' },
            webhook_secret: 'secret',
        }, 'wrong-token'),
        error => error.statusCode === 401,
    );
    database.close();
});

test('authenticated one-click provisioning configures Wa Savana as the source', async () => {
    const database = createDatabase();
    const snapshot = entitlementSnapshot();
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async url => {
            if (new URL(url).pathname.includes('/entitlements/')) {
                return Response.json({ data: snapshot });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
        config,
    });
    const sourceTenantId = crypto.randomUUID();
    const targetTenantId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const item = await service.provisionConnection({
        connection: {
            id: connectionId,
            organization_id: organizationId,
            source_tenant_id: sourceTenantId,
            target_tenant_id: targetTenantId,
            source_platform: 'wa_savana',
            target_platform: 'catalog',
            source_external_tenant_id: 'wa_savana:tenant:1',
            target_external_tenant_id: 'catalog:shop:99',
            status: 'active',
            scopes: ['catalog.products.projection'],
        },
        webhook_secret: 'source-provision-secret',
    }, callbackToken);

    assert.equal(item.connection_id, connectionId);
    assert.equal(item.platform_code, 'catalog');
    assert.equal(item.local_platform_tenant_id, sourceTenantId);
    assert.equal(item.remote_platform_tenant_id, targetTenantId);
    assert.equal(item.remote_external_tenant_id, 'catalog:shop:99');
    database.close();
});

test('central plan checkout is validated locally and delegated idempotently', async () => {
    const database = createDatabase();
    const platformTenantId = crypto.randomUUID();
    const planId = crypto.randomUUID();
    const priceId = crypto.randomUUID();
    const snapshot = entitlementSnapshot();
    let checkoutPayload;
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url);
            if (parsed.pathname === '/v1/platform-tenants') {
                return Response.json([{
                    id: platformTenantId,
                    organization_id: organizationId,
                    platform_code: 'wa_savana',
                    external_tenant_id: 'wa_savana:tenant:1',
                }]);
            }
            if (parsed.pathname.endsWith('/subscription-context/wa_savana')) {
                return Response.json({ data: {
                    source: 'savana_subscriptions',
                    managed_centrally: true,
                    organization: { id: organizationId, name: 'Savana tenant' },
                    platform_code: 'wa_savana',
                    subscription_status: 'unsubscribed',
                    subscriptions: [],
                    active_items: [],
                    plans: [{
                        id: planId,
                        name: 'Wa Standard',
                        prices: [{
                            id: priceId,
                            amount_minor: 8000,
                            billing_period: 'monthly',
                            active: true,
                        }],
                    }],
                    bundles: [],
                    entitlement_snapshot: snapshot,
                    invoices: [],
                    ui: {},
                } });
            }
            if (parsed.pathname.endsWith('/checkout') && options.method === 'POST') {
                checkoutPayload = JSON.parse(options.body);
                return Response.json({ data: {
                    subscription: { id: crypto.randomUUID(), status: 'pending_payment' },
                    invoice: { number: 'SAV-TEST', status: 'open' },
                    payment_required: true,
                } }, { status: 201 });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
        config: { ...config, subscriptionsMode: 'central' },
    });

    const result = await service.subscriptionCheckout(1, {
        plan_id: planId,
        price_id: priceId,
        idempotency_key: 'wa-test-checkout-0001',
    }, 'tenant-user');
    assert.equal(result.invoice.number, 'SAV-TEST');
    assert.equal(checkoutPayload.platform_code, 'wa_savana');
    assert.deepEqual(checkoutPayload.items, [{
        plan_id: planId,
        price_id: priceId,
        quantity: 1,
    }]);
    database.close();
});

test('Wa manager can create a central pending-review subscription for a selected tenant', async (t) => {
    let checkoutCall;
    const service = {
        config: {
            enabled: true,
            subscriptionsMode: 'central',
        },
        async subscriptionCheckout(tenantId, payload, actorId) {
            checkoutCall = { tenantId, payload, actorId };
            return {
                subscription: {
                    id: crypto.randomUUID(),
                    status: 'pending_payment',
                },
                invoice: {
                    id: crypto.randomUUID(),
                    number: 'SAV-WA-ADMIN-001',
                    status: 'open',
                },
                payment_required: true,
            };
        },
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'manager-7' };
        next();
    });
    app.use('/central-subscriptions', createAdminSubscriptionsRouter({ service }));
    const server = app.listen(0);
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));

    const response = await fetch(
        `http://127.0.0.1:${server.address().port}/central-subscriptions/42/checkout`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_id: 'plan-wa-standard',
                price_id: 'price-wa-monthly',
                idempotency_key: 'wa-manager-checkout-001',
            }),
        },
    );
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.subscription.status, 'pending_payment');
    assert.equal(body.invoice.status, 'open');
    assert.deepEqual(checkoutCall, {
        tenantId: '42',
        payload: {
            plan_id: 'plan-wa-standard',
            price_id: 'price-wa-monthly',
            idempotency_key: 'wa-manager-checkout-001',
        },
        actorId: 'admin:manager-7',
    });
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

test('central subscription context becomes the tenant billing enforcement source', async () => {
    const database = createDatabase();
    database.prepare("UPDATE tenants SET status = 'Pending' WHERE id = 1").run();
    database.prepare(`
        INSERT INTO users (
            username, password_hash, name, role, tenant_id, is_active
        ) VALUES ('pending-wa-user', 'test-password-hash', 'Pending Wa user', 'user', 1, 0)
    `).run();
    const planId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    const periodStart = '2026-07-01T00:00:00+00:00';
    const periodEnd = '2026-08-01T00:00:00+00:00';
    const snapshot = entitlementSnapshot();
    const fetchImpl = async url => {
        const parsed = new URL(url);
        if (parsed.pathname === '/v1/platform-tenants') {
            assert.equal(parsed.searchParams.get('platform_code'), 'wa_savana');
            assert.equal(parsed.searchParams.get('external_tenant_id'), 'wa_savana:tenant:1');
            return Response.json([{
                id: crypto.randomUUID(),
                organization_id: organizationId,
                platform_code: 'wa_savana',
                external_tenant_id: 'wa_savana:tenant:1',
            }]);
        }
        if (parsed.pathname.endsWith('/subscription-context/wa_savana')) {
            return Response.json({ data: {
                source: 'savana_subscriptions',
                managed_centrally: true,
                platform_code: 'wa_savana',
                subscription_status: 'active',
                active_items: [{
                    id: itemId,
                    plan_id: planId,
                    plan_name: 'Wa Central',
                    billing_period: 'monthly',
                }],
                plans: [{
                    id: planId,
                    code: 'wa_standard',
                    name: 'Wa Central',
                    description: 'Central plan',
                    prices: [{
                        billing_period: 'monthly',
                        amount_minor: 4500,
                        currency: 'LYD',
                        active: true,
                    }],
                }],
                subscriptions: [{
                    id: subscriptionId,
                    status: 'active',
                    current_period_start: periodStart,
                    current_period_end: periodEnd,
                    items: [{ id: itemId, plan_id: planId }],
                }],
                entitlement_snapshot: snapshot,
                invoices: [],
                ui: {},
            } });
        }
        return Response.json({ error: 'unexpected request' }, { status: 500 });
    };
    const service = new SavanaIntegrationService({
        database,
        fetchImpl,
        config: { ...config, subscriptionsMode: 'central' },
    });

    const context = await service.synchronizeCentralSubscription(1);
    assert.equal(context.active_plan.name, 'Wa Central');
    assert.equal(context.bound, true);
    const account = database.prepare(
        'SELECT * FROM tenant_billing_accounts WHERE tenant_id = 1'
    ).get();
    assert.equal(account.plan_balance_credits, 10000);
    assert.equal(account.credit_limit_credits, 250);
    assert.equal(account.billing_cycle_start, periodStart);
    assert.equal(account.billing_cycle_end, periodEnd);
    assert.equal(account.status, 'active');
    assert.equal(
        database.prepare('SELECT status FROM tenants WHERE id = 1').get().status,
        'Active',
    );
    assert.equal(
        database.prepare("SELECT is_active FROM users WHERE username = 'pending-wa-user'").get().is_active,
        1,
    );
    assert.equal(
        database.prepare(`
            SELECT COUNT(*) AS count FROM activity_logs
            WHERE tenant_id = 1 AND event_type = 'central_subscription_activated'
        `).get().count,
        1,
    );
    const shadowPlan = database.prepare(
        'SELECT * FROM billing_plans WHERE id = ?'
    ).get(account.plan_id);
    assert.equal(shadowPlan.name, 'Wa Central');
    assert.equal(shadowPlan.is_active, 0);

    database.prepare(
        'UPDATE tenant_billing_accounts SET plan_balance_credits = 7500 WHERE tenant_id = 1'
    ).run();
    await service.synchronizeCentralSubscription(1);
    assert.equal(
        database.prepare(
            'SELECT plan_balance_credits FROM tenant_billing_accounts WHERE tenant_id = 1'
        ).get().plan_balance_credits,
        7500,
    );
    assert.equal(
        database.prepare(`
            SELECT COUNT(*) AS count FROM activity_logs
            WHERE tenant_id = 1 AND event_type = 'central_subscription_activated'
        `).get().count,
        1,
    );
    database.close();
});

test('pending central payment keeps the Wa account under review', async () => {
    const database = createDatabase();
    database.prepare("UPDATE tenants SET status = 'Pending' WHERE id = 1").run();
    database.prepare(`
        INSERT INTO users (
            username, password_hash, name, role, tenant_id, is_active
        ) VALUES ('pending-payment-user', 'test-password-hash', 'Pending payment', 'user', 1, 0)
    `).run();
    const service = new SavanaIntegrationService({
        database,
        fetchImpl: async () => Response.json({ error: 'unexpected request' }, { status: 500 }),
        config: { ...config, subscriptionsMode: 'central' },
    });
    service.subscriptionContext = async () => ({
        source: 'savana_subscriptions',
        managed_centrally: true,
        bound: true,
        platform_code: 'wa_savana',
        subscription_status: 'pending_payment',
        subscriptions: [],
        active_items: [],
        plans: [],
        bundles: [],
        entitlement_snapshot: null,
        invoices: [],
        ui: {},
    });

    await service.synchronizeCentralSubscription(1);

    assert.equal(
        database.prepare('SELECT status FROM tenants WHERE id = 1').get().status,
        'Pending',
    );
    assert.equal(
        database.prepare("SELECT is_active FROM users WHERE username = 'pending-payment-user'").get().is_active,
        0,
    );
    assert.equal(
        database.prepare(`
            SELECT COUNT(*) AS count FROM activity_logs
            WHERE tenant_id = 1 AND event_type = 'central_subscription_activated'
        `).get().count,
        0,
    );
    database.close();
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
    const sharedProduct = database.prepare(`
        SELECT sku, name, price, savana_projection_key, is_active
        FROM bot_products WHERE tenant_id = 1 AND sku = 'CAT-1'
    `).get();
    assert.equal(sharedProduct.name, 'Catalog product');
    assert.equal(sharedProduct.price, 12.5);
    assert.ok(sharedProduct.savana_projection_key);
    assert.equal(sharedProduct.is_active, 1);
    const request = database.prepare('SELECT * FROM savana_service_requests').get();
    assert.equal(request.request_kind, 'order_notification');
    assert.equal(request.status, 'pending_review');
    assert.equal(service.diagnostics(service.get(1, 'catalog')).counts.pending_service_requests, 1);
    database.close();
});
