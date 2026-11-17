// Dedicated fresh-process behavioral probe. Targets are parent-owned loopback
// sentinels only; no application singleton, service worker or real DB is loaded.
import http, { request as liveHttpRequest } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import express from 'express';
import Database from 'better-sqlite3';
import { applyThrough, migrationFiles } from './savanaMigrationFixture.js';

const captured = { fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get,
    httpsRequest: https.request, httpsGet: https.get };
const lines = createInterface({ input: process.stdin });
const iterator = lines[Symbol.asyncIterator]();
const emit = value => process.stdout.write(`@@EGRESS_PROBE@@${JSON.stringify(value)}\n`);
const finish = async code => {
    lines.close(); process.stdin.destroy();
    await new Promise(resolve => process.stdout.write('', resolve));
    process.exit(code);
};
let server;
let database;
let directory;
let input;
const cleanup = async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (database?.open) database.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    return { server_closed: !server?.listening, database_closed: !database?.open,
        owned_state_removed: !directory || !fs.existsSync(directory) };
};
const errorFacts = error => {
    const codes = [];
    let text = '';
    let causeHasMaintenanceCode = false;
    const visited = new Set();
    const visit = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || visited.has(value) || depth > 8) return;
        visited.add(value);
        if (typeof value.code === 'string') codes.push(value.code);
        if (depth > 0 && value.code === 'WA_EGRESS_MAINTENANCE') causeHasMaintenanceCode = true;
        for (const name of Object.getOwnPropertyNames(value)) {
            const item = value[name];
            if (typeof item === 'string') text += item;
        }
        visit(value.cause, depth + 1);
        if (Array.isArray(value.errors)) value.errors.forEach(item => visit(item, depth + 1));
    };
    visit(error);
    return { codes, cause_has_maintenance_code: causeHasMaintenanceCode,
        redacted: ![input.secret, input.httpOrigin, input.tlsOrigin, 'X-Probe-Private',
            'Bearer WA_PRIVATE_PROBE_', 'invalid-private-flag-value'].some(value => text.includes(value)) };
};
const outcome = async (name, action) => {
    try {
        const response = await action();
        if (response?.arrayBuffer) await response.arrayBuffer();
        return { name, blocked: false, codes: [], redacted: true };
    } catch (error) {
        const facts = errorFacts(error);
        return { name, blocked: facts.codes.includes('WA_EGRESS_MAINTENANCE'), ...facts };
    }
};
const request = (fn, origin, get = false) => new Promise((resolve, reject) => {
    let req;
    const timer = setTimeout(() => { req?.destroy(); reject(new Error('Owned transport probe timeout')); }, 1200);
    const done = callback => value => { clearTimeout(timer); callback(value); };
    try {
        req = fn(`${origin}/private-target?marker=${input.secret}`, {
            method: get ? 'GET' : 'POST', headers: { Authorization: `Bearer ${input.secret}`, 'X-Probe-Private': input.secret },
        }, response => { response.resume(); response.on('end', done(resolve)); });
        req.once('error', done(reject));
        if (!get) req.end(input.secret);
    } catch (error) { clearTimeout(timer); req?.destroy(); reject(error); }
});
const socket = connect => new Promise((resolve, reject) => {
    let value;
    const timer = setTimeout(() => { value?.destroy(); reject(new Error('Owned socket probe timeout')); }, 1200);
    const done = callback => event => { clearTimeout(timer); value?.destroy(); callback(event); };
    try {
        value = connect();
        value.once('error', done(reject));
        value.once('connect', done(resolve));
    } catch (error) { clearTimeout(timer); value?.destroy(); reject(error); }
});
const datagram = () => new Promise((resolve, reject) => {
    const udp = dgram.createSocket('udp4');
    const close = () => { try { udp.close(); } catch { /* It may never have bound. */ } };
    const timer = setTimeout(() => { close(); reject(new Error('Owned datagram probe timeout')); }, 1200);
    udp.once('error', error => { clearTimeout(timer); close(); reject(error); });
    try {
        udp.send(Buffer.from(input.secret), input.udpPort, '127.0.0.1', error => {
            clearTimeout(timer); close(); if (error) reject(error); else resolve();
        });
    } catch (error) { clearTimeout(timer); close(); reject(error); }
});
const databaseDigest = () => {
    const tables = database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const snapshot = tables.map(table => ({ ...table,
        rows: database.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`).all()
            .map(row => JSON.stringify(row)).sort() }));
    return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
};
const migratedDatabase = mode => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-egress-preflight-probe-'));
    database = new Database(path.join(directory, 'owned.sqlite'));
    applyThrough(database, migrationFiles.at(-1));
    if (mode === 'resume-unresolved') database.prepare('INSERT INTO broadcast_jobs(status,results) VALUES(?,?)').run('pending', input.secret);
    if (mode === 'resume-incomplete') database.exec('ALTER TABLE broadcast_jobs RENAME COLUMN status TO hidden_state');
};

try {
    const first = await iterator.next();
    if (first.done) throw new Error('Private probe configuration required');
    input = JSON.parse(first.value);
    for (const key of ['httpOrigin', 'tlsOrigin']) {
        const url = new URL(input[key]);
        if (url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/') throw new Error('Owned probe origin required');
    }
    try { await import('../runtime/egressMaintenanceBootstrap.js'); }
    catch (error) {
        emit({ event: 'bootstrap_rejected', ...errorFacts(error), cleanup: await cleanup() });
        await finish(2);
    }
    const runtime = await import('../runtime/egressMaintenance.js');
    if (input.mode === 'default-off') {
        const activeBefore = runtime.isEgressMaintenanceActive();
        await (await fetch(`${input.httpOrigin}/one-owned-default-off`)).arrayBuffer();
        emit({ event: 'done', active_before: activeBefore, status: runtime.egressMaintenanceStatus(), cleanup: await cleanup() });
        await finish(0);
    }
    if (input.mode.startsWith('resume-')) {
        const pending = await outcome('pending_startup_fetch', () => fetch(`${input.httpOrigin}/pending?marker=${input.secret}`));
        process.env.SAVANA_EGRESS_REQUIRE_IDLE = 'false';
        const pendingAfterEnvChange = runtime.isEgressMaintenanceActive();
        migratedDatabase(input.mode);
        const before = databaseDigest();
        let verificationError = null;
        try { runtime.verifyEgressResumeReady(database); }
        catch (error) { verificationError = { ...errorFacts(error), summary: error.summary }; }
        const databaseUnchanged = before === databaseDigest();
        let after;
        if (input.mode === 'resume-idle') {
            await (await fetch(`${input.httpOrigin}/one-owned-after-idle-verification`)).arrayBuffer();
            after = { released: !runtime.isEgressMaintenanceActive() };
        } else after = await outcome('still_blocked_after_failed_preflight', () => fetch(`${input.httpOrigin}/private?marker=${input.secret}`));
        emit({ event: 'done', pending, pending_after_env_change: pendingAfterEnvChange, verification_error: verificationError,
            database_unchanged: databaseUnchanged, after, status: runtime.egressMaintenanceStatus(), cleanup: await cleanup() });
        await finish(0);
    }
    if (input.mode !== 'active') throw new Error('Unknown isolated probe mode');
    const options = { host: '127.0.0.1', port: input.tcpPort };
    const checks = [
        ['fetch', () => fetch(`${input.httpOrigin}/private?marker=${input.secret}`, { headers: { Authorization: `Bearer ${input.secret}` } })],
        ['http_request', () => request(http.request, input.httpOrigin)],
        ['http_get', () => request(http.get, input.httpOrigin, true)],
        ['https_request', () => request(https.request, input.tlsOrigin)],
        ['https_get', () => request(https.get, input.tlsOrigin, true)],
        ['net_connect', () => socket(() => net.connect(options))],
        ['net_createConnection', () => socket(() => net.createConnection(options))],
        ['socket_connect', () => socket(() => new net.Socket().connect(options))],
        ['tls_connect', () => socket(() => tls.connect({ ...options, rejectUnauthorized: false }))],
        ['dgram_send', datagram],
        ['captured_fetch', () => captured.fetch(`${input.httpOrigin}/private?marker=${input.secret}`, { headers: { Authorization: `Bearer ${input.secret}` } })],
        ['captured_http_request', () => request(captured.httpRequest, input.httpOrigin)],
        ['captured_http_get', () => request(captured.httpGet, input.httpOrigin, true)],
        ['captured_https_request', () => request(captured.httpsRequest, input.tlsOrigin)],
        ['captured_https_get', () => request(captured.httpsGet, input.tlsOrigin, true)],
        ['live_named_http_request', () => request(liveHttpRequest, input.httpOrigin)],
    ];
    const outcomes = [];
    for (const [name, action] of checks) outcomes.push(await outcome(name, action));
    process.env.SAVANA_EGRESS_MAINTENANCE = 'false';
    process.env.SAVANA_EGRESS_REQUIRE_IDLE = 'false';
    runtime.installEgressMaintenance();
    migratedDatabase('idle');
    const before = databaseDigest();
    runtime.verifyEgressResumeReady(database);
    const explicitMaintenanceNotReleased = runtime.isEgressMaintenanceActive();
    const preflightDatabaseUnchanged = before === databaseDigest();
    outcomes.push(await outcome('fetch_after_env_clear_and_idle_verification', () => fetch(`${input.httpOrigin}/private?marker=${input.secret}`)));
    const counts = { health: 0, controllers: 0, queue_mutations: 0 };
    const app = express();
    app.use(runtime.createEgressMaintenanceMiddleware());
    app.use(express.json());
    app.get('/health', (_req, res) => { counts.health++; res.json({ ok: true }); });
    app.all('*', (_req, res) => { counts.controllers++; counts.queue_mutations++; res.json({ accepted: true }); });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    emit({ event: 'ready', port: server.address().port, outcomes, explicit_maintenance_not_released: explicitMaintenanceNotReleased,
        preflight_database_unchanged: preflightDatabaseUnchanged, status: runtime.egressMaintenanceStatus() });
    const command = await iterator.next();
    if (command.done || JSON.parse(command.value).command !== 'finish') throw new Error('Private finish required');
    emit({ event: 'done', counts, status: runtime.egressMaintenanceStatus(), cleanup: await cleanup() });
    await finish(0);
} catch (error) {
    emit({ event: 'failure', ...(input ? errorFacts(error) : { error_name: error.name }), cleanup: await cleanup() });
    await finish(1);
}
