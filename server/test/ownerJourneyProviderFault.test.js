import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createOwnerJourneyProviderFault } from '../test-support/ownerJourneyProviderFault.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const arm = { target: 'message_provider', mode: 'commit_then_drop_ack' };
const armedReceipt = { fault: 'commit_then_drop_ack_once', armed: true, boundary: 'owned_provider_http' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// A small owned HTTP probe, not Root's joint-run provider on offset7. Its
// independent SQLite ledger commits before it sends the actual response bytes.
const fixture = async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-provider-fault-'));
    const filename = path.join(directory, 'native.sqlite');
    let database = new Database(filename);
    database.exec(`CREATE TABLE tenants(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY);
        CREATE TABLE savana_service_requests(id INTEGER PRIMARY KEY); CREATE TABLE billing_usage_events(id INTEGER PRIMARY KEY);
        CREATE TABLE facebook_content_publications(id INTEGER PRIMARY KEY); CREATE TABLE broadcast_jobs(id INTEGER PRIMARY KEY);`);
    database.exec(fs.readFileSync(new URL('../db/migrations/061_collaborative_execution.sql', import.meta.url), 'utf8'));
    database.prepare('INSERT INTO tenants VALUES(1)').run();
    database.pragma('foreign_keys = ON');
    const provider = new Database(path.join(directory, 'provider.sqlite'));
    provider.exec('CREATE TABLE actual_http_acceptances(request_key TEXT PRIMARY KEY,payload_sha256 TEXT NOT NULL)');
    let responseFor = () => null;
    let calls = 0;
    const waiters = [];
    const server = http.createServer(async (req, res) => {
        try {
            const chunks = []; for await (const bytes of req) chunks.push(bytes);
            const raw = Buffer.concat(chunks); const body = JSON.parse(raw.toString('utf8'));
            const key = req.headers['idempotency-key'] || body.biz_opaque_callback_data || body.message?.metadata;
            calls++;
            provider.prepare('INSERT INTO actual_http_acceptances VALUES(?,?)').run(key, hash(raw));
            for (const waiter of waiters) if (calls >= waiter.count) waiter.resolve();
            const custom = await responseFor({ req, body, key });
            const value = custom?.body ?? (req.url === '/services/v1/messages.php'
                ? { success: true, data: { message_id: `synthetic-sms-${key}` } }
                : body.messaging_product === 'whatsapp' ? { messages: [{ id: `synthetic-wamid-${key}` }] }
                    : { message_id: `synthetic-mid-${key}` });
            res.writeHead(custom?.status ?? 200, { 'Content-Type': 'application/json' });
            res.end(custom?.raw ?? JSON.stringify(value));
        } catch { res.writeHead(500); res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runId = 'synthetic_owned_fault';
    const fresh = () => createOwnerJourneyProviderFault({ database, runId, providerOrigin: origin });
    const effect = (key, kind = 'sms_message', { retained = true, state = 'dispatching' } = {}) => {
        const executionId = `execution-${key}`; const effectId = `effect-${key}`; const now = new Date().toISOString();
        if (retained) {
            database.prepare(`INSERT INTO savana_collaborative_executions(id,tenant_id,capability_code,request_hash,selection_hash,
                selection_json,authorization_json,principal_json,state,created_at,updated_at) VALUES(?,1,'messaging.send',?,?,'{}','{}','{}','executing',?,?)`)
                .run(executionId, hash(key), hash(key), now, now);
            database.prepare(`INSERT INTO savana_collaborative_effects(id,execution_id,effect_key,native_kind,native_idempotency_key,state,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?)`).run(effectId, executionId, key, kind, key, state, now, now);
        }
        const token = `synthetic-correlation-${key}`;
        if (retained && kind !== 'sms_message') database.prepare(`INSERT INTO savana_collaborative_correlations(effect_id,channel,tenant_id,
            account_ref,account_fingerprint,recipient_sha256,payload_sha256,token_sha256,encrypted_mac_key,encrypted_capture,created_at)
            VALUES(?,?,1,'synthetic-account',?,?,?,?,'synthetic-cipher','synthetic-capture',?)`)
            .run(effectId, kind === 'whatsapp_message' ? 'whatsapp' : 'messenger', hash('account'), hash('recipient'), hash('payload'), hash(token), now);
        const body = kind === 'sms_message' ? { recipient: 'synthetic-recipient', message: 'Synthetic owned HTTP only' }
            : kind === 'whatsapp_message' ? { messaging_product: 'whatsapp', to: 'synthetic-recipient', biz_opaque_callback_data: token }
                : { recipient: { id: 'synthetic-recipient' }, message: { text: 'Synthetic owned HTTP only', metadata: token } };
        return { url: origin + (kind === 'sms_message' ? '/services/v1/messages.php' : '/v25.0/synthetic-account/messages'),
            options: { method: 'POST', headers: { 'Content-Type': 'application/json', ...(kind === 'sms_message' ? { 'Idempotency-Key': key } : {}) },
                body: JSON.stringify(body) } };
    };
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); provider.close();
        fs.rmSync(directory, { recursive: true, force: true }); });
    return { fresh, effect, calls: () => calls,
        accepted: () => provider.prepare('SELECT COUNT(*) n FROM actual_http_acceptances').get().n,
        reply: fn => { responseFor = fn; },
        send: (wrapped, request) => wrapped(request.url, request.options),
        waitFor: count => calls >= count ? Promise.resolve() : new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('owned_probe_timeout')), 2000);
            waiters.push({ count, resolve: () => { clearTimeout(timer); resolve(); } });
        }),
        reopen: () => { database.close(); database = new Database(filename); database.pragma('foreign_keys = ON'); return fresh(); },
        database: () => database, origin };
};

