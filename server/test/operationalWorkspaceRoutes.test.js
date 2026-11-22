import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createOperationalWorkspaceRouter } from '../routes/operationalWorkspace.js';
import { SharedProductReadError } from '../services/centralProductRead.js';

const fixture = async t => {
    const calls = [];
    const methods = ['overview', 'select', 'reviewActivity', 'reviewProvider', 'reviewConnection', 'reviewProduct',
        'submit', 'records', 'record', 'commands', 'command', 'approve', 'approveRequest', 'reconcileCommand', 'intent', 'reconcileIntent', 'result',
        'resourceOfferings', 'resourceOffering', 'resourceProduct', 'resourcePreview', 'bindingAuthorization'];
    let failure;
    const service = Object.fromEntries(methods.map(method => [method, async (principal, input) => {
        calls.push({ method, principal, input });
        if (failure) throw failure;
        if (method === 'resourcePreview') {
            const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
            return { bytes, contentType: 'image/png', sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                validUntil: new Date(Date.now() + 5000).toISOString() };
        }
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

test('binding authorization: read-only local endpoint forwards only the original opaque attempt and rejects query/body authority', async t => {
    const f = await fixture(t);
    const response = await fetch(`${f.base}/intents/wr1.original_attempt/binding-authorization`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(f.calls[0].method, 'bindingAuthorization'); assert.deepEqual(f.calls[0].input, { intent: 'wr1.original_attempt' });
    assert.equal(f.calls[0].principal.userId, 8);
    for (const query of ['state=browser-state', 'authorization_url=https://foreign.invalid', 'external_tenant_id=browser-tenant', 'actor_id=browser-actor']) {
        assert.equal((await fetch(`${f.base}/intents/wr1.original_attempt/binding-authorization?${query}`)).status, 422);
    }
    const bodyStatus = await new Promise((resolve, reject) => {
        const body = JSON.stringify({ state: 'browser-state' });
        const request = http.request(`${f.base}/intents/wr1.original_attempt/binding-authorization`, { method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, result => {
            result.resume(); result.once('end', () => resolve(result.statusCode));
        });
        request.once('error', reject); request.end(body);
    });
    assert.equal(bodyStatus, 422); assert.equal(f.calls.length, 1);
    f.fail(new SharedProductReadError('workspace_binding_authorization_unavailable', 409));
    const denied = await fetch(`${f.base}/intents/wr1.original_attempt/binding-authorization`);
    assert.equal(denied.status, 409); assert.equal((await denied.json()).clear_previous, true);
});

test('nonbinding recovery: current-owner not-applicable discriminator remains distinct from generic invalid input', async t => {
    const f = await fixture(t);
    f.fail(new SharedProductReadError('workspace_binding_authorization_not_applicable', 422));
    const response = await fetch(`${f.base}/intents/wr1.original_activity/binding-authorization`), value = await response.json();
    assert.equal(response.status, 422); assert.equal(value.error.code, 'workspace_binding_authorization_not_applicable');
    assert.equal(value.clear_previous, true); assert.equal(response.headers.get('cache-control'), 'no-store');
    const invalid = await fetch(`${f.base}/intents/wr1.original_activity/binding-authorization?state=browser-state`);
    assert.equal(invalid.status, 422); assert.equal((await invalid.json()).error.code, 'workspace_request_invalid');
    assert.equal(f.calls.length, 1);
});

test('shared resource reads forward opaque selectors only and private media is authenticated no-store bytes', async t => {
    const f = await fixture(t);
    for (const [path, method, input] of [
        ['/resources?activity=opaque-activity&provider=opaque-provider&q=service', 'resourceOfferings', { activity: 'opaque-activity', provider: 'opaque-provider', q: 'service' }],
        ['/resources/wr1.resource?activity=opaque-activity', 'resourceOffering', { activity: 'opaque-activity', resource: 'wr1.resource' }],
        ['/records/wr1.product/resource?activity=opaque-activity', 'resourceProduct', { activity: 'opaque-activity', record: 'wr1.product' }],
    ]) {
        assert.equal((await fetch(`${f.base}${path}`)).status, 200);
        assert.deepEqual(f.calls.at(-1).input, input); assert.equal(f.calls.at(-1).method, method);
    }
    const response = await fetch(`${f.base}/resource-media/wr1.preview?activity=opaque-activity`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), response.headers.get('x-savana-preview-sha256'));
    assert.ok(Date.parse(response.headers.get('x-savana-preview-valid-until')) > Date.now());
    const before = f.calls.length;
    for (const path of ['/resources?source_installation_id=browser', '/resources/wr1.resource?fields=price',
        '/resource-media/wr1.preview?ticket=browser-ticket', '/records/wr1.product/resource?rights_reference=browser-rights']) {
        assert.equal((await fetch(`${f.base}${path}`)).status, 422);
    }
    assert.equal(f.calls.length, before);
    f.fail(new SharedProductReadError('workspace_resource_read_expired', 403));
    const withdrawn = await fetch(`${f.base}/resource-media/wr1.preview?activity=opaque-activity`);
    assert.equal(withdrawn.status, 403); assert.equal(withdrawn.headers.get('cache-control'), 'no-store');
    assert.equal((await withdrawn.json()).clear_previous, true);
});

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
