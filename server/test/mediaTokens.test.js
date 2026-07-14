import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import {
    createMediaToken,
    isMediaDownloadRequest,
    verifyMediaToken,
} from '../security/mediaTokens.js';

const secret = 'a'.repeat(64);

test('media token carries a restricted audience and expected identity', () => {
    const token = createMediaToken({
        userId: 42,
        tenantId: 7,
        role: 'user',
    }, secret);

    const decoded = verifyMediaToken(token, secret);
    assert.equal(decoded.sub, 42);
    assert.equal(decoded.tid, 7);
    assert.equal(decoded.role, 'user');
    assert.equal(decoded.purpose, 'media');
    assert.equal(decoded.aud, 'media-download');
});

test('ordinary JWTs and tokens signed by another key are rejected as media tokens', () => {
    const ordinaryJwt = jwt.sign({ sub: 42, purpose: 'media' }, secret, { expiresIn: 300 });
    const wrongKeyToken = createMediaToken({ userId: 42 }, 'b'.repeat(64));

    assert.equal(verifyMediaToken(ordinaryJwt, secret), null);
    assert.equal(verifyMediaToken(wrongKeyToken, secret), null);
});

test('media token query authentication is limited to GET download routes', () => {
    const allowed = [
        '/messages/media/abc/download',
        '/messages/media/abc/download/?media_token=token',
        '/portal/media/abc-123/download?media_token=token',
    ];

    for (const originalUrl of allowed) {
        assert.equal(isMediaDownloadRequest({ method: 'GET', originalUrl }), true, originalUrl);
    }

    const denied = [
        { method: 'POST', originalUrl: '/messages/media/abc/download' },
        { method: 'GET', originalUrl: '/messages/media/abc' },
        { method: 'GET', originalUrl: '/tenants' },
        { method: 'DELETE', originalUrl: '/portal/templates/1' },
    ];

    for (const request of denied) {
        assert.equal(isMediaDownloadRequest(request), false, request.originalUrl);
    }
});
