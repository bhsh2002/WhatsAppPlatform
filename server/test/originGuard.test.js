import assert from 'node:assert/strict';
import test from 'node:test';
import { createOriginGuard } from '../middleware/originGuard.js';

const invoke = ({ method = 'POST', origin, host = 'app.example.com', protocol = 'https' } = {}) => {
    const headers = { host };
    if (origin !== undefined) headers.origin = origin;
    const req = {
        method,
        protocol,
        headers,
        get(name) {
            return headers[name.toLowerCase()];
        },
    };
    const result = { statusCode: 200, body: null, nextCalled: false };
    const res = {
        status(value) {
            result.statusCode = value;
            return this;
        },
        json(value) {
            result.body = value;
            return this;
        },
    };
    createOriginGuard({ allowedOrigins: ['http://localhost:5173'] })(req, res, () => {
        result.nextCalled = true;
    });
    return result;
};

test('origin guard allows same-origin, configured development and Origin-less mutations', () => {
    assert.equal(invoke({ origin: 'https://app.example.com' }).nextCalled, true);
    assert.equal(invoke({ origin: 'http://localhost:5173' }).nextCalled, true);
    assert.equal(invoke({ origin: undefined }).nextCalled, true);
    assert.equal(invoke({ method: 'GET', origin: 'https://evil.example' }).nextCalled, true);
});

test('origin guard rejects cross-origin browser mutations', () => {
    const result = invoke({ origin: 'https://evil.example' });
    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body.code, 'ORIGIN_NOT_ALLOWED');
});
