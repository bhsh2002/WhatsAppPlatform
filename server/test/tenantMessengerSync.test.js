import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantMessengerSyncRouter } from '../routes/tenantMessengerSync.js';

function createDatabase({ pages = true } = {}) {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenant_pages (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            page_id TEXT,
            page_name TEXT,
            page_access_token_encrypted TEXT,
            is_active INTEGER
        );
        CREATE TABLE fb_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            linked_page_id INTEGER NOT NULL,
            page_id TEXT NOT NULL,
            user_psid TEXT NOT NULL,
            user_name TEXT,
            user_profile_pic TEXT,
            last_message TEXT,
            last_message_time DATETIME,
            unread_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (linked_page_id, user_psid)
        );
        CREATE TABLE fb_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            tenant_id INTEGER NOT NULL,
            mid TEXT UNIQUE,
            direction TEXT,
            sender_id TEXT,
            sender_name TEXT,
            message_text TEXT,
            attachment_type TEXT,
            attachment_url TEXT,
            sticker_url TEXT,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    if (pages) {
        db.exec(`
            INSERT INTO tenant_pages VALUES
                (1, 1, 'page/A', 'Page A', 'encrypted-a', 1),
                (2, 2, 'page-B', 'Page B', 'encrypted-b', 1);
            INSERT INTO fb_conversations (
                id, tenant_id, linked_page_id, page_id, user_psid,
                user_name, last_message, last_message_time
            ) VALUES (20, 2, 2, 'page-B', 'user-1', 'Tenant B User', 'Do not change', '2026-01-01 00:00:00');
        `);
    }
    return db;
}

const findHandlers = router => {
    const layer = router.stack.find(item => (
        item.route?.path === '/unified/messenger/sync' && item.route.methods?.post
    ));
    assert.ok(layer);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, tenantId) => new Promise((resolve, reject) => {
    const req = { user: { tenant_id: tenantId }, body: {}, query: {}, params: {} };
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
    const handlers = findHandlers(router);
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve(res);
        Promise.resolve(handlers[index++](req, res, next)).catch(reject);
    };
    next();
});

test('Messenger sync returns an empty tenant result without calling Meta when no pages exist', async (t) => {
    const db = createDatabase({ pages: false });
    t.after(() => db.close());
    let metaCalls = 0;
    const router = createTenantMessengerSyncRouter({
        database: db,
        decryptToken: () => null,
        requestMeta: async () => {
            metaCalls += 1;
            return { ok: true, status: 200, data: {} };
        },
        apiBase: 'https://graph.test/v25.0',
    });
    const result = await invoke(router, 1);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
        success: true,
        synced_conversations: 0,
        synced_messages: 0,
        failed_pages: 0,
        message: 'لا توجد صفحات مرتبطة',
    });
    assert.equal(metaCalls, 0);
});

test('Messenger sync is tenant-scoped, token-header-only and idempotent for conversation messages', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const requestMeta = async (url, init) => {
        calls.push({ url, init });
        if (url.includes('/user-1?')) {
            return {
                ok: true,
                status: 200,
                data: { name: 'User One', profile_pic: 'https://cdn.test/user-1.jpg' },
            };
        }
        if (url.includes('/page%2FA/conversations?')) {
            return {
                ok: true,
                status: 200,
                data: {
                    data: [{
                        updated_time: '2026-07-14T12:00:00+0000',
                        participants: { data: [{ id: 'page/A' }, { id: 'user-1', name: 'Fallback' }] },
                        messages: {
                            data: [{
                                mid: 'mid-1',
                                message: 'Hello from Messenger',
                                from: { id: 'user-1', name: 'User One' },
                                created_time: '2026-07-14T12:00:00+0000',
                            }],
                        },
                    }],
                },
            };
        }
        return assert.fail(`Unexpected request ${url}`);
    };
    const router = createTenantMessengerSyncRouter({
        database: db,
        decryptToken: value => value === 'encrypted-a' ? 'token-a' : 'token-b',
        requestMeta,
        apiBase: 'https://graph.test/v25.0',
    });

    const first = await invoke(router, 1);
    assert.deepEqual(first.body, {
        success: true,
        synced_conversations: 1,
        synced_messages: 1,
        failed_pages: 0,
    });
    const conversation = db.prepare('SELECT * FROM fb_conversations WHERE tenant_id = 1').get();
    assert.equal(conversation.linked_page_id, 1);
    assert.equal(conversation.user_psid, 'user-1');
    assert.equal(conversation.user_name, 'User One');
    assert.equal(db.prepare('SELECT tenant_id FROM fb_messages WHERE mid = ?').get('mid-1').tenant_id, 1);
    assert.equal(db.prepare('SELECT last_message FROM fb_conversations WHERE id = 20').get().last_message, 'Do not change');
    assert.ok(calls.every(call => call.init.headers.Authorization === 'Bearer token-a'));
    assert.ok(calls.every(call => !call.url.includes('token-a') && !call.url.includes('access_token')));

    const second = await invoke(router, 1);
    assert.equal(second.body.synced_conversations, 0);
    assert.equal(second.body.synced_messages, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM fb_messages WHERE mid = 'mid-1'").get().count, 1);
});

test('Messenger sync rejects cross-origin Meta pagination without following it', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const router = createTenantMessengerSyncRouter({
        database: db,
        decryptToken: () => 'token-a',
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            return {
                ok: true,
                status: 200,
                data: { data: [], paging: { next: 'https://attacker.test/token' } },
            };
        },
        apiBase: 'https://graph.test/v25.0',
    });
    const result = await invoke(router, 1);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, false);
    assert.equal(result.body.failed_pages, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/graph\.test/);
});
