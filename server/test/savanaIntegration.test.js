import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import express from 'express';
import { createSavanaLifecycleFixture, savanaLifecycleDelivery } from '../test-support/savanaLifecycleFixture.js';

import {
    createAdminSubscriptionsRouter,
    createTenantIntegrationsRouter,
} from '../routes/savanaIntegrations.js';
import {
    canonicalJson,
    SavanaIntegrationError,
    SavanaIntegrationService,
    signWebhook,
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

const entitlementSnapshot = ({
    entitled = true,
    integrationsEnabled = undefined,
    secret = signingSecret,
} = {}) => {
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
            ...(integrationsEnabled === undefined
                ? {}
                : { 'savana.integrations.enabled': integrationsEnabled }),
            'wa_savana.credits.monthly': 10000,
            'wa_savana.credit_limit.default': 250,
        },
    };
    return {
        payload,
        signature: `v1=${crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex')}`,
    };
};

const createFetch = ({ entitled = true, badSignature = false } = {}) => createSavanaLifecycleFixture({ fetchImpl: async (url, options) => {
    const pathName = new URL(url).pathname;
    if (pathName.includes('/entitlements/')) {
        const snapshot = entitlementSnapshot({ entitled });
        if (badSignature) snapshot.signature = 'v1=invalid';
        return Response.json({ data: snapshot });
    }
    if (pathName === '/v1/platform-bindings' && options.method === 'GET') {
        return Response.json([{
            id: 'wa-savana-tenant-id',
            organization_id: organizationId,
            platform_code: 'wa_savana',
            external_tenant_id: 'wa_savana:tenant:1',
        }]);
    }
    if (pathName === '/v1/platform-connection-candidates' && options.method === 'GET') {
        return Response.json({
            organization: { id: organizationId, name: 'Wa test organization' },
            source_tenant: {
                id: 'wa-savana-tenant-id',
                organization_id: organizationId,
                platform_code: 'wa_savana',
                external_tenant_id: 'wa_savana:tenant:1',
            },
            target_platform_code: 'pos',
            candidates: [{
                id: 'pos-tenant-id',
                external_tenant_id: 'pos-company-1',
                display_name: 'POS account',
                connectable: true,
            }],
        });
    }
    if (pathName === '/v1/platform-connections/requests' && options.method === 'POST') {
        return Response.json({
            connection: {
                id: 'connection-1',
                organization_id: organizationId,
                source_tenant_id: 'wa-savana-tenant-id',
                target_tenant_id: 'pos-tenant-id',
                source_platform: 'wa_savana',
                target_platform: 'pos',
                source_external_tenant_id: 'wa_savana:tenant:1',
                target_external_tenant_id: 'pos-company-1',
                status: 'pending_authorization',
                lifecycle_version: 0,
                scopes: ['pos.sales.events'],
            },
            target_tenant: {
                id: 'pos-tenant-id',
                external_tenant_id: 'pos-company-1',
            },
            approval_required: true,
        }, { status: 201 });
    }
    if (pathName === '/v1/events' && options.method === 'POST') {
        return Response.json({ event_id: crypto.randomUUID(), duplicate: false }, { status: 202 });
    }
    return Response.json({ error: 'unexpected request' }, { status: 500 });
} });

const config = {
    enabled: true,
    connectUrl: 'https://connect.test',
    connectPlatformToken: 'wa-savana-connect-platform-token',
    callbackUrl: 'https://wa.test/integrations/connect/events',
    callbackToken,
    subscriptionsUrl: 'https://subscriptions.test',
    subscriptionsPlatformToken: 'wa-savana-subscriptions-platform-token',
    subscriptionsSigningSecret: signingSecret,
    subscriptionsMode: 'central',
    publicAppUrl: 'https://wa.test',
    timeoutMs: 1000,
};