test('arming ACK requires an installed real hook and retained source tables, without claiming an applied fault', async t => {
    const f = await fixture(t); const hook = f.fresh();
    assert.throws(() => hook.control(arm), { code: 'owned_fault_boundary_unavailable' });
    assert.deepEqual(hook.snapshot(), { armed: false, applied: 0 });
    hook.wrapFetch(fetch);
    assert.deepEqual(hook.control(arm), armedReceipt);
    assert.deepEqual(hook.snapshot(), { armed: true, applied: 0 });
    assert.equal(f.database().prepare("SELECT COUNT(*) n FROM owner_journey_provider_faults WHERE state='armed'").get().n, 1);
    assert.throws(() => hook.control(arm), { code: 'owned_fault_already_armed' });
    assert.throws(() => hook.wrapFetch(fetch), { code: 'owned_fault_boundary_invalid' });
    assert.throws(() => hook.control({ ...arm, armed: true }), { code: 'unsupported_owned_fault' });
    assert.equal(f.calls(), 0);
    const absent = new Database(':memory:'); t.after(() => absent.close());
    const missing = createOwnerJourneyProviderFault({ database: absent, runId: 'synthetic_missing', providerOrigin: f.origin });
    missing.wrapFetch(fetch);
    assert.throws(() => missing.control(arm), { code: 'owned_fault_boundary_unavailable' });
});

test('actual owned HTTP acceptance commits before one correlated SMS, WhatsApp or Messenger ACK is dropped', async t => {
    const f = await fixture(t); const hook = f.fresh(); const wrapped = hook.wrapFetch(fetch);
    for (const [index, kind] of ['sms_message', 'whatsapp_message', 'messenger_message'].entries()) {
        assert.deepEqual(hook.control(arm), armedReceipt);
        await assert.rejects(f.send(wrapped, f.effect(`send-${index}`, kind)), { code: 'owned_provider_ack_dropped' });
        assert.equal(f.accepted(), index + 1); assert.equal(f.calls(), index + 1);
        assert.deepEqual(hook.snapshot(), { armed: false, applied: index + 1 });
    }
    const rows = f.database().prepare("SELECT effect_sha256,receipt_sha256,applied_at FROM owner_journey_provider_faults WHERE state='applied'").all();
    assert.equal(rows.length, 3);
    for (const row of rows) { assert.match(row.effect_sha256, /^[a-f0-9]{64}$/); assert.match(row.receipt_sha256, /^[a-f0-9]{64}$/); assert.ok(row.applied_at); }
    assert.equal(f.database().prepare("SELECT value FROM owner_journey_counters WHERE name='commit_then_drop_ack'").get().value, 3);
});

test('two real concurrent committed ACKs consume exactly one persisted arm', async t => {
    const f = await fixture(t); const hook = f.fresh(); const wrapped = hook.wrapFetch(fetch); const gate = deferred();
    f.reply(async () => { await gate.promise; return null; }); hook.control(arm);
    const sends = [f.send(wrapped, f.effect('parallel-one')), f.send(wrapped, f.effect('parallel-two'))];
    const results = Promise.allSettled(sends); await f.waitFor(2); assert.equal(f.accepted(), 2); gate.resolve();
    const settled = await results;
    assert.equal(settled.filter(row => row.status === 'rejected' && row.reason.code === 'owned_provider_ack_dropped').length, 1);
    assert.equal(settled.filter(row => row.status === 'fulfilled').length, 1);
    assert.deepEqual(hook.snapshot(), { armed: false, applied: 1 }); assert.equal(f.calls(), 2);
    for (const row of settled) if (row.status === 'fulfilled') await row.value.body?.cancel();
});

