import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateLocalIntegrationCapabilities, projectScopedCapabilityActions as rawProjectScopedCapabilityActions } from '../services/integrationCapabilities.js';

const handler = (code, action = 'execute') => ({ platform: 'wa_savana', capability_code: code, action,
    handler_registered: true, configured: true, supported_contract_versions: ['1.0'], reason: 'qualified_native_handler',
    next_action: action, action_url: `https://wa.example.test/owner-actions/${code}/${action}`,
    owner_action_allowlist: ['https://wa.example.test/owner-actions'] });
const codeFor = id => ({ 'wa_savana.notifications.send': 'messaging.send', 'wa_savana.campaigns.send': 'campaigns.execute', 'wa_savana.content.publish': 'content.publish' })[id];
const projectScopedCapabilityActions = input => rawProjectScopedCapabilityActions({ ...input,
    actions: input.actions?.map(action => ({ ...action, facts: {
        handler_readiness: handler(input.capability_code, action.readiness_action || 'execute'), ...action.facts,
    } })),
});
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
    reviewReadiness: Object.fromEntries(['wa_savana.notifications.send','wa_savana.campaigns.send','wa_savana.content.publish'].map(id => [id, handler(codeFor(id), 'request_review')])),
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

const checkedAt = '2026-11-18T10:00:00.000Z';
const now = Date.parse(checkedAt);
const fresh = () => ({
    handler_registered: true, handler_qualified: true, deployment_ready: true,
    actor_authorized: true, review_authorized: true, resource_authorized: true,
    channel: 'sms', channel_implemented: true, provider_selected: true, provider_ready: true,
    recipient_ready: true, content_ready: true, consent_confirmed: true, budget_sufficient: true,
    outcome_clear: true, data_fresh: true, checked_at: checkedAt,
    valid_until: '2026-11-18T10:00:30.000Z',
});
const descriptors = ['wa_savana.notifications.send', 'wa_savana.campaigns.send', 'wa_savana.content.publish'];
const qualified = override => ({ ...readyForReview, now,
    capabilityFacts: Object.fromEntries(descriptors.map(id => [id, { ...fresh(), execution_readiness: handler(codeFor(id)), review_readiness: handler(codeFor(id), 'request_review'), ...override }])),
});

test('qualified actual handlers can execute while legacy scope IDs map explicitly to canonical capabilities', () => {
    const rows = evaluateLocalIntegrationCapabilities(qualified());
    assert.deepEqual(rows.map(row => row.capability_code), ['messaging.send', 'campaigns.execute', 'content.publish']);
    assert.deepEqual(rows.map(row => row.review_capability_code), ['messaging.review', 'campaigns.review', 'content.review']);
    for (const row of rows) {
        assert.equal(row.implementation, 'implemented'); assert.equal(row.can_execute, true);
        assert.equal(row.can_request_review, true); assert.deepEqual(row.execution_blockers, []);
        assert.equal(row.checked_at, checkedAt);
    }
});

test('registered implementation alone cannot qualify a provider, account, approval, budget or destination', () => {
    const checks = ['handler_qualified', 'deployment_ready', 'actor_authorized', 'resource_authorized',
        'channel_implemented', 'provider_selected', 'provider_ready', 'content_ready', 'consent_confirmed',
        'budget_sufficient', 'outcome_clear', 'data_fresh', 'recipient_ready'];
    for (const check of checks) {
        const [row] = evaluateLocalIntegrationCapabilities(qualified({ [check]: false }));
        assert.equal(row.can_execute, false, check);
        assert.ok(row.execution_blockers.every(reason => reason.destination.path.startsWith('/portal/')));
    }
    const [registeredOnly] = evaluateLocalIntegrationCapabilities(qualified({
        ...Object.fromEntries(checks.map(check => [check, undefined])), handler_registered: true,
    }));
    assert.equal(registeredOnly.can_execute, false);
    assert.equal(registeredOnly.context_checks.account_ready, null);
});

