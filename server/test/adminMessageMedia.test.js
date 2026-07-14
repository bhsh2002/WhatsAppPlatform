import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createMessageMediaRouter } from '../routes/messageMedia.js';
import { MediaTooLargeError } from '../services/mediaStreaming.js';

const NOW = Date.parse('2026-07-14T13:00:00.000Z');

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            phone TEXT,
            last_customer_message_at DATETIME,
            UNIQUE (tenant_id, phone)
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            direction TEXT,
            sender TEXT,
            recipient TEXT,
            message_type TEXT,
            content TEXT,
            status TEXT,
            wamid TEXT,
            error_message TEXT,
            media_id TEXT,
            media_url TEXT,
            media_mime_type TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            tenant_name TEXT,
            event_type TEXT,
            description TEXT,
            status TEXT
        );
        INSERT INTO contacts VALUES
            (1, 1, '218910000001', '2026-07-14T12:00:00.000Z'),
            (2, 1, '218910000009', '2026-07-12T12:00:00.000Z');
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

const credentialsFor = ({ tenantId, phoneNumberIdOverride, accessTokenOverride }) => {
    if (tenantId === 1) {
        return {
            tenant: { id: 1, name: 'Tenant A' },
            phoneNumberId: 'phone/A',
            accessToken: 'token-a',
            isSuspended: false,
        };
    }
    if (tenantId === 2) {
        return {
            tenant: { id: 2, name: 'Tenant B' },
            phoneNumberId: null,
            accessToken: null,
            isSuspended: false,
        };
    }
    if (tenantId === 3) {
        return {
            tenant: { id: 3, name: 'Suspended' },
            phoneNumberId: null,
            accessToken: null,
            isSuspended: true,
        };
    }
    if (tenantId) return { tenant: null, phoneNumberId: null, accessToken: null };
    return {
        tenant: null,
        phoneNumberId: phoneNumberIdOverride || 'default-phone',
        accessToken: accessTokenOverride || 'default-token',
        isSuspended: false,
    };
};

const findRouteHandlers = (router, method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = { body: {}, headers: {}, params: {}, query: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        headersSent: false,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; this.headersSent = true; resolve(this); return this; },
        destroy(error) { this.destroyedWith = error; resolve(this); },
    };
    const handlers = findRouteHandlers(router, method, routePath);
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

function createHarness({ database = createDatabase(), responses = [], streamMedia } = {}) {
    const requests = [];
    const cleaned = [];
    const forms = [];
    const billing = createBilling();
    const router = createMessageMediaRouter({
        database,
        credentialResolver: credentialsFor,
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
        uploadMiddleware: (_req, _res, next) => next(),
        formDataFactory: () => {
            const form = {
                entries: [],
                append(...args) { this.entries.push(args); },
                getHeaders: () => ({ 'content-type': 'multipart/form-data; boundary=test' }),
                getBuffer: () => Buffer.from('multipart-body'),
            };
            forms.push(form);
            return form;
        },
        readFile: filePath => Buffer.from(`file:${filePath}`),
        cleanup: filePath => { if (filePath) cleaned.push(filePath); },
        billing,
        logger: { error: () => undefined },
        now: () => NOW,
        apiBase: 'https://graph.test/v25.0',
    });
    return { database, router, requests, cleaned, forms, billing };
}

test('admin media rejects malformed input, invalid tenants and closed windows before side effects', async (t) => {
    const harness = createHarness();
    t.after(() => harness.database.close());

    const invalidId = await invokeRoute(harness.router, 'get', '/media/:mediaId', {
        params: { mediaId: 'bad/id' }, query: { tenant_id: 1 },
    });
    assert.equal(invalidId.statusCode, 400);

    const missingTenant = await invokeRoute(harness.router, 'get', '/media/:mediaId', {
        params: { mediaId: 'media-1' }, query: { tenant_id: 999 },
    });
    assert.equal(missingTenant.statusCode, 404);

    const cases = [
        { recipient: 'bad', type: 'image', mediaUrl: 'https://cdn.example.com/a.jpg' },
        { recipient: '218910000001', type: 'sticker', mediaUrl: 'https://cdn.example.com/a.webp' },
        { recipient: '218910000001', type: 'image', mediaUrl: 'http://cdn.example.com/a.jpg' },
        { recipient: '218910000001', type: 'image', mediaUrl: 'https://127.0.0.1/a.jpg' },
        { recipient: '218910000001', type: 'audio', mediaUrl: 'https://cdn.example.com/a.mp3', caption: 'No caption' },
        { tenant_id: '1junk', recipient: '218910000001', type: 'image', mediaUrl: 'https://cdn.example.com/a.jpg' },
    ];
    for (const body of cases) {
        const result = await invokeRoute(harness.router, 'post', '/send-media', { body });
        assert.equal(result.statusCode, 400);
    }

    for (const [tenant_id, status] of [[999, 404], [3, 403], [2, 400]]) {
        const result = await invokeRoute(harness.router, 'post', '/send-media', {
            body: {
                tenant_id,
                recipient: '218910000001',
                type: 'image',
                mediaUrl: 'https://cdn.example.com/a.jpg',
            },
        });
        assert.equal(result.statusCode, status);
    }

    const closed = await invokeRoute(harness.router, 'post', '/send-media', {
        body: {
            tenant_id: 1,
            recipient: '218910000009',
            type: 'image',
            mediaUrl: 'https://cdn.example.com/a.jpg',
        },
    });
    assert.equal(closed.statusCode, 400);
    assert.equal(closed.body.code, 'OUTSIDE_WINDOW');

    const mismatchedFile = await invokeRoute(harness.router, 'post', '/send-media-file', {
        body: { tenant_id: 1, recipient: '218910000001', type: 'video' },
        file: { path: '/tmp/mismatch.jpg', originalname: 'image.jpg', mimetype: 'image/jpeg' },
    });
    assert.equal(mismatchedFile.statusCode, 400);
    assert.equal(mismatchedFile.body.code, 'MEDIA_TYPE_MISMATCH');
    assert.deepEqual(harness.cleaned, ['/tmp/mismatch.jpg']);
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.billing.calls.reserves.length, 0);
});

