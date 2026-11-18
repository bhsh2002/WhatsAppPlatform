import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createOperationalWorkspaceRouter } from '../routes/operationalWorkspace.js';
import { SharedProductReadError } from '../services/centralProductRead.js';

const fixture = async t => {
    const calls = [];
    const methods = ['overview', 'select', 'reviewActivity', 'reviewProvider', 'reviewConnection', 'reviewProduct',
        'submit', 'records', 'record', 'commands', 'command', 'approve', 'approveRequest', 'reconcileCommand', 'intent', 'reconcileIntent', 'result'];
    let failure;
    const service = Object.fromEntries(methods.map(method => [method, async (principal, input) => {
        calls.push({ method, principal, input });
        if (failure) throw failure;
        if (method === 'result') {
            const bytes = Buffer.from('"اسم","الحالة"\r\n"عميل تجريبي","مؤكد"\r\n');
            return { bytes, contentType: 'text/csv', sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
        }
        return { state: 'synthetic-route-only' };
    }]));
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 8, tenant_id: 4, jti: 'actual-native-auth-middleware',
        auth_version: 2, role: 'tenant', exp: 2_000_000_000 }; next(); });
    app.use('/api/portal/integrations', createOperationalWorkspaceRouter({ service, appOrigin: 'https://wa.invalid' }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}/api/portal/integrations/workspace`;
    const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { calls, base, post, fail: value => { failure = value; } };
};
const intent = { 'X-Savana-Owner-Intent': 'connections-data-v1', Origin: 'https://wa.invalid' };

test('workspace mutations require explicit current-origin intent before any service is called', async t => {
    const f = await fixture(t);
    for (const headers of [{}, { ...intent, Origin: 'https://foreign.invalid' },
        { ...intent, 'X-Savana-Owner-Intent': 'shared-read-setup-v1' }]) {
        assert.equal((await f.post('/submit', { review: 'opaque_review' }, headers)).status, 403);
    }
    assert.equal(f.calls.length, 0);
    const result = await f.post('/submit', { review: 'opaque_review' }, intent);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(f.calls[0].principal.userId, 8);
    assert.equal(f.calls[0].principal.tenantId, 4);
    assert.deepEqual(f.calls[0].input, { review: 'opaque_review' });
});

test('browser identities, versions, scopes and replacement review payloads cannot enter the service', async t => {
    const f = await fixture(t);
    for (const extra of [{ actor_id: 'browser-owner' }, { organization_id: 'browser-org' }, { approved: true },
        { expected_version: 5 }, { fields: { price: 'changed-after-review' } }, { scope: {} }]) {
        assert.equal((await f.post('/submit', { review: 'opaque_review', ...extra }, intent)).status, 422);
    }
    assert.equal((await fetch(`${f.base}?organization_id=browser-org`)).status, 422);
    assert.equal((await fetch(`${f.base}/records?activity=opaque&consumer_installation_id=browser-installation`)).status, 422);
    assert.equal((await f.post('/commands/opaque/approve', { expected_version: 5 }, intent)).status, 422);
    assert.equal(f.calls.length, 0);
});

test('unknown outcomes stay explicit and internal failures never disclose credentials or payloads', async t => {
    const f = await fixture(t);
    f.fail(new SharedProductReadError('workspace_outcome_unknown', 503));
    const result = await f.post('/submit', { review: 'opaque_review' }, intent);
    const body = await result.json();
    assert.equal(body.error.code, 'workspace_outcome_unknown');
    assert.equal(body.clear_previous, true);
    f.fail(new Error('synthetic-private-cookie-and-token'));
    const response = await fetch(f.base);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('private-cookie'), false);
});

test('approval forwards the exact preissued reference and never accepts an omitted or replacement authority body', async t => {
    const f = await fixture(t);
    for (const body of [{}, { intent: {} }, { intent: 'raw-core-id' }, { intent: 'wr1.current_review', expected_version: 3 }]) {
        assert.equal((await f.post('/commands/opaque/approve', body, intent)).status, 422);
    }
    assert.equal(f.calls.length, 0);
    assert.equal((await f.post('/commands/opaque/approve', { intent: 'wr1.current_review' }, intent)).status, 200);
    assert.deepEqual(f.calls[0].input, { command: 'opaque', intent: 'wr1.current_review' });
    assert.equal((await f.post('/requests/opaque/approve', { intent: 'wr1.current_request' }, intent)).status, 200);
    assert.deepEqual(f.calls[1].input, { request: 'opaque', intent: 'wr1.current_request' });
});

test('scoped result download preserves actual CSV bytes, digest, MIME and no-store and rejects scope injection', async t => {
    const f = await fixture(t);
    const response = await fetch(`${f.base}/commands/wr1.current_command/result?format=csv`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /^text\/csv/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), response.headers.get('x-savana-result-sha256'));
    assert.deepEqual(f.calls[0].input, { command: 'wr1.current_command', format: 'csv' });
    assert.equal((await fetch(`${f.base}/commands/wr1.current_command/result?format=csv&organization_id=foreign`)).status, 422);
    assert.equal((await fetch(`${f.base}/commands/wr1.current_command/result?format=html`)).status, 422);
    assert.equal(f.calls.length, 1);
    f.fail(new SharedProductReadError('workspace_command_read_forbidden', 403));
    const denied = await fetch(`${f.base}/commands/wr1.current_command/result?format=csv`);
    assert.equal(denied.status, 403); assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.equal((await denied.json()).clear_previous, true);
});
