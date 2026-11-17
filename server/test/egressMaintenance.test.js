import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const probePath = fileURLToPath(new URL('../test-support/egressMaintenanceProbe.mjs', import.meta.url));
const createSentinels = async t => {
    const counts = { http_requests: 0, http_connections: 0, http_bytes: 0, tcp_connections: 0, tcp_bytes: 0, udp_packets: 0 };
    const sockets = new Set();
    const web = http.createServer((_req, res) => { counts.http_requests++; res.end('owned sentinel'); });
    web.on('connection', socket => { counts.http_connections++; sockets.add(socket); socket.on('data', data => { counts.http_bytes += data.length; }); socket.on('close', () => sockets.delete(socket)); });
    const tcp = net.createServer(socket => { counts.tcp_connections++; sockets.add(socket); socket.on('data', data => { counts.tcp_bytes += data.length; }); socket.on('close', () => sockets.delete(socket)); });
    const udp = dgram.createSocket('udp4');
    udp.on('message', () => { counts.udp_packets++; });
    web.listen(0, '127.0.0.1'); tcp.listen(0, '127.0.0.1'); udp.bind(0, '127.0.0.1');
    await Promise.all([once(web, 'listening'), once(tcp, 'listening'), once(udp, 'listening')]);
    t.after(async () => {
        for (const socket of sockets) socket.destroy();
        await Promise.all([new Promise(resolve => web.close(resolve)), new Promise(resolve => tcp.close(resolve)), new Promise(resolve => udp.close(resolve))]);
    });
    return { counts, httpOrigin: `http://127.0.0.1:${web.address().port}`, tlsOrigin: `https://127.0.0.1:${tcp.address().port}`,
        tcpPort: tcp.address().port, udpPort: udp.address().port };
};
const childProbe = (t, sentinels, mode, flags = {}) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-egress-parent-probe-'));
    const secret = `WA_PRIVATE_PROBE_${crypto.randomUUID()}`;
    const child = spawn(process.execPath, [probePath], { cwd: path.dirname(probePath),
        env: { PATH: path.dirname(process.execPath), NODE_ENV: 'test', DOTENV_CONFIG_PATH: path.join(directory, 'absent.env'), ...flags },
        stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let buffer = '';
    const queued = []; const readers = [];
    child.stdout.on('data', chunk => {
        stdout += chunk; buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
            if (!line.startsWith('@@EGRESS_PROBE@@')) continue;
            const value = JSON.parse(line.slice('@@EGRESS_PROBE@@'.length));
            if (readers.length) readers.shift()(value); else queued.push(value);
        }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const ended = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await ended;
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const next = () => queued.length ? Promise.resolve(queued.shift()) : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Owned egress child protocol timed out')), 20_000);
        readers.push(value => { clearTimeout(timer); resolve(value); });
    });
    child.stdin.write(JSON.stringify({ mode, httpOrigin: sentinels.httpOrigin, tlsOrigin: sentinels.tlsOrigin,
        tcpPort: sentinels.tcpPort, udpPort: sentinels.udpPort, secret }) + '\n');
    return { next, ended, finish: () => child.stdin.write('{"command":"finish"}\n'),
        assertRedacted() {
            for (const marker of [secret, sentinels.httpOrigin, sentinels.tlsOrigin,
                'Bearer WA_PRIVATE_PROBE_', 'X-Probe-Private', 'invalid-private-flag-value']) {
                assert.equal((stdout + stderr).includes(marker), false, 'Child diagnostics exposed private transport data');
            }
        } };
};
const zeroPackets = counts => assert.deepEqual(counts, { http_requests: 0, http_connections: 0, http_bytes: 0,
    tcp_connections: 0, tcp_bytes: 0, udp_packets: 0 });
const blocked = result => {
    assert.equal(result.blocked, true, result.name);
    assert.equal(result.codes.includes('WA_EGRESS_MAINTENANCE'), true, result.name);
    assert.equal(result.redacted, true, result.name);
};

