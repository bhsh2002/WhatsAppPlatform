import assert from 'node:assert/strict';
import test from 'node:test';

import {
    integrationRequestMatchesConversation,
    integrationRequestRecipient,
} from './integrationRequestLifecycle.js';

const request = {
    payload: {
        recipient: { phone_e164: '+218 91 234 5678' },
    },
};

test('integration request recipient is normalized to the WhatsApp conversation id', () => {
    assert.equal(integrationRequestRecipient(request), '218912345678');
    assert.equal(integrationRequestMatchesConversation(request, {
        channel: 'whatsapp',
        contact_id: '218912345678',
    }), true);
});

test('integration requests never complete from another recipient or channel', () => {
    assert.equal(integrationRequestMatchesConversation(request, {
        channel: 'whatsapp',
        contact_id: '218919999999',
    }), false);
    assert.equal(integrationRequestMatchesConversation(request, {
        channel: 'sms',
        contact_id: '218912345678',
    }), false);
});
