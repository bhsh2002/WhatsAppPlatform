import assert from 'node:assert/strict';
import db from '../db/database.js';
import fbContentRouter from '../routes/fbContent.js';
import fbInsightsRouter from '../routes/fbInsights.js';
import { encrypt, initEncryption } from '../services/encryption.js';

initEncryption();

const tenantOne = Number(db.prepare(
    "INSERT INTO tenants (name, status) VALUES ('FB Content Tenant One', 'Active')"
).run().lastInsertRowid);
const tenantTwo = Number(db.prepare(
    "INSERT INTO tenants (name, status) VALUES ('FB Content Tenant Two', 'Active')"
).run().lastInsertRowid);

const insertPage = db.prepare(`
    INSERT INTO tenant_pages (tenant_id, page_id, page_name, page_access_token_encrypted, is_active)
    VALUES (?, ?, ?, ?, 1)
`);
const pageOne = Number(insertPage.run(tenantOne, 'page-one', 'Page One', encrypt('token-one')).lastInsertRowid);
const pageTwo = Number(insertPage.run(tenantTwo, 'page-two', 'Page Two', encrypt('token-two')).lastInsertRowid);

let metaRequestCount = 0;
globalThis.fetch = async () => {
    metaRequestCount += 1;
    return new Response(JSON.stringify({
        error: {
            message: 'Invalid page token',
            type: 'OAuthException',
            code: 190,
            fbtrace_id: 'private-trace',
            error_data: { access_token: 'private-token' },
        },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } });
};

const listPostsLayer = fbContentRouter.stack.find(layer => (
    layer.route?.path === '/:linkedPageId/posts' && layer.route.methods.get
));
assert.ok(listPostsLayer, 'list posts route must be registered');
const listPostsHandler = listPostsLayer.route.stack.at(-1).handle;
const overviewLayer = fbInsightsRouter.stack.find(layer => (
    layer.route?.path === '/:linkedPageId/overview' && layer.route.methods.get
));
assert.ok(overviewLayer, 'insights overview route must be registered');
const overviewHandler = overviewLayer.route.stack.at(-1).handle;

const invokeHandler = async (handler, linkedPageId, user) => {
    let status = 200;
    let body;
    const req = { params: { linkedPageId: String(linkedPageId) }, query: {}, user };
    const res = {
        status(value) {
            status = value;
            return this;
        },
        json(value) {
            body = value;
            return value;
        },
    };

    await handler(req, res);
    return { status, body };
};

try {
    const denied = await invokeHandler(listPostsHandler, pageTwo, { role: 'tenant', tenant_id: tenantOne });
    assert.equal(denied.status, 404);
    assert.equal(metaRequestCount, 0, 'cross-tenant page lookup must fail before contacting Meta');

    const owned = await invokeHandler(listPostsHandler, pageOne, { role: 'tenant', tenant_id: tenantOne });
    assert.equal(owned.status, 401);
    assert.equal(owned.body.error, 'Invalid page token');
    assert.equal(owned.body.details.code, 190);
    assert.equal(JSON.stringify(owned.body).includes('private-trace'), false);
    assert.equal(JSON.stringify(owned.body).includes('private-token'), false);

    const admin = await invokeHandler(listPostsHandler, pageTwo, { role: 'admin' });
    assert.equal(admin.status, 401);
    assert.equal(metaRequestCount, 2);

    const deniedInsights = await invokeHandler(overviewHandler, pageTwo, { role: 'tenant', tenant_id: tenantOne });
    assert.equal(deniedInsights.status, 404);
    assert.equal(metaRequestCount, 2, 'cross-tenant insights lookup must fail before contacting Meta');

    console.log(JSON.stringify({ tenantIsolation: true, normalizedErrors: true, adminAccess: true }));
} finally {
    db.close();
}
