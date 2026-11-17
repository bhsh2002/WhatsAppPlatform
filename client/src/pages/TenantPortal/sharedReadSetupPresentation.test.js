import assert from 'node:assert/strict';
import test from 'node:test';
import { savanaIntegrationMethods } from '../../api/savanaIntegrations.js';
import { sharedReadAuthorizationUrl, sharedReadCanAuthorize, sharedReadCanDisconnect, sharedReadCanEnroll, sharedReadDisconnectIsValid, sharedReadEffectiveSessionState, sharedReadEnrollmentIsValid, sharedReadEnrollmentLabel, sharedReadSessionLabel, sharedReadSetupError, sharedReadSetupIsValid } from './sharedReadSetupPresentation.js';

const setup = overrides => ({ enabled: true, read_ready: false, read_only: true, execution_ready: false, pricing_use_allowed: false,
    session: { state: 'disconnected' }, requests: [], options: {}, actions: { authorize: true, disconnect: false }, ...overrides });
const enrollment = overrides => ({ state: 'unregistered', enrollment: null, requires_reconciliation: false,
    reconciliation_available: false, grants_created: false, ...overrides });

test('setup requires an explicit read-only document and a known server session state', () => {
    assert.equal(sharedReadSetupIsValid(setup()), true);
    for (const mutation of [{ enabled: 'true' }, { read_ready: undefined }, { read_ready: 'true' }, { read_only: false }, { execution_ready: true }, { pricing_use_allowed: true },
        { session: { state: 'ready_from_local_owner_role' } }, { session: { state: 'connected', expires_at: 'invalid' } },
        { requests: null }, { actions: { authorize: 'true', disconnect: false } }, { actions: { authorize: true, disconnect: 'true' } }]) {
        assert.equal(sharedReadSetupIsValid(setup(mutation)), false);
    }
});

test('optional enrollment status requires explicit public state and no grant claim', () => {
    assert.equal(sharedReadSetupIsValid(setup()), true);
    for (const state of ['unregistered', 'prepared', 'inflight', 'unknown', 'failed']) {
        assert.equal(sharedReadEnrollmentIsValid(enrollment({ state })), true);
        assert.equal(typeof sharedReadEnrollmentLabel(state, 'ar'), 'string');
    }
    const completed = enrollment({ state: 'completed', enrollment: { enrollment_id: 'synthetic-enrollment', version: 1 } });
    assert.equal(sharedReadEnrollmentIsValid(completed), true);
    assert.ok(sharedReadEnrollmentLabel('completed', 'en').includes('no read grants'));
    for (const mutation of [{ state: 'approved' }, { grants_created: true }, { reconciliation_available: true },
        { requires_reconciliation: 'false' }, { state: 'completed', enrollment: null },
        { enrollment: { enrollment_id: 'synthetic-enrollment', version: 0 } }]) {
        assert.equal(sharedReadSetupIsValid(setup({ enrollment: enrollment(mutation) })), false);
    }
});

test('enrollment requires an enabled explicit action and a confirmed unregistered state', () => {
    const ready = setup({ enrollment: enrollment(), actions: { authorize: false, disconnect: true, enroll_consumer: true } });
    assert.equal(sharedReadCanEnroll(ready), true);
    assert.equal(sharedReadCanEnroll({ ...ready, enabled: false }), false);
    assert.equal(sharedReadCanEnroll({ ...ready, actions: { ...ready.actions, enroll_consumer: false }, local_role: 'owner' }), false);
    assert.equal(sharedReadCanEnroll({ ...ready, actions: { ...ready.actions, enroll_consumer: 'true' } }), false);
    assert.equal(sharedReadCanEnroll({ ...ready, enrollment: undefined }), false);
    assert.equal(sharedReadCanEnroll({ ...ready, enrollment: enrollment({ requires_reconciliation: true }) }), false);
});

test('pending, uncertain and completed enrollment never expose a submission retry', () => {
    for (const state of ['prepared', 'inflight', 'unknown', 'failed', 'completed']) {
        const status = enrollment({ state, ...(state === 'completed' ? { enrollment: { enrollment_id: 'synthetic-enrollment', version: 1 } } : {}) });
        assert.equal(sharedReadCanEnroll(setup({ enrollment: status, actions: { authorize: true, disconnect: true, enroll_consumer: true } })), false);
    }
});

