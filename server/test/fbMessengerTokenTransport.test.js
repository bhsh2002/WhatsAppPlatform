import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, before } from 'node:test';

import db from '../db/database.js';
import router from '../routes/fbMessenger.js';
import { encrypt, initEncryption } from '../services/encryption.js';

before(() => {
    process.env.CRYPTO_KEY = 'a'.repeat(64);
    initEncryption();
});
after(() => db.close());

const invokeSync = (linkedPageId) => new Promise((resolve, reject) => {
    const layer = router.stack.find(item => item.route?.path === '/:linkedPageId/sync' && item.route.methods?.post);
    assert.ok(layer);
    const req = { params: { linkedPageId: String(linkedPageId) }, body: {}, query: {} };
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            resolve(this);
            return this;
        },
    };
    Promise.resolve(layer.route.stack[0].handle(req, res)).catch(reject);
});

test('admin Messenger sync authenticates with a bearer header without exposing the page token in the URL', async (t) => {
    db.exec(`
        INSERT INTO tenants (id, name) VALUES (99901, 'Messenger token transport');
        INSERT INTO tenant_pages (id, tenant_id, page_id, page_name, is_active)
        VALUES (99901, 99901, 'page/transport', 'Messenger test page', 1);
    `);
    db.prepare('UPDATE tenant_pages SET page_access_token_encrypted = ? WHERE id = 99901')
        .run(encrypt('messenger-sync-private-token'));

    const originalFetch = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init = {}) => {
        call = { url: String(url), init };
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const result = await invokeSync(99901);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
        success: true,
        synced_conversations: 0,
        synced_messages: 0,
    });
    assert.equal(call.init.headers.Authorization, 'Bearer messenger-sync-private-token');
    assert.match(call.url, /\/page%2Ftransport\/conversations\?fields=/);
    assert.doesNotMatch(call.url, /access_token=|messenger-sync-private-token/);
});

test('Meta Page, Messenger and webhook route sources contain no access_token URL query parameter', () => {
    for (const route of ['facebookPages.js', 'fbMessenger.js', 'webhooks.js']) {
        const source = readFileSync(new URL(`../routes/${route}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /[?&]access_token=/, `${route} must not put access_token in a URL`);
    }
});
