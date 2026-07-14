import assert from 'node:assert/strict';
import test from 'node:test';

import { createMetricsAuth } from '../middleware/metricsAuth.js';

function invoke(middleware, authorization) {
    const result = { status: 200, body: null, next: false, headers: {} };
    const req = { get: name => name.toLowerCase() === 'authorization' ? authorization : undefined };
    const res = {
        status(value) {
            result.status = value;
            return this;
        },
        json(value) {
            result.body = value;
            return this;
        },
        setHeader(name, value) {
            result.headers[name] = value;
        },
    };
    middleware(req, res, () => {
        result.next = true;
    });
    return result;
}

test('metrics endpoint is hidden when its dedicated token is disabled', () => {
    const result = invoke(createMetricsAuth({ token: '' }), 'Bearer anything');
    assert.equal(result.status, 404);
    assert.equal(result.next, false);
});

test('metrics endpoint accepts only its exact bearer token', () => {
    const middleware = createMetricsAuth({ token: 'metrics-token-with-at-least-32-characters' });
    const invalid = invoke(middleware, 'Bearer wrong-token');
    const valid = invoke(middleware, 'Bearer metrics-token-with-at-least-32-characters');

    assert.equal(invalid.status, 401);
    assert.equal(invalid.headers['WWW-Authenticate'], 'Bearer realm="metrics"');
    assert.equal(invalid.next, false);
    assert.equal(valid.next, true);
});
