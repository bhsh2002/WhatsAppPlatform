import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantProfileRouter } from '../routes/tenantProfile.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT,
            phone TEXT,
            status TEXT,
            tier TEXT,
            credits INTEGER,
            quality TEXT,
            created_at DATETIME,
            phone_number_id TEXT,
            access_token TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            tenant_name TEXT,
            event_type TEXT,
            description TEXT,
            status TEXT
        );
        INSERT INTO tenants (
            id, name, phone, status, tier, credits, quality,
            created_at, phone_number_id, access_token
        ) VALUES
            (1, 'Tenant A', '+218910000001', 'Active', 'pro', 20, 'green',
             '2026-06-01 10:00:00', 'phone-a', 'must-not-leak'),
            (2, 'Tenant B', '+218910000002', 'Active', 'free', 5, 'yellow',
             '2026-06-02 10:00:00', NULL, 'other-secret');
    `);
    return db;
}

const findRouteHandlers = (router, method, routePath) => {
    const layer = router.stack.find((item) => (
        item.route?.path === routePath && item.route.methods?.[method]
    ));
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map((item) => item.handle);
};

const invokeRoute = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
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
    const handlers = findRouteHandlers(router, method, routePath);
    let index = 0;
    const next = (error) => {
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

test('tenant account profile is scoped and returned through an explicit allowlist', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const router = createTenantProfileRouter({
        database: db,
        accessTokenForTenant: () => null,
        requestMeta: async () => assert.fail('Meta must not be called for account profile'),
    });

    const profileA = await invokeRoute(router, 'get', '/profile', { user: { tenant_id: 1 } });
    assert.equal(profileA.res.statusCode, 200);
    assert.equal(profileA.res.body.id, 1);
    assert.equal(profileA.res.body.name, 'Tenant A');
    assert.equal('access_token' in profileA.res.body, false);
    assert.equal('phone_number_id' in profileA.res.body, false);

    const profileB = await invokeRoute(router, 'get', '/profile', { user: { tenant_id: 2 } });
    assert.equal(profileB.res.body.id, 2);
    const missing = await invokeRoute(router, 'get', '/profile', { user: { tenant_id: 99 } });
    assert.equal(missing.res.statusCode, 404);
});

test('business-profile reads use only the authenticated tenant credentials', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const router = createTenantProfileRouter({
        database: db,
        accessTokenForTenant: (tenantId) => tenantId === 1 ? 'tenant-a-token' : null,
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            return {
                ok: true,
                status: 200,
                data: { data: [{ about: 'Tenant A profile', messaging_product: 'whatsapp' }] },
            };
        },
    });

    const result = await invokeRoute(router, 'get', '/business-profile', { user: { tenant_id: 1 } });
    assert.equal(result.res.statusCode, 200);
    assert.equal(result.res.body.about, 'Tenant A profile');
    assert.match(calls[0].url, /\/phone-a\/whatsapp_business_profile\?fields=/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tenant-a-token');

    const incomplete = await invokeRoute(router, 'get', '/business-profile', { user: { tenant_id: 2 } });
    assert.equal(incomplete.res.statusCode, 400);
    assert.equal(calls.length, 1);
});

test('business-profile updates allowlist fields, normalize websites and write scoped activity', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    let shouldFail = false;
    const router = createTenantProfileRouter({
        database: db,
        accessTokenForTenant: () => 'tenant-a-token',
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            if (shouldFail) {
                return { ok: false, status: 429, error: { message: 'Meta rate limit', retryable: true } };
            }
            return { ok: true, status: 200, data: { success: true } };
        },
    });

    const updated = await invokeRoute(router, 'put', '/business-profile', {
        user: { tenant_id: 1 },
        body: {
            about: 'Updated profile',
            websites: 'https://example.test',
            profile_picture_handle: 'handle-1',
            tenant_id: 2,
            arbitrary_secret: 'drop-me',
        },
    });
    assert.equal(updated.res.statusCode, 200);
    const payload = JSON.parse(calls[0].init.body);
    assert.deepEqual(payload, {
        messaging_product: 'whatsapp',
        about: 'Updated profile',
        profile_picture_handle: 'handle-1',
        websites: ['https://example.test'],
    });
    assert.equal(calls[0].init.method, 'POST');
    const activity = db.prepare('SELECT * FROM activity_logs').all();
    assert.equal(activity.length, 1);
    assert.equal(activity[0].tenant_id, 1);
    assert.equal(activity[0].tenant_name, 'Tenant A');

    shouldFail = true;
    const failed = await invokeRoute(router, 'put', '/business-profile', {
        user: { tenant_id: 1 },
        body: { description: 'not persisted' },
    });
    assert.equal(failed.res.statusCode, 429);
    assert.equal(failed.res.body.error, 'Meta rate limit');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM activity_logs').get().count, 1);
});