test('production callback policy permits only HTTPS or the canonical private Docker service', () => {
    assert.doesNotThrow(() => validateIntegrationConfig(config, { NODE_ENV: 'production' }));
    assert.throws(
        () => validateIntegrationConfig({ ...config, publicAppUrl: 'http://wa.test' }, {
            NODE_ENV: 'production',
        }),
        /PUBLIC_APP_URL must use HTTPS/,
    );
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

test('production integration policy requires distinct secrets and trusted service URLs', () => {
    assert.doesNotThrow(() => validateIntegrationConfig({
        ...config,
        connectUrl: 'http://savana-connect:8010',
        subscriptionsUrl: 'http://savana-subscriptions:8020',
    }, { NODE_ENV: 'production' }));
    assert.throws(
        () => validateIntegrationConfig({
            ...config,
            subscriptionsPlatformToken: config.callbackToken,
        }, { NODE_ENV: 'production' }),
        /must be distinct/,
    );
    assert.throws(
        () => validateIntegrationConfig({
            ...config,
            connectUrl: 'http://connect.example.test:8010',
        }, { NODE_ENV: 'production' }),
        /must use HTTPS/,
    );
    assert.throws(
        () => validateIntegrationConfig({
            ...config,
            subscriptionsMode: 'local',
        }, { NODE_ENV: 'production' }),
        /must be central/,
    );
});

test('tenant platform list reflects the targets enabled by Savana Connect', async (t) => {
    const database = createDatabase();
    const snapshot = entitlementSnapshot({ entitled: false, integrationsEnabled: true });
    let targetRequest;
    const service = new SavanaIntegrationService({
        database,
        config,
        fetchImpl: async (url, options) => {
            const pathName = new URL(url).pathname;
            if (pathName === '/v1/platform-targets') {
                targetRequest = { url: new URL(url), options };
                return Response.json([
                    { code: 'sawemly', display_name: 'Sawemly' },
                    { code: 'wa_savana', display_name: 'Wa Savana' },
                    { code: 'future_platform', display_name: 'Future platform' },
                ]);
            }
            if (pathName === '/v1/platform-bindings') {
                return Response.json([{ organization_id: organizationId }]);
            }
            if (pathName.endsWith('/subscription-context/wa_savana')) {
                return Response.json({ data: {
                    managed_centrally: true,
                    organization: { id: organizationId },
                    entitlement_snapshot: snapshot,
                } });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
    });
    const app = express();
    app.use((req, _res, next) => {
        req.user = { id: 'tenant-user', tenant_id: 1 };
        next();
    });
    app.use('/integrations', createTenantIntegrationsRouter({ database, service }));
    const server = app.listen(0);
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    t.after(() => database.close());

    const response = await fetch(
        `http://127.0.0.1:${server.address().port}/integrations/platforms`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(targetRequest.url.pathname, '/v1/platform-targets');
    assert.equal(targetRequest.options.method, 'GET');
    assert.equal(
        targetRequest.options.headers['X-Savana-Platform-Code'],
        'wa_savana'
    );
    assert.equal(
        targetRequest.options.headers['X-Savana-Platform-Token'],
        config.connectPlatformToken
    );
    assert.deepEqual(
        body.data.map(item => [item.platform_code, item.available, item.subscription_entitled]),
        [
            ['pos', false, true],
            ['catalog', false, true],
            ['sawemly', true, true],
        ]
    );
    assert.equal(body.data.find(item => item.platform_code === 'sawemly').status, 'disconnected');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_integrations').get().count, 0);
});

test('subscription entitlement is unknown when unbound or the central source fails', async (t) => {
    const database = createDatabase();
    const snapshot = entitlementSnapshot({ entitled: false });
    const service = new SavanaIntegrationService({
        database,
        config,
        fetchImpl: async (url) => {
            const pathName = new URL(url).pathname;
            if (pathName === '/v1/platform-targets') {
                return Response.json([{ code: 'sawemly' }]);
            }
            throw new Error('central service unavailable');
        },
    });
    t.after(() => database.close());
    assert.equal(service.subscriptionIntegrationEntitlement({
        managed_centrally: true,
        bound: false,
    }, 'sawemly'), null);
    assert.equal(service.subscriptionIntegrationEntitlement({
        managed_centrally: true,
        bound: true,
        entitlement_snapshot: snapshot,
    }, 'sawemly'), false);
    assert.equal(service.subscriptionIntegrationEntitlement({
        managed_centrally: true,
        bound: true,
    }, 'sawemly'), null);

    const app = express();
    app.use((req, _res, next) => {
        req.user = { id: 'tenant-user', tenant_id: 1 };
        next();
    });
    app.use('/integrations', createTenantIntegrationsRouter({ database, service }));
    const server = app.listen(0);
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        const response = await fetch(
            `http://127.0.0.1:${server.address().port}/integrations/platforms`
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data.find(item => item.platform_code === 'sawemly').subscription_entitled, null);
    } finally {
        console.warn = originalWarn;
    }
});

test('malformed platform target discovery preserves the local list as unavailable', async () => {
    const database = createDatabase();
    const service = new SavanaIntegrationService({
        database,
        config,
        fetchImpl: async () => Response.json({ data: [] }),
    });
    const originalConsoleError = console.error;
    const logged = [];
    console.error = (...values) => logged.push(values.join(' '));

    try {
        assert.deepEqual(await service.availablePlatforms(), []);
        assert.match(logged.join('\n'), /discovery failed closed/);
    } finally {
        console.error = originalConsoleError;
        database.close();
    }
});

const provision = async (database, fetchImpl = createFetch()) => {
    const current = createSavanaLifecycleFixture({ fetchImpl });
    const service = new SavanaIntegrationService({ database, fetchImpl: current, config });
    const connection = current.setConnection({
            id: 'connection-1',
            organization_id: organizationId,
            source_tenant_id: 'pos-tenant-id',
            target_tenant_id: 'wa-savana-tenant-id',
            source_platform: 'pos',
            target_platform: 'wa_savana',
            source_external_tenant_id: 'pos-company-1',
            target_external_tenant_id: 'wa_savana:tenant:1',
            status: 'active',
            lifecycle_version: 1,
            scopes: ['pos.sales.events'],
    });
    const item = await service.provisionConnection({ connection,
        webhook_secret: 'wa-savana-connection-secret',
    }, callbackToken);
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

const deliver = (
    service,
    payload,
    {
        connectionId = 'connection-1',
        callback = callbackToken,
        secret = 'wa-savana-connection-secret',
        signature = null,
    } = {},
) => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const deliveryId = crypto.randomUUID();
    return service.receiveEvent(
        connectionId,
        callback,
        deliveryId,
        timestamp,
        signature || signWebhook(secret, timestamp, deliveryId, rawBody),
        rawBody,
    );
};

test('maintenance preserves integration outbox bytes and resumes the same event once', async t => {
    const database = createDatabase();
    const previous = process.env.SAVANA_EGRESS_MAINTENANCE;
    t.after(() => {
        database.close();
        if (previous === undefined) delete process.env.SAVANA_EGRESS_MAINTENANCE;
        else process.env.SAVANA_EGRESS_MAINTENANCE = previous;
    });
    const calls = [];
    const baseFetch = createFetch();
    const { service, item } = await provision(database, async (url, options) => {
        if (new URL(url).pathname === '/v1/events') calls.push({ url, options });
        return baseFetch(url, options);
    });
    const queued = service.queueNotificationStatus(item, { request_id: 'maintenance-request', status: 'delivered' });
    const before = database.prepare('SELECT * FROM savana_integration_outbox').all();
    process.env.SAVANA_EGRESS_MAINTENANCE = 'true';
    assert.deepEqual(await service.dispatchOutbox(), []);
    assert.deepEqual(await service.retryOutbox(item), { paused: true, queued: 0, published: 0, failed: 0 });
    assert.deepEqual(database.prepare('SELECT * FROM savana_integration_outbox').all(), before);
    assert.equal(calls.length, 0);
    process.env.SAVANA_EGRESS_MAINTENANCE = 'false';
    const result = await service.dispatchOutbox();
    assert.equal(result[0].event_id, queued.record.event_id);
    assert.equal(result[0].status, 'published');
    await service.dispatchOutbox();
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].options.body).event_id, before[0].event_id);
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
        'savana_integration_outbox',
        'savana_product_snapshot_streams',
        'savana_product_snapshot_pages',
        'savana_product_snapshot_memberships',
        'savana_delegated_read_sessions',
        'savana_delegated_read_flows',
        'savana_delegated_read_audit',
        'savana_operational_owner_sessions',
        'savana_operational_read_actions',
        'savana_operational_consumer_enrollments',
        'savana_operational_consumer_enrollment_audit',
        'savana_owner_portal_sessions',
        'savana_owner_portal_intents',
        'savana_owner_portal_audit',
        'savana_collaborative_executions',
        'savana_collaborative_effects',
        'savana_collaborative_nonces',
        'savana_collaborative_command_receipts',
        'savana_collaborative_correlations',
        'savana_collaborative_provider_evidence',
        'savana_workspace_intents',
        'savana_workspace_intent_audit',
        'savana_collaborative_consents',
        'savana_collaborative_consent_audit',
        'savana_native_owner_proofs',
        'savana_native_owner_proof_audit',
        'savana_native_enrollment_service_audit',
        'savana_workspace_receipts',
        'savana_workspace_review_fences',
        'savana_native_action_facts',
        'savana_native_media_assets',
        'savana_lifecycle_state',
    ]));
    for(const table of ['savana_collaborative_executions','savana_collaborative_effects','savana_workspace_intents',
        'savana_collaborative_consents','savana_native_owner_proofs','savana_workspace_receipts','savana_workspace_review_fences',
        'savana_native_action_facts','savana_native_media_assets','savana_lifecycle_state'])assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0,
            'Schema migration must not invent business actions, consent, identity links or ownership receipts');
    assert.equal(database.pragma('foreign_key_check').length, 0);
    database.close();
});

