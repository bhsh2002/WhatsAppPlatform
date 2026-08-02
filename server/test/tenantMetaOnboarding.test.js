import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantMetaOnboardingRouter } from '../routes/tenantMetaOnboarding.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT,
            waba_id TEXT,
            phone_number_id TEXT,
            business_id TEXT,
            dataset_id TEXT,
            access_token TEXT,
            access_token_encrypted TEXT,
            facebook_user_access_token_encrypted TEXT,
            facebook_user_token_scopes TEXT,
            facebook_user_token_updated_at DATETIME,
            facebook_user_token_status TEXT,
            facebook_user_token_expires_at DATETIME,
            facebook_user_token_checked_at DATETIME,
            facebook_user_token_app_id TEXT,
            facebook_user_id TEXT,
            facebook_user_name TEXT,
            facebook_user_email TEXT,
            facebook_user_picture_url TEXT,
            facebook_user_profile_updated_at DATETIME,
            updated_at DATETIME
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            tenant_name TEXT,
            event_type TEXT,
            description TEXT,
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE tenant_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            platform TEXT DEFAULT 'facebook',
            page_id TEXT NOT NULL,
            page_name TEXT,
            page_access_token_encrypted TEXT,
            page_category TEXT,
            page_picture_url TEXT,
            is_active INTEGER DEFAULT 1,
            subscribed_fields TEXT,
            webhook_subscribed INTEGER DEFAULT 0,
            token_status TEXT,
            token_expires_at DATETIME,
            token_checked_at DATETIME,
            token_app_id TEXT,
            token_scopes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, page_id)
        );
        INSERT INTO tenants (id, name) VALUES (1, 'Tenant A'), (2, 'Tenant B');
    `);
    return db;
}

function enableMultipleWhatsAppNumbers(db) {
    db.exec(`
        CREATE TABLE tenant_whatsapp_numbers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            phone_number_id TEXT NOT NULL UNIQUE,
            waba_id TEXT,
            business_id TEXT,
            dataset_id TEXT,
            display_phone_number TEXT,
            verified_name TEXT,
            label TEXT,
            quality_rating TEXT,
            platform_status TEXT,
            access_token_encrypted TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, phone_number_id)
        );
        CREATE UNIQUE INDEX one_tenant_whatsapp_default
            ON tenant_whatsapp_numbers(tenant_id) WHERE is_default = 1;
    `);
}

const config = {
    apiBase: 'https://graph.test/v25.0',
    apiVersion: 'v25.0',
    appId: 'app-id',
    appSecret: 'app-secret',
    redirectUri: 'https://app.test/oauth',
    whatsappConfigId: 'wa-config',
    reviewScopes: ['pages_show_list', 'pages_messaging', 'email'],
    webhookFields: ['messages', 'feed'],
};

function createDependencies(overrides = {}) {
    let randomValue = 0;
    return {
        encryptToken: value => `encrypted:${value}`,
        decryptToken: value => value?.replace(/^encrypted:/, '') || null,
        buildReadiness: async tenantId => ({ tenant_id: tenantId, overall: { status: 'ready' } }),
        listSnapshots: (tenantId, limit) => [{ tenant_id: tenantId, limit }],
        saveSnapshot: (tenantId, readiness) => ({ id: 1, tenant_id: tenantId, status: readiness.overall.status }),
        requestMeta: async () => ({ ok: true, status: 200, data: {} }),
        randomBytes: size => Buffer.alloc(size, ++randomValue),
        config,
        ...overrides,
    };
}

const findRouteHandlers = (router, method, routePath) => {
    const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map((item) => item.handle);
};

const invokeRoute = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = { body: {}, headers: {}, params: {}, query: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve(this);
            return this;
        },
    };
    const handlers = findRouteHandlers(router, method, routePath);
    let index = 0;
    const next = (error) => {
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

async function connectFacebook(router, tenantId = 1) {
    const auth = await invokeRoute(router, 'get', '/facebook/auth-url', {
        user: { tenant_id: tenantId },
    });
    assert.equal(auth.statusCode, 200);
    return invokeRoute(router, 'post', '/facebook/connect', {
        user: { tenant_id: tenantId },
        body: { code: 'oauth-code', state: auth.body.state },
    });
}

test('Facebook OAuth state is tenant-bound and page tokens never return to the browser', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const results = [
        { ok: true, status: 200, data: { access_token: 'short-token' } },
        { ok: true, status: 200, data: { access_token: 'long-token' } },
        {
            ok: true,
            status: 200,
            data: { data: { is_valid: true, scopes: ['pages_show_list', 'email'], app_id: 'app-id' } },
        },
        {
            ok: true,
            status: 200,
            data: { id: 'user-1', name: 'User One', email: 'one@example.test' },
        },
        {
            ok: true,
            status: 200,
            data: { data: [{ id: 'page-1', name: 'Page One', access_token: 'page-token' }] },
        },
    ];
    const router = createTenantMetaOnboardingRouter({
        database: db,
        ...createDependencies({
            requestMeta: async (url, init) => {
                calls.push({ url, init });
                return results.shift();
            },
        }),
    });

    const configResult = await invokeRoute(router, 'get', '/meta/config', {
        user: { tenant_id: 1 },
    });
    assert.equal(configResult.body.facebook_oauth_available, true);
    assert.equal(configResult.body.whatsapp_signup_available, true);
    assert.ok(!Object.hasOwn(configResult.body, 'app_secret'));

    const auth = await invokeRoute(router, 'get', '/facebook/auth-url', {
        user: { tenant_id: 1 },
    });
    assert.equal(auth.body.state.length, 64);
    assert.match(auth.body.url, /client_id=app-id/);
    assert.doesNotMatch(auth.body.url, /app-secret/);
    const wrongTenant = await invokeRoute(router, 'post', '/facebook/connect', {
        user: { tenant_id: 2 },
        body: { code: 'oauth-code', state: auth.body.state },
    });
    assert.equal(wrongTenant.statusCode, 400);
    assert.equal(calls.length, 0);

    const connected = await invokeRoute(router, 'post', '/facebook/connect', {
        user: { tenant_id: 1 },
        body: { code: 'oauth-code', state: auth.body.state },
    });
    assert.equal(connected.statusCode, 200);
    assert.equal(connected.body.pages[0].id, 'page-1');
    assert.ok(!Object.hasOwn(connected.body.pages[0], 'access_token'));
    assert.doesNotMatch(JSON.stringify(connected.body), /page-token|long-token|short-token/);
    assert.deepEqual(connected.body.missing_scopes, ['pages_messaging']);
    assert.equal(
        db.prepare('SELECT facebook_user_access_token_encrypted FROM tenants WHERE id = 1').get()
            .facebook_user_access_token_encrypted,
        'encrypted:long-token'
    );
    assert.equal(db.prepare('SELECT facebook_user_id FROM tenants WHERE id = 2').get().facebook_user_id, null);

    assert.equal(calls[0].url, 'https://graph.test/v25.0/oauth/access_token');
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[0].init.body, /client_secret=app-secret/);
    assert.doesNotMatch(calls[0].url, /app-secret|oauth-code/);
    assert.equal(calls[3].init.headers.Authorization, 'Bearer long-token');
    assert.equal(calls[4].init.headers.Authorization, 'Bearer long-token');
});

test('Facebook diagnostics and Meta review snapshots remain tenant-scoped and bounded', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.exec(`
        UPDATE tenants
        SET facebook_user_access_token_encrypted = 'encrypted:tenant-a',
            facebook_user_token_scopes = '["pages_show_list","email"]',
            facebook_user_id = 'user-a', facebook_user_name = 'User A',
            facebook_user_email = 'a@example.test'
        WHERE id = 1;
        UPDATE tenants
        SET facebook_user_access_token_encrypted = 'encrypted:tenant-b',
            facebook_user_token_scopes = '["pages_messaging"]'
        WHERE id = 2;
        INSERT INTO tenant_pages (
            tenant_id, page_id, page_name, page_access_token_encrypted,
            subscribed_fields, webhook_subscribed
        ) VALUES
            (1, 'page-a', 'Page A', 'encrypted:page-a-token', '["messages"]', 1),
            (2, 'page-b', 'Page B', 'encrypted:page-b-token', '["feed"]', 1);
    `);
    const readinessCalls = [];
    const snapshotCalls = [];
    const router = createTenantMetaOnboardingRouter({
        database: db,
        ...createDependencies({
            buildReadiness: async tenantId => {
                readinessCalls.push(tenantId);
                return { tenant_id: tenantId, overall: { status: 'ready' } };
            },
            listSnapshots: (tenantId, limit) => {
                snapshotCalls.push({ tenantId, limit });
                return [{ tenant_id: tenantId }];
            },
        }),
    });

    const diagnostics = await invokeRoute(router, 'get', '/facebook/diagnostics', {
        user: { tenant_id: 1 },
    });
    assert.equal(diagnostics.statusCode, 200);
    assert.deepEqual(diagnostics.body.pages.map(page => page.page_id), ['page-a']);
    assert.deepEqual(diagnostics.body.pages[0].missing_webhook_fields, ['feed']);
    assert.equal(diagnostics.body.facebook_user_identity.public_profile_ready, true);
    assert.doesNotMatch(JSON.stringify(diagnostics.body), /tenant-a|tenant-b|page-a-token|page-b-token/);

    const readiness = await invokeRoute(router, 'get', '/meta-review/readiness', {
        user: { tenant_id: 1 },
    });
    assert.equal(readiness.body.tenant_id, 1);
    const snapshots = await invokeRoute(router, 'get', '/meta-review/snapshots', {
        user: { tenant_id: 2 },
        query: { limit: '999' },
    });
    assert.deepEqual(snapshots.body.snapshots, [{ tenant_id: 2 }]);
    assert.deepEqual(snapshotCalls, [{ tenantId: 2, limit: 50 }]);
    const saved = await invokeRoute(router, 'post', '/meta-review/snapshot', {
        user: { tenant_id: 1 },
    });
    assert.equal(saved.statusCode, 201);
    assert.equal(saved.body.snapshot.tenant_id, 1);
    assert.deepEqual(readinessCalls, [1, 1]);
});

test('page linking keeps tokens server-side, subscribes by authorization and disconnects by tenant', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    let accountCalls = 0;
    const requestMeta = async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/oauth/access_token')) {
            const values = new URLSearchParams(init.body);
            return values.get('grant_type') === 'fb_exchange_token'
                ? { ok: true, status: 200, data: { access_token: 'long-token' } }
                : { ok: true, status: 200, data: { access_token: 'short-token' } };
        }
        if (url.includes('/debug_token')) {
            return { ok: true, status: 200, data: { data: { is_valid: true, scopes: ['pages_show_list'] } } };
        }
        if (url.includes('/me?fields=')) {
            return { ok: true, status: 200, data: { id: 'user-1', name: 'User One' } };
        }
        if (url.includes('/me/accounts?')) {
            accountCalls += 1;
            return {
                ok: true,
                status: 200,
                data: {
                    data: [{
                        id: 'page/1',
                        name: 'Page One',
                        category: 'Business',
                        access_token: 'page-token',
                    }],
                },
            };
        }
        if (url.endsWith('/page%2F1/subscribed_apps')) {
            return { ok: true, status: 200, data: { success: true } };
        }
        return assert.fail(`Unexpected Meta request: ${url}`);
    };
    const router = createTenantMetaOnboardingRouter({
        database: db,
        ...createDependencies({ requestMeta }),
    });
    const connected = await connectFacebook(router);
    assert.equal(connected.statusCode, 200);

    const linked = await invokeRoute(router, 'post', '/facebook/link-pages', {
        user: { tenant_id: 1 },
        body: { link_state: connected.body.link_state, page_ids: ['page/1', 'missing-page'] },
    });
    assert.equal(linked.statusCode, 200);
    assert.equal(linked.body.linked[0].webhook_subscribed, true);
    assert.deepEqual(linked.body.unavailable_page_ids, ['missing-page']);
    assert.equal(accountCalls, 2);
    const page = db.prepare('SELECT * FROM tenant_pages WHERE tenant_id = 1').get();
    assert.equal(page.page_access_token_encrypted, 'encrypted:page-token');
    assert.equal(page.webhook_subscribed, 1);
    assert.deepEqual(JSON.parse(page.subscribed_fields), ['messages', 'feed']);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM activity_logs WHERE event_type = 'page_linked'").get().count, 1);
    const subscribeCall = calls.find(call => call.url.endsWith('/page%2F1/subscribed_apps') && call.init.method === 'POST');
    assert.equal(subscribeCall.init.headers.Authorization, 'Bearer page-token');
    assert.doesNotMatch(subscribeCall.url + subscribeCall.init.body, /page-token/);

    const otherTenant = await invokeRoute(router, 'delete', '/facebook/disconnect/:linkedPageId', {
        user: { tenant_id: 2 },
        params: { linkedPageId: String(page.id) },
    });
    assert.equal(otherTenant.statusCode, 404);
    const callCountBeforeOwnerDelete = calls.length;
    const disconnected = await invokeRoute(router, 'delete', '/facebook/disconnect/:linkedPageId', {
        user: { tenant_id: 1 },
        params: { linkedPageId: String(page.id) },
    });
    assert.equal(disconnected.statusCode, 200);
    assert.equal(calls.length, callCountBeforeOwnerDelete + 1);
    assert.equal(calls.at(-1).init.method, 'DELETE');
    assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer page-token');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM tenant_pages').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM activity_logs WHERE event_type = 'page_unlinked'").get().count, 1);
});

test('WhatsApp onboarding verifies WABA phone ownership before encrypted tenant update', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const requestMeta = async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/oauth/access_token')) {
            return { ok: true, status: 200, data: { access_token: 'wa-token' } };
        }
        if (url.includes('/waba-1/phone_numbers?')) {
            return { ok: true, status: 200, data: { data: [{ id: 'phone-1' }] } };
        }
        if (url.endsWith('/waba-1/subscribed_apps')) {
            return { ok: true, status: 200, data: { success: true } };
        }
        return assert.fail(`Unexpected Meta request: ${url}`);
    };
    const router = createTenantMetaOnboardingRouter({
        database: db,
        ...createDependencies({ requestMeta }),
    });

    const initial = await invokeRoute(router, 'get', '/whatsapp/status', {
        user: { tenant_id: 1 },
    });
    assert.equal(initial.body.connected, false);
    const mismatched = await invokeRoute(router, 'post', '/whatsapp/connect', {
        user: { tenant_id: 1 },
        body: { code: 'wa-code', waba_id: 'waba-1', phone_number_id: 'phone-other' },
    });
    assert.equal(mismatched.statusCode, 400);
    assert.match(mismatched.body.error, /does not belong/);
    assert.equal(db.prepare('SELECT waba_id FROM tenants WHERE id = 1').get().waba_id, null);

    const connected = await invokeRoute(router, 'post', '/whatsapp/connect', {
        user: { tenant_id: 1 },
        body: {
            code: 'wa-code',
            waba_id: 'waba-1',
            phone_number_id: 'phone-1',
            business_id: 'business-1',
        },
    });
    assert.equal(connected.statusCode, 200);
    assert.equal(connected.body.status.connected, true);
    const tenant = db.prepare(`
        SELECT waba_id, phone_number_id, business_id, access_token, access_token_encrypted
        FROM tenants WHERE id = 1
    `).get();
    assert.deepEqual(tenant, {
        waba_id: 'waba-1',
        phone_number_id: 'phone-1',
        business_id: 'business-1',
        access_token: null,
        access_token_encrypted: 'encrypted:wa-token',
    });
    assert.equal(db.prepare('SELECT waba_id FROM tenants WHERE id = 2').get().waba_id, null);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM activity_logs WHERE event_type = 'whatsapp_connected'").get().count, 1);
    const tokenCalls = calls.filter(call => call.url.endsWith('/oauth/access_token'));
    assert.ok(tokenCalls.every(call => call.init.method === 'POST'));
    assert.ok(tokenCalls.every(call => !call.url.includes('app-secret') && !call.url.includes('wa-code')));
    assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer wa-token');

    const conflict = await invokeRoute(router, 'post', '/whatsapp/connect', {
        user: { tenant_id: 1 },
        body: { code: 'new-code', waba_id: 'waba-1', phone_number_id: 'phone-1' },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, 'WHATSAPP_ALREADY_CONNECTED');
});

test('WhatsApp onboarding imports every authorized WABA number without replacing the existing registry', async (t) => {
    const db = createDatabase();
    enableMultipleWhatsAppNumbers(db);
    t.after(() => db.close());
    const requestMeta = async url => {
        if (url.endsWith('/oauth/access_token')) {
            return { ok: true, status: 200, data: { access_token: 'multi-token' } };
        }
        if (url.includes('/waba-multi/phone_numbers?')) {
            return {
                ok: true,
                status: 200,
                data: {
                    data: [
                        {
                            id: 'phone-multi-1',
                            display_phone_number: '+218 91 000 0001',
                            verified_name: 'Sales',
                            quality_rating: 'GREEN',
                            status: 'CONNECTED',
                        },
                        {
                            id: 'phone-multi-2',
                            display_phone_number: '+218 92 000 0002',
                            verified_name: 'Support',
                            quality_rating: 'YELLOW',
                            status: 'CONNECTED',
                        },
                    ],
                },
            };
        }
        if (url.endsWith('/waba-multi/subscribed_apps')) {
            return { ok: true, status: 200, data: { success: true } };
        }
        return assert.fail(`Unexpected Meta request: ${url}`);
    };
    const router = createTenantMetaOnboardingRouter({
        database: db,
        ...createDependencies({ requestMeta }),
    });

    const connected = await invokeRoute(router, 'post', '/whatsapp/connect', {
        user: { tenant_id: 1 },
        body: {
            code: 'multi-code',
            waba_id: 'waba-multi',
            phone_number_id: 'phone-multi-2',
            business_id: 'business-multi',
        },
    });
    assert.equal(connected.statusCode, 200);
    assert.equal(connected.body.imported_count, 2);
    assert.equal(connected.body.status.number_count, 2);
    assert.equal(connected.body.status.default_phone_number_id, 'phone-multi-2');
    assert.deepEqual(
        db.prepare(`
            SELECT phone_number_id, display_phone_number, verified_name,
                   quality_rating, platform_status, is_default
            FROM tenant_whatsapp_numbers
            WHERE tenant_id = 1
            ORDER BY phone_number_id
        `).all(),
        [
            {
                phone_number_id: 'phone-multi-1',
                display_phone_number: '+218 91 000 0001',
                verified_name: 'Sales',
                quality_rating: 'GREEN',
                platform_status: 'CONNECTED',
                is_default: 0,
            },
            {
                phone_number_id: 'phone-multi-2',
                display_phone_number: '+218 92 000 0002',
                verified_name: 'Support',
                quality_rating: 'YELLOW',
                platform_status: 'CONNECTED',
                is_default: 1,
            },
        ],
    );
    assert.equal(db.prepare('SELECT phone_number_id FROM tenants WHERE id = 1').get().phone_number_id, 'phone-multi-2');
    assert.doesNotMatch(JSON.stringify(connected.body), /multi-token|encrypted:multi-token/);
});