test('malformed, error, empty-ID or wrong endpoint ACKs cannot consume a valid arm', async t => {
    const f = await fixture(t); const hook = f.fresh(); const wrapped = hook.wrapFetch(fetch); hook.control(arm);
    const replies = [{ body: { success: false, data: { message_id: 'not-accepted' } } }, { body: { success: true, data: { message_id: '' } } },
        { raw: '{invalid-json' }, { status: 503, body: { success: true, data: { message_id: 'not-accepted' } } },
        { body: { error: { message: 'rejected' }, success: true, data: { message_id: 'not-accepted' } } }];
    for (const [index, reply] of replies.entries()) {
        f.reply(() => reply); const response = await f.send(wrapped, f.effect(`bad-${index}`)); await response.body?.cancel();
        assert.deepEqual(hook.snapshot(), { armed: true, applied: 0 });
    }
    f.reply(() => ({ body: { id: 'wrong-whatsapp-response-field' } }));
    await (await f.send(wrapped, f.effect('wrong-shape', 'whatsapp_message'))).body?.cancel();
    assert.deepEqual(hook.snapshot(), { armed: true, applied: 0 });
    f.reply(() => null);
    await assert.rejects(f.send(wrapped, f.effect('valid-after-malformed')), { code: 'owned_provider_ack_dropped' });
    assert.deepEqual(hook.snapshot(), { armed: false, applied: 1 });
});

test('uncorrelated, inactive and wrong-origin sends do not consume the actual collaborative arm', async t => {
    const f = await fixture(t); const hook = f.fresh(); let delegated = 0;
    const wrapped = hook.wrapFetch((url, options) => { delegated++; return new URL(url).origin === f.origin
        ? fetch(url, options) : Promise.resolve(new Response(JSON.stringify({ success: true, data: { message_id: 'synthetic-no-network' } }))); });
    hook.control(arm);
    for (const request of [f.effect('unretained', 'sms_message', { retained: false }), f.effect('inactive', 'sms_message', { state: 'accepted' })]) {
        await (await f.send(wrapped, request)).body?.cancel(); assert.deepEqual(hook.snapshot(), { armed: true, applied: 0 });
    }
    const wrong = f.effect('wrong-origin'); wrong.url = 'http://127.0.0.1:1/services/v1/messages.php';
    await (await f.send(wrapped, wrong)).body?.cancel();
    assert.deepEqual(hook.snapshot(), { armed: true, applied: 0 }); assert.equal(f.calls(), 2); assert.equal(delegated, 3);
});

test('late response from a consumed generation cannot consume a newly installed arm', async t => {
    const f = await fixture(t); const hook = f.fresh(); const wrapped = hook.wrapFetch(fetch); const gate = deferred();
    f.reply(async ({ key }) => { if (key === 'slow-old-generation') await gate.promise; return null; });
    hook.control(arm); const slow = f.send(wrapped, f.effect('slow-old-generation')); await f.waitFor(1);
    await assert.rejects(f.send(wrapped, f.effect('fast-old-generation')), { code: 'owned_provider_ack_dropped' });
    hook.control(arm); gate.resolve(); await (await slow).body?.cancel();
    assert.deepEqual(hook.snapshot(), { armed: true, applied: 1 });
    await assert.rejects(f.send(wrapped, f.effect('new-generation')), { code: 'owned_provider_ack_dropped' });
    assert.deepEqual(hook.snapshot(), { armed: false, applied: 2 }); assert.equal(f.calls(), 3);
});

test('fresh SQLite/helper reopen preserves armed and consumed state without dispatch or automatic rearming', async t => {
    const f = await fixture(t); let hook = f.fresh(); hook.wrapFetch(fetch); hook.control(arm);
    const request = f.effect('survives-reopen'); hook = f.reopen(); const wrapped = hook.wrapFetch(fetch);
    assert.deepEqual(hook.snapshot(), { armed: true, applied: 0 }); assert.equal(f.calls(), 0);
    await assert.rejects(f.send(wrapped, request), { code: 'owned_provider_ack_dropped' }); assert.equal(f.accepted(), 1);
    hook = f.reopen(); hook.wrapFetch(fetch);
    assert.deepEqual(hook.snapshot(), { armed: false, applied: 1 }); assert.equal(f.calls(), 1);
    assert.equal(f.database().prepare("SELECT value FROM owner_journey_counters WHERE name='commit_then_drop_ack'").get().value, 1);
});