test('organization authorization is started for the exact authenticated tenant', async () => {
    const database = createDatabase();
    let authorizationPayload;
    const service = new SavanaIntegrationService({
        database,
        config,
        fetchImpl: async (url, options) => {
            const parsed = new URL(url);
            if (
                parsed.pathname === '/v1/platform-authorizations'
                && options.method === 'POST'
            ) {
                authorizationPayload = JSON.parse(options.body);
                return Response.json({
                    id: crypto.randomUUID(),
                    status: 'pending',
                    authorization_url: (
                        'https://control.example/?authorization_request=test'
                    ),
                }, { status: 201 });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
    });

    const result = await service.startBindingAuthorization(
        1,
        'https://wa.example/portal/integrations',
        'c'.repeat(64),
        42,
    );

    assert.equal(result.status, 'pending');
    assert.deepEqual(authorizationPayload, {
        external_tenant_id: 'wa_savana:tenant:1',
        display_name: 'Wa tenant',
        redirect_uri: 'https://wa.example/portal/integrations',
        state: 'c'.repeat(64),
        actor_id: '42',
    });
    database.close();
});

test('approved POS provisioning is centrally entitled and supports explicit lifecycle control', async () => {
    const database = createDatabase();
    const { service, item } = await provision(database);
    assert.equal(item.status, 'active');
    assert.equal(service.hasEntitlement(item), true);
    assert.equal(service.serialize(item).independent_mode, true);
    assert.equal((await service.refreshStatus(item)).status, 'active');
    assert.equal(service.lifecycle.read(item.connection_id).version, 1);
    assert.equal((await service.transition(service.get(1), 'pause', 'tenant')).status, 'paused');
    assert.equal(service.lifecycle.read(item.connection_id).version, 2);
    assert.equal((await service.transition(service.get(1), 'resume', 'tenant')).status, 'active');
    assert.equal(service.lifecycle.read(item.connection_id).version, 3);
    assert.equal((await service.transition(service.get(1), 'revoke', 'tenant')).status, 'revoked');
    assert.equal(service.lifecycle.read(item.connection_id).version, 4);
    database.close();
});

test('link request discovers the bound account and waits for target approval', async () => {
    const database = createDatabase();
    const sourceTenantId = crypto.randomUUID();
    const targetTenantId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const snapshot = entitlementSnapshot();
    const fetchImpl = createSavanaLifecycleFixture({ fetchImpl: async (url, options = {}) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/v1/platform-bindings' && options.method === 'GET') {
            return Response.json([{
                id: sourceTenantId,
                organization_id: organizationId,
                platform_code: 'wa_savana',
                external_tenant_id: 'wa_savana:tenant:1',
            }]);
        }
        if (parsed.pathname === '/v1/platform-connection-candidates' && options.method === 'GET') {
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
        if (parsed.pathname === '/v1/platform-connections/requests' && options.method === 'POST') {
            assert.deepEqual(JSON.parse(options.body), {
                source_external_tenant_id: 'wa_savana:tenant:1',
                actor_id: 'tenant-user',
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
                    status: 'pending_authorization',
                    lifecycle_version: 0,
                    scopes: ['catalog.products.projection'],
                },
                target_tenant: {
                    id: targetTenantId,
                    external_tenant_id: 'catalog:shop:42',
                },
                approval_required: true,
            }, { status: 201 });
        }
        return Response.json({ error: 'unexpected request' }, { status: 500 });
    } });
    const service = new SavanaIntegrationService({
        database,
        fetchImpl,
        config: { ...config, subscriptionsMode: 'central' },
    });

    const item = await service.requestConnection(1, {}, 'tenant-user', 'catalog');
    assert.equal(item.status, 'pending_authorization');
    assert.equal(item.connection_id, connectionId);
    assert.equal(service.lifecycle.read(connectionId).version, 0);
    assert.equal(item.remote_external_tenant_id, 'catalog:shop:42');
    assert.equal(service.serialize(item, 'catalog').entitled, true);
    database.close();
});

