import assert from 'node:assert/strict';
import db from '../db/database.js';
import tenantDashboardRouter from '../routes/tenantDashboard.js';

const findRouteHandlers = (method, routePath) => {
    const layer = tenantDashboardRouter.stack.find(item => (
        item.route?.path === routePath && item.route.methods?.[method]
    ));
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = { body: {}, headers: {}, params: {}, query: {}, ...request };
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
    const handlers = findRouteHandlers(method, routePath);
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

const insertTenant = db.prepare(`
    INSERT INTO tenants (name, phone, status, quality, tier, credits)
    VALUES (?, ?, 'Active', ?, ?, ?)
`);
const tenantA = Number(insertTenant.run('Dashboard A', '+218910007001', 'High', '5K', 777).lastInsertRowid);
const tenantB = Number(insertTenant.run('Dashboard B', '+218910007002', 'Low', '1K', 222).lastInsertRowid);
db.prepare("UPDATE tenants SET access_token = 'must-not-leak', webhook_secret = 'also-secret' WHERE id = ?").run(tenantA);

const insertMessage = db.prepare(`
    INSERT INTO messages (
        tenant_id, direction, sender, recipient, message_type, content, status,
        created_at
    ) VALUES (?, ?, ?, ?, 'text', ?, ?, datetime('now', 'localtime'))
`);
insertMessage.run(tenantA, 'incoming', 'wa-phone-1', null, 'Incoming A1', 'received');
insertMessage.run(tenantA, 'outgoing', null, 'wa-phone-1', 'Outgoing A1', 'sent');
insertMessage.run(tenantA, 'incoming', 'wa-phone-2', null, 'Incoming A2', 'read');
insertMessage.run(tenantB, 'incoming', 'wa-phone-b', null, 'Incoming B', 'received');

const insertPage = db.prepare(`
    INSERT INTO tenant_pages (tenant_id, page_id, page_name, is_active)
    VALUES (?, ?, ?, ?)
`);
const activePageA = Number(insertPage.run(tenantA, 'page-a-active', 'Page A active', 1).lastInsertRowid);
const inactivePageA = Number(insertPage.run(tenantA, 'page-a-inactive', 'Page A inactive', 0).lastInsertRowid);
const activePageB = Number(insertPage.run(tenantB, 'page-b-active', 'Page B active', 1).lastInsertRowid);

const insertConversation = db.prepare(`
    INSERT INTO fb_conversations (
        tenant_id, linked_page_id, page_id, user_psid, user_name,
        unread_count, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const activeConversationA = Number(insertConversation.run(
    tenantA, activePageA, 'page-a-active', 'psid-a-active', 'User A', 3, 1
).lastInsertRowid);
insertConversation.run(
    tenantA, inactivePageA, 'page-a-inactive', 'psid-a-inactive', 'Inactive A', 8, 0
);
const activeConversationB = Number(insertConversation.run(
    tenantB, activePageB, 'page-b-active', 'psid-b-active', 'User B', 5, 1
).lastInsertRowid);

const insertMessengerMessage = db.prepare(`
    INSERT INTO fb_messages (
        conversation_id, tenant_id, mid, direction, sender_id, message_text,
        created_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
`);
insertMessengerMessage.run(activeConversationA, tenantA, 'mid-a-in', 'incoming', 'psid-a-active', 'Messenger incoming A');
insertMessengerMessage.run(activeConversationA, tenantA, 'mid-a-out', 'outgoing', 'page-a-active', 'Messenger outgoing A');
insertMessengerMessage.run(activeConversationB, tenantB, 'mid-b-in', 'incoming', 'psid-b-active', 'Messenger incoming B');

const insertTemplate = db.prepare(`
    INSERT INTO templates (tenant_id, name, body, status)
    VALUES (?, ?, ?, 'approved')
`);
insertTemplate.run(tenantA, 'template-a-1', 'Body A1');
insertTemplate.run(tenantA, 'template-a-2', 'Body A2');
insertTemplate.run(tenantB, 'template-b-1', 'Body B1');

const insertActivity = db.prepare(`
    INSERT INTO activity_logs (
        tenant_id, tenant_name, event_type, description, status, created_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now', ?))
`);
const activityTypesA = [
    'fb_post_created',
    'page_linked',
    'template_created',
    'login',
    'api_key_rotated',
    'profile_updated',
];
activityTypesA.forEach((eventType, index) => {
    insertActivity.run(tenantA, 'Dashboard A', eventType, `A activity ${index}`, 'success', `-${index} minutes`);
});
insertActivity.run(tenantB, 'Dashboard B', 'fb_post_created', 'B marker must stay hidden', 'error', '-1 minute');

const dashboardA = await invokeRoute('get', '/', {
    user: { tenant_id: tenantA, role: 'user' },
});
assert.equal(dashboardA.res.statusCode, 200);
assert.deepEqual(dashboardA.res.body.tenant, {
    id: tenantA,
    name: 'Dashboard A',
    phone: '+218910007001',
    status: 'Active',
    quality: 'High',
    tier: '5K',
    credits: 777,
});
assert.equal('access_token' in dashboardA.res.body.tenant, false);
assert.equal('webhook_secret' in dashboardA.res.body.tenant, false);
assert.deepEqual(dashboardA.res.body.stats, {
    totalConversations: 3,
    messagesToday: 5,
    sentToday: 2,
    receivedToday: 3,
    unreadCount: 4,
    templatesCount: 2,
    whatsappConversations: 2,
    whatsappMessagesToday: 3,
    whatsappSentToday: 1,
    whatsappReceivedToday: 2,
    whatsappUnread: 1,
    messengerConversations: 1,
    messengerMessagesToday: 2,
    messengerSentToday: 1,
    messengerReceivedToday: 1,
    messengerUnread: 3,
    linkedFacebookPages: 1,
    facebookActionsWeek: 2,
});
assert.equal(dashboardA.res.body.recentActivity.length, 5);
assert.ok(dashboardA.res.body.recentActivity.every(item => !('tenant_id' in item)));
assert.ok(dashboardA.res.body.recentActivity.every(item => !item.description.includes('B marker')));
assert.deepEqual(
    dashboardA.res.body.recentActivity.map(item => item.description),
    ['A activity 0', 'A activity 1', 'A activity 2', 'A activity 3', 'A activity 4'],
);

const dashboardB = await invokeRoute('get', '/', {
    user: { tenant_id: tenantB, role: 'user' },
});
assert.equal(dashboardB.res.statusCode, 200);
assert.equal(dashboardB.res.body.stats.whatsappConversations, 1);
assert.equal(dashboardB.res.body.stats.messengerConversations, 1);
assert.equal(dashboardB.res.body.stats.templatesCount, 1);
assert.equal(dashboardB.res.body.stats.linkedFacebookPages, 1);
assert.ok(dashboardB.res.body.recentActivity.some(item => item.description === 'B marker must stay hidden'));

const missingTenant = await invokeRoute('get', '/', {
    user: { tenant_id: 999999, role: 'user' },
});
assert.equal(missingTenant.res.statusCode, 404);

db.close();
console.log(JSON.stringify({
    aggregateCounts: true,
    whatsappAndMessengerIsolation: true,
    pageAndTemplateIsolation: true,
    activityAllowlistAndIsolation: true,
    tenantSecretRedaction: true,
    missingTenantHandling: true,
}));