test('admin media discovery and download encode ids and reject untrusted Meta URLs', async (t) => {
    const responses = [
        { ok: true, status: 200, data: { url: 'https://lookaside.fbsbx.com/media/a', mime_type: 'image/jpeg' } },
        { ok: true, status: 200, data: { url: 'https://attacker.test/media/a', mime_type: 'image/jpeg' } },
        { ok: true, status: 200, data: { url: 'https://scontent.example.fbcdn.net/media/a', mime_type: 'video/mp4' } },
        { ok: true, status: 200, binary: true },
    ];
    const harness = createHarness({ responses });
    t.after(() => harness.database.close());

    const discovery = await invokeRoute(harness.router, 'get', '/media/:mediaId', {
        params: { mediaId: 'media:1' }, query: { tenant_id: 1 },
    });
    assert.equal(discovery.statusCode, 200);
    assert.equal(discovery.body.mime_type, 'image/jpeg');
    assert.match(harness.requests[0].url, /\/media%3A1$/);
    assert.equal(harness.requests[0].init.headers.Authorization, 'Bearer token-a');

    const unsafe = await invokeRoute(harness.router, 'get', '/media/:mediaId', {
        params: { mediaId: 'media-2' }, query: { tenant_id: 1 },
    });
    assert.equal(unsafe.statusCode, 502);
    assert.match(unsafe.body.error, /trusted media URL/);

    const download = await invokeRoute(harness.router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'media-3' }, query: { tenant_id: 1 },
    });
    assert.equal(download.statusCode, 200);
    assert.deepEqual(download.body, { streamed: true, contentType: 'video/mp4' });
    assert.equal(harness.requests[3].url, 'https://scontent.example.fbcdn.net/media/a');
    assert.equal(harness.requests[3].init.headers.Authorization, 'Bearer token-a');
});

test('admin media download maps oversized streams to 413', async (t) => {
    const harness = createHarness({
        responses: [
            { ok: true, status: 200, data: { url: 'https://lookaside.fbsbx.com/media/large' } },
            { ok: true, status: 200, binary: true },
        ],
        streamMedia: async () => { throw new MediaTooLargeError(1024); },
    });
    t.after(() => harness.database.close());
    const result = await invokeRoute(harness.router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'large' }, query: { tenant_id: 1 },
    });
    assert.equal(result.statusCode, 413);
    assert.match(result.body.error, /download limit/);
});

