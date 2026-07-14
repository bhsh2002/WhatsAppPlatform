import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createApiV1MessagingRouter } from '../routes/api/v1Messaging.js';

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
        CREATE TABLE templates (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, name TEXT, language TEXT,
            category TEXT, header_type TEXT, header_content TEXT, body TEXT,
            footer TEXT, buttons TEXT, variables TEXT, status TEXT
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, direction TEXT,
            sender TEXT, recipient TEXT, message_type TEXT, content TEXT, status TEXT,
            wamid TEXT, error_message TEXT, media_url TEXT, media_id TEXT,
            media_mime_type TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, tenant_name TEXT,
            event_type TEXT, description TEXT, status TEXT
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'phone/A', 'Active'),
            (2, 'No Credentials', NULL, 'Active'),
            (3, 'Suspended', 'phone-C', 'Suspended');
        INSERT INTO contacts VALUES
            (1, '218910000001', '2026-07-14T12:00:00.000Z'),
            (1, '218910000009', '2026-07-12T12:00:00.000Z');
        INSERT INTO templates VALUES (
            1, 1, 'order_update', 'en', 'utility', 'none', NULL,
            'Order {{1}} remains {{1}} and arrives {{2}}', NULL, NULL, NULL, 'approved'
        );
        INSERT INTO templates VALUES (
            2, 1, 'draft_template', 'en', 'utility', 'none', NULL,
            'Draft {{1}}', NULL, NULL, NULL, 'pending'
        );
    `);
    return database;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: {
            WHATSAPP_TEXT: 'whatsapp.text',
            WHATSAPP_TEMPLATE: 'whatsapp.template',
            WHATSAPP_MEDIA: 'whatsapp.media',
            WHATSAPP_INTERACTIVE: 'whatsapp.interactive',
        },
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
    const req = { tenantId: 1, body: {}, params: {}, query: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        headersSent: false,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; this.headersSent = true; resolve(this); return this; },
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

function createHarness({ responses = [], billing: billingOverride } = {}) {
    const database = createDatabase();
    const billing = billingOverride || createBilling();
    const requests = [];
    const callbacks = [];
    const cleaned = [];
    const forms = [];
    const errors = [];
    const router = createApiV1MessagingRouter({
        database,
        credentialResolver: tenantId => {
            const tenant = database.prepare(
                'SELECT id, name, phone_number_id, status FROM tenants WHERE id = ?',
            ).get(tenantId);
            return tenant ? {
                tenant,
                phoneNumberId: tenant.phone_number_id,
                accessToken: tenant.id === 2 ? null : `token-${tenant.id}`,
                suspended: tenant.status === 'Suspended',
            } : null;
        },
        billing,
        fetchImpl: async (url, init = {}) => {
            requests.push({ url, init });
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response;
        },
        parseMetaResponse: async response => response,
        callbackSender: async (...args) => { callbacks.push(args); },
        documentUploadMiddleware: (_req, _res, next) => next(),
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
        logger: { error: (...args) => errors.push(args) },
        now: () => NOW,
        apiBase: 'https://graph.test/v25.0',
    });
    return {
        database,
        billing,
        requests,
        callbacks,
        cleaned,
        forms,
        errors,
        router,
    };
}

const file = (path, mimetype = 'application/pdf', originalname = 'upload.pdf') => ({
    path,
    mimetype,
    originalname,
});

test('API v1 messaging rejects invalid contexts, inputs and closed windows before side effects', async (t) => {
    const h = createHarness();
    t.after(() => h.database.close());

    const invalidTenant = await invoke(h.router, 'post', '/messages/send', {
        tenantId: 0,
        body: { recipient: '218910000001', message: 'Hello' },
    });
    assert.equal(invalidTenant.statusCode, 401);

    const missingCredentials = await invoke(h.router, 'post', '/messages/send', {
        tenantId: 2,
        body: { recipient: '218910000001', message: 'Hello' },
    });
    assert.equal(missingCredentials.statusCode, 400);

    const suspended = await invoke(h.router, 'post', '/messages/send', {
        tenantId: 3,
        body: { recipient: '218910000001', message: 'Hello' },
    });
    assert.equal(suspended.statusCode, 403);

    const invalidRecipient = await invoke(h.router, 'post', '/messages/send', {
        body: { recipient: 'not-a-phone', message: 'Hello' },
    });
    assert.equal(invalidRecipient.statusCode, 400);

    const closedText = await invoke(h.router, 'post', '/messages/send', {
        body: { recipient: '218910000009', message: 'Hello' },
    });
    assert.equal(closedText.statusCode, 400);
    assert.equal(closedText.body.code, 'OUTSIDE_WINDOW');

    const unsafeMedia = await invoke(h.router, 'post', '/messages/send-media', {
        body: { recipient: '218910000001', type: 'image', media_url: 'http://127.0.0.1/a.jpg' },
    });
    assert.equal(unsafeMedia.statusCode, 400);

    const closedInteractive = await invoke(h.router, 'post', '/messages/send-interactive', {
        body: {
            recipient: '218910000009',
            interactive_type: 'button',
            body_text: 'Choose',
            buttons: [{ title: 'One' }],
        },
    });
    assert.equal(closedInteractive.statusCode, 400);
    assert.equal(closedInteractive.body.code, 'OUTSIDE_WINDOW');

    const wrongDocument = await invoke(h.router, 'post', '/messages/send-document', {
        body: { recipient: '218910000001' },
        file: file('/tmp/not-a-document.jpg', 'image/jpeg', 'photo.jpg'),
    });
    assert.equal(wrongDocument.statusCode, 400);
    assert.equal(wrongDocument.body.code, 'MEDIA_TYPE_MISMATCH');
    assert.deepEqual(h.cleaned, ['/tmp/not-a-document.jpg']);
    assert.equal(h.requests.length, 0);
    assert.equal(h.billing.calls.reserves.length, 0);
});

test('API v1 text and approved templates normalize payloads, enforce variables and persist outcomes', async (t) => {
    const h = createHarness({ responses: [
        { ok: true, status: 200, data: { messages: [{ id: 'wa-text' }] } },
        { ok: true, status: 200, data: { messages: [{ id: 'wa-template' }] } },
        { ok: false, status: 429, error: { message: 'Rate limited' } },
    ] });
    t.after(() => h.database.close());

    const textResult = await invoke(h.router, 'post', '/messages/send', {
        body: { recipient: '+218 91 000 0001', message: '  Hello API  ' },
    });
    assert.equal(textResult.statusCode, 200);
    assert.deepEqual(textResult.body, {
        success: true,
        message_id: 'wa-text',
        recipient: '218910000001',
    });
    assert.match(h.requests[0].url, /\/phone%2FA\/messages$/);
    assert.deepEqual(JSON.parse(h.requests[0].init.body), {
        messaging_product: 'whatsapp',
        to: '218910000001',
        type: 'text',
        text: { body: 'Hello API' },
    });

    const templateResult = await invoke(h.router, 'post', '/messages/send', {
        body: {
            recipient: '218910000009',
            type: 'template',
            template_name: 'order_update',
            template_params: ['A-1', 'tomorrow'],
        },
    });
    assert.equal(templateResult.statusCode, 200, 'templates must be allowed outside the service window');
    const templatePayload = JSON.parse(h.requests[1].init.body);
    assert.equal(templatePayload.template.language.code, 'en');
    assert.equal(templatePayload.template.components[0].parameters.length, 2);

    const mismatch = await invoke(h.router, 'post', '/messages/send', {
        body: {
            recipient: '218910000001',
            template_name: 'order_update',
            template_params: ['only-one'],
        },
    });
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.body.code, 'TEMPLATE_PARAM_MISMATCH');
    assert.equal(mismatch.body.expected, 2, 'repeated placeholders count by highest index');

    const failedText = await invoke(h.router, 'post', '/messages/send', {
        body: { recipient: '218910000001', message: 'Retry later' },
    });
    assert.equal(failedText.statusCode, 429);
    assert.equal(failedText.body.error, 'Rate limited');

    assert.equal(h.requests.length, 3);
    assert.equal(h.billing.calls.commits.length, 2);
    assert.equal(h.billing.calls.releases.length, 1);
    assert.equal(h.callbacks.length, 2, 'callbacks only announce successful sends');
    assert.deepEqual(
        h.database.prepare('SELECT message_type, status FROM messages ORDER BY id').all(),
        [
            { message_type: 'text', status: 'sent' },
            { message_type: 'template', status: 'sent' },
            { message_type: 'text', status: 'failed' },
        ],
    );
});

test('API v1 URL media validates public HTTPS input and settles successful and failed sends once', async (t) => {
    const h = createHarness({ responses: [
        { ok: true, status: 200, data: { messages: [{ id: 'wa-image' }] } },
        { ok: false, status: 400, error: { message: 'Document rejected' } },
    ] });
    t.after(() => h.database.close());

    const image = await invoke(h.router, 'post', '/messages/send-media', {
        body: {
            recipient: '218910000001',
            type: 'image',
            media_url: 'https://cdn.example.com/photo.jpg',
            caption: '  Product photo  ',
        },
    });
    assert.equal(image.statusCode, 200);
    assert.deepEqual(JSON.parse(h.requests[0].init.body).image, {
        link: 'https://cdn.example.com/photo.jpg',
        caption: 'Product photo',
    });

    const document = await invoke(h.router, 'post', '/messages/send-media', {
        body: {
            recipient: '218910000001',
            type: 'document',
            media_url: 'https://cdn.example.com/files/terms.pdf',
            filename: ' terms.pdf ',
        },
    });
    assert.equal(document.statusCode, 400);
    assert.equal(document.body.error, 'Document rejected');
    assert.equal(JSON.parse(h.requests[1].init.body).document.filename, 'terms.pdf');

    assert.equal(h.billing.calls.commits.length, 1);
    assert.equal(h.billing.calls.releases.length, 1);
    assert.deepEqual(
        h.database.prepare('SELECT status, media_url FROM messages ORDER BY id').all(),
        [
            { status: 'sent', media_url: 'https://cdn.example.com/photo.jpg' },
            { status: 'failed', media_url: 'https://cdn.example.com/files/terms.pdf' },
        ],
    );
});

test('API v1 document upload cleans files and only bills the downstream message send', async (t) => {
    const h = createHarness({ responses: [
        { ok: true, status: 200, data: { id: 'media-1' } },
        { ok: true, status: 200, data: { messages: [{ id: 'wa-doc-1' }] } },
        { ok: false, status: 503, error: { message: 'Upload unavailable' } },
        { ok: true, status: 200, data: { id: 'media-2' } },
        { ok: false, status: 400, error: { message: 'Send rejected' } },
    ] });
    t.after(() => h.database.close());

    const success = await invoke(h.router, 'post', '/messages/send-document', {
        body: {
            recipient: '+218 91 000 0001',
            caption: ' Contract ',
            filename: ' agreement.pdf ',
        },
        file: file('/tmp/doc-success.pdf'),
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.media_id, 'media-1');
    assert.match(h.requests[0].url, /\/phone%2FA\/media$/);
    assert.equal(h.forms[0].entries[2][2].filename, 'agreement.pdf');
    assert.deepEqual(JSON.parse(h.requests[1].init.body).document, {
        id: 'media-1',
        filename: 'agreement.pdf',
        caption: 'Contract',
    });

    const uploadFailure = await invoke(h.router, 'post', '/messages/send-document', {
        body: { recipient: '218910000001' },
        file: file('/tmp/doc-upload-failure.pdf'),
    });
    assert.equal(uploadFailure.statusCode, 503);
    assert.equal(uploadFailure.body.error, 'Upload unavailable');

    const sendFailure = await invoke(h.router, 'post', '/messages/send-document', {
        body: { recipient: '218910000001' },
        file: file('/tmp/doc-send-failure.pdf'),
    });
    assert.equal(sendFailure.statusCode, 400);
    assert.equal(sendFailure.body.error, 'Send rejected');

    assert.deepEqual(h.cleaned, [
        '/tmp/doc-success.pdf',
        '/tmp/doc-upload-failure.pdf',
        '/tmp/doc-send-failure.pdf',
    ]);
    assert.equal(h.billing.calls.reserves.length, 2, 'failed uploads are not billable sends');
    assert.equal(h.billing.calls.commits.length, 1);
    assert.equal(h.billing.calls.releases.length, 1);
    assert.deepEqual(
        h.database.prepare('SELECT status, media_id FROM messages ORDER BY id').all(),
        [
            { status: 'sent', media_id: 'media-1' },
            { status: 'failed', media_id: 'media-2' },
        ],
    );
});

test('API v1 interactive messages use shared limits, window checks and normalized payloads', async (t) => {
    const h = createHarness({ responses: [
        { ok: true, status: 200, data: { messages: [{ id: 'wa-button' }] } },
        { ok: false, status: 502, error: { message: 'Interactive unavailable' } },
    ] });
    t.after(() => h.database.close());

    const tooManyButtons = await invoke(h.router, 'post', '/messages/send-interactive', {
        body: {
            recipient: '218910000001',
            interactive_type: 'button',
            body_text: 'Choose',
            buttons: ['One', 'Two', 'Three', 'Four'].map(title => ({ title })),
        },
    });
    assert.equal(tooManyButtons.statusCode, 400);

    const button = await invoke(h.router, 'post', '/messages/send-interactive', {
        body: {
            recipient: '+218 91 000 0001',
            interactive_type: 'button',
            body_text: ' Choose one ',
            buttons: [{ id: 'yes', title: 'Yes' }],
        },
    });
    assert.equal(button.statusCode, 200);
    assert.deepEqual(JSON.parse(h.requests[0].init.body).interactive.action.buttons, [{
        type: 'reply',
        reply: { id: 'yes', title: 'Yes' },
    }]);

    const list = await invoke(h.router, 'post', '/messages/send-interactive', {
        body: {
            recipient: '218910000001',
            interactive_type: 'list',
            body_text: 'Pick',
            list_button_text: 'Options',
            sections: [{ title: 'Main', rows: [{ id: 'one', title: 'One' }] }],
        },
    });
    assert.equal(list.statusCode, 502);
    assert.equal(list.body.error, 'Interactive unavailable');
    assert.equal(JSON.parse(h.requests[1].init.body).interactive.action.button, 'Options');

    assert.equal(h.requests.length, 2);
    assert.equal(h.billing.calls.commits.length, 1);
    assert.equal(h.billing.calls.releases.length, 1);
    assert.deepEqual(
        h.database.prepare('SELECT message_type, status FROM messages ORDER BY id').all(),
        [
            { message_type: 'interactive', status: 'sent' },
            { message_type: 'interactive', status: 'failed' },
        ],
    );
});

test('API v1 never releases a remotely successful send when local billing commit fails', async (t) => {
    const billing = createBilling();
    billing.commit = (reservation, options) => {
        billing.calls.commits.push({ reservation, options });
        throw new Error('commit unavailable');
    };
    const h = createHarness({
        billing,
        responses: [{ ok: true, status: 200, data: { messages: [{ id: 'wa-settled' }] } }],
    });
    t.after(() => h.database.close());

    const result = await invoke(h.router, 'post', '/messages/send', {
        body: { recipient: '218910000001', message: 'Delivered remotely' },
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.warnings, ['billing_commit_failed']);
    assert.equal(h.billing.calls.commits.length, 1);
    assert.equal(h.billing.calls.releases.length, 0);
    assert.equal(h.requests.length, 1);
});
