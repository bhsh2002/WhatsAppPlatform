import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizePublicMetaError,
    readMetaResponse,
    requestMetaJson,
    sanitizeStoredMetaResponse,
    sendMetaFailure,
    summarizeMetaException,
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
        message: 'Meta access token is invalid or expired',
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
    assert.equal(payload.error, 'Meta access token is invalid or expired');
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
            message: 'Meta rejected the request',
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

test('untrusted Meta messages and type fields cannot expose tokens or request URLs', async () => {
    const secret = 'ea-secret-app-token';
    const url = `https://graph.facebook.com/debug_token?input_token=${secret}`;
    const result = await readMetaResponse(new Response(JSON.stringify({
        error: {
            message: `Request to ${url} failed`,
            error_user_msg: `Use ${secret} to retry`,
            type: `OAuthException ${secret}`,
            code: 190,
            error_subcode: 463,
            fbtrace_id: secret,
        },
    }), { status: 401 }));

    assert.equal(result.error.message, 'Meta access token is invalid or expired');
    assert.equal(result.error.type, null);
    assert.equal(result.error.code, 190);
    assert.equal(result.error.subcode, 463);
    assert.equal(result.data, null);
    assert.doesNotMatch(JSON.stringify(result.error), /ea-secret|debug_token|input_token/);
});

test('unsafe Meta code and subcode types are discarded', () => {
    const error = normalizePublicMetaError({ error: {
        message: 'secret',
        type: { value: 'secret' },
        code: 'access_token=secret',
        error_subcode: -1,
    } }, 400);
    assert.deepEqual({ type: error.type, code: error.code, subcode: error.subcode }, {
        type: null, code: null, subcode: null,
    });
    assert.equal(error.message, 'Meta rejected the request');
});

test('a successful HTTP response containing a Meta error is treated as a failure', async () => {
    const result = await readMetaResponse(new Response(JSON.stringify({
        error: { message: 'access_token=secret', code: 190 },
    }), { status: 200 }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(result.error.code, 190);
    assert.equal(result.data, null);
    assert.doesNotMatch(JSON.stringify(result.error), /secret/);
});

test('fetch exception summaries never log URLs, messages, or arbitrary codes', () => {
    const error = new TypeError('https://graph.facebook.com/?access_token=secret');
    error.code = 'access_token=secret';
    error.cause = { access_token: 'secret' };
    assert.deepEqual(summarizeMetaException(error), { name: 'TypeError', code: null });
    assert.deepEqual(summarizeMetaException({ name: 'Error', code: 'ETIMEDOUT' }), {
        name: 'Error', code: 'ETIMEDOUT',
    });
});

test('sendMetaFailure sanitizes arbitrary error objects before returning them', () => {
    let payload;
    let status;
    sendMetaFailure({
        status(value) { status = value; return this; },
        json(value) { payload = value; return this; },
    }, { status: 400, error: {
        message: 'https://graph.facebook.com/?access_token=secret',
        type: 'secret',
        code: 'secret',
    } });
    assert.equal(status, 400);
    assert.equal(payload.error, 'Meta rejected the request');
    assert.doesNotMatch(JSON.stringify(payload), /secret|graph\.facebook/);
});

test('Arabic routes receive fixed safe copy without echoing a fallback that includes a secret', () => {
    let payload;
    sendMetaFailure({
        status() { return this; },
        json(value) { payload = value; return this; },
    }, { status: 429, error: { message: 'access_token=secret', code: 4 } },
    'فشل الطلب access_token=secret');
    assert.equal(payload.error, 'تم تجاوز حد طلبات Meta، حاول لاحقاً');
    assert.equal(payload.details.message, payload.error);
    assert.equal(payload.details.code, 4);
    assert.doesNotMatch(JSON.stringify(payload), /secret|access_token/);
});
