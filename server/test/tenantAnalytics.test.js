import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantAnalyticsRouter } from '../routes/tenantAnalytics.js';

const invokeSummary = (router, tenantId) => new Promise((resolve, reject) => {
    const layer = router.stack.find((item) => item.route?.path === '/summary' && item.route.methods?.get);
    assert.ok(layer, 'Missing GET /summary');
    const req = { user: { tenant_id: tenantId }, body: {}, params: {}, query: {} };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve(this);
            return this;
        },
    };
    try {
        Promise.resolve(layer.route.stack[0].handle(req, res, reject)).catch(reject);
    } catch (error) {
        reject(error);
    }
});

test('tenant analytics aggregate counts and distributions without cross-tenant rows', async (t) => {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec(`
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            direction TEXT,
            status TEXT,
            message_type TEXT,
            created_at DATETIME
        );
        INSERT INTO messages (id, tenant_id, direction, status, message_type, created_at) VALUES
            (1, 1, 'outgoing', 'sent', 'text', datetime('now')),
            (2, 1, 'outgoing', 'failed', 'image', datetime('now')),
            (3, 1, 'incoming', 'received', 'text', datetime('now', '-1 day')),
            (4, 1, 'incoming', 'received', 'document', datetime('now', '-40 days')),
            (5, 2, 'outgoing', 'failed', 'video', datetime('now')),
            (6, 2, 'incoming', 'received', 'video', datetime('now'));
    `);
    const router = createTenantAnalyticsRouter({ database: db });

    const tenantA = await invokeSummary(router, 1);
    assert.equal(tenantA.statusCode, 200);
    assert.deepEqual({
        total: tenantA.body.totalMessages,
        sent: tenantA.body.sentMessages,
        received: tenantA.body.receivedMessages,
        failed: tenantA.body.failedMessages,
    }, { total: 4, sent: 2, received: 2, failed: 1 });
    assert.equal(tenantA.body.dailyBreakdown.reduce((sum, row) => sum + row.total, 0), 3);
    assert.deepEqual(tenantA.body.typeDistribution, [
        { message_type: 'text', count: 2 },
        { message_type: 'document', count: 1 },
        { message_type: 'image', count: 1 },
    ]);

    const tenantB = await invokeSummary(router, 2);
    assert.deepEqual({
        total: tenantB.body.totalMessages,
        sent: tenantB.body.sentMessages,
        received: tenantB.body.receivedMessages,
        failed: tenantB.body.failedMessages,
    }, { total: 2, sent: 1, received: 1, failed: 1 });
    assert.deepEqual(tenantB.body.typeDistribution, [{ message_type: 'video', count: 2 }]);

    const empty = await invokeSummary(router, 99);
    assert.equal(empty.body.totalMessages, 0);
    assert.deepEqual(empty.body.dailyBreakdown, []);
    assert.deepEqual(empty.body.typeDistribution, []);
});