test('authenticated one-click provisioning configures Wa Savana as the target', async () => {
    const database = createDatabase();
    const snapshot = entitlementSnapshot();
    const fetchImpl = createSavanaLifecycleFixture({ fetchImpl: async url => {
            if (new URL(url).pathname.includes('/entitlements/')) {
                return Response.json({ data: snapshot });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
    } });
    const service = new SavanaIntegrationService({ database, fetchImpl, config });
    const connectionId = crypto.randomUUID();
    const connection = fetchImpl.setConnection({
            id: connectionId,
            organization_id: organizationId,
            source_tenant_id: crypto.randomUUID(),
            target_tenant_id: crypto.randomUUID(),
            source_platform: 'catalog',
            target_platform: 'wa_savana',
            source_external_tenant_id: 'catalog:shop:42',
            target_external_tenant_id: 'wa_savana:tenant:1',
            status: 'active',
            lifecycle_version: 1,
            scopes: ['catalog.products.projection'],
    });
    const item = await service.provisionConnection({ connection,
        webhook_secret: 'target-provision-secret',
    }, callbackToken);

    assert.equal(item.connection_id, connectionId);
    assert.equal(item.platform_code, 'catalog');
    assert.equal(item.remote_external_tenant_id, 'catalog:shop:42');
    assert.equal(item.status, 'active');
    const degradedConnection = fetchImpl.setConnection({ ...connection, status: 'degraded', lifecycle_version: 2 });
    const degraded = await service.applyLifecycle({
        connection: degradedConnection,
        action: 'degraded',
    }, callbackToken, savanaLifecycleDelivery(degradedConnection));
    assert.equal(degraded.status, 'degraded');
    assert.notEqual(degraded.webhook_secret_encrypted, null);
    const revokedConnection = fetchImpl.setConnection({ ...connection, status: 'revoked', lifecycle_version: 3 });
    const revoked = await service.applyLifecycle({
        connection: revokedConnection,
        action: 'revoked',
    }, callbackToken, savanaLifecycleDelivery(revokedConnection));
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
    const fetchImpl = createSavanaLifecycleFixture({ fetchImpl: async url => {
            if (new URL(url).pathname.includes('/entitlements/')) {
                return Response.json({ data: snapshot });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
    } });
    const service = new SavanaIntegrationService({ database, fetchImpl, config });
    const sourceTenantId = crypto.randomUUID();
    const targetTenantId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const connection = fetchImpl.setConnection({
            id: connectionId,
            organization_id: organizationId,
            source_tenant_id: sourceTenantId,
            target_tenant_id: targetTenantId,
            source_platform: 'wa_savana',
            target_platform: 'catalog',
            source_external_tenant_id: 'wa_savana:tenant:1',
            target_external_tenant_id: 'catalog:shop:99',
            status: 'active',
            lifecycle_version: 1,
            scopes: ['catalog.products.projection'],
    });
    const item = await service.provisionConnection({ connection,
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
            if (parsed.pathname === '/v1/platform-bindings') {
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
    assert.equal(checkoutPayload.period_days, 30);
    assert.equal(checkoutPayload.actor_id, 'tenant:1:user:tenant-user');
    assert.match(checkoutPayload.idempotency_key, /^wa-savana:tenant:1:checkout:[0-9a-f]{64}$/);
    database.close();
});

test('central checkout retry keys are stable per tenant and isolated across tenants in one organization', async () => {
    const database = createDatabase();
    database.prepare("INSERT INTO tenants (id, name, phone, status) VALUES (2, 'Second Wa tenant', '218910000002', 'Active')").run();
    const planId = crypto.randomUUID();
    const priceId = crypto.randomUUID();
    const checkoutPayloads = [];
    const service = new SavanaIntegrationService({
        database,
        config: { ...config, subscriptionsMode: 'central' },
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url);
            if (parsed.pathname === '/v1/platform-bindings') {
                const externalTenantId = parsed.searchParams.get('external_tenant_id');
                return Response.json([{
                    id: crypto.randomUUID(),
                    organization_id: organizationId,
                    platform_code: 'wa_savana',
                    external_tenant_id: externalTenantId,
                }]);
            }
            if (parsed.pathname.endsWith('/subscription-context/wa_savana')) {
                return Response.json({ data: {
                    managed_centrally: true,
                    organization: { id: organizationId },
                    platform_code: 'wa_savana',
                    plans: [{ id: planId, prices: [{
                        id: priceId, active: true, billing_period: 'monthly',
                    }] }],
                    bundles: [],
                } });
            }
            if (parsed.pathname.endsWith('/checkout')) {
                checkoutPayloads.push(JSON.parse(options.body));
                return Response.json({ data: { invoice: { number: 'SAV-TEST' } } }, { status: 201 });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
    });
    const selection = {
        plan_id: planId,
        price_id: priceId,
        idempotency_key: 'shared-client-retry-key',
    };

    await service.subscriptionCheckout(1, selection, 'same-user-id');
    await service.subscriptionCheckout(1, selection, 'same-user-id');
    await service.subscriptionCheckout(2, selection, 'same-user-id');
    assert.equal(checkoutPayloads[0].idempotency_key, checkoutPayloads[1].idempotency_key);
    assert.notEqual(checkoutPayloads[0].idempotency_key, checkoutPayloads[2].idempotency_key);
    assert.ok(checkoutPayloads.every(item => item.idempotency_key.length <= 255));
    assert.equal(checkoutPayloads[0].actor_id, 'tenant:1:user:same-user-id');
    assert.equal(checkoutPayloads[2].actor_id, 'tenant:2:user:same-user-id');
    await assert.rejects(
        () => service.subscriptionCheckout(1, { ...selection, idempotency_key: 12345 }),
        error => error instanceof SavanaIntegrationError
            && error.code === 'invalid_idempotency_key',
    );
    assert.equal(checkoutPayloads.length, 3);
    database.close();
});

test('central checkout derives annual and bundle periods from central pricing', async () => {
    const database = createDatabase();
    const planId = crypto.randomUUID();
    const priceId = crypto.randomUUID();
    const bundleId = crypto.randomUUID();
    const checkoutPayloads = [];
    const quotePayloads = [];
    let bundlePeriod = 'monthly';
    let bundlePriceAvailable = true;
    const service = new SavanaIntegrationService({
        database,
        config: { ...config, subscriptionsMode: 'central' },
        fetchImpl: async (url, options = {}) => {
            const path = new URL(url).pathname;
            if (path === '/v1/platform-bindings') {
                return Response.json([{
                    id: crypto.randomUUID(),
                    organization_id: organizationId,
                    platform_code: 'wa_savana',
                    external_tenant_id: 'wa_savana:tenant:1',
                }]);
            }
            if (path.endsWith('/subscription-context/wa_savana')) {
                return Response.json({ data: {
                    managed_centrally: true,
                    organization: { id: organizationId },
                    platform_code: 'wa_savana',
                    plans: [{ id: planId, prices: [{
                        id: priceId, active: true, billing_period: 'yearly',
                    }] }],
                    bundles: [{ id: bundleId, active: true,
                        price_available: bundlePriceAvailable,
                        billing_period: bundlePeriod }],
                } });
            }
            if (path.endsWith('/checkout-quote')) {
                quotePayloads.push(JSON.parse(options.body));
                return Response.json({ data: {
                    base_amount_minor: 8000,
                    catalog_fingerprint: 'a'.repeat(64),
                    upgrade_credit_minor: 2000,
                    subtotal_minor: 6000,
                    discount_minor: 0,
                    tax_minor: 0,
                    total_minor: 6000,
                    currency: 'LYD',
                } });
            }
            if (path.endsWith('/checkout')) {
                checkoutPayloads.push(JSON.parse(options.body));
                return Response.json({ data: { invoice: { number: 'SAV-TEST' } } }, { status: 201 });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
    });

    const annualQuote = await service.subscriptionCheckoutQuote(1, {
        plan_id: planId,
        price_id: priceId,
        period_days: 1,
    });
    assert.equal(annualQuote.total_minor, 6000);
    assert.equal(quotePayloads[0].period_days, 365);
    assert.deepEqual(quotePayloads[0].items, [{
        plan_id: planId, price_id: priceId, quantity: 1,
    }]);
    assert.equal('actor_id' in quotePayloads[0], false);
    assert.equal('idempotency_key' in quotePayloads[0], false);
    assert.equal(checkoutPayloads.length, 0);

    await service.subscriptionCheckout(1, {
        plan_id: planId,
        price_id: priceId,
        period_days: 1,
        expected_total_minor: annualQuote.total_minor,
        expected_catalog_fingerprint: annualQuote.catalog_fingerprint,
        idempotency_key: 'annual-checkout-test',
    });
    assert.equal(checkoutPayloads[0].period_days, 365);
    assert.equal(checkoutPayloads[0].expected_total_minor, annualQuote.total_minor);
    assert.equal(checkoutPayloads[0].expected_catalog_fingerprint, annualQuote.catalog_fingerprint);
    assert.deepEqual(checkoutPayloads[0].items, quotePayloads[0].items);

    await service.subscriptionCheckoutQuote(1, {
        bundle_id: bundleId,
        period_days: 1,
    });
    assert.equal(quotePayloads[1].bundle_id, bundleId);
    assert.equal(quotePayloads[1].period_days, 30);
    await service.subscriptionCheckout(1, {
        bundle_id: bundleId,
        period_days: 1,
        expected_total_minor: 0,
        idempotency_key: 'bundle-checkout-test',
    });
    assert.equal(checkoutPayloads[1].bundle_id, bundleId);
    assert.equal(checkoutPayloads[1].period_days, 30);
    assert.equal(checkoutPayloads[1].expected_total_minor, 0);
    assert.equal('expected_catalog_fingerprint' in checkoutPayloads[1], false);

    for (const fingerprint of [null, 123, '', 'a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64)]) {
        await assert.rejects(
            () => service.subscriptionCheckout(1, {
                bundle_id: bundleId, expected_catalog_fingerprint: fingerprint,
            }),
            error => error instanceof SavanaIntegrationError
                && error.code === 'invalid_expected_catalog_fingerprint',
        );
    }

    await assert.rejects(
        () => service.subscriptionCheckout(1, {
            bundle_id: bundleId, expected_total_minor: -1,
        }),
        error => error instanceof SavanaIntegrationError
            && error.code === 'invalid_expected_checkout_total',
    );

    bundlePeriod = null;
    await assert.rejects(
        () => service.subscriptionCheckout(1, { bundle_id: bundleId }),
        error => error instanceof SavanaIntegrationError
            && error.code === 'central_billing_period_unavailable',
    );
    bundlePriceAvailable = false;
    await assert.rejects(
        () => service.subscriptionCheckout(1, { bundle_id: bundleId }),
        error => error instanceof SavanaIntegrationError
            && error.code === 'central_bundle_price_unavailable',
    );
    assert.equal(checkoutPayloads.length, 2);
    database.close();
});

test('tenant payment intents use only an open invoice visible to that tenant', async () => {
    const database = createDatabase();
    database.prepare("INSERT INTO tenants (id, name, phone, status) VALUES (2, 'Other tenant', '218910000002', 'Active')").run();
    const ownInvoiceId = crypto.randomUUID();
    const otherInvoiceId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const intentRequests = [];
    let ownInvoiceStatus = 'open';
    let invoiceDetails = {};
    let visibleIntents = [];
    const service = new SavanaIntegrationService({
        database,
        config: {
            ...config,
            subscriptionsMode: 'central',
            publicAppUrl: 'https://wa.test',
        },
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url);
            if (parsed.pathname === '/v1/platform-bindings') {
                const tenantId = parsed.searchParams.get('external_tenant_id') === 'wa_savana:tenant:1' ? 1 : 2;
                return Response.json([{
                    id: crypto.randomUUID(),
                    organization_id: tenantId === 1 ? organizationId : otherOrganizationId,
                    platform_code: 'wa_savana',
                    external_tenant_id: `wa_savana:tenant:${tenantId}`,
                }]);
            }
            if (parsed.pathname.endsWith('/subscription-context/wa_savana')) {
                const isOwn = parsed.pathname.includes(organizationId);
                return Response.json({ data: {
                    managed_centrally: true,
                    organization: { id: isOwn ? organizationId : otherOrganizationId },
                    platform_code: 'wa_savana',
                    payment_methods: ['moamalat', 'cash'],
                    invoices: [{ id: isOwn ? ownInvoiceId : otherInvoiceId,
                        status: isOwn ? ownInvoiceStatus : 'open', ...invoiceDetails }],
                    payment_intents: isOwn ? visibleIntents : [],
                } });
            }
            if (parsed.pathname.endsWith('/payment-intents')) {
                intentRequests.push({ path: parsed.pathname, options });
                const provider = JSON.parse(options.body).provider;
                return Response.json({ data: {
                    checkout_url: provider === 'moamalat'
                        ? 'https://payments.test/checkout/session-1'
                        : null,
                    status: 'pending',
                } }, { status: 201 });
            }
            return Response.json({ error: 'unexpected request' }, { status: 500 });
        },
    });

    await assert.rejects(
        () => service.createSubscriptionPaymentIntent(1, {
            invoice_id: otherInvoiceId,
            provider: 'moamalat',
        }, 'user-1'),
        error => error instanceof SavanaIntegrationError && error.code === 'invoice_not_found'
            && error.statusCode === 404,
    );
    assert.equal(intentRequests.length, 0);

    ownInvoiceStatus = 'paid';
    await assert.rejects(
        () => service.createSubscriptionPaymentIntent(1, {
            invoice_id: ownInvoiceId,
            provider: 'moamalat',
        }, 'user-1'),
        error => error instanceof SavanaIntegrationError && error.code === 'invoice_not_payable'
            && error.statusCode === 409,
    );
    assert.equal(intentRequests.length, 0);
    ownInvoiceStatus = 'open';

    const intent = await service.createSubscriptionPaymentIntent(1, {
        invoice_id: ownInvoiceId,
        provider: 'moamalat',
    }, 'user-1');
    assert.equal(intent.checkout_url, 'https://payments.test/checkout/session-1');
    assert.equal(intentRequests.length, 1);
    assert.equal(intentRequests[0].path,
        `/v1/organizations/${organizationId}/invoices/${ownInvoiceId}/payment-intents`);
    assert.equal(intentRequests[0].options.headers['X-Savana-Platform-Code'], 'wa_savana');
    assert.deepEqual(JSON.parse(intentRequests[0].options.body), {
        provider: 'moamalat',
        return_url: 'https://wa.test/portal/billing',
        idempotency_key: `wa-savana:moamalat:${ownInvoiceId}`,
        actor_id: 'wa_savana:tenant:1:user:user-1',
    });

    await service.createSubscriptionPaymentIntent(1, {
        invoice_id: ownInvoiceId,
        provider: 'moamalat',
        idempotency_key: 'different-client-key-ignored',
    }, 'user-1');
    assert.equal(JSON.parse(intentRequests[1].options.body).idempotency_key,
        `wa-savana:moamalat:${ownInvoiceId}`);

    visibleIntents = [{
        id: crypto.randomUUID(),
        invoice_id: ownInvoiceId,
        provider: 'moamalat',
        status: 'pending',
        checkout_url: intent.checkout_url,
    }];
    await assert.rejects(
        () => service.createSubscriptionPaymentIntent(1, {
            invoice_id: ownInvoiceId,
            provider: 'cash',
        }, 'user-1'),
        error => error instanceof SavanaIntegrationError
            && error.code === 'payment_method_already_selected',
    );
    const resumed = await service.createSubscriptionPaymentIntent(1, {
        invoice_id: ownInvoiceId,
        provider: 'moamalat',
    }, 'user-1');
    assert.equal(resumed.checkout_url, intent.checkout_url);
    assert.equal(intentRequests.length, 2);
    for (const details of [
        { payable: false },
        ...['cancelled', 'expired', 'void'].map(subscription_status => ({ subscription_status })),
        { checkout_expires_at: '2020-01-01T00:00:00Z' },
        { checkout_expires_at: 'invalid' },
    ]) {
        invoiceDetails = details;
        await assert.rejects(
            () => service.createSubscriptionPaymentIntent(1, {
                invoice_id: ownInvoiceId, provider: 'moamalat',
            }, 'user-1'),
            error => error instanceof SavanaIntegrationError
                && error.code === (details.checkout_expires_at ? 'invoice_checkout_expired' : 'invoice_not_payable'),
        );
        assert.equal(intentRequests.length, 2);
    }
    invoiceDetails = {};
    visibleIntents = [];

    const cashIntent = await service.createSubscriptionPaymentIntent(1, {
        invoice_id: ownInvoiceId,
        provider: 'cash',
    }, 'user-1');
    assert.equal(cashIntent.status, 'pending');
    assert.equal(cashIntent.checkout_url, null);
    assert.equal(JSON.parse(intentRequests[2].options.body).provider, 'cash');
    assert.equal(JSON.parse(intentRequests[2].options.body).idempotency_key,
        `wa-savana:cash:${ownInvoiceId}`);
    await assert.rejects(
        () => service.createSubscriptionPaymentIntent(1, {
            invoice_id: ownInvoiceId,
            provider: 'unconfigured',
        }, 'user-1'),
        error => error instanceof SavanaIntegrationError && error.code === 'payment_provider_invalid',
    );
    database.close();
});

test('Wa manager can create a central pending-review subscription for a selected tenant', async (t) => {
    let checkoutCall;
    let quoteCall;
    let quoteErrorCode;
    const service = {
        config: {
            enabled: true,
            subscriptionsMode: 'central',
        },
        async subscriptionCheckoutQuote(tenantId, payload) {
            if (quoteErrorCode) throw new SavanaIntegrationError('Internal billing details', 409, quoteErrorCode);
            quoteCall = { tenantId, payload };
            return { base_amount_minor: 20000, upgrade_credit_minor: 4000, total_minor: 16000,
                catalog_fingerprint: 'a'.repeat(64) };
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

    const quoteResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/central-subscriptions/42/checkout-quote`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bundle_id: 'suite-id' }) },
    );
    assert.equal(quoteResponse.status, 200);
    assert.equal((await quoteResponse.json()).total_minor, 16000);
    assert.deepEqual(quoteCall, { tenantId: '42', payload: { bundle_id: 'suite-id' } });
    for (const code of ['subscription_downgrade_not_allowed', 'subscription_change_pending',
        'upgrade_currency_mismatch', 'subscription_payment_required', 'subscription_change_requires_checkout']) {
        quoteErrorCode = code;
        const deniedQuote = await fetch(
            `http://127.0.0.1:${server.address().port}/central-subscriptions/42/checkout-quote`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        );
        const denial = await deniedQuote.json();
        assert.equal(deniedQuote.status, 409);
        assert.equal(denial.code, code);
        assert.match(denial.error, /[\u0600-\u06ff]/);
        assert.equal(denial.error.includes('Internal billing details'), false);
    }

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
            () => service.requestConnection(1, {}, 'tenant-user'),
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
        if (parsed.pathname === '/v1/platform-bindings') {
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
                organization: {
                    id: organizationId,
                    name: 'Savana test organization',
                },
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
    const localIntegration = service.getOrCreate(1, 'catalog');
    database.prepare(`
        UPDATE savana_integrations SET organization_id = ?,
            entitlement_valid_until = '2020-01-01T00:00:00Z',
            last_error = 'expired snapshot'
        WHERE id = ?
    `).run(organizationId, localIntegration.id);

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
    const synchronizedIntegration = service.get(1, 'catalog');
    assert.equal(
        synchronizedIntegration.entitlement_valid_until,
        snapshot.payload.valid_until,
    );
    assert.deepEqual(
        JSON.parse(synchronizedIntegration.entitlement_payload_json),
        snapshot.payload,
    );
    assert.equal(synchronizedIntegration.last_error, null);

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
    assert.equal(deliver(service, sale).duplicate, false);
    assert.equal(deliver(service, sale).duplicate, true);

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
    deliver(service, inventory);

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
    deliver(service, returned);

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_integration_events').get().count, 3);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_pos_transactions').get().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM savana_notification_candidates').get().count, 2);
    assert.equal(database.prepare('SELECT quantity_available FROM savana_product_projection').get().quantity_available, '18.000000');
    assert.throws(
        () => deliver(service, sale, { callback: 'wrong-token' }),
        error => error instanceof SavanaIntegrationError && error.statusCode === 401,
    );
    assert.throws(
        () => deliver(service, sale, { signature: 'v1=invalid' }),
        error => error instanceof SavanaIntegrationError
            && error.code === 'invalid_signature',
    );
    assert.deepEqual(service.diagnostics(service.get(1)).counts, {
        products: 1,
        transactions: 2,
        pending_notification_candidates: 2,
        pending_service_requests: 0,
    });
    database.close();
});

test('approved Catalog link creates reviewed Wa service requests without POS', async () => {
    const database = createDatabase();
    const fetchImpl = createFetch();
    const service = new SavanaIntegrationService({ database, fetchImpl, config });
    const connection = fetchImpl.setConnection({
            id: 'connection-1',
            organization_id: organizationId,
            source_tenant_id: 'catalog-tenant-id',
            target_tenant_id: 'wa-savana-tenant-id',
            source_platform: 'catalog',
            target_platform: 'wa_savana',
            source_external_tenant_id: 'catalog:shop:1',
            target_external_tenant_id: 'wa_savana:tenant:1',
            status: 'active',
            lifecycle_version: 1,
            scopes: ['catalog.products.projection'],
    });
    const item = await service.provisionConnection({ connection,
        webhook_secret: 'wa-savana-connection-secret',
    }, callbackToken);
    assert.equal(item.platform_code, 'catalog');

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
    deliver(service, product);

    const order = envelope('wa_savana.notification_send_requested.v1', {
        request_id: 'ORDER-1-ready',
        recipient: { phone_e164: '+218910000001' },
        template_key: 'catalog_order_ready',
        requires_review: true,
        consent_asserted: false,
    }, crypto.randomUUID(), 'catalog:order:ORDER-1:ready');
    order.source = 'catalog';
    deliver(service, order);

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
    assert.equal(request.request_kind, 'notification_request');
    assert.equal(request.status, 'pending_review');
    assert.equal(service.diagnostics(service.get(1, 'catalog')).counts.pending_service_requests, 1);
    database.close();
});

test('tenant inbox reviews and tracks contextual requests without sending automatically', async (t) => {
    const database = createDatabase();
    const fetchImpl = createFetch();
    const service = new SavanaIntegrationService({ database, fetchImpl, config });
    const connection = fetchImpl.setConnection({
            id: 'catalog-message-connection',
            organization_id: organizationId,
            source_tenant_id: 'catalog-tenant-id',
            target_tenant_id: 'wa-savana-tenant-id',
            source_platform: 'catalog',
            target_platform: 'wa_savana',
            source_external_tenant_id: 'catalog:shop:1',
            target_external_tenant_id: 'wa_savana:tenant:1',
            status: 'active',
            lifecycle_version: 1,
            scopes: ['wa_savana.notifications.send'],
    });
    await service.provisionConnection({ connection,
        webhook_secret: 'catalog-message-secret',
    }, callbackToken);
    const command = envelope('wa_savana.notification_send_requested.v1', {
        request_id: 'catalog-message-1',
        recipient: { phone_e164: '+218910000001' },
        message: 'رسالة من الطلب للمراجعة.',
        requires_review: true,
        consent_asserted: false,
    }, crypto.randomUUID(), 'catalog:message:1');
    command.source = 'catalog';
    deliver(service, command, {
        connectionId: 'catalog-message-connection',
        secret: 'catalog-message-secret',
    });
    assert.equal(
        database.prepare('SELECT COUNT(*) count FROM messages').get().count,
        0,
    );
    assert.equal(
        database.prepare('SELECT COUNT(*) count FROM savana_integration_outbox').get().count,
        0,
    );

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'tenant-user', tenant_id: 1 };
        next();
    });
    app.use('/integrations', createTenantIntegrationsRouter({ database, service }));
    const server = app.listen(0);
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    t.after(() => database.close());
    const baseUrl = `http://127.0.0.1:${server.address().port}/integrations`;

    const listResponse = await fetch(`${baseUrl}/message-requests`);
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].platform_code, 'catalog');
    assert.equal(list.data[0].payload.message, 'رسالة من الطلب للمراجعة.');

    const forgedStatus = await fetch(`${baseUrl}/platforms/catalog/publish-status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: 'catalog-message-1', status: 'sent', channel_message_id: 'forged' }),
    });
    assert.equal(forgedStatus.status, 409);
    assert.equal((await forgedStatus.json()).code, 'execution_evidence_required');
    assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_integration_outbox').get().count, 0);

    const requestId = list.data[0].id;
    const acceptedResponse = await fetch(`${baseUrl}/message-requests/${requestId}/accept`, {
        method: 'POST', headers: { 'X-Savana-Review-Mode': 'review-only-v1' },
    });
    assert.equal(acceptedResponse.status, 200);
    assert.equal(
        database.prepare('SELECT status FROM savana_service_requests WHERE id = ?').get(requestId).status,
        'approved',
    );
    assert.equal(
        database.prepare('SELECT COUNT(*) count FROM messages').get().count,
        0,
    );
    assert.equal(
        database.prepare('SELECT COUNT(*) count FROM savana_integration_outbox').get().count,
        1,
    );

    const accepted = await acceptedResponse.json();
    assert.equal(accepted.request.review_only, true);
    assert.equal(accepted.request.execution_ready, false);
    assert.equal(accepted.request.reviewed_by, 'tenant-user');
    assert.ok(accepted.request.reviewed_at);
    const review = database.prepare(
        'SELECT reviewed_payload_hash FROM savana_service_requests WHERE id = ?'
    ).get(requestId);
    assert.match(review.reviewed_payload_hash, /^[a-f0-9]{64}$/);

    // Even a native outgoing message to the same recipient is not proof that
    // the cross-platform request executed with its account and consent.
    database.prepare(`
        INSERT INTO messages (
            tenant_id, direction, sender, recipient, message_type,
            content, status, wamid
        ) VALUES (1, 'outgoing', 'wa-number-1', '218910000001', 'text',
            'رسالة من الطلب للمراجعة.', 'sent', 'wamid.contextual-message')
    `).run();
    for (const body of [{}, { channel_message_id: 'wamid.contextual-message' }]) {
        const completion = await fetch(`${baseUrl}/message-requests/${requestId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        assert.equal(completion.status, 409);
        assert.equal((await completion.json()).code, 'integration_execution_unavailable');
    }
    assert.equal(database.prepare(
        'SELECT status FROM savana_service_requests WHERE id = ?'
    ).get(requestId).status, 'approved');
    assert.equal(database.prepare(
        'SELECT COUNT(*) count FROM savana_integration_outbox'
    ).get().count, 1);

    // A repeated review returns the same outbox event, not another acceptance.
    const repeat = await fetch(`${baseUrl}/message-requests/${requestId}/accept`, { method: 'POST', headers: { 'X-Savana-Review-Mode': 'review-only-v1' } });
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).status_published, true);
    assert.equal(database.prepare(
        'SELECT COUNT(*) count FROM savana_integration_outbox'
    ).get().count, 1);
    database.prepare('UPDATE savana_service_requests SET payload_json = ? WHERE id = ?')
        .run(JSON.stringify({ ...command.data, message: 'changed after review' }), requestId);
    const stale = await fetch(`${baseUrl}/message-requests/${requestId}/accept`, { method: 'POST', headers: { 'X-Savana-Review-Mode': 'review-only-v1' } });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'request_review_stale');
});

