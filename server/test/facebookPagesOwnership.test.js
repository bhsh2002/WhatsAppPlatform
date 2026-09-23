import assert from 'node:assert/strict';
import test from 'node:test';

import db from '../db/database.js';
import router from '../routes/facebookPages.js';

const findRouteHandlers = (method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
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
            resolve(this);
            return this;
        },
    };
    const handlers = findRouteHandlers(method, routePath);
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve(res);
        try {
            Promise.resolve(handlers[index++](req, res, next)).catch(reject);
        } catch (handlerError) {
            reject(handlerError);
        }
    };
    next();
});

test('admin page linking rejects a page owned by another tenant without disclosing its owner', async (t) => {
    t.after(() => db.close());
    db.exec(`
        DELETE FROM tenant_pages;
        DELETE FROM tenants;
        INSERT INTO tenants (id, name) VALUES
            (901, 'Private owner'),
            (902, 'Requesting tenant');
        INSERT INTO tenant_pages (tenant_id, page_id, page_name)
        VALUES (901, 'globally-owned-page', 'Secret page');
    `);

    const response = await invokeRoute('post', '/tenant/:tenantId', {
        params: { tenantId: '902' },
        body: {
            page_id: 'globally-owned-page',
            page_access_token: 'token-that-must-not-be-used',
        },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, { error: 'هذه الصفحة غير متاحة للربط' });
    assert.doesNotMatch(JSON.stringify(response.body), /Private owner|901|Secret page/);
    assert.deepEqual(
        db.prepare('SELECT tenant_id, page_name FROM tenant_pages WHERE page_id = ?')
            .get('globally-owned-page'),
        { tenant_id: 901, page_name: 'Secret page' }
    );
});