test('content publication has no recipient prerequisite and one capability cannot green another', () => {
    const input = qualified({ recipient_ready: false });
    const [notification, campaign, publication] = evaluateLocalIntegrationCapabilities(input);
    assert.equal(notification.can_execute, false); assert.equal(campaign.can_execute, false);
    assert.equal(publication.can_execute, true);
    input.capabilityFacts[descriptors[0]].budget_sufficient = false;
    input.capabilityFacts[descriptors[1]].recipient_ready = true;
    assert.equal(evaluateLocalIntegrationCapabilities(input)[1].can_execute, true);
});

test('request-review permission and approved execution authority do not substitute for each other', () => {
    const [requester] = evaluateLocalIntegrationCapabilities(qualified({ actor_authorized: false }));
    assert.equal(requester.can_request_review, true); assert.equal(requester.can_execute, false);
    const [executor] = evaluateLocalIntegrationCapabilities(qualified({ review_authorized: false }));
    assert.equal(executor.can_request_review, false); assert.equal(executor.can_execute, true);
});

test('subscription errors, unknown verification, expiry and genuine plan denial have distinct repairs', () => {
    const cases = [
        [{ error: true }, 'subscription_verification_unavailable'],
        [{ verified: false }, 'subscription_unverified'],
        [{ verified: true, entitled: true, expires_at: checkedAt }, 'subscription_expired'],
        [{ bound: false }, 'organization_unbound'],
        [{ verified: true, entitled: false, expires_at: '2026-11-18T10:30:00Z' }, 'subscription_required'],
    ];
    for (const [subscription, code] of cases) {
        const [row] = evaluateLocalIntegrationCapabilities({ ...qualified(), subscription });
        assert.equal(row.can_execute, false);
        assert.ok(row.review_blockers.some(reason => reason.code === code));
        if (code !== 'subscription_required') assert.ok(!row.review_blockers.some(reason => reason.code === 'subscription_required'));
    }
});

test('failed platform discovery is not reported as an absent provider', () => {
    for (const [platformDiscovery, code] of [
        [{ error: true }, 'platform_discovery_unavailable'],
        [{ verified: true, available: false }, 'provider_not_offered'],
        [{ verified: false }, 'platform_discovery_unverified'],
    ]) {
        const [row] = evaluateLocalIntegrationCapabilities({ ...qualified(), platformDiscovery });
        assert.ok(row.review_blockers.some(reason => reason.code === code));
        assert.equal(row.can_execute, false);
        assert.equal(row.context_checks.provider_available, code === 'provider_not_offered' ? false : null);
    }
});

test('readiness expires at its boundary and stale or future facts never retain green account checks', () => {
    for (const timestamps of [
        { valid_until: checkedAt },
        { checked_at: '2026-11-18T09:59:29.000Z', valid_until: '2026-11-18T11:00:00Z' },
        { checked_at: '2026-11-18T10:00:00.001Z' },
    ]) {
        const [row] = evaluateLocalIntegrationCapabilities(qualified(timestamps));
        assert.equal(row.can_execute, false); assert.equal(row.context_checks.readiness_current, false);
        assert.equal(row.context_checks.account_ready, null); assert.equal(row.valid_until, null);
    }
    const [bounded] = evaluateLocalIntegrationCapabilities(qualified({ valid_until: '2026-11-18T11:00:00Z' }));
    assert.equal(bounded.valid_until, '2026-11-18T10:00:30.000Z');
});

test('projection exposes no provider credentials, raw account/recipient data, or cached request bodies', () => {
    const [row] = evaluateLocalIntegrationCapabilities(qualified({
        token: 'synthetic-private-token', account_id: 'synthetic-private-account',
        phone: '+218910009999', payload: { customer: 'synthetic-private-customer' },
    }));
    for (const value of ['synthetic-private-token', 'synthetic-private-account', '+218910009999', 'synthetic-private-customer']) {
        assert.equal(JSON.stringify(row).includes(value), false);
    }
});

const scopedFacts = override => ({ ...fresh(), native_account_bound: true, consumer_selected: true,
    scope_granted: true, field_permissions_verified: true, field_authority_verified: true,
    source_authorized: true, source_handler_ready: true, expected_version_current: true,
    idempotency_valid: true, approved_payload_current: true, purpose_confirmed: true,
    receipt_correlated: true, command_identity_verified: true, ...override });
