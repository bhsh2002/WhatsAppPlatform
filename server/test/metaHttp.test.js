import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizePublicMetaError,
    readMetaResponse,
    requestMetaJson,
    sanitizeStoredMetaResponse,
    sendMetaFailure,
} from '../services/metaHttp.js';

test('Meta errors are normalized without leaking trace or raw error data', () => {
    const error = normalizePublicMetaError({
        error: {
            message: 'Internal detail',
            error_user_msg: 'Action required',
            type: 'OAuthException',
            code: 190,
            error_subcode: 463,
            fbtrace_id: 'trace-secret',
            error_data: { access_token: 'secret' },
        },
    }, 401);

    assert.deepEqual(error, {
        message: 'Action required',
        type: 'OAuthException',
        code: 190,
        subcode: 463,
        status: 401,
        retryable: false,
    });
    assert.equal('fbtrace_id' in error, false);
    assert.equal('error_data' in error, false);
});

test('invalid Meta JSON becomes a stable protocol error', async () => {
    const result = await requestMetaJson('https://graph.facebook.com/test', {}, {
        fetchImpl: async () => new Response('<html>gateway error</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
        }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.data, null);
    assert.equal(result.error.status, 502);
    assert.equal(result.error.retryable, true);
    assert.match(result.error.message, /invalid JSON/);
});

test('successful Meta JSON preserves the response payload', async () => {
    const result = await requestMetaJson('https://graph.facebook.com/test', {}, {
        fetchImpl: async () => new Response(JSON.stringify({ id: '123' }), { status: 200 }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { id: '123' });
    assert.equal(result.error, null);
});

test('existing fetch responses use the same invalid JSON contract', async () => {
    const result = await readMetaResponse(new Response('upstream unavailable', { status: 503 }));

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error.retryable, true);
    assert.match(result.error.message, /invalid JSON/);
});

test('HTTP responses expose only the normalized Meta error shape', () => {
    let statusCode;
    let payload;
    const res = {
        status(value) {
            statusCode = value;
            return this;
        },
        json(value) {
            payload = value;
            return value;
        },
    };

    sendMetaFailure(res, {
        status: 400,
        error: normalizePublicMetaError({
            error: {
                message: 'Invalid token',
                code: 190,
                fbtrace_id: 'private-trace',
                error_data: { access_token: 'private-token' },
            },
        }, 400),
    });

    assert.equal(statusCode, 400);
    assert.equal(payload.error, 'Invalid token');
    assert.equal(payload.details.code, 190);
    assert.equal(JSON.stringify(payload).includes('private-trace'), false);
    assert.equal(JSON.stringify(payload).includes('private-token'), false);
});

test('stored legacy Meta failures are sanitized before presentation', () => {
    const stored = sanitizeStoredMetaResponse(JSON.stringify({
        error: {
            message: 'Invalid event',
            code: 100,
            error_subcode: 2804019,
            fbtrace_id: 'legacy-trace',
            error_data: { access_token: 'legacy-token' },
        },
    }));

    assert.deepEqual(stored, {
        error: {
            message: 'Invalid event',
            type: null,
            code: 100,
            subcode: 2804019,
            status: 400,
            retryable: false,
        },
    });
    assert.equal(JSON.stringify(stored).includes('legacy-trace'), false);
    assert.equal(JSON.stringify(stored).includes('legacy-token'), false);
});

test('stored Meta successes expose only explicit allowlisted fields', () => {
    const stored = sanitizeStoredMetaResponse({
        events_received: 2,
        fbtrace_id: 'success-trace',
        access_token: 'must-not-leak',
    }, { successFields: ['events_received', 'fbtrace_id'] });

    assert.deepEqual(stored, { events_received: 2, fbtrace_id: 'success-trace' });
});
