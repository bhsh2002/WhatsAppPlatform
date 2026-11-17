import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { createTenantIntegrationsRouter } from '../routes/savanaIntegrations.js';
import { SavanaIntegrationError } from '../services/savanaIntegration.js';
import { savanaIntegrationMethods } from '../../client/src/api/savanaIntegrations.js';

const reviewHeaders = { 'X-Savana-Review-Mode': 'review-only-v1' };

const createFixture = async (t) => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE savana_integrations (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            platform_code TEXT NOT NULL
        );
        INSERT INTO savana_integrations (id, tenant_id, platform_code)
        VALUES (11, 1, 'catalog'), (22, 1, 'sawemly'), (33, 1, 'pos'),
               (44, 2, 'catalog');
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
            reviewed_payload_hash TEXT,
            reviewed_by TEXT,
            reviewed_at TEXT,
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
    let dispatchReceipt = { queued: true };
    const service = {
        get(tenantId, platformCode = 'pos') {
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
            return { ...queued, receipt: dispatchReceipt };
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
        setDispatchReceipt(value) { dispatchReceipt = value; },
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
        status_published: false,
        status_queued: true,
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

test('legacy approved requests gain review evidence without gaining execution permission', async (t) => {
    const fixture = await createFixture(t);
    const originalPayload = JSON.stringify({
        order_id: 'legacy-order', customer_phone: '+218910000001',
        message: 'Synthetic legacy draft', consent_asserted: true,
        execution_ready: true,
    });
    const request = fixture.insertRequest.run(
        11, 'legacy-order-event', 'order_notification', 'legacy-order-request', originalPayload,
    );
    const requestId = Number(request.lastInsertRowid);
    fixture.database.prepare("UPDATE savana_service_requests SET status = 'approved' WHERE id = ?").run(requestId);
    const accept = await fetch(`${fixture.baseUrl}/message-requests/${requestId}/accept`, { method: 'POST', headers: reviewHeaders });
    assert.equal(accept.status, 200);
    const accepted = await accept.json();
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.status_queued, true);
    assert.equal(accepted.status_published, false);
    assert.equal(accepted.request.status, 'approved');
    assert.equal(accepted.request.review_only, true);
    assert.equal(accepted.request.execution_ready, false);
    assert.equal(accepted.request.reviewed_by, '7');
    assert.ok(accepted.request.reviewed_at);
    const reviewed = fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(requestId);
    assert.match(reviewed.reviewed_payload_hash, /^[a-f0-9]{64}$/);
    assert.equal(reviewed.payload_json, originalPayload);
    assert.equal(reviewed.event_id, 'legacy-order-event');

    // Old clients could submit a message ID obtained from the native inbox.
    // Even a matching recipient and declared consent cannot bind it to the
    // request, account, content and approval as verified execution evidence.
    fixture.database.prepare(`
        INSERT INTO messages (tenant_id, direction, recipient, status, wamid)
        VALUES (1, 'outgoing', '218910000001', 'sent', 'wamid.native-legacy')
    `).run();
    for (const body of [
        {},
        { channel_message_id: null },
        { channel_message_id: 'wamid.native-legacy' },
        { channel_message_id: 'wamid.native-legacy', execution_ready: true, consent_asserted: true, status: 'sent' },
    ]) {
        const completion = await fetch(`${fixture.baseUrl}/message-requests/${requestId}/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        assert.equal(completion.status, 409);
        assert.equal((await completion.json()).code, 'integration_execution_unavailable');
    }
    assert.deepEqual(fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(requestId), reviewed);
    assert.deepEqual(fixture.publishedStatuses.map(item => item.payload.status), ['accepted']);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 1);
});

test('legacy status publication is rejected for every provider and cannot assert an external effect', async (t) => {
    const fixture = await createFixture(t);
    for (const platform of ['pos', 'catalog', 'sawemly']) {
        for (const status of ['accepted', 'rejected', 'sent', 'delivered', 'read', 'failed']) {
            const response = await fetch(`${fixture.baseUrl}/platforms/${platform}/publish-status`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    request_id: 'legacy-status-request', status,
                    channel_message_id: 'wamid.claimed', consent_asserted: true,
                    execution_ready: true, tenant_id: 2,
                }),
            });
            assert.equal(response.status, 409);
            assert.equal((await response.json()).code, 'execution_evidence_required');
        }
    }
    const unknown = await fetch(`${fixture.baseUrl}/platforms/not-connected/publish-status`, { method: 'POST' });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).code, 'connection_not_found');
    const oldPosAlias = await fetch(`${fixture.baseUrl}/pos/publish-status`, { method: 'POST' });
    assert.equal(oldPosAlias.status, 404);
    assert.equal((await oldPosAlias.json()).code, 'action_not_found');
    assert.equal(fixture.publishedStatuses.length, 0);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
});

test('a review result distinguishes queued transport from a publication receipt and never claims sending', async (t) => {
    const fixture = await createFixture(t);
    const receipts = [
        [{ queued: true }, false],
        [{ event_id: 'receipt-still-queued', queued: true }, false],
        [undefined, false],
        [{ event_id: 123 }, false],
        [{ event_id: '  ' }, false],
        [{ event_id: 'transport-receipt-1' }, true],
        [{ event_id: 'transport-receipt-2', duplicate: true }, true],
    ];
    for (const [index, [receipt, isPublished]] of receipts.entries()) {
        fixture.setDispatchReceipt(receipt);
        const row = fixture.insertRequest.run(
            33, `review-event-${index}`, 'notification_request', `review-key-${index}`,
            JSON.stringify({ request_id: `review-key-${index}`, message: 'Synthetic review only' }),
        );
        const response = await fetch(`${fixture.baseUrl}/message-requests/${row.lastInsertRowid}/accept`, { method: 'POST', headers: reviewHeaders });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.status_queued, true);
        assert.equal(body.status_published, isPublished);
        assert.equal(body.accepted, true);
        assert.equal(body.sent, undefined);
        assert.equal(body.delivered, undefined);
        assert.equal(body.request.review_only, true);
        assert.equal(body.request.execution_ready, false);
        assert.equal(body.request.status, 'approved');
    }
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
    assert.ok(fixture.publishedStatuses.every(item => item.payload.status === 'accepted'));
});

test('historical sent requests remain unchanged and cannot be reviewed or completed again', async (t) => {
    const fixture = await createFixture(t);
    const row = fixture.insertRequest.run(
        11, 'historical-sent-event', 'notification_request', 'historical-sent-key',
        JSON.stringify({ request_id: 'historical-sent-key', message: 'Historical record' }),
    );
    fixture.database.prepare("UPDATE savana_service_requests SET status = 'sent' WHERE id = ?").run(row.lastInsertRowid);
    const before = fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(row.lastInsertRowid);
    const list = await fetch(`${fixture.baseUrl}/platforms/catalog/service-requests`);
    const listed = (await list.json()).data.find(item => item.id === Number(row.lastInsertRowid));
    assert.equal(listed.status, 'sent');
    assert.equal(listed.execution_ready, false);
    assert.equal(listed.payload.message, 'Historical record');
    for (const action of ['accept', 'complete', 'dismiss']) {
        const response = await fetch(`${fixture.baseUrl}/message-requests/${row.lastInsertRowid}/${action}`, { method: 'POST', headers: reviewHeaders });
        assert.equal(response.status, 404);
        assert.equal((await response.json()).code, 'message_request_not_found');
    }
    assert.deepEqual(fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(row.lastInsertRowid), before);
    assert.equal(fixture.publishedStatuses.length, 0);
});

test('legacy request identifiers never expose another tenant or bypass the review-only boundary', async (t) => {
    const fixture = await createFixture(t);
    const foreign = fixture.database.prepare(`
        INSERT INTO savana_service_requests (
            tenant_id, integration_id, event_id, request_kind, request_key, payload_json, status
        ) VALUES (2, 44, 'foreign-event', 'notification_request', 'foreign-key',
            '{"message":"Other synthetic tenant"}', 'approved')
    `).run();
    const before = fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(foreign.lastInsertRowid);
    const list = await fetch(`${fixture.baseUrl}/message-requests`);
    assert.deepEqual((await list.json()).data, []);
    for (const path of [
        `/message-requests/${foreign.lastInsertRowid}/accept`,
        `/message-requests/${foreign.lastInsertRowid}/complete`,
        `/message-requests/${foreign.lastInsertRowid}/dismiss`,
        `/platforms/catalog/service-requests/${foreign.lastInsertRowid}/dismiss`,
    ]) {
        const response = await fetch(`${fixture.baseUrl}${path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...reviewHeaders },
            body: JSON.stringify({ tenant_id: 2, channel_message_id: 'wamid.unrelated' }),
        });
        assert.equal(response.status, 404);
    }
    assert.deepEqual(fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(foreign.lastInsertRowid), before);
    assert.equal(fixture.publishedStatuses.length, 0);
});

