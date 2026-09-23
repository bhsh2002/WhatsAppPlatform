import assert from 'node:assert/strict';
import test from 'node:test';

import { metaWebhookNotificationSource } from '../services/metaWebhookNotifications.js';

test('Meta notification fallback sources are deterministic privacy-safe hashes', () => {
    const input = {
        kind: 'messenger-message',
        pageId: 'page-8',
        senderId: 'sender-8',
        message: { text: 'private Messenger body' },
    };

    const first = metaWebhookNotificationSource(input);
    const second = metaWebhookNotificationSource(input);
    const reordered = metaWebhookNotificationSource({
        message: { text: 'private Messenger body' },
        senderId: 'sender-8',
        pageId: 'page-8',
        kind: 'messenger-message',
    });
    const nestedReordered = metaWebhookNotificationSource({
        ...input,
        message: { z: { second: 2, first: 1 }, a: ['one', { y: 2, x: 1 }] },
    });
    const nestedCanonical = metaWebhookNotificationSource({
        kind: input.kind,
        pageId: input.pageId,
        senderId: input.senderId,
        message: { a: ['one', { x: 1, y: 2 }], z: { first: 1, second: 2 } },
    });
    const changed = metaWebhookNotificationSource({ ...input, senderId: 'sender-9' });

    assert.equal(first, second);
    assert.equal(first, reordered);
    assert.equal(nestedReordered, nestedCanonical);
    assert.match(first, /^meta:[0-9a-f]{64}$/);
    assert.notEqual(first, changed);
    assert.ok(!first.includes('private'));
    assert.ok(!first.includes('sender-8'));
});
