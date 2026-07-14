import assert from 'node:assert/strict';
import db from '../db/database.js';
import apiV1Router from '../routes/api/v1.js';
import { createTenantUnifiedInboxRouter } from '../routes/tenantUnifiedInbox.js';
import tenantsRouter from '../routes/tenants.js';
import unifiedRouter from '../routes/unified.js';

const tenantUnifiedInboxRouter = createTenantUnifiedInboxRouter({
    database: db,
    accessTokenForTenant: () => null,
    decryptToken: () => null,
    billing: {
        operations: {},
        reserve: () => null,
        commit: () => undefined,
        release: () => undefined,
        handleError: () => false,
    },
});

const findRouteHandlers = (router, method, routePath) => {
    const findLayer = currentRouter => {
        for (const item of currentRouter.stack || []) {
            if (item.route?.path === routePath && item.route.methods?.[method]) return item;
            if (item.handle?.stack) {
                const nested = findLayer(item.handle);
                if (nested) return nested;
            }
        }
        return null;
    };
    const layer = findLayer(router);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = {
        body: {},
        headers: {},
        params: {},
        query: {},
        ...request,
    };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve({ req, res: this });
            return this;
        },
    };
    const handlers = findRouteHandlers(router, method, routePath);
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve({ req, res });
        try {
            Promise.resolve(handlers[index++](req, res, next)).catch(reject);
        } catch (handlerError) {
            reject(handlerError);
        }
    };
    next();
});

const tenantA = Number(db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES ('Pagination A', '+218910002001', 'Active')
`).run().lastInsertRowid);
const tenantB = Number(db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES ('Pagination B', '+218910002002', 'Active')
`).run().lastInsertRowid);

const insertTenant = db.prepare("INSERT INTO tenants (name, status) VALUES (?, 'Active')");
db.transaction(() => {
    for (let index = 0; index < 203; index += 1) {
        insertTenant.run(`Extra tenant ${index}`);
    }
})();

const insertMessage = db.prepare(`
    INSERT INTO messages (
        tenant_id, direction, sender, recipient, message_type, content, status, created_at
    ) VALUES (?, ?, ?, ?, 'text', ?, ?, ?)
`);
const timestamp = index => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();

db.transaction(() => {
    for (let index = 0; index < 205; index += 1) {
        insertMessage.run(
            tenantA,
            'incoming',
            `conversation-${String(index).padStart(3, '0')}`,
            null,
            `conversation-message-${index}`,
            'read',
            timestamp(index)
        );
    }
    for (let index = 0; index < 250; index += 1) {
        insertMessage.run(
            tenantA,
            index % 2 === 0 ? 'incoming' : 'outgoing',
            index % 2 === 0 ? '218919999999' : null,
            index % 2 === 0 ? null : '218919999999',
            `thread-${index}`,
            'read',
            timestamp(1000 + index)
        );
    }
    insertMessage.run(tenantA, 'incoming', 'shared-phone', null, 'tenant-a-shared', 'received', timestamp(2000));
    insertMessage.run(tenantB, 'incoming', 'shared-phone', null, 'tenant-b-shared', 'received', timestamp(2001));
})();

const defaultConversations = await invokeRoute(apiV1Router, 'get', '/conversations', {
    tenantId: tenantA,
});
assert.equal(defaultConversations.res.statusCode, 200);
assert.equal(defaultConversations.res.body.length, 100);

const maximumConversations = await invokeRoute(apiV1Router, 'get', '/conversations', {
    tenantId: tenantA,
    query: { limit: '999' },
});
assert.equal(maximumConversations.res.body.length, 200);

const pagedConversations = await invokeRoute(apiV1Router, 'get', '/conversations', {
    tenantId: tenantA,
    query: { limit: '10', offset: '200' },
});
assert.equal(pagedConversations.res.body.length, 7);

const thread = await invokeRoute(apiV1Router, 'get', '/conversations/:phone/messages', {
    tenantId: tenantA,
    params: { phone: '218919999999' },
});
assert.equal(thread.res.body.length, 100);
assert.equal(thread.res.body[0].content, 'thread-150');
assert.equal(thread.res.body.at(-1).content, 'thread-249');

const portalConversations = await invokeRoute(tenantUnifiedInboxRouter, 'get', '/unified/conversations', {
    user: { tenant_id: tenantA, role: 'user' },
    query: { limit: '3', offset: '2', channel: 'whatsapp' },
});
assert.equal(portalConversations.res.statusCode, 200);
assert.equal(portalConversations.res.body.length, 3);

const scopedRead = await invokeRoute(unifiedRouter, 'get', '/conversations/:channel/:id/messages', {
    params: { channel: 'whatsapp', id: 'shared-phone' },
    query: { tenant_id: String(tenantA), limit: '10' },
});
assert.equal(scopedRead.res.statusCode, 200);
assert.equal(scopedRead.res.body.length, 1);
assert.equal(
    db.prepare('SELECT status FROM messages WHERE tenant_id = ? AND sender = ?').get(tenantA, 'shared-phone').status,
    'read'
);
assert.equal(
    db.prepare('SELECT status FROM messages WHERE tenant_id = ? AND sender = ?').get(tenantB, 'shared-phone').status,
    'received'
);

const tenantList = await invokeRoute(tenantsRouter, 'get', '/', {});
assert.equal(tenantList.res.statusCode, 200);
assert.equal(tenantList.res.body.length, 200);

console.log(JSON.stringify({
    defaultAndMaximumLimits: true,
    chronologicalMessageWindow: true,
    combinedInboxPagination: true,
    tenantReadIsolation: true,
}));
process.exit(0);
