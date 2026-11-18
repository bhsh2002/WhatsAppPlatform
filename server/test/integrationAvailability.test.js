import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntegrationAvailabilityService, createScopedCapabilityAvailabilityService, IntegrationAvailabilityError } from '../services/integrationAvailability.js';
import { LOCAL_REQUEST_CAPABILITIES } from '../services/integrationCapabilities.js';

const now = Date.parse('2026-11-18T10:00:00Z');
const principal = () => ({ userId: 7, tenantId: 3, sessionId: 'synthetic-native-jti', authVersion: 2,
    role: 'tenant', issuedAt: now / 1000 - 20, sessionExpiresAt: now / 1000 + 600 });
const facts = () => Object.fromEntries(LOCAL_REQUEST_CAPABILITIES.map(row => [row.capability_id, {
    handler_registered: true, handler_qualified: true, deployment_ready: true,
    actor_authorized: true, review_authorized: true, resource_authorized: true,
    channel: 'sms', provider_selected: true, provider_ready: true, recipient_ready: true,
    content_ready: true, consent_confirmed: true, budget_sufficient: true,
    outcome_clear: true, data_fresh: true, checked_at: new Date(now).toISOString(), valid_until: new Date(now + 30_000).toISOString(),
}]));
const handler = (code, action = 'execute') => ({ platform: 'wa_savana', capability_code: code, action,
    handler_registered: true, configured: true, supported_contract_versions: ['1.0'], reason: 'qualified_native_handler', next_action: action,
    action_url: `https://wa.example.test/owner-actions/${code}/${action}`, owner_action_allowlist: ['https://wa.example.test/owner-actions'] });
const registry = () => LOCAL_REQUEST_CAPABILITIES.map(row => ({ ...row,
    canonical_capability_id: row.capability_code, review_capability_id: row.review_capability_code,
    channels: ['sms'], implemented: true, execution_readiness: handler(row.capability_code), review_readiness: handler(row.capability_code, 'request_review'),
}));
const platform = () => ({ integrationEnabled: true, providerAvailable: true, subscriptionEntitled: true,
    connectionStatus: 'active', grantedScopes: LOCAL_REQUEST_CAPABILITIES.map(row => row.capability_id),
    canReview: true, scopeAuthorized: true,
    platformDiscovery: { verified: true, available: true },
    subscription: { verified: true, entitled: true, expires_at: new Date(now + 3600_000).toISOString() },
});
const make = overrides => createIntegrationAvailabilityService({ verifyPrincipal: () => true,
    loadPlatformFacts: platform, getRegistry: registry, getCapabilityFacts: facts, now: () => now, ...overrides });

test('actual registry and current scoped facts produce executable projections with repeated native identity checks', async () => {
    let checks = 0; const p = principal();
    const service = make({ verifyPrincipal: snapshot => { checks++; assert.equal(snapshot.tenantId, 3); return true; },
        getCapabilityFacts: context => { assert.equal(context.principal.userId, 7); assert.equal(context.platformCode, 'catalog'); return facts(); } });
    const rows = await service.forPlatform(p, 'catalog');
    assert.equal(checks, 4); assert.ok(rows.every(row => row.can_execute));
    assert.equal(rows[0].capability_code, 'messaging.send');
});

test('native principal changes during awaited platform lookup stop all later reads', async () => {
    const p = principal(); let registryReads = 0;
    const service = make({ loadPlatformFacts: async () => { await Promise.resolve(); p.tenantId = 99; return platform(); },
        getRegistry: () => { registryReads++; return registry(); } });
    await assert.rejects(service.forPlatform(p, 'catalog'), error => error instanceof IntegrationAvailabilityError && error.code === 'availability_principal_changed');
    assert.equal(registryReads, 0);
});

test('native revocation during capability verification rejects the final projection', async () => {
    let active = true;
    const service = make({ verifyPrincipal: () => active, getCapabilityFacts: async () => { active = false; return facts(); } });
    await assert.rejects(service.forPlatform(principal(), 'catalog'), { code: 'availability_principal_changed' });
});

test('platform/subscription lookup failure retains unknown business states instead of a missing plan', async () => {
    const rows = await make({ loadPlatformFacts: () => { throw new Error('synthetic-private-upstream-response'); } }).forPlatform(principal(), 'catalog');
    assert.ok(rows[0].review_blockers.some(row => row.code === 'platform_discovery_unavailable'));
    assert.ok(rows[0].review_blockers.some(row => row.code === 'subscription_verification_unavailable'));
    assert.ok(!rows[0].review_blockers.some(row => row.code === 'subscription_required'));
    assert.equal(JSON.stringify(rows).includes('synthetic-private-upstream-response'), false);
});