const scopedAction = (action, effect, required_checks, override) => ({ action, effect, required_checks, facts: scopedFacts(override) });

test('shared product viewing can display stale data without gaining write or price authority', () => {
    const row = projectScopedCapabilityActions({ capability_code: 'products.read', now,
        actions: [scopedAction('search', 'read', ['resource_authorized', 'native_account_bound', 'consumer_selected', 'scope_granted', 'field_permissions_verified'],
            { data_fresh: false, freshness: 'stale', provider_selected: false, recipient_ready: false, budget_sufficient: false })] });
    assert.equal(row.actions[0].can_execute, true); assert.equal(row.actions[0].freshness, 'stale');
    assert.equal(row.actions[0].effect, 'read'); assert.equal(row.can_execute, undefined);
});

test('requesting product review does not grant authoritative apply or require an existing final write grant', () => {
    const checks = ['resource_authorized', 'field_authority_verified', 'expected_version_current', 'idempotency_valid'];
    const row = projectScopedCapabilityActions({ capability_code: 'products.write', now, actions: [
        scopedAction('request_review', 'write', checks, { source_authorized: false }),
        scopedAction('apply', 'write', [...checks, 'source_authorized', 'source_handler_ready', 'approved_payload_current'], { source_authorized: false }),
    ] });
    assert.equal(row.actions[0].can_execute, true); assert.equal(row.actions[1].can_execute, false);
    assert.ok(row.actions[1].blockers.some(item => item.code === 'authoritative_source_required'));
});

test('Catalog-owned media requires its field source rather than a native WA channel account', () => {
    const row = projectScopedCapabilityActions({ capability_code: 'media.manage', now, actions: [
        scopedAction('upload', 'write', ['resource_authorized', 'field_authority_verified', 'source_handler_ready', 'content_ready'], { provider_selected: false }),
    ] });
    assert.equal(row.actions[0].can_execute, true);
    const denied = projectScopedCapabilityActions({ capability_code: 'media.manage', now, actions: [
        scopedAction('upload', 'write', ['resource_authorized', 'field_authority_verified', 'source_handler_ready', 'content_ready'], { field_authority_verified: false }),
    ] });
    assert.equal(denied.actions[0].can_execute, false);
});

test('customer purpose/consent and owner receipt reconciliation are particular action requirements', () => {
    const customer = projectScopedCapabilityActions({ capability_code: 'customers.manage', now, actions: [
        scopedAction('list', 'read', ['resource_authorized', 'field_permissions_verified'], { consent_confirmed: false }),
        scopedAction('export', 'read', ['resource_authorized', 'field_permissions_verified', 'purpose_confirmed', 'consent_confirmed'], { consent_confirmed: false }),
    ] });
    assert.equal(customer.actions[0].can_execute, true); assert.equal(customer.actions[1].can_execute, false);
    const owner = projectScopedCapabilityActions({ capability_code: 'owner.operations', now, actions: [
        scopedAction('status', 'read', ['resource_authorized'], { outcome_clear: false }),
        scopedAction('reconcile', 'write', ['resource_authorized', 'receipt_correlated', 'command_identity_verified'], { receipt_correlated: false }),
    ] });
    assert.equal(owner.actions[0].can_execute, true); assert.equal(owner.actions[1].can_execute, false);
});

test('generic action projection refuses missing/unknown policy and preserves unavailable capabilities', () => {
    let row = projectScopedCapabilityActions({ capability_code: 'products.read', now, actions: [] });
    assert.equal(row.visible, true); assert.equal(row.blockers[0].code, 'capability_actions_unavailable');
    row = projectScopedCapabilityActions({ capability_code: 'products.read', now, actions: [{ action: 'search', effect: 'read', facts: scopedFacts() }] });
    assert.equal(row.actions[0].can_execute, false);
    row = projectScopedCapabilityActions({ capability_code: 'products.read', now, actions: [scopedAction('search', 'read', ['unregistered_custom_gate'])] });
    assert.equal(row.actions[0].can_execute, false);
    assert.throws(() => projectScopedCapabilityActions({ capability_code: 'invented.capability', actions: [] }));
});

