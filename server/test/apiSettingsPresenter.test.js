import assert from 'node:assert/strict';
import test from 'node:test';
import { presentApiSettings } from '../presenters/apiSettings.js';

const storedSettings = {
    id: 3,
    tenant_id: 9,
    api_key: null,
    api_key_hash: 'digest',
    webhook_secret: 'ciphertext',
    webhook_url: 'https://example.test/webhook',
    callback_url: null,
    is_active: 1,
    created_at: 'created',
    updated_at: 'updated',
};

test('stored API settings expose presence flags but no credentials', () => {
    const presented = presentApiSettings(storedSettings);

    assert.equal(presented.has_api_key, true);
    assert.equal(presented.has_webhook_secret, true);
    assert.equal('api_key' in presented, false);
    assert.equal('api_key_hash' in presented, false);
    assert.equal('webhook_secret' in presented, false);
});

test('new credentials are included only in an explicit one-time reveal', () => {
    const presented = presentApiSettings(storedSettings, {
        apiKey: 'new-api-key',
        webhookSecret: 'new-webhook-secret',
    });

    assert.equal(presented.api_key, 'new-api-key');
    assert.equal(presented.api_key_visible_once, true);
    assert.equal(presented.webhook_secret, 'new-webhook-secret');
    assert.equal(presented.webhook_secret_visible_once, true);
});