test('a local owner or connected session is never itself a central grant', () => {
    for (const state of ['disconnected', 'authorizing', 'connected', 'unknown', 'expired', 'revoked']) {
        const document = setup({ session: { state }, local_role: 'owner', central_grant: true });
        assert.equal(typeof sharedReadSessionLabel(state, 'ar'), 'string');
        assert.equal(document.execution_ready, false);
        assert.equal(document.pricing_use_allowed, false);
    }
    assert.ok(sharedReadSessionLabel('connected', 'en').includes('does not grant reads'));
    assert.equal(sharedReadCanAuthorize(setup({ session: { state: 'authorizing' } })), false);
    assert.equal(sharedReadCanAuthorize(setup({ enabled: false })), false);
    assert.equal(sharedReadCanAuthorize(setup({ actions: { authorize: false, disconnect: false }, local_role: 'owner' })), false);
    assert.equal(sharedReadCanAuthorize(setup({ session: { state: 'expired' } })), true);
    assert.equal(sharedReadEffectiveSessionState(setup({ session: { state: 'connected', expires_at: '2026-11-17T12:00:00Z' } }), Date.parse('2026-11-17T12:00:01Z')), 'expired');
});

test('local disconnect requires the enabled setup gate and explicit server action flag', () => {
    for (const state of ['authorizing', 'connected', 'unknown', 'expired', 'revoked']) {
        assert.equal(sharedReadCanDisconnect(setup({ session: { state }, actions: { authorize: false, disconnect: true } })), true);
        assert.equal(sharedReadCanDisconnect(setup({ enabled: false, session: { state }, actions: { authorize: false, disconnect: true } })), false);
        assert.equal(sharedReadCanDisconnect(setup({ session: { state }, local_role: 'owner' })), false);
    }
    assert.equal(sharedReadCanDisconnect(setup({ actions: { authorize: true, disconnect: 'true' } })), false);
    assert.equal(sharedReadCanDisconnect(null), false);
});

test('local disconnect acknowledgement cannot claim central grant or publisher key revocation', () => {
    const result = { disconnected: true, central_read_grant_revoked: false, source_publisher_key_revoked: false,
        read_only: true, execution_ready: false, pricing_use_allowed: false };
    assert.equal(sharedReadDisconnectIsValid(result), true);
    for (const mutation of [{ disconnected: false }, { central_read_grant_revoked: true }, { source_publisher_key_revoked: true },
        { central_read_grant_revoked: undefined }, { execution_ready: true }, { pricing_use_allowed: true }, { read_only: false }]) {
        assert.equal(sharedReadDisconnectIsValid({ ...result, ...mutation }), false);
    }
});

test('authorization navigation accepts HTTPS or owned loopback but never script/data/credential URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,secret', 'http://public.invalid/authorize',
        'https://user:password@center.invalid/authorize', 'https://center.invalid/#access_token=secret',
        'https://center.invalid/authorize?client_secret=secret', 'https://center.invalid/authorize?ACCESS_TOKEN=secret', '', null]) {
        assert.equal(sharedReadAuthorizationUrl(value), null);
    }
    assert.equal(sharedReadAuthorizationUrl('https://center.invalid/authorize?state=opaque'), 'https://center.invalid/authorize?state=opaque');
    assert.equal(sharedReadAuthorizationUrl('http://127.0.0.1:32123/authorize?state=opaque'), 'http://127.0.0.1:32123/authorize?state=opaque');
});

test('unavailable setup explains lost verification without granting authority or treating it as deletion', () => {
    for (const status of [401, 403, 409, 503]) assert.equal(typeof sharedReadSetupError({ status }, 'ar'), 'string');
    assert.ok(sharedReadSetupError({ status: 403 }, 'en').includes('not authorized'));
    assert.ok(sharedReadSetupError({ status: 503 }, 'en').includes('No local grant'));
    assert.ok(sharedReadSetupError({ data: { error: { code: 'shared_product_reads_disabled' } } }, 'en').includes('does not create'));
});

test('setup and authorization APIs accept no browser-supplied central grant, token, scope or role', async () => {
    const calls = [];
    const client = { request: (...args) => { calls.push(args); return {}; } };
    await savanaIntegrationMethods.getPortalSharedReadSetup.call(client, { local_role: 'owner', access_token: 'secret' });
    await savanaIntegrationMethods.authorizePortalSharedRead.call(client, { grant: true, scope: '*', access_token: 'secret' });
    await savanaIntegrationMethods.disconnectPortalSharedRead.call(client, { revoke_central_grant: true, revoke_publisher: true });
    await savanaIntegrationMethods.enrollPortalSharedReadConsumer.call(client, { organization_id: 'browser-choice', external_tenant_id: 'browser-choice', public_key_pem: 'browser-key', grants: ['*'] });
    assert.deepEqual(calls, [
        ['/api/portal/integrations/shared-read-setup'],
        ['/api/portal/integrations/shared-read-setup/authorization', { method: 'POST', headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' } }],
        ['/api/portal/integrations/shared-read-setup/disconnect', { method: 'POST', headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' } }],
        ['/api/portal/integrations/shared-read-setup/enrollment', { method: 'POST', headers: { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' } }],
    ]);
});
