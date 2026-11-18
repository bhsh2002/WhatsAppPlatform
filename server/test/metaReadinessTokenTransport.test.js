import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.META_APP_ID = 'readiness-transport-app';
process.env.META_APP_SECRET = 'readiness-transport-secret';
process.env.CRYPTO_KEY = 'b'.repeat(64);

const [{ default: db }, { debugFacebookUserToken, FACEBOOK_WEBHOOK_FIELDS, isMessengerWebhookReady }, { encrypt, initEncryption }] = await Promise.all([
    import('../db/database.js'),
    import('../services/metaReadiness.js'),
    import('../services/encryption.js'),
]);

initEncryption();
after(() => db.close());

test('Messenger readiness requires recorded sent-message echoes as well as messages without subscribing automatically', () => {
    assert.deepEqual(FACEBOOK_WEBHOOK_FIELDS, ['feed', 'messages', 'messaging_postbacks', 'message_echoes']);
    const legacy = { token_ready: true, webhook_subscribed: true, subscribed_fields: ['feed', 'messages', 'messaging_postbacks'] };
    assert.equal(isMessengerWebhookReady(legacy), false);
    const ready = { ...legacy, subscribed_fields: JSON.stringify(FACEBOOK_WEBHOOK_FIELDS) };
    assert.equal(isMessengerWebhookReady(ready), true);
    assert.equal(isMessengerWebhookReady({ ...ready, token_ready: false }), false);
    assert.equal(isMessengerWebhookReady({ ...ready, webhook_subscribed: false }), false);
    assert.equal(isMessengerWebhookReady({ ...ready, subscribed_fields: ['message_echoes'] }), false);
});

test('Facebook readiness sends the app credential in Authorization, not the debug URL', async (t) => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ data: {
            is_valid: true,
            app_id: 'readiness-transport-app',
            scopes: ['pages_show_list'],
        } }), { status: 200 });
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const result = await debugFacebookUserToken({
        facebook_user_access_token_encrypted: encrypt('user-token-for-debug'),
    });
    assert.equal(result.checked, true);
    assert.equal(result.status, 'valid');
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('input_token'), 'user-token-for-debug');
    assert.equal(url.searchParams.has('access_token'), false);
    assert.doesNotMatch(calls[0].url, /readiness-transport-secret/);
    assert.equal(calls[0].init.headers.Authorization,
        'Bearer readiness-transport-app|readiness-transport-secret');
});
