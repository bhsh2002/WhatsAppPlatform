import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.META_APP_ID = 'app-transport-test';
process.env.META_APP_SECRET = 'app-transport-secret';
process.env.META_WEBHOOK_CALLBACK_URL = 'https://wa.example.test/api/webhook';
process.env.WEBHOOK_VERIFY_TOKEN = 'webhook-verify-test';

const [{ default: db }, { default: router }] = await Promise.all([
    import('../db/database.js'),
    import('../routes/facebookPages.js'),
]);

after(() => db.close());

const invokeRoute = (method, path, request = {}) => new Promise((resolve, reject) => {
    const layer = router.stack.find(item => item.route?.path === path && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${path}`);
    const req = { body: {}, params: {}, query: {}, ...request };
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

test('app-level webhook diagnostic and setup keep the app secret out of URLs', async (t) => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(init.method === 'POST' ? { success: true } : { data: [] }), {
            status: 200,
        });
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const diagnostic = await invokeRoute('get', '/webhook-diagnostic');
    const setup = await invokeRoute('post', '/setup-app-webhook');

    assert.equal(diagnostic.statusCode, 200);
    assert.equal(setup.statusCode, 200);
    assert.equal(setup.body.success, true);
    assert.equal(calls.length, 3);
    for (const call of calls) {
        assert.doesNotMatch(call.url, /access_token=|app-transport-secret/);
        if (call.init.method !== 'POST') {
            assert.equal(call.init.headers.Authorization, 'Bearer app-transport-test|app-transport-secret');
        }
    }
    const subscribeBody = new URLSearchParams(calls[1].init.body);
    assert.equal(subscribeBody.get('verify_token'), 'webhook-verify-test');
    assert.equal(subscribeBody.get('access_token'), 'app-transport-test|app-transport-secret');
});

test('app webhook errors hide credential-bearing fetch exceptions from responses and logs', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const logs = [];
    const secret = 'sensitive-app-secret-in-fetch-error';
    globalThis.fetch = async () => {
        throw new TypeError(`https://graph.facebook.com/debug_token?input_token=${secret}`);
    };
    console.error = (...args) => { logs.push(args); };
    t.after(() => {
        globalThis.fetch = originalFetch;
        console.error = originalError;
    });

    const diagnostic = await invokeRoute('get', '/webhook-diagnostic');
    const setup = await invokeRoute('post', '/setup-app-webhook');
    assert.equal(diagnostic.statusCode, 500);
    assert.equal(setup.statusCode, 500);
    assert.equal(diagnostic.body.error, 'فشل فحص إعدادات Webhook');
    assert.equal(setup.body.error, 'فشل إعداد Webhook');
    assert.doesNotMatch(JSON.stringify({ diagnostic: diagnostic.body, setup: setup.body, logs }),
        /sensitive-app-secret|debug_token|input_token/);
});