test('admin upload-to-meta cleans files on success and remote failure', async (t) => {
    const harness = createHarness({
        responses: [
            { ok: true, status: 200, data: { id: 'media-uploaded' } },
            { ok: false, status: 503, error: { message: 'Meta unavailable', code: 2 } },
        ],
    });
    t.after(() => harness.database.close());

    const success = await invokeRoute(harness.router, 'post', '/media/upload-to-meta', {
        body: { tenant_id: 1 },
        file: { path: '/tmp/header.jpg', originalname: ' header.jpg ', mimetype: 'image/jpeg' },
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.id, 'media-uploaded');
    assert.match(harness.requests[0].url, /\/phone%2FA\/media$/);
    assert.equal(harness.forms[0].entries[2][2].filename, 'header.jpg');

    const failure = await invokeRoute(harness.router, 'post', '/media/upload-to-meta', {
        body: { tenant_id: 1 },
        file: { path: '/tmp/failing.jpg', originalname: 'failing.jpg', mimetype: 'image/jpeg' },
    });
    assert.equal(failure.statusCode, 503);
    assert.equal(failure.body.error, 'Meta unavailable');
    assert.deepEqual(harness.cleaned, ['/tmp/header.jpg', '/tmp/failing.jpg']);
});

test('admin media maps incomplete Meta responses and transport failures without side effects', async (t) => {
    const harness = createHarness({
        responses: [
            { ok: false, status: 503, error: { message: 'Lookup unavailable' } },
            { ok: true, status: 200, data: {} },
            { ok: true, status: 200, data: { url: 'https://lookaside.fbsbx.com/media/missing' } },
            { ok: false, status: 404, binary: true },
            { ok: true, status: 200, data: {} },
            { ok: true, status: 200, data: {} },
            new Error('transport failed'),
        ],
    });
    t.after(() => harness.database.close());

    const lookupFailure = await invokeRoute(harness.router, 'get', '/media/:mediaId', {
        params: { mediaId: 'lookup' }, query: { tenant_id: 1 },
    });
    assert.equal(lookupFailure.statusCode, 503);
    assert.equal(lookupFailure.body.error, 'Lookup unavailable');

    const missingUrl = await invokeRoute(harness.router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'missing-url' }, query: { tenant_id: 1 },
    });
    assert.equal(missingUrl.statusCode, 502);

    const downloadFailure = await invokeRoute(harness.router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'missing-file' }, query: { tenant_id: 1 },
    });
    assert.equal(downloadFailure.statusCode, 404);
    assert.equal(downloadFailure.body.error, 'Failed to download media');

    const noFile = await invokeRoute(harness.router, 'post', '/media/upload-to-meta', {
        body: { tenant_id: 1 },
    });
    assert.equal(noFile.statusCode, 400);

    const noTenant = await invokeRoute(harness.router, 'post', '/media/upload-to-meta', {
        body: {},
        file: { path: '/tmp/no-tenant.jpg', originalname: 'image.jpg', mimetype: 'image/jpeg' },
    });
    assert.equal(noTenant.statusCode, 400);

    const missingUploadId = await invokeRoute(harness.router, 'post', '/media/upload-to-meta', {
        body: { tenant_id: 1 },
        file: { path: '/tmp/no-id.jpg', originalname: 'image.jpg', mimetype: 'image/jpeg' },
    });
    assert.equal(missingUploadId.statusCode, 502);

    const missingSendUploadId = await invokeRoute(harness.router, 'post', '/send-media-file', {
        body: { tenant_id: 1, recipient: '218910000001' },
        file: { path: '/tmp/no-send-id.jpg', originalname: 'image.jpg', mimetype: 'image/jpeg' },
    });
    assert.equal(missingSendUploadId.statusCode, 502);
    assert.equal(harness.billing.calls.reserves.length, 0);

    const missingContact = await invokeRoute(harness.router, 'post', '/send-media-file', {
        body: { tenant_id: 1, recipient: '218910000088' },
        file: { path: '/tmp/no-window.jpg', originalname: 'image.jpg', mimetype: 'image/jpeg' },
    });
    assert.equal(missingContact.statusCode, 400);
    assert.equal(missingContact.body.code, 'OUTSIDE_WINDOW');

    const transportFailure = await invokeRoute(harness.router, 'post', '/send-media', {
        body: {
            tenant_id: 1,
            recipient: '218910000001',
            type: 'image',
            mediaUrl: 'https://cdn.example.com/transport.jpg',
        },
    });
    assert.equal(transportFailure.statusCode, 500);
    assert.equal(harness.billing.calls.reserves.length, 1);
    assert.equal(harness.billing.calls.releases.length, 1);
    assert.deepEqual(harness.cleaned, [
        '/tmp/no-tenant.jpg', '/tmp/no-id.jpg', '/tmp/no-send-id.jpg', '/tmp/no-window.jpg',
    ]);
});