test('tenant inbox product picker exposes every integrated product with the POS compatibility alias', async (t) => {
    const database = createDatabase();
    const { service } = await provision(database);
    deliver(service, envelope('savana.product_snapshot.v1', {
        snapshot_id: crypto.randomUUID(),
        generated_at: new Date().toISOString(),
        page_number: 1,
        page_count: 1,
        complete: true,
        products: [{
            canonical_product_id: null,
            local_product_id: 'POS-PICKER-1',
            sku: 'PICKER-1',
            barcodes: ['100000000901'],
            name: 'Picker product',
            online_price: '15.000',
            is_active: true,
        }],
    }, crypto.randomUUID(), 'pos:products:picker'));
    database.prepare(`
        UPDATE savana_product_projection SET shelf_code = 'A-04'
        WHERE tenant_id = 1 AND sku = 'PICKER-1'
    `).run();

    const app = express();
    app.use((req, _res, next) => {
        req.user = { id: 'tenant-user', tenant_id: 1 };
        next();
    });
    app.use('/integrations', createTenantIntegrationsRouter({ database, service }));
    const server = app.listen(0);
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    t.after(() => database.close());
    const baseUrl = `http://127.0.0.1:${server.address().port}/integrations`;

    const productsResponse = await fetch(`${baseUrl}/products`);
    const products = await productsResponse.json();
    assert.equal(productsResponse.status, 200);
    assert.equal(products.data[0].name, 'Picker product');
    assert.equal(products.data[0].shelf_code, 'A-04');

    const compatibilityResponse = await fetch(`${baseUrl}/pos/products`);
    const compatibility = await compatibilityResponse.json();
    assert.deepEqual(compatibility.data, products.data);
});

