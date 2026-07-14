import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantQrCodesRouter } from '../routes/tenantQrCodes.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT,
            phone_number_id TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            tenant_name TEXT,
            event_type TEXT,
            description TEXT,
            status TEXT
        );
        INSERT INTO tenants (id, name, phone_number_id) VALUES
            (1, 'Tenant A', 'phone-a'),
            (2, 'Tenant B', NULL);
    `);
    return db;
}

const invokeRoute = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
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

test('tenant QR listing uses scoped credentials and normalizes the Meta response', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const router = createTenantQrCodesRouter({
        database: db,
        accessTokenForTenant: (tenantId) => tenantId === 1 ? 'token-a' : null,
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            return {
                ok: true,
                status: 200,
                data: { data: [{ code: 'qr-a' }], paging: { next: 'cursor' } },
            };
        },
    });

    const listed = await invokeRoute(router, 'get', '/', { user: { tenant_id: 1 } });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.body, {
        qr_codes: [{ code: 'qr-a' }],
        paging: { next: 'cursor' },
    });
    assert.match(calls[0].url, /\/phone-a\/message_qrdls$/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-a');

    const incomplete = await invokeRoute(router, 'get', '/', { user: { tenant_id: 2 } });
    assert.equal(incomplete.statusCode, 400);
    assert.equal(calls.length, 1);
});

test('tenant QR create/delete validate input, scope activity and encode remote ids', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const router = createTenantQrCodesRouter({
        database: db,
        accessTokenForTenant: () => 'token-a',
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            return { ok: true, status: 200, data: { code: 'created-code' } };
        },
    });

    const empty = await invokeRoute(router, 'post', '/', {
        user: { tenant_id: 1 },
        body: { prefilled_message: '   ' },
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(calls.length, 0);

    const created = await invokeRoute(router, 'post', '/', {
        user: { tenant_id: 1 },
        body: { prefilled_message: '  مرحبًا  ', generate_qr_image: 'SVG' },
    });
    assert.equal(created.statusCode, 200);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
        prefilled_message: 'مرحبًا',
        generate_qr_image: 'SVG',
    });
    const activity = db.prepare('SELECT * FROM activity_logs').get();
    assert.equal(activity.tenant_id, 1);
    assert.equal(activity.tenant_name, 'Tenant A');

    const deleted = await invokeRoute(router, 'delete', '/:qrCodeId', {
        user: { tenant_id: 1 },
        params: { qrCodeId: 'qr/id ?' },
    });
    assert.equal(deleted.statusCode, 200);
    assert.match(calls[1].url, /\/message_qrdls\/qr%2Fid%20%3F$/);
    assert.equal(calls[1].init.method, 'DELETE');
});
