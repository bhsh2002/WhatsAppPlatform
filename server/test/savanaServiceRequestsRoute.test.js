import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { createTenantIntegrationsRouter } from '../routes/savanaIntegrations.js';
import { SavanaIntegrationError } from '../services/savanaIntegration.js';

const createFixture = async (t) => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE savana_service_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            integration_id INTEGER NOT NULL,
            event_id TEXT NOT NULL UNIQUE,
            request_kind TEXT NOT NULL,
            request_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_review',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(integration_id, request_key)
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            direction TEXT,
            recipient TEXT,
            status TEXT,
            wamid TEXT
        );
    `);
    const integrationIds = { catalog: 11, sawemly: 22, pos: 33 };
    const publishedStatuses = [];
    let publishFailure = false;
    const service = {
        get(tenantId, platformCode) {
            const id = integrationIds[platformCode];
            return Number(tenantId) === 1 && id
                ? { id, tenant_id: 1, platform_code: platformCode, status: 'active' }
                : null;
        },
        diagnostics(item) {
            return {
                integration: item,
                counts: { pending_service_requests: item.id === 22 ? 2 : 0 },
            };
        },
        queueNotificationStatus(item, payload) {
            if (publishFailure) {
                throw new SavanaIntegrationError(
                    'Status callback is temporarily unavailable',
                    503,
                    'status_callback_unavailable',
                );
            }
            publishedStatuses.push({ item, payload });
            return { event: payload, record: { status: 'pending' } };
        },
        async dispatchQueuedNotificationStatus(queued) {
            return { ...queued, receipt: { queued: true } };
        },
        async publishNotificationStatus(item, payload) {
            return this.dispatchQueuedNotificationStatus(
                this.queueNotificationStatus(item, payload),
            );
        },
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = { id: 7, tenant_id: 1 };
        next();
    });
    app.use(createTenantIntegrationsRouter({ database, service }));
    const server = app.listen(0);
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(() => {
        database.close();
        resolve();
    })));

    const insertRequest = database.prepare(`
        INSERT INTO savana_service_requests (
            tenant_id, integration_id, event_id, request_kind,
            request_key, payload_json, status
        ) VALUES (1, ?, ?, ?, ?, ?, 'pending_review')
    `);
    return {
        database,
        insertRequest,
        publishedStatuses,
        setPublishFailure(value) { publishFailure = value; },
        baseUrl: `http://127.0.0.1:${server.address().port}`,
    };
};

test('lists and diagnoses service requests for the selected Sawemly integration', async (t) => {
    const fixture = await createFixture(t);
    fixture.insertRequest.run(
        22,
        'sawemly-notification-event',
        'notification_request',
        'sawemly-notification-1',
        JSON.stringify({ request_id: 'sawemly-notification-1', template_key: 'available' }),
    );
    fixture.insertRequest.run(
        22,
        'sawemly-content-event',
        'content_publication',
        'sawemly-content-1',
        JSON.stringify({ request_id: 'sawemly-content-1', content_type: 'product_post' }),
    );
    fixture.insertRequest.run(
        11,
        'catalog-notification-event',
        'notification_request',
        'catalog-notification-1',
        JSON.stringify({ request_id: 'catalog-notification-1' }),
    );

    const response = await fetch(
        `${fixture.baseUrl}/platforms/sawemly/service-requests?limit=20`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.map(item => item.request_kind), [
        'content_publication',
        'notification_request',
    ]);
    assert.equal(body.data[0].payload.content_type, 'product_post');
    assert.equal(body.data[0].payload_json, undefined);

    const diagnosticsResponse = await fetch(
        `${fixture.baseUrl}/platforms/sawemly/diagnostics`,
    );
    assert.equal(diagnosticsResponse.status, 200);
    assert.equal(
        (await diagnosticsResponse.json()).counts.pending_service_requests,
        2,
    );
});

test('dismiss rejects unsupported request kinds and publishes a contract-valid rejection', async (t) => {
    const fixture = await createFixture(t);
    const content = fixture.insertRequest.run(
        22,
        'sawemly-content-event',
        'content_publication',
        'sawemly-content-1',
        JSON.stringify({ request_id: 'sawemly-content-1' }),
    );
    const notification = fixture.insertRequest.run(
        22,
        'sawemly-notification-event',
        'notification_request',
        'sawemly-notification-1',
        JSON.stringify({ request_id: 'sawemly-notification-1' }),
    );

    const unsupportedResponse = await fetch(
        `${fixture.baseUrl}/platforms/sawemly/service-requests/${content.lastInsertRowid}/dismiss`,
        { method: 'POST' },
    );
    assert.equal(unsupportedResponse.status, 409);
    assert.equal(
        (await unsupportedResponse.json()).code,
        'service_request_action_unsupported',
    );
    assert.equal(fixture.database.prepare(`
        SELECT status FROM savana_service_requests WHERE id = ?
    `).get(content.lastInsertRowid).status, 'pending_review');
    assert.equal(fixture.publishedStatuses.length, 0);

    const notificationResponse = await fetch(
        `${fixture.baseUrl}/platforms/sawemly/service-requests/${notification.lastInsertRowid}/dismiss`,
        { method: 'POST' },
    );
    assert.equal(notificationResponse.status, 200);
    assert.deepEqual(await notificationResponse.json(), {
        dismissed: true,
        status_published: true,
    });
    assert.equal(fixture.database.prepare(`
        SELECT status FROM savana_service_requests WHERE id = ?
    `).get(notification.lastInsertRowid).status, 'dismissed');
    assert.equal(fixture.publishedStatuses.length, 1);
    assert.equal(fixture.publishedStatuses[0].item.platform_code, 'sawemly');
    assert.deepEqual(fixture.publishedStatuses[0].payload, {
        request_id: 'sawemly-notification-1',
        status: 'rejected',
        causation_id: 'sawemly-notification-event',
    });
});

test('a failed status callback leaves the request reviewable and retryable', async (t) => {
    const fixture = await createFixture(t);
    const notification = fixture.insertRequest.run(
        22,
        'sawemly-retry-event',
        'notification_request',
        'sawemly-retry-1',
        JSON.stringify({ request_id: 'sawemly-retry-1' }),
    );
    const url = (
        `${fixture.baseUrl}/platforms/sawemly/service-requests/`
        + `${notification.lastInsertRowid}/dismiss`
    );

    fixture.setPublishFailure(true);
    const failed = await fetch(url, { method: 'POST' });
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).code, 'status_callback_unavailable');
    assert.equal(fixture.database.prepare(`
        SELECT status FROM savana_service_requests WHERE id = ?
    `).get(notification.lastInsertRowid).status, 'pending_review');

    fixture.setPublishFailure(false);
    const retried = await fetch(url, { method: 'POST' });
    assert.equal(retried.status, 200);
    assert.equal(fixture.database.prepare(`
        SELECT status FROM savana_service_requests WHERE id = ?
    `).get(notification.lastInsertRowid).status, 'dismissed');
    assert.equal(fixture.publishedStatuses.length, 1);
});