test('fresh maintenance child blocks real and previously captured transports before every owned sentinel', { timeout: 25_000 }, async t => {
    const sentinels = await createSentinels(t);
    const child = childProbe(t, sentinels, 'active', { SAVANA_EGRESS_MAINTENANCE: 'true', SAVANA_EGRESS_REQUIRE_IDLE: 'true' });
    const ready = await child.next();
    assert.equal(ready.event, 'ready');
    assert.equal(ready.outcomes.length, 17);
    ready.outcomes.forEach(blocked);
    assert.equal(ready.outcomes.find(result => result.name === 'captured_fetch').cause_has_maintenance_code, true);
    assert.equal(ready.explicit_maintenance_not_released, true);
    assert.equal(ready.preflight_database_unchanged, true);
    assert.equal(ready.status.active, true);
    assert.equal(ready.status.requested, true);
    assert.equal(ready.status.enforced, true);
    zeroPackets(sentinels.counts);
    const origin = `http://127.0.0.1:${ready.port}`;
    for (const method of ['GET', 'HEAD']) {
        const response = await fetch(origin + '/health', { method, headers: { Connection: 'close' } });
        assert.equal(response.status, 200); await response.arrayBuffer();
    }
    const routes = ['/api/auth/login', '/api/messages', '/messages', '/portal/messages', '/api/v1/messages',
        '/api/portal/integrations/shared-products', '/api/portal/integrations/shared-read-setup/owner/operations',
        '/webhooks', '/webhooks/facebook', '/webhooks/sms', '/api/savana/connect/callback', '/ready', '/health/extra'];
    for (const route of routes) for (const method of ['GET', 'POST']) {
        const response = await fetch(origin + route + '?private=WA_NATIVE_PRIVATE', { method,
            headers: { Authorization: 'Bearer WA_NATIVE_PRIVATE', 'Content-Type': 'application/json', Connection: 'close' },
            ...(method === 'POST' ? { body: '{"private":"WA_NATIVE_PRIVATE"}' } : {}) });
        assert.equal(response.status, 503, `${method} ${route}`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('retry-after'), '60');
        const raw = await response.text();
        assert.equal(raw.includes('WA_NATIVE_PRIVATE'), false);
        const body = JSON.parse(raw);
        assert.equal(body.error.code, 'WA_EGRESS_MAINTENANCE');
        assert.equal(body.accepted, false); assert.equal(body.execution_ready, false);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const response = await fetch(origin + '/health', { method, headers: { Connection: 'close' } });
        assert.equal(response.status, 503); await response.arrayBuffer();
    }
    child.finish();
    const done = await child.next();
    assert.equal(done.event, 'done');
    assert.deepEqual(done.counts, { health: 2, controllers: 0, queue_mutations: 0 });
    assert.equal(Object.values(done.cleanup).every(Boolean), true);
    assert.equal((await child.ended).code, 0);
    await delay(30); zeroPackets(sentinels.counts); child.assertRedacted();
});

test('fresh default-off child dispatches exactly one actual owned HTTP request', { timeout: 25_000 }, async t => {
    const sentinels = await createSentinels(t);
    const child = childProbe(t, sentinels, 'default-off');
    const done = await child.next();
    assert.equal(done.event, 'done'); assert.equal(done.active_before, false);
    assert.equal(done.status.active, false); assert.equal(done.status.enforced, true);
    assert.equal((await child.ended).code, 0);
    assert.equal(sentinels.counts.http_requests, 1);
    assert.equal(sentinels.counts.http_connections, 1);
    assert.equal(sentinels.counts.tcp_connections, 0); assert.equal(sentinels.counts.udp_packets, 0);
    child.assertRedacted();
});

for (const flag of ['SAVANA_EGRESS_MAINTENANCE', 'SAVANA_EGRESS_REQUIRE_IDLE']) {
    test(`invalid ${flag} fails closed before transports or an inbound app`, { timeout: 25_000 }, async t => {
        const sentinels = await createSentinels(t);
        const child = childProbe(t, sentinels, 'active', { [flag]: 'invalid-private-flag-value' });
        const rejected = await child.next();
        assert.equal(rejected.event, 'bootstrap_rejected'); assert.equal(rejected.redacted, true);
        assert.equal(Object.values(rejected.cleanup).every(Boolean), true);
        assert.equal((await child.ended).code, 2);
        zeroPackets(sentinels.counts); child.assertRedacted();
    });
}

for (const mode of ['resume-unresolved', 'resume-incomplete', 'resume-idle']) {
    test(`${mode}: actual migrated SQLite preflight gates startup without replay`, { timeout: 25_000 }, async t => {
        const sentinels = await createSentinels(t);
        const child = childProbe(t, sentinels, mode, { SAVANA_EGRESS_MAINTENANCE: 'false', SAVANA_EGRESS_REQUIRE_IDLE: 'true' });
        const done = await child.next();
        assert.equal(done.event, 'done'); blocked(done.pending);
        assert.equal(done.pending_after_env_change, true);
        assert.equal(done.database_unchanged, true);
        assert.equal(Object.values(done.cleanup).every(Boolean), true);
        assert.equal((await child.ended).code, 0);
        if (mode === 'resume-idle') {
            assert.equal(done.verification_error, null); assert.equal(done.after.released, true);
            assert.equal(done.status.active, false); assert.equal(done.status.resume_check.passed, true);
            assert.equal(sentinels.counts.http_requests, 1); assert.equal(sentinels.counts.tcp_connections, 0); assert.equal(sentinels.counts.udp_packets, 0);
        } else {
            assert.equal(done.verification_error.codes.includes('WA_EGRESS_RESUME_BLOCKED'), true);
            assert.equal(done.verification_error.redacted, true);
            assert.equal(done.verification_error.summary.schema_complete, mode === 'resume-unresolved');
            assert.equal(done.verification_error.summary.unresolved_count, mode === 'resume-unresolved' ? 1 : 0);
            blocked(done.after); assert.equal(done.status.active, true); zeroPackets(sentinels.counts);
        }
        child.assertRedacted();
    });
}
