import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantWhatsAppMediaRouter } from '../routes/tenantWhatsAppMedia.js';
import { MediaTooLargeError } from '../services/mediaStreaming.js';

const NOW = Date.parse('2026-07-14T13:00:00.000Z');

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY, name TEXT, phone_number_id TEXT, status TEXT
        );
        CREATE TABLE contacts (
            tenant_id INTEGER, phone TEXT, last_customer_message_at DATETIME
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, direction TEXT,
            sender TEXT, recipient TEXT, message_type TEXT, content TEXT, status TEXT,
            wamid TEXT, error_message TEXT, media_id TEXT, media_mime_type TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, tenant_name TEXT,
            event_type TEXT, description TEXT, status TEXT
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'phone/A', 'Active'),
            (2, 'No Phone', NULL, 'Active'),
            (3, 'Suspended', 'phone-C', 'Suspended');
        INSERT INTO contacts VALUES
            (1, '218910000001', '2026-07-14T12:00:00.000Z'),
            (1, '218910000009', '2026-07-12T12:00:00.000Z');
    `);
    return database;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: { WHATSAPP_MEDIA: 'whatsapp.media' },
        reserve(options) {
            const reservation = { id: calls.reserves.length + 1, ...options };
            calls.reserves.push(reservation);
            return reservation;
        },
        commit(reservation, options) { calls.commits.push({ reservation, options }); },
        release(reservation, reason) { calls.releases.push({ reservation, reason }); },
        handleError: () => false,
    };
}

const findHandlers = (router, method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = { user: { tenant_id: 1 }, body: {}, params: {}, query: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        headersSent: false,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; this.headersSent = true; resolve(this); return this; },
        destroy(error) { this.destroyedWith = error; resolve(this); },
    };
    const handlers = findHandlers(router, method, routePath);
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve(res);
        try {
            Promise.resolve(handlers[index++](req, res, next)).catch(reject);
        } catch (handlerError) {
            reject(handlerError);
        }
    };
    next();
});

function createHarness({ responses = [], streamMedia } = {}) {
    const database = createDatabase();
    const billing = createBilling();
    const requests = [];
    const cleaned = [];
    const forms = [];
    const emitted = [];
    const router = createTenantWhatsAppMediaRouter({
        database,
        accessTokenForTenant: tenantId => tenantId === 2 ? 'token-2' : `token-${tenantId}`,
        billing,
        emitNewMessage: value => emitted.push(value),
        emitConversationUpdate: tenantId => emitted.push({ update: tenantId }),
        fetchImpl: async (url, init = {}) => {
            requests.push({ url, init });
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response;
        },
        parseMetaResponse: async response => response,
        streamMedia: streamMedia || (async (_response, res, options) => {
            res.json({ streamed: true, contentType: options.contentType });
        }),
        documentUploadMiddleware: (_req, _res, next) => next(),
        mediaUploadMiddleware: (_req, _res, next) => next(),
        formDataFactory: () => {
            const form = {
                entries: [],
                append(...args) { this.entries.push(args); },
                getHeaders: () => ({ 'content-type': 'multipart/form-data; boundary=test' }),
                getBuffer: () => Buffer.from('multipart'),
            };
            forms.push(form);
            return form;
        },
        readFile: path => Buffer.from(`file:${path}`),
        cleanup: file => { if (file?.path) cleaned.push(file.path); },
        logger: { error: () => undefined },
        now: () => NOW,
        apiBase: 'https://graph.test/v25.0',
    });
    return { database, billing, requests, cleaned, forms, emitted, router };
}

const file = (path, mimetype = 'image/jpeg', originalname = 'upload.jpg') => ({
    path,
    mimetype,
    originalname,
});

test('tenant media rejects invalid sessions, tenant states and closed windows before Meta or billing', async (t) => {
    const h = createHarness();
    t.after(() => h.database.close());

    const cases = [
        { request: { user: { tenant_id: 0 }, body: {}, file: file('/tmp/session.jpg') }, status: 401 },
        { request: { user: { tenant_id: 99 }, body: {}, file: file('/tmp/missing.jpg') }, status: 404 },
        { request: { user: { tenant_id: 3 }, body: {}, file: file('/tmp/suspended.jpg') }, status: 403 },
        { request: { user: { tenant_id: 2 }, body: {}, file: file('/tmp/no-phone.jpg') }, status: 400 },
    ];
    for (const entry of cases) {
        const result = await invoke(h.router, 'post', '/media/upload-to-meta', entry.request);
        assert.equal(result.statusCode, entry.status);
    }

    const invalidRecipient = await invoke(h.router, 'post', '/messages/send-document', {
        body: { recipient: 'not-a-phone' },
        file: file('/tmp/invalid.pdf', 'application/pdf', 'invalid.pdf'),
    });
    assert.equal(invalidRecipient.statusCode, 400);

    const wrongDocumentType = await invoke(h.router, 'post', '/messages/send-document', {
        body: { recipient: '218910000001' },
        file: file('/tmp/not-document.jpg'),
    });
    assert.equal(wrongDocumentType.statusCode, 400);
    assert.equal(wrongDocumentType.body.code, 'MEDIA_TYPE_MISMATCH');

    const closed = await invoke(h.router, 'post', '/messages/send-image', {
        body: { recipient: '218910000009' },
        file: file('/tmp/closed.jpg'),
    });
    assert.equal(closed.statusCode, 400);
    assert.equal(closed.body.code, 'OUTSIDE_WINDOW');

    const audioCaption = await invoke(h.router, 'post', '/messages/send-image', {
        body: { recipient: '218910000001', caption: 'unsupported' },
        file: file('/tmp/audio.mp3', 'audio/mpeg', 'audio.mp3'),
    });
    assert.equal(audioCaption.statusCode, 400);
    assert.equal(h.requests.length, 0);
    assert.equal(h.billing.calls.reserves.length, 0);
    assert.equal(h.cleaned.length, 8);
});

test('tenant media upload returns Meta ids and always cleans local files', async (t) => {
    const h = createHarness({ responses: [
        { ok: true, status: 200, data: { id: 'meta-upload' } },
        { ok: false, status: 503, error: { message: 'Upload unavailable' } },
    ] });
    t.after(() => h.database.close());

    const success = await invoke(h.router, 'post', '/media/upload-to-meta', {
        file: file('/tmp/upload.jpg', 'image/jpeg', ' photo.jpg '),
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.id, 'meta-upload');
    assert.match(h.requests[0].url, /\/phone%2FA\/media$/);
    assert.equal(h.requests[0].init.headers.Authorization, 'Bearer token-1');
    assert.equal(h.forms[0].entries[2][2].filename, 'photo.jpg');

    const failure = await invoke(h.router, 'post', '/media/upload-to-meta', {
        file: file('/tmp/upload-fail.jpg'),
    });
    assert.equal(failure.statusCode, 503);
    assert.equal(failure.body.error, 'Upload unavailable');
    assert.deepEqual(h.cleaned, ['/tmp/upload.jpg', '/tmp/upload-fail.jpg']);
});

test('tenant document sends normalize payloads, persist outcomes and settle billing once', async (t) => {
    const h = createHarness({ responses: [
        { ok: true, status: 200, data: { id: 'meta-doc-1' } },
        { ok: true, status: 200, data: { messages: [{ id: 'wa-doc-1' }] } },
        { ok: true, status: 200, data: { id: 'meta-doc-2' } },
        { ok: false, status: 400, error: { message: 'Document rejected' } },
    ] });
    t.after(() => h.database.close());

    const success = await invoke(h.router, 'post', '/messages/send-document', {
        body: {
            recipient: '+218 91 000 0001',
            caption: ' Contract ',
            filename: ' agreement.pdf ',
        },
        file: file('/tmp/doc-1.pdf', 'application/pdf', 'original.pdf'),
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.media_id, 'meta-doc-1');
    assert.deepEqual(JSON.parse(h.requests[1].init.body), {
        messaging_product: 'whatsapp',
        to: '218910000001',
        type: 'document',
        document: { id: 'meta-doc-1', caption: 'Contract', filename: 'agreement.pdf' },
    });
    assert.equal(h.billing.calls.commits.length, 1);
    assert.equal(h.emitted.length, 2);
    assert.equal(h.emitted[0].tenant_id, 1);

    const failure = await invoke(h.router, 'post', '/messages/send-document', {
        body: { recipient: '218910000001' },
        file: file('/tmp/doc-2.pdf', 'application/pdf', 'failure.pdf'),
    });
    assert.equal(failure.statusCode, 400);
    assert.equal(failure.body.error, 'Document rejected');
    assert.equal(h.billing.calls.commits.length, 1);
    assert.equal(h.billing.calls.releases.length, 1);
    assert.equal(h.emitted.length, 2, 'failed sends must not emit realtime success events');
    assert.deepEqual(
        h.database.prepare('SELECT status FROM messages ORDER BY id').all(),
        [{ status: 'sent' }, { status: 'failed' }],
    );
    assert.deepEqual(h.cleaned, ['/tmp/doc-1.pdf', '/tmp/doc-2.pdf']);
});

test('tenant image media does not reserve failed uploads and persists remote send failures', async (t) => {
    const h = createHarness({ responses: [
        { ok: false, status: 503, error: { message: 'Upload failed' } },
        { ok: true, status: 200, data: { id: 'meta-image' } },
        { ok: false, status: 502, error: { message: 'Send failed' } },
    ] });
    t.after(() => h.database.close());

    const uploadFailure = await invoke(h.router, 'post', '/messages/send-image', {
        body: { recipient: '218910000001' },
        file: file('/tmp/image-upload.jpg'),
    });
    assert.equal(uploadFailure.statusCode, 503);
    assert.equal(h.billing.calls.reserves.length, 0);

    const sendFailure = await invoke(h.router, 'post', '/messages/send-image', {
        body: { recipient: '218910000001', caption: ' Image ' },
        file: file('/tmp/image-send.jpg'),
    });
    assert.equal(sendFailure.statusCode, 502);
    assert.equal(h.billing.calls.reserves.length, 1);
    assert.equal(h.billing.calls.releases.length, 1);
    const row = h.database.prepare('SELECT message_type, content, status, error_message FROM messages').get();
    assert.deepEqual(row, {
        message_type: 'image', content: 'Image', status: 'failed', error_message: 'Send failed',
    });
});

test('tenant media download streams only trusted Meta URLs and maps size limits', async (t) => {
    const h = createHarness({ responses: [
        { ok: true, status: 200, data: { url: 'https://scontent.test.fbcdn.net/media/1', mime_type: 'image/jpeg' } },
        { ok: true, status: 200, binary: true },
        { ok: true, status: 200, data: { url: 'https://attacker.test/media/2' } },
    ] });
    t.after(() => h.database.close());

    const success = await invoke(h.router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'media:1' },
    });
    assert.equal(success.statusCode, 200);
    assert.deepEqual(success.body, { streamed: true, contentType: 'image/jpeg' });
    assert.match(h.requests[0].url, /\/media%3A1$/);
    assert.equal(h.requests[1].init.headers.Authorization, 'Bearer token-1');

    const unsafe = await invoke(h.router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'media-2' },
    });
    assert.equal(unsafe.statusCode, 502);
    assert.equal(h.requests.length, 3);

    const oversized = createHarness({
        responses: [
            { ok: true, status: 200, data: { url: 'https://lookaside.fbsbx.com/media/large' } },
            { ok: true, status: 200, binary: true },
        ],
        streamMedia: async () => { throw new MediaTooLargeError(1024); },
    });
    t.after(() => oversized.database.close());
    const tooLarge = await invoke(oversized.router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'large' },
    });
    assert.equal(tooLarge.statusCode, 413);
});
