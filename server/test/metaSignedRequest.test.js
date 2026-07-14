import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { verifyMetaSignedRequest } from '../security/metaSignedRequest.js';

const encode = value => Buffer.from(value).toString('base64url');
const sign = (payload, secret) => {
    const encodedPayload = encode(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
    return `${signature}.${encodedPayload}`;
};

test('Meta data-deletion signed requests require HMAC-SHA256 and a valid signature', () => {
    const secret = 'test-app-secret';
    const signed = sign({ algorithm: 'HMAC-SHA256', user_id: 'psid-123' }, secret);

    assert.equal(verifyMetaSignedRequest(signed, secret).user_id, 'psid-123');
    assert.throws(() => verifyMetaSignedRequest(`${signed}x`, secret), /signature|Malformed/);
    assert.throws(() => verifyMetaSignedRequest(sign({ algorithm: 'none', user_id: 'psid-123' }, secret), secret), /algorithm/);
    assert.throws(() => verifyMetaSignedRequest(sign({ algorithm: 'HMAC-SHA256' }, secret), secret), /user_id/);
});
