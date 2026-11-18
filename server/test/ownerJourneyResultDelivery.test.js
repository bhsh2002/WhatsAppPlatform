import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createOwnerJourneyResultDelivery } from '../test-support/ownerJourneyResultDelivery.js';

const prefix = '/api/portal/integrations';
const resultPath = '/workspace/commands/synthetic-opaque/result';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const eventFor = (bytes, contentType = 'application/json') => ({
    // These markers exercise delivery correlation only; they are not Core
    // identities, source bindings or a substitute for collector authorization.
    principal: { marker: 'synthetic-principal' }, before: { marker: 'synthetic-before' }, after: { marker: 'synthetic-after' },
    representation: { bytes, contentType, sha256: sha(bytes) },
});
const headers = (res, event) => res.set('Content-Type', `${event.representation.contentType}; charset=utf-8`)
    .set('X-Savana-Result-SHA256', event.representation.sha256);
const fixture = async (t, handler) => {
    const delivered = deferred(); const events = [];
    const hook = createOwnerJourneyResultDelivery({ onDelivered: event => { events.push(event); delivered.resolve(event); } });
    const app = express(); app.use(prefix, hook.middleware);
    app.use(prefix, (req, res, next) => Promise.resolve(handler(req, res, hook)).catch(next));
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    return { hook, events, delivered: delivered.promise, url: route => `http://127.0.0.1:${server.address().port}${prefix}${route}` };
};

test('actual finished Arabic JSON and UTF8 CSV responses retain exact bytes, MIME and digest and notify once', { timeout: 10_000 }, async t => {
    for (const [contentType, text] of [['application/json', '{"name":"منتج عربي","quantity":1}'],
        ['text/csv', 'الاسم,الكمية\nمنتج عربي,1\n']]) {
        const bytes = Buffer.from(text, 'utf8'); const original = Buffer.from(bytes); const event = eventFor(bytes, contentType);
        const f = await fixture(t, (_req, res, hook) => {
            assert.equal(hook.capture(event), true);
            assert.equal(hook.capture(eventFor(Buffer.from('a second capture cannot replace the first'))), false);
            headers(res, event).send(bytes);
        });
        const response = await fetch(f.url(resultPath + '?format=' + (contentType === 'text/csv' ? 'csv' : 'json')));
        const actual = Buffer.from(await response.arrayBuffer()); const observed = await f.delivered;
        assert.equal(response.status, 200); assert.equal(response.headers.get('content-type').split(';')[0], contentType);
        assert.equal(response.headers.get('x-savana-result-sha256'), sha(original));
        assert.deepEqual(actual, original); assert.deepEqual(bytes, original); assert.deepEqual(observed.representation.bytes, actual);
        assert.equal(observed.representation.contentType, contentType); assert.equal(observed.representation.sha256, sha(actual));
        assert.deepEqual(observed.before, event.before); assert.deepEqual(observed.after, event.after);
        await new Promise(setImmediate); assert.equal(f.events.length, 1);
    }
});

test('prepared capture and partial real HTTP writes do not report delivery before finish', { timeout: 10_000 }, async t => {
    const bytes = Buffer.from('{"message":"لم يكتمل الرد بعد"}'); const event = eventFor(bytes);
    const started = deferred(); const finish = deferred();
    const f = await fixture(t, async (_req, res, hook) => {
        hook.capture(event); headers(res, event); res.write(bytes.subarray(0, 5)); started.resolve();
        await finish.promise; res.end(bytes.subarray(5));
    });
    const pending = fetch(f.url(resultPath)); await started.promise; const response = await pending;
    assert.equal(f.events.length, 0); finish.resolve();
    const actual = Buffer.from(await response.arrayBuffer()); await f.delivered;
    assert.deepEqual(actual, bytes); assert.equal(f.events.length, 1);
});

test('an actual client abort before end produces no delivery callback', { timeout: 10_000 }, async t => {
    const bytes = Buffer.from('{"message":"رد سيقطعه العميل"}'); const event = eventFor(bytes); const closed = deferred();
    let serverResponse;
    const f = await fixture(t, (_req, res, hook) => {
        serverResponse = res; hook.capture(event); headers(res, event);
        res.once('close', closed.resolve); res.write(bytes.subarray(0, 8));
    });
    await new Promise((resolve, reject) => {
        const request = http.get(f.url(resultPath), response => {
            response.once('data', () => { response.destroy(); request.destroy(); resolve(); });
            response.on('error', () => {});
        });
        request.once('error', error => { if (error.code === 'ECONNRESET') resolve(); else reject(error); });
    });
    await closed.promise; await new Promise(setImmediate);
    assert.equal(serverResponse.writableFinished, false); assert.equal(f.events.length, 0);
});

test('wrong status, body, MIME, missing hash or changed hash never report a completed result', { timeout: 10_000 }, async t => {
    const bytes = Buffer.from('{"message":"البيانات الأصلية"}'); const event = eventFor(bytes); let mode;
    const f = await fixture(t, (_req, res, hook) => {
        hook.capture(event); headers(res, event);
        if (mode === 'status') res.status(403);
        if (mode === 'mime') res.set('Content-Type', 'text/plain');
        if (mode === 'missing-hash') res.removeHeader('X-Savana-Result-SHA256');
        if (mode === 'changed-hash') res.set('X-Savana-Result-SHA256', '0'.repeat(64));
        res.send(mode === 'body' ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes);
    });
    for (mode of ['status', 'mime', 'missing-hash', 'changed-hash', 'body']) {
        const response = await fetch(f.url(resultPath)); await response.arrayBuffer(); await new Promise(setImmediate);
        assert.equal(f.events.length, 0, mode);
    }
});

test('outside capture, uncaptured results, non-GET and unrelated routes do not create a result delivery', { timeout: 10_000 }, async t => {
    const bytes = Buffer.from('{"message":"قراءة محلية فقط"}'); const event = eventFor(bytes); let capturing = true;
    const f = await fixture(t, (_req, res, hook) => { if (capturing) hook.capture(event); headers(res, event).send(bytes); });
    assert.equal(f.hook.capture(event), false);
    for (const [route, method] of [[resultPath + '/extra', 'GET'], ['/workspace/commands/synthetic-opaque', 'GET'], [resultPath, 'POST']]) {
        const response = await fetch(f.url(route), { method }); await response.arrayBuffer();
    }
    capturing = false; const response = await fetch(f.url(resultPath)); await response.arrayBuffer(); await new Promise(setImmediate);
    assert.equal(f.events.length, 0);
});

test('mutating a returned representation Buffer before the actual response cannot rewrite the captured evidence', { timeout: 10_000 }, async t => {
    const bytes = Buffer.from('{"value":"original"}'); const event = eventFor(bytes); const originalHash = event.representation.sha256;
    const f = await fixture(t, (_req, res, hook) => {
        hook.capture(event);
        bytes.fill(0x20);
        headers(res, event).send(bytes);
    });
    const response = await fetch(f.url(resultPath)); const actual = Buffer.from(await response.arrayBuffer()); await new Promise(setImmediate);
    assert.equal(response.headers.get('x-savana-result-sha256'), originalHash);
    assert.notEqual(sha(actual), originalHash); assert.equal(f.events.length, 0);
});
