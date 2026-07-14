import assert from 'node:assert/strict';
import db from '../db/database.js';
import tenantAutomationRouter from '../routes/tenantAutomation.js';

const findRouteHandlers = (method, routePath) => {
    const layer = tenantAutomationRouter.stack.find(item => (
        item.route?.path === routePath && item.route.methods?.[method]
    ));
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (method, routePath, request = {}) => new Promise((resolve, reject) => {
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

const tenantA = Number(db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES ('Automation tenant A', '+218910003001', 'Active')
`).run().lastInsertRowid);
const tenantB = Number(db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES ('Automation tenant B', '+218910003002', 'Active')
`).run().lastInsertRowid);

const requestFor = (tenantId, values = {}) => ({
    user: { tenant_id: tenantId, role: 'user' },
    ...values,
});

const createdA = await invokeRoute('post', '/rules', requestFor(tenantA, {
    body: {
        name: 'Tenant A keyword',
        rule_type: 'keyword',
        channel: 'whatsapp',
        match_type: 'contains',
        match_pattern: 'help',
        response_type: 'text',
        response_text: 'How can we help?',
    },
}));
assert.equal(createdA.res.statusCode, 201);
assert.equal(createdA.res.body.tenant_id, tenantA);
const ruleA = Number(createdA.res.body.id);

const createdB = await invokeRoute('post', '/rules', requestFor(tenantB, {
    body: {
        name: 'Tenant B welcome',
        rule_type: 'welcome',
        channel: 'messenger',
        response_type: 'text',
        response_text: 'Welcome',
    },
}));
assert.equal(createdB.res.statusCode, 201);
const ruleB = Number(createdB.res.body.id);

const invalidPattern = await invokeRoute('post', '/rules', requestFor(tenantA, {
    body: {
        name: 'Unsafe regex',
        rule_type: 'keyword',
        match_type: 'regex',
        match_pattern: '(a+)+$',
        response_text: 'No',
    },
}));
assert.equal(invalidPattern.res.statusCode, 400);

const tenantAList = await invokeRoute('get', '/rules', requestFor(tenantA, {
    query: { channel: 'whatsapp', limit: '1', offset: '0' },
}));
assert.equal(tenantAList.res.statusCode, 200);
assert.deepEqual(tenantAList.res.body.map(rule => rule.id), [ruleA]);

const hiddenRead = await invokeRoute('get', '/rules/:id', requestFor(tenantA, {
    params: { id: String(ruleB) },
}));
assert.equal(hiddenRead.res.statusCode, 404);

const hiddenUpdate = await invokeRoute('put', '/rules/:id', requestFor(tenantA, {
    params: { id: String(ruleB) },
    body: { response_text: 'Cross-tenant update' },
}));
assert.equal(hiddenUpdate.res.statusCode, 404);

const hiddenToggle = await invokeRoute('patch', '/rules/:id/toggle', requestFor(tenantA, {
    params: { id: String(ruleB) },
}));
assert.equal(hiddenToggle.res.statusCode, 404);

const hiddenDelete = await invokeRoute('delete', '/rules/:id', requestFor(tenantA, {
    params: { id: String(ruleB) },
}));
assert.equal(hiddenDelete.res.statusCode, 404);

const updated = await invokeRoute('put', '/rules/:id', requestFor(tenantA, {
    params: { id: String(ruleA) },
    body: { response_text: 'Updated response', priority: 10 },
}));
assert.equal(updated.res.statusCode, 200);
assert.equal(updated.res.body.response_text, 'Updated response');
assert.equal(updated.res.body.priority, 10);

const toggled = await invokeRoute('patch', '/rules/:id/toggle', requestFor(tenantA, {
    params: { id: String(ruleA) },
}));
assert.equal(toggled.res.statusCode, 200);
assert.equal(toggled.res.body.is_active, 0);

const inactiveRules = await invokeRoute('get', '/rules', requestFor(tenantA, {
    query: { is_active: 'false' },
}));
assert.deepEqual(inactiveRules.res.body.map(rule => rule.id), [ruleA]);

db.prepare(`
    UPDATE automation_rules
    SET trigger_count = 4, last_triggered_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
`).run(ruleA, tenantA);
db.prepare(`
    INSERT INTO automation_cooldowns (rule_id, contact_id, channel)
    VALUES (?, 'contact-a', 'whatsapp')
`).run(ruleA);

const stats = await invokeRoute('get', '/rules/:id/stats', requestFor(tenantA, {
    params: { id: String(ruleA) },
}));
assert.equal(stats.res.statusCode, 200);
assert.equal(stats.res.body.trigger_count, 4);
assert.deepEqual(stats.res.body.recent_contacts.map(item => item.contact_id), ['contact-a']);

const hiddenStats = await invokeRoute('get', '/rules/:id/stats', requestFor(tenantB, {
    params: { id: String(ruleA) },
}));
assert.equal(hiddenStats.res.statusCode, 404);

const summaryA = await invokeRoute('get', '/summary', requestFor(tenantA));
assert.deepEqual(summaryA.res.body, {
    total: 1,
    active: 0,
    keywords: 0,
    weekTriggers: 4,
    totalTriggers: 4,
});

const deleted = await invokeRoute('delete', '/rules/:id', requestFor(tenantA, {
    params: { id: String(ruleA) },
}));
assert.equal(deleted.res.statusCode, 200);
assert.equal(db.prepare('SELECT COUNT(*) count FROM automation_cooldowns WHERE rule_id = ?').get(ruleA).count, 0);
assert.equal(db.prepare('SELECT COUNT(*) count FROM automation_rules WHERE id = ?').get(ruleB).count, 1);

db.close();
console.log(JSON.stringify({
    crudLifecycle: true,
    tenantIsolation: true,
    paginationAndFilters: true,
    patternValidation: true,
    statsAndCascade: true,
}));