test('cached clients must negotiate review-only mode before acceptance can change state', async (t) => {
    const fixture = await createFixture(t);
    const row = fixture.insertRequest.run(
        11, 'review-mode-event', 'notification_request', 'review-mode-request',
        JSON.stringify({ request_id: 'review-mode-request', message: 'Synthetic review-only draft' }),
    );
    const before = fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(row.lastInsertRowid);
    for (const mode of [undefined, 'review-only-v0', 'execute-v1', 'review-only-v1, execute-v1']) {
        const response = await fetch(`${fixture.baseUrl}/message-requests/${row.lastInsertRowid}/accept`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(mode === undefined ? {} : { 'X-Savana-Review-Mode': mode }),
            },
            // A body field cannot stand in for the required client mode.
            body: JSON.stringify({ review_only: true, review_mode: 'review-only-v1' }),
        });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'request_review_client_upgrade_required');
        assert.deepEqual(fixture.database.prepare('SELECT * FROM savana_service_requests WHERE id = ?').get(row.lastInsertRowid), before);
        assert.equal(fixture.publishedStatuses.length, 0);
        assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
    }
    const modern = await fetch(`${fixture.baseUrl}/message-requests/${row.lastInsertRowid}/accept`, {
        method: 'POST', headers: reviewHeaders,
    });
    assert.equal(modern.status, 200);
    const accepted = await modern.json();
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.request.review_only, true);
    assert.equal(accepted.request.execution_ready, false);
    assert.equal(accepted.sent, undefined);
    assert.deepEqual(fixture.publishedStatuses.map(item => item.payload.status), ['accepted']);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
});

test('the supported client sends only the local review-mode negotiation header on acceptance', async () => {
    const calls = [];
    const result = { accepted: true, request: { review_only: true, execution_ready: false } };
    const response = await savanaIntegrationMethods.acceptPortalMessageRequest.call({
        async request(path, options) {
            calls.push({ path, options });
            return result;
        },
    }, 17);
    assert.equal(response, result);
    assert.deepEqual(calls, [{
        path: '/api/portal/integrations/message-requests/17/accept',
        options: { method: 'POST', headers: reviewHeaders },
    }]);
});
