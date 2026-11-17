import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateLocalIntegrationCapabilities } from '../services/integrationCapabilities.js';

const readyForReview = {
    sourcePlatform: 'pos',
    integrationEnabled: true,
    providerAvailable: true,
    subscriptionEntitled: true,
    connectionStatus: 'active',
    grantedScopes: [
        'wa_savana.notifications.send',
        'wa_savana.campaigns.send',
        'wa_savana.content.publish',
    ],
    canReview: true,
    scopeAuthorized: true,
};

test('POS, Catalog and Sawemly retain implemented request capabilities without declaring execution', () => {
    for (const sourcePlatform of ['pos', 'catalog', 'sawemly']) {
        const capabilities = evaluateLocalIntegrationCapabilities({
            ...readyForReview,
            sourcePlatform,
            account: { ready: true, in_scope: true, selected: true },
            balance: { sufficient: true },
            consent: { confirmed: true },
        });
        assert.equal(capabilities.length, 3);
        for (const capability of capabilities) {
            assert.equal(capability.visible, true);
            assert.equal(capability.can_request_review, true);
            assert.equal(capability.can_execute, false);
            assert.deepEqual(capability.execution_blockers.map(row => row.code), [
                'adapter_execution_not_implemented',
            ]);
            assert.equal(capability.execution_blockers[0].action, 'await_adapter');
        }
    }
    assert.deepEqual(evaluateLocalIntegrationCapabilities({ sourcePlatform: 'instagram' }), []);
});

test('unknown eligibility remains visible and blocked with simultaneous requirements', () => {
    const [capability] = evaluateLocalIntegrationCapabilities({ sourcePlatform: 'pos' });
    assert.equal(capability.can_view_requirements, true);
    assert.equal(capability.can_prepare_request, false);
    assert.equal(capability.can_request_review, false);
    assert.deepEqual(capability.review_blockers.map(row => row.code), [
        'integrations_disabled', 'provider_unavailable', 'subscription_unverified',
        'connection_inactive', 'review_permission_required', 'context_scope_unverified',
        'connection_scope_required',
    ]);
    assert.equal(capability.context_checks.scope_authorized, null);
    assert.equal(capability.context_checks.subscription_entitled, null);
});

test('subscription, link, actor and data scopes cannot substitute for one another', () => {
    for (const override of [
        { subscriptionEntitled: false },
        { connectionStatus: 'revoked' },
        { canReview: false },
        { scopeAuthorized: false },
        { providerAvailable: false },
        { grantedScopes: [] },
    ]) {
        for (const capability of evaluateLocalIntegrationCapabilities({ ...readyForReview, ...override })) {
            assert.equal(capability.can_request_review, false);
            assert.equal(capability.can_execute, false);
        }
    }
    const [pending] = evaluateLocalIntegrationCapabilities({
        ...readyForReview, connectionStatus: 'pending_authorization',
    });
    assert.equal(pending.review_blockers[0].code, 'connection_pending');
});

test('account, credit and consent requirements affect execution while preserving review preparation', () => {
    const [capability] = evaluateLocalIntegrationCapabilities({
        ...readyForReview,
        account: { selected: true, ready: true, in_scope: false, phone: '+218910000001' },
        balance: { sufficient: false },
        consent: { phone_e164: '+218910000001', confirmed: false },
    });
    assert.equal(capability.can_prepare_request, true);
    assert.equal(capability.can_request_review, true);
    assert.deepEqual(capability.execution_blockers.map(row => row.code), [
        'adapter_execution_not_implemented', 'account_unverified',
        'balance_insufficient', 'consent_unverified',
    ]);
    assert.equal(JSON.stringify(capability).includes('218910000001'), false);
});

test('truthy strings do not become verified scope, consent or account grants', () => {
    const [capability] = evaluateLocalIntegrationCapabilities({
        ...readyForReview,
        scopeAuthorized: 'true',
        account: { selected: 'true', ready: 'true', in_scope: 'true' },
        balance: { sufficient: 'true' },
        consent: { confirmed: 'true' },
    });
    assert.equal(capability.can_request_review, false);
    assert.equal(capability.context_checks.scope_authorized, null);
    assert.equal(capability.context_checks.consent_confirmed, null);
    assert.equal(capability.context_checks.account_ready, null);
});
