import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
    unsignedWebhooksAllowed,
    verifyMetaWebhookSignature,
} from '../security/webhookSignature.js';

test('valid Meta webhook signatures pass and altered payloads fail', () => {
    const appSecret = 'meta-app-secret';
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

    assert.equal(verifyMetaWebhookSignature({ appSecret, signature, rawBody }), true);
    assert.equal(verifyMetaWebhookSignature({
        appSecret,
        signature,
        rawBody: Buffer.from('{"object":"page"}'),
    }), false);
});

test('missing or malformed webhook signatures fail closed', () => {
    const input = { appSecret: 'secret', rawBody: Buffer.from('{}') };
    assert.equal(verifyMetaWebhookSignature(input), false);
    assert.equal(verifyMetaWebhookSignature({ ...input, signature: 'sha256=bad' }), false);
    assert.equal(verifyMetaWebhookSignature({ ...input, appSecret: '' }), false);
});

test('unsigned webhook override is allowed only outside production', () => {
    assert.equal(unsignedWebhooksAllowed({
        appSecret: '',
        nodeEnv: 'development',
        allowUnsigned: true,
    }), true);
    assert.equal(unsignedWebhooksAllowed({
        appSecret: '',
        nodeEnv: 'production',
        allowUnsigned: true,
    }), false);
    assert.equal(unsignedWebhooksAllowed({
        appSecret: '',
        nodeEnv: 'test',
        allowUnsigned: false,
    }), false);
    assert.equal(unsignedWebhooksAllowed({
        appSecret: 'configured',
        nodeEnv: 'production',
        allowUnsigned: false,
    }), true);
});