test('POS product snapshots keep prices and reconcile all pages together', async () => {
    const database = createDatabase();
    const { service } = await provision(database);
    const generatedAt = new Date().toISOString();
    const snapshotId = crypto.randomUUID();
    const product = (sku, barcode, name, price) => ({
        canonical_product_id: null,
        local_product_id: sku,
        sku,
        barcodes: [barcode],
        name,
        online_price: price,
        is_active: true,
    });

    deliver(service, envelope('savana.product_snapshot.v1', {
        snapshot_id: snapshotId,
        generated_at: generatedAt,
        page_number: 1,
        page_count: 2,
        complete: false,
        products: [product('POS-1', '100000000001', 'POS first page', '7.500')],
    }, crypto.randomUUID(), 'pos:products:paged:1'));
    deliver(service, envelope('savana.product_snapshot.v1', {
        snapshot_id: snapshotId,
        generated_at: generatedAt,
        page_number: 2,
        page_count: 2,
        complete: true,
        products: [product('POS-2', '100000000002', 'POS second page', '9.000')],
    }, crypto.randomUUID(), 'pos:products:paged:2'));

    const products = database.prepare(`
        SELECT sku, price, is_active, availability FROM bot_products
        WHERE tenant_id = 1 ORDER BY sku
    `).all();
    assert.deepEqual(products, [
        { sku: 'POS-1', price: 7.5, is_active: 0, availability: 'hidden' },
        { sku: 'POS-2', price: 9, is_active: 0, availability: 'hidden' },
    ]);
    database.close();
});