test('a true entitlement flag never bypasses a failed or expired authoritative subscription check', () => {
    for (const [subscription, code] of [
        [{ error: true }, 'subscription_verification_unavailable'],
        [{ verified: true, entitled: true, expires_at: checkedAt }, 'subscription_expired'],
        [{}, 'subscription_unverified'],
    ]) {
        const row = projectScopedCapabilityActions({ capability_code: 'media.manage', now, actions: [
            scopedAction('upload', 'write', ['subscription_entitled'], { subscription_entitled: true, subscription }),
        ] });
        assert.equal(row.actions[0].can_execute, false); assert.ok(row.actions[0].blockers.some(item => item.code === code));
    }
});

test('canonical availability prioritizes actual implementation proof over a plan purchase prompt', () => {
    const [missing] = evaluateLocalIntegrationCapabilities({ ...qualified({ execution_readiness: null }), executionReadiness: undefined,
        subscriptionEntitled: false, reviewReadiness: undefined,
        capabilityFacts: { [descriptors[0]]: { ...fresh(), execution_readiness: null, review_readiness: null } } });
    assert.equal(missing.availability.state, 'implementation_missing'); assert.equal(missing.can_execute, false);
    assert.notEqual(missing.availability.next_action.code, 'view_subscription');
    assert.deepEqual(Object.keys(missing.availability).sort(), ['message', 'next_action', 'reason_code', 'state']);
    assert.deepEqual(Object.keys(missing.availability.next_action).sort(), ['code', 'href', 'label']);
});

test('a genuinely available review action stays distinct from external execution', () => {
    const [row] = evaluateLocalIntegrationCapabilities({ ...qualified({ execution_readiness: null }), executionReadiness: undefined });
    assert.equal(row.availability.state, 'review_available'); assert.equal(row.can_request_review, true); assert.equal(row.can_execute, false);
    const [relative] = evaluateLocalIntegrationCapabilities(qualified({ execution_readiness: { ...handler('messaging.send'),
        action_url: '/?workspace=shared&action=message.send', owner_action_allowlist: [] } }));
    assert.equal(relative.execution_availability.state, 'available');
});

test('generic self-links, foreign hosts, lookalike paths and unsafe action URLs cannot establish readiness', () => {
    const urls = [
        'https://wa.example.test/portal/integrations', '/?workspace=shared',
        'https://outside.example.test/owner-actions/message.send', 'http://wa.example.test/owner-actions/message.send',
        'https://wa.example.test/owner-actions-evil/message.send', 'https://user:password@wa.example.test/owner-actions/message.send',
        'https://wa.example.test/owner-actions/%2e%2e/private', 'https://wa.example.test/owner-actions/../private',
        'https://wa.example.test/owner-actions/message.send\n', '//wa.example.test/owner-actions/message.send',
    ];
    for (const action_url of urls) {
        const [row] = evaluateLocalIntegrationCapabilities(qualified({ execution_readiness: { ...handler('messaging.send'), action_url } }));
        assert.equal(row.execution_availability.state, 'configuration_required', action_url);
        assert.equal(row.can_execute, false);
    }
});

test('handler platform/capability/action binding and supported contracts are independently required', () => {
    for (const wrong of [{ platform: 'catalog' }, { capability_code: 'campaigns.execute' }, { action: 'request_review' }]) {
        const [row] = evaluateLocalIntegrationCapabilities(qualified({ execution_readiness: { ...handler('messaging.send'), ...wrong } }));
        assert.equal(row.execution_availability.state, 'implementation_missing');
    }
    const [unsupported] = evaluateLocalIntegrationCapabilities(qualified({ execution_readiness: { ...handler('messaging.send'), supported_contract_versions: ['0.9'] } }));
    assert.equal(unsupported.execution_availability.state, 'not_supported');
});

test('canonical connection states distinguish paused and revoked from a missing connection', () => {
    for (const state of ['paused', 'revoked']) {
        const [row] = evaluateLocalIntegrationCapabilities({ ...qualified(), connectionStatus: state });
        assert.equal(row.execution_availability.state, `connection_${state}`); assert.equal(row.can_execute, false);
    }
});