test('admin URL media sends normalize payloads, persist outcomes and settle billing once', async (t) => {
    const harness = createHarness({
        responses: [
            { ok: true, status: 200, data: { messages: [{ id: 'wa-document' }] } },
            { ok: false, status: 500, error: { message: 'Image rejected', code: 131009 } },
        ],
    });
    t.after(() => harness.database.close());

    const success = await invokeRoute(harness.router, 'post', '/send-media', {
        body: {
            tenant_id: 1,
            recipient: '+218 91 000 0001',
            type: 'document',
            mediaUrl: ' https://cdn.example.com/report.pdf ',
            caption: ' Quarterly report ',
            filename: ' report.pdf ',
        },
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.message_id, 'wa-document');
    assert.match(harness.requests[0].url, /\/phone%2FA\/messages$/);
    assert.deepEqual(JSON.parse(harness.requests[0].init.body), {
        messaging_product: 'whatsapp',
        to: '218910000001',
        type: 'document',
        document: {
            link: 'https://cdn.example.com/report.pdf',
            caption: 'Quarterly report',
            filename: 'report.pdf',
        },
    });
    assert.equal(harness.billing.calls.commits.length, 1);
    assert.equal(harness.billing.calls.releases.length, 0);
    assert.equal(
        harness.database.prepare("SELECT status FROM messages WHERE wamid = 'wa-document'").get().status,
        'sent',
    );

    const failure = await invokeRoute(harness.router, 'post', '/send-media', {
        body: {
            tenant_id: 1,
            recipient: '218910000001',
            type: 'image',
            mediaUrl: 'https://cdn.example.com/image.jpg',
        },
    });
    assert.equal(failure.statusCode, 500);
    assert.equal(failure.body.error, 'Image rejected');
    assert.equal(harness.billing.calls.commits.length, 1);
    assert.equal(harness.billing.calls.releases.length, 1);
    const failedRow = harness.database.prepare("SELECT status, error_message FROM messages WHERE message_type = 'image'").get();
    assert.deepEqual(failedRow, { status: 'failed', error_message: 'Image rejected' });
    assert.deepEqual(
        harness.database.prepare('SELECT status FROM activity_logs ORDER BY id').all(),
        [{ status: 'success' }, { status: 'error' }],
    );
});

test('admin file media sends clean uploads and distinguish upload from send failures', async (t) => {
    const harness = createHarness({
        responses: [
            { ok: true, status: 200, data: { id: 'meta-image-1' } },
            { ok: true, status: 200, data: { messages: [{ id: 'wa-image-1' }] } },
            { ok: false, status: 503, error: { message: 'Upload unavailable' } },
            { ok: true, status: 200, data: { id: 'meta-image-2' } },
            { ok: false, status: 400, error: { message: 'Send rejected' } },
        ],
    });
    t.after(() => harness.database.close());
    const imageFile = path => ({ path, originalname: 'photo.jpg', mimetype: 'image/jpeg' });

    const success = await invokeRoute(harness.router, 'post', '/send-media-file', {
        body: { tenant_id: 1, recipient: '218910000001', type: 'image', caption: ' Photo ' },
        file: imageFile('/tmp/photo-1.jpg'),
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.media_id, 'meta-image-1');
    assert.equal(JSON.parse(harness.requests[1].init.body).image.id, 'meta-image-1');
    assert.equal(harness.billing.calls.commits.length, 1);

    const uploadFailure = await invokeRoute(harness.router, 'post', '/send-media-file', {
        body: { tenant_id: 1, recipient: '218910000001', type: 'image' },
        file: imageFile('/tmp/photo-2.jpg'),
    });
    assert.equal(uploadFailure.statusCode, 503);
    assert.equal(uploadFailure.body.error, 'Upload unavailable');
    assert.equal(harness.billing.calls.reserves.length, 1, 'failed uploads must not reserve billing');

    const sendFailure = await invokeRoute(harness.router, 'post', '/send-media-file', {
        body: { tenant_id: 1, recipient: '218910000001', type: 'image' },
        file: imageFile('/tmp/photo-3.jpg'),
    });
    assert.equal(sendFailure.statusCode, 400);
    assert.equal(sendFailure.body.error, 'Send rejected');
    assert.equal(harness.billing.calls.reserves.length, 2);
    assert.equal(harness.billing.calls.releases.length, 1);
    assert.equal(
        harness.database.prepare("SELECT status FROM messages WHERE media_id = 'meta-image-2'").get().status,
        'failed',
    );
    assert.deepEqual(harness.cleaned, [
        '/tmp/photo-1.jpg', '/tmp/photo-2.jpg', '/tmp/photo-3.jpg',
    ]);
});

test('admin media preserves tenantless overrides and reports local persistence warnings', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const databaseWithBrokenWrites = {
        prepare(sql) {
            if (/INSERT INTO messages/.test(sql)) throw new Error('local store unavailable');
            return database.prepare(sql);
        },
    };
    const harness = createHarness({
        database: databaseWithBrokenWrites,
        responses: [{ ok: true, status: 200, data: { messages: [{ id: 'wa-global-media' }] } }],
    });
    const result = await invokeRoute(harness.router, 'post', '/send-media', {
        body: {
            recipient: '218910000099',
            type: 'image',
            mediaUrl: 'https://cdn.example.com/global.jpg',
            phone_number_id: 'global/phone',
            access_token: 'global-token',
        },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.warnings, ['local_message_store_failed']);
    assert.match(harness.requests[0].url, /\/global%2Fphone\/messages$/);
    assert.equal(harness.billing.calls.reserves[0].tenantId, null);
    assert.equal(harness.billing.calls.commits.length, 0);
    assert.equal(harness.billing.calls.releases.length, 0);
});