test('cross-platform Wa commands remain reviewable and idempotent', async () => {
    const database = createDatabase();
    const { service } = await provision(database);
    database.prepare("UPDATE savana_integrations SET status = 'active' WHERE tenant_id = 1").run();

    const command = envelope('wa_savana.content_publish_requested.v1', {
        request_id: 'content-request-1',
        channels: ['facebook'],
        content_type: 'post',
        text: 'منشور منتج جاهز للمراجعة',
        requires_review: true,
    }, crypto.randomUUID(), 'pos:content:content-request-1');

    assert.equal(deliver(service, command).duplicate, false);
    assert.equal(deliver(service, command).duplicate, true);
    const request = database.prepare('SELECT * FROM savana_service_requests').get();
    assert.equal(request.request_kind, 'content_publication');
    assert.equal(request.status, 'pending_review');
    database.close();
});

test('notification status remains durable while Connect is unavailable', async () => {
    const database = createDatabase();
    const baseFetch = createFetch();
    let failEvents = true;
    const fetchImpl = async (url, options) => {
        if (new URL(url).pathname === '/v1/events' && failEvents) {
            return Response.json(
                { error: { code: 'temporary_unavailable' } },
                { status: 503 },
            );
        }
        return baseFetch(url, options);
    };
    const { service, item } = await provision(database, fetchImpl);
    const published = await service.publishNotificationStatus(item, {
        request_id: 'notification-request-1',
        status: 'delivered',
    });
    assert.equal(published.event.reply_to_platform, 'pos');
    assert.equal(published.receipt.queued, true);
    assert.equal(published.receipt.status, 'failed');
    assert.equal(
        database.prepare(`
            SELECT status FROM savana_integration_outbox
        `).get().status,
        'failed',
    );
    assert.equal(service.diagnostics(item).outbox.counts.failed, 1);
    assert.equal(service.diagnostics(item).outbox.recent_failures.length, 1);

    failEvents = false;
    const retried = await service.retryOutbox(item);
    assert.deepEqual(retried, { queued: 1, published: 1, failed: 0 });
    assert.equal(
        database.prepare(`
            SELECT status FROM savana_integration_outbox
        `).get().status,
        'published',
    );
    database.close();
});

