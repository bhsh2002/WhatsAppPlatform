import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createFetchWithDefaultTimeout,
    normalizeFetchTimeout,
    normalizeSafeFetchAttempts,
} from '../runtime/fetchTimeout.js';

test('external fetches receive a bounded default timeout signal', async () => {
    let captured;
    const wrapped = createFetchWithDefaultTimeout(async (_input, init) => {
        captured = init;
        return { ok: true };
    }, 2500, { sleep: async () => {} });

    await wrapped('https://graph.facebook.com/test', { method: 'GET' });
    assert.equal(captured.method, 'GET');
    assert.equal(captured.signal instanceof AbortSignal, true);
    assert.equal(captured.signal.aborted, false);
});

test('explicit abort signals are preserved and timeout configuration is bounded', async () => {
    const controller = new AbortController();
    let capturedSignal;
    const wrapped = createFetchWithDefaultTimeout(async (_input, init) => {
        capturedSignal = init.signal;
        return { ok: true };
    }, 5000, { sleep: async () => {} });

    await wrapped('https://example.test', { signal: controller.signal });
    assert.equal(capturedSignal, controller.signal);
    assert.equal(normalizeFetchTimeout('20'), 1000);
    assert.equal(normalizeFetchTimeout('999999'), 120000);
    assert.equal(normalizeFetchTimeout('invalid'), 30000);
    assert.equal(normalizeSafeFetchAttempts('0'), 1);
    assert.equal(normalizeSafeFetchAttempts('99'), 4);
});

test('safe GET requests retry transient responses and honor the final response', async () => {
    const statuses = [503, 429, 200];
    const delays = [];
    let calls = 0;
    const wrapped = createFetchWithDefaultTimeout(async () => {
        const status = statuses[calls++];
        return new Response('response', {
            status,
            headers: status === 429 ? { 'Retry-After': '0' } : {},
        });
    }, 5000, {
        safeAttempts: 3,
        sleep: async delay => delays.push(delay),
    });

    const response = await wrapped('https://graph.facebook.com/test');
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.deepEqual(delays, [250, 0]);
});

test('unsafe methods are never retried automatically', async () => {
    let calls = 0;
    const wrapped = createFetchWithDefaultTimeout(async () => {
        calls += 1;
        return new Response('unavailable', { status: 503 });
    }, 5000, { safeAttempts: 4, sleep: async () => {} });

    const response = await wrapped('https://graph.facebook.com/messages', { method: 'POST' });
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
});

test('safe GET requests retry transient network failures', async () => {
    let calls = 0;
    const wrapped = createFetchWithDefaultTimeout(async () => {
        calls += 1;
        if (calls < 3) throw new TypeError('temporary network failure');
        return new Response('ok', { status: 200 });
    }, 5000, { safeAttempts: 3, sleep: async () => {} });

    assert.equal((await wrapped('https://graph.facebook.com/test')).status, 200);
    assert.equal(calls, 3);
});
