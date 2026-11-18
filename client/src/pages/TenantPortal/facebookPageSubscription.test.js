import assert from 'node:assert/strict';
import test from 'node:test';
import { facebookPageHasMessageEchoes, facebookPageNeedsWebhookRepair } from './facebookPageSubscription.js';

test('a legacy recorded subscription still offers explicit repair when sent-message echoes are missing', () => {
    const legacy = { is_active: 1, webhook_subscribed: 1, token_status: 'valid', subscribed_fields: JSON.stringify(['feed', 'messages', 'messaging_postbacks']) };
    assert.equal(facebookPageHasMessageEchoes(legacy), false);
    assert.equal(facebookPageNeedsWebhookRepair(legacy), true);
    const current = { ...legacy, subscribed_fields: ['feed', 'messages', 'messaging_postbacks', 'message_echoes'] };
    assert.equal(facebookPageHasMessageEchoes(current), true);
    assert.equal(facebookPageNeedsWebhookRepair(current), false);
    assert.equal(facebookPageNeedsWebhookRepair(current, true), true);
});

test('repair remains unavailable for inactive or invalid-token pages and tolerates malformed saved fields', () => {
    const page = { is_active: 1, webhook_subscribed: 1, token_status: 'valid', subscribed_fields: '{invalid' };
    assert.equal(facebookPageNeedsWebhookRepair(page), true);
    assert.equal(facebookPageNeedsWebhookRepair({ ...page, is_active: 0 }), false);
    assert.equal(facebookPageNeedsWebhookRepair({ ...page, token_status: 'expired' }), false);
    assert.equal(facebookPageNeedsWebhookRepair({ ...page, token_status: 'invalid' }), false);
    assert.equal(facebookPageHasMessageEchoes({ subscribed_fields: 'messages,message_echoes' }), true);
});