test('operation retries reject changed content and retain the original durable request', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const { service } = await provision(database);
    const command = envelope('wa_savana.notification_send_requested.v1', {
        request_id: 'stable-request',
        recipient: { phone_e164: '+218910000001' },
        channel: 'whatsapp',
        message: 'Original review',
        requires_review: true,
        consent_asserted: false,
    }, crypto.randomUUID(), 'pos:notification:stable');
    assert.equal(deliver(service, command).duplicate, false);
    assert.equal(deliver(service, { ...command, event_id: crypto.randomUUID() }).duplicate, true);
    for (const mutation of [
        { data: { ...command.data, message: 'Changed content' } },
        { data: { ...command.data, consent_asserted: true } },
        { platform_tenant_id: 'another-pos-installation' },
        { occurred_at: '2020-01-01T00:00:00Z' },
        { spec_version: '2.0' },
        { idempotency_key: 'another-key-for-the-same-event' },
    ]) {
        assert.throws(() => deliver(service, { ...command, ...mutation }),
            error => error.code === 'idempotency_conflict' && error.statusCode === 409);
    }
    assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_integration_events').get().count, 1);
    assert.deepEqual(JSON.parse(database.prepare('SELECT payload_json FROM savana_service_requests').get().payload_json), command.data);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM messages').get().count, 0);
});

test('a new transport key cannot replace a reviewed request or change its kind', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const { service } = await provision(database);
    const command = envelope('wa_savana.content_publish_requested.v1', {
        request_id: 'stable-content-request',
        channels: ['facebook'],
        text: 'Original content',
        requires_review: true,
    }, crypto.randomUUID(), 'pos:content:original');
    deliver(service, command);
    database.prepare("UPDATE savana_service_requests SET status = 'approved'").run();
    for (const next of [
        { ...command, data: { ...command.data, text: 'Replacement' } },
        { ...command, event_type: 'wa_savana.campaign_create_requested.v1' },
    ]) {
        assert.throws(() => deliver(service, {
            ...next, event_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
        }), error => error.code === 'request_content_conflict');
    }
    assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_integration_events').get().count, 1);
    assert.equal(database.prepare('SELECT status FROM savana_service_requests').get().status, 'approved');
});

test('outbound result retries reuse the stored event and reject contradictory evidence', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const { service, item } = await provision(database);
    const data = { request_id: 'result-1', status: 'sent', channel_message_id: 'wamid.original' };
    const first = service.queueNotificationStatus(item, data);
    const retry = service.queueNotificationStatus(item, data);
    assert.equal(first.event.event_id, retry.event.event_id);
    assert.equal(first.record.id, retry.record.id);
    assert.throws(() => service.queueNotificationStatus(item, {
        ...data, channel_message_id: 'wamid.another',
    }), error => error.code === 'idempotency_conflict');
    assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_integration_outbox').get().count, 1);
});

test('a lost transport acknowledgment retries only the same status event and never a channel send', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const baseFetch = createFetch();
    const attempts = [];
    const fetchImpl = async (url, options) => {
        if (new URL(url).pathname === '/v1/events') {
            attempts.push(JSON.parse(Buffer.from(options.body).toString()));
            if (attempts.length === 1) throw new Error('Acknowledgment lost after receipt');
        }
        return baseFetch(url, options);
    };
    const { service, item } = await provision(database, fetchImpl);
    const result = await service.publishNotificationStatus(item, {
        request_id: 'review-ack', status: 'accepted',
    });
    assert.equal(result.receipt.queued, true);
    await service.retryOutbox(item);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM messages').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM savana_integration_outbox').get().count, 1);
});
