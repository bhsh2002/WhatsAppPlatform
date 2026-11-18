import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { NativeCommandProtocol, nativeCommandJson } from '../services/nativeCommandProtocol.js';

const callbackToken = ['synthetic', 'protocol', 'fixture', 'only'].join(':');
const now = Date.parse('2026-11-18T10:00:00Z');
const timestamp = String(now / 1000);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const database = name => {
    const db = new Database(name);
    db.exec(`CREATE TABLE IF NOT EXISTS savana_collaborative_nonces (
        nonce TEXT PRIMARY KEY, request_sha256 TEXT, consumed_at INTEGER, expires_at INTEGER)`);
    return db;
};
const signed = ({ nonce = crypto.randomBytes(16).toString('hex'), body = Buffer.from('{"command_id":"owned-command"}'),
    method = 'POST', wirePath = '/savana/command-adapter/v1/commands', time = timestamp } = {}) => ({
    method, pathAndQuery: wirePath, body, headers: {
        'X-Savana-Callback-Token': callbackToken,
        'X-Savana-Command-Timestamp': time,
        'X-Savana-Command-Nonce': nonce,
        'X-Savana-Command-Signature': `v1=${crypto.createHmac('sha256', callbackToken).update(
            ['savana-command-request-v1', method, wirePath, time, nonce, sha(body)].join('\n')).digest('hex')}`,
    },
});

test('official exact-byte signature consumes one durable nonce and rejects its replay after a restart', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-native-nonce-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const name = path.join(directory, 'owned.db'); const first = database(name);
    const request = signed();
    const protocol = new NativeCommandProtocol({ database: first, callbackToken, now: () => now });
    const verified = protocol.authenticate(request);
    assert.equal(verified.requestBodySha256, sha(request.body));
    assert.equal(first.prepare('SELECT COUNT(*) AS n FROM savana_collaborative_nonces').get().n, 1);
    first.close();
    const reopened = database(name); t.after(() => reopened.close());
    assert.throws(() => new NativeCommandProtocol({ database: reopened, callbackToken, now: () => now }).authenticate(request),
        error => error.code === 'native_command_nonce_replayed');
});

test('body, path, account token and timestamp tampering never consume a nonce', t => {
    const db = database(':memory:'); t.after(() => db.close());
    const protocol = new NativeCommandProtocol({ database: db, callbackToken, now: () => now });
    for (const alter of [
        request => { request.body = Buffer.from('{"command_id":"changed"}'); },
        request => { request.pathAndQuery += '/reconcile'; },
        request => { request.headers['X-Savana-Callback-Token'] = 'unrelated'; },
        request => { request.headers['X-Savana-Command-Timestamp'] = String(now / 1000 - 31); },
    ]) {
        const request = signed(); alter(request);
        assert.throws(() => protocol.authenticate(request));
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM savana_collaborative_nonces').get().n, 0);
    }
});

test('operator-owned public proxy prefix binds the wire path and cannot be supplied through a header', t => {
    const db = database(':memory:'); t.after(() => db.close());
    const protocol = new NativeCommandProtocol({ database: db, callbackToken, now: () => now, signaturePathPrefix: '/api' });
    const request = signed({ wirePath: '/api/savana/command-adapter/v1/discovery?organization_id=owned' });
    request.pathAndQuery = request.pathAndQuery.slice(4);
    request.headers['X-Forwarded-Prefix'] = '/untrusted';
    assert.equal(protocol.authenticate(request).path, '/api/savana/command-adapter/v1/discovery?organization_id=owned');
    const unprefixed = signed();
    unprefixed.headers['X-Forwarded-Prefix'] = '/api';
    assert.throws(() => protocol.authenticate(unprefixed), error => error.code === 'native_command_signature_invalid');
});

test('signed UTF8 response binds request nonce/body, status and canonical response bytes', t => {
    const db = database(':memory:'); t.after(() => db.close());
    const protocol = new NativeCommandProtocol({ database: db, callbackToken, now: () => now });
    const request = signed(); const verified = protocol.authenticate(request);
    const result = protocol.response(verified, 202, { outcome: 'pending', reason_code: 'بانتظار النتيجة', version: 1 });
    const expectedBytes = Buffer.from('{"outcome":"pending","reason_code":"بانتظار النتيجة","version":1}');
    assert.deepEqual(result.body, expectedBytes);
    const material = ['savana-command-response-v1', request.method, request.pathAndQuery, timestamp,
        request.headers['X-Savana-Command-Nonce'], sha(request.body), '202', sha(expectedBytes)].join('\n');
    assert.equal(result.signature, `v1=${crypto.createHmac('sha256', callbackToken).update(material).digest('hex')}`);
    assert.equal(result.nonce, verified.nonce);
});

test('nonfinite or undefined protocol JSON and oversized responses are refused', t => {
    const db = database(':memory:'); t.after(() => db.close());
    const protocol = new NativeCommandProtocol({ database: db, callbackToken, now: () => now });
    for (const value of [{ bad: Number.NaN }, { bad: undefined }, [Infinity]]) assert.throws(() => nativeCommandJson(value));
    const verified = protocol.authenticate(signed());
    assert.throws(() => protocol.response(verified, 200, { oversized: 'x'.repeat(1_048_577) }),
        error => error.code === 'native_command_response_too_large');
});