test('execution lookup failure never masquerades as an unimplemented handler or subscription denial', async () => {
    const rows = await make({ getCapabilityFacts: () => { throw new Error('synthetic-private-token'); } }).forPlatform(principal(), 'catalog');
    assert.ok(rows[0].execution_blockers.some(row => row.code === 'execution_readiness_unavailable'));
    assert.ok(!rows[0].execution_blockers.some(row => row.code === 'adapter_execution_not_implemented'));
    assert.equal(JSON.stringify(rows).includes('synthetic-private-token'), false);
});

test('SMS implementation cannot qualify WhatsApp or a mismatched selected channel', async () => {
    const getCapabilityFacts = () => Object.fromEntries(Object.entries(facts()).map(([id, row]) => [id, { ...row, channel: 'whatsapp' }]));
    let rows = await make({ getCapabilityFacts }).forPlatform(principal(), 'catalog');
    assert.ok(rows.every(row => !row.can_execute && row.execution_blockers.some(reason => reason.code === 'channel_selection_required')));
    rows = await make().forPlatform(principal(), 'catalog', { selection: { channel: 'messenger' } });
    assert.ok(rows.every(row => !row.can_execute));
});

test('wrong canonical mapping, duplicate registry rows and absent actual adapters cannot become ready', async () => {
    for (const getRegistry of [
        () => registry().map(row => ({ ...row, canonical_capability_id: 'wrong.capability' })),
        () => [...registry(), registry()[0]],
        () => registry().map(row => ({ ...row, implemented: false })),
    ]) {
        const rows = await make({ getRegistry }).forPlatform(principal(), 'catalog');
        assert.ok(rows.every(row => !row.can_execute));
    }
});

test('expiry during awaited verification blocks execution even if every returned boolean is true', async () => {
    let clock = now;
    const rows = await make({ now: () => clock, getCapabilityFacts: async () => { const data = facts(); clock += 30_000; return data; } }).forPlatform(principal(), 'catalog');
    assert.ok(rows.every(row => !row.can_execute && row.valid_until === null));
});

test('identity verification exceptions remain fixed native identity errors without private details', async () => {
    await assert.rejects(make({ verifyPrincipal: () => { throw new Error('synthetic-private-database-message'); } }).forPlatform(principal(), 'catalog'), error => {
        assert.equal(error.code, 'availability_principal_changed');
        assert.equal(error.message.includes('synthetic-private'), false); return true;
    });
    await assert.rejects(make().forPlatform({}, 'catalog'), { code: 'availability_principal_required' });
    await assert.rejects(make().forPlatform(principal(), 'unconfigured_platform'), { statusCode: 422 });
});

const actionRows = () => [{ capability_code: 'products.read', actions: [{ action: 'search', effect: 'read',
    required_checks: ['resource_authorized', 'consumer_selected', 'scope_granted', 'field_permissions_verified'],
    facts: { ...facts()[LOCAL_REQUEST_CAPABILITIES[0].capability_id], handler_readiness: handler('products.read'), consumer_selected: true, scope_granted: true, field_permissions_verified: true, freshness: 'stale' } }] }];

test('scoped gateway projects actual per-action facts and keeps all five capability requirements visible', async () => {
    let checks = 0;
    const service = createScopedCapabilityAvailabilityService({ verifyPrincipal: () => { checks++; return true; }, loadActions: actionRows, now: () => now });
    const result = await service.forCapabilities(principal());
    assert.equal(checks, 2); assert.equal(result.length, 5);
    assert.equal(result[0].actions[0].can_execute, true);
    assert.equal(result[1].blockers[0].code, 'capability_actions_unavailable');
});

test('scoped gateway never returns another tenant context or cached rows after local revocation', async () => {
    const p = principal();
    const service = createScopedCapabilityAvailabilityService({ verifyPrincipal: () => true, now: () => now,
        loadActions: async () => { p.tenantId = 4; return actionRows(); } });
    await assert.rejects(service.forCapabilities(p), { code: 'availability_principal_changed' });
});

test('scoped gateway failures return fixed errors without raw central response details', async () => {
    const service = createScopedCapabilityAvailabilityService({ verifyPrincipal: () => true,
        loadActions: () => { throw new Error('synthetic-private-central-body'); } });
    await assert.rejects(service.forCapabilities(principal()), error => error.statusCode === 503
        && error.code === 'availability_verification_unavailable' && !error.message.includes('synthetic-private'));
});

test('unrecognized or duplicate scoped capability rows cannot masquerade as actual action registries', async () => {
    for (const loaded of [[...actionRows(), ...actionRows()], [{ capability_code: 'invented.capability', actions: [] }]]) {
        const service = createScopedCapabilityAvailabilityService({ verifyPrincipal: () => true, loadActions: () => loaded });
        await assert.rejects(service.forCapabilities(principal()), { code: 'availability_response_invalid' });
    }
});
