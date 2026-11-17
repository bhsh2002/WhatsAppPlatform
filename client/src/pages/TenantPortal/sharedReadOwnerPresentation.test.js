import assert from 'node:assert/strict';
import test from 'node:test';
import { savanaIntegrationMethods } from '../../api/savanaIntegrations.js';
import { ownerFixtureOverview, ownerFixtureStatus } from '../../../browser-tests/sharedReadOwnerFixture.js';
import { ownerCanDisconnect, ownerCanLogin, ownerCanOverview, ownerChoicesForScope, ownerMutationsHeld, ownerOverviewIsValid, ownerScopeIsValid, ownerSetupError, ownerStatusIsValid } from './sharedReadOwnerPresentation.js';

test('review connection is separate from role, identity and current action authorization', () => {
    const status = ownerFixtureStatus('connected');
    assert.equal(ownerStatusIsValid(status), true);
    assert.equal(ownerCanOverview(status), true);
    assert.equal(ownerCanLogin(ownerFixtureStatus('disabled')), false);
    assert.equal(ownerCanDisconnect({ ...status, actions: { ...status.actions, disconnect: false }, local_role: 'owner', oidc_connected: true }), false);
    assert.equal(ownerCanOverview({ ...status, session: { ...status.session, expires_at: '2000-01-01T00:00:00Z' } }), false);
    assert.equal(ownerStatusIsValid({ ...status, execution_ready: true }), false);
    assert.equal(ownerStatusIsValid({ ...status, native_reference: undefined }), false);
    assert.equal(ownerStatusIsValid({ ...status, native_reference: 'browser-account-guess' }), false);
    assert.equal(ownerStatusIsValid({ ...status, intents: { ...status.intents, unknown_count: '1' } }), false);
});

test('unknown or inflight intent holds all new mutations despite contradictory action flags', () => {
    const status = ownerFixtureStatus('connected');
    for (const intents of [{ unknown_count: 1, inflight_count: 0, mutations_blocked: false },
        { unknown_count: 0, inflight_count: 1, mutations_blocked: false }, { unknown_count: 0, inflight_count: 0, mutations_blocked: true }]) {
        const held = { ...status, intents, actions: { login: true, disconnect: true, overview: true } };
        assert.equal(ownerMutationsHeld(held), true);
        assert.equal(ownerCanLogin(held), false);
        assert.equal(ownerCanDisconnect(held), false);
        assert.equal(ownerCanOverview(held), true);
    }
});

test('overview binds fresh owner actor and exact scope without parent-scope fallback', () => {
    const overview = ownerFixtureOverview();
    const scope = overview.options.scopes[0].scope;
    assert.equal(ownerOverviewIsValid(overview), true);
    assert.equal(ownerScopeIsValid({ ...scope, warehouse_id: 'warehouse', branch_id: null }, scope.organization_id), false);
    assert.equal(ownerOverviewIsValid({ ...overview, context: { ...overview.context, actor_id: 'different-account' } }), false);
    assert.equal(ownerOverviewIsValid({ ...overview, context: { ...overview.context, valid_until: '2000-01-01T00:00:00Z' } }), false);
    assert.equal(ownerChoicesForScope(overview, { ...scope, branch_id: 'unapproved-child' }), null);
    assert.equal(ownerChoicesForScope(overview, overview.options.scopes[1].scope).consumers.length, 0);
    assert.equal(ownerChoicesForScope(overview, scope).consumers.length, 1);
});

test('pending v2 preserves distinct effective v1 and rejects invalid versions or grant claims', () => {
    const overview = ownerFixtureOverview();
    assert.equal(ownerOverviewIsValid(overview), true);
    assert.equal(overview.requests[0].version, 2);
    assert.equal(overview.requests[0].effective_version, 1);
    for (const changes of [{ version: Number.MAX_SAFE_INTEGER + 1 }, { effective_version: 3 }, { effective_version: 1, effective_resource: null },
        { proposal: { ...overview.requests[0].proposal, fields: ['name', 'unsupported'] } }]) {
        assert.equal(ownerOverviewIsValid({ ...overview, requests: [{ ...overview.requests[0], ...changes }] }), false);
    }
    assert.equal(ownerOverviewIsValid({ ...overview, requests: [{ ...overview.requests[0], state: 'rejected' }] }), true);
});

test('owner session API accepts only login credentials and static local intent, never grants or HMAC', async () => {
    const calls = [];
    const client = { request: (...args) => { calls.push(args); return {}; } };
    await savanaIntegrationMethods.getPortalSharedReadOwnerStatus.call(client);
    await savanaIntegrationMethods.loginPortalSharedReadOwner.call(client, { username: 'synthetic-user', password: 'synthetic-password', mfa_code: '123456', actor_id: 'injected', owner: true, hmac_key: 'do-not-forward' });
    await savanaIntegrationMethods.disconnectPortalSharedReadOwner.call(client, { revoke_grants: true });
    await savanaIntegrationMethods.getPortalSharedReadOwnerOverview.call(client);
    assert.deepEqual(JSON.parse(calls[1][1].body), { username: 'synthetic-user', password: 'synthetic-password', mfa_code: '123456' });
    assert.deepEqual(calls[1][1].headers, { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' });
    assert.equal(calls[1][0].includes('password'), false);
    assert.deepEqual(JSON.parse(calls[2][1].body), {});
    assert.equal(calls[0][0], '/api/portal/integrations/shared-read-setup/owner');
    assert.equal(calls[3][0], '/api/portal/integrations/shared-read-setup/owner/overview');
    assert.equal(ownerSetupError({ status: 403, message: 'DO_NOT_RENDER_SECRET' }, 'en').includes('DO_NOT_RENDER_SECRET'), false);
});
