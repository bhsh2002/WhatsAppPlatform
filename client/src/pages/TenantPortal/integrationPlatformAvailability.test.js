import assert from 'node:assert/strict';
import test from 'node:test';

import {
    integrationCandidatesForPlatform,
    integrationIsConnectable,
    integrationLoadIsCurrent,
    integrationSubscriptionBadge,
    resolveAvailablePlatform,
    shouldRequestIntegrationCandidates,
    integrationCandidateIsSelectable,
    integrationRequirements,
} from './integrationPlatformAvailability.js';

const integrations = [
    { platform_code: 'pos', available: false, status: 'disconnected' },
    { platform_code: 'catalog', available: false, status: 'disconnected' },
    { platform_code: 'sawemly', available: true, status: 'disconnected' },
];

test('subscription badge separates Wa entitlement from connection status', () => {
    assert.deepEqual(integrationSubscriptionBadge(true, true), {
        label: 'اشتراك Wa Savana يشمل الربط',
        color: 'success',
    });
    assert.deepEqual(integrationSubscriptionBadge(false, true), {
        label: 'اشتراك Wa Savana لا يشمل الربط',
        color: 'warning',
    });
    assert.deepEqual(integrationSubscriptionBadge(null, true), {
        label: 'تعذر التحقق من الاشتراك',
        color: 'default',
    });
});

test('unavailable platforms remain selectable to explain requirements', () => {
    assert.equal(resolveAvailablePlatform(integrations, 'catalog'), 'catalog');
    assert.equal(resolveAvailablePlatform(integrations, 'sawemly'), 'sawemly');
    assert.equal(resolveAvailablePlatform(integrations.slice(0, 2), 'catalog'), 'catalog');
    assert.equal(resolveAvailablePlatform([], null), 'pos');
    assert.equal(resolveAvailablePlatform(integrations, null), 'sawemly');
});

test('requirements preserve simultaneous blockers and distinguish support from payment', () => {
    const reasons = integrationRequirements({ integration: integrations[0], bound: false }, 'en');
    assert.deepEqual(reasons.map(reason => reason.code), [
        'platform_unavailable', 'organization_unbound', 'subscription_unknown', 'connection_required',
    ]);
    assert.match(reasons[0].message, /subscription alone does not enable/);
    assert.deepEqual(integrationRequirements({ integration: {
        available: true, subscription_entitled: true, connection_id: 'connection', status: 'active',
    }, bound: true }), []);
});

test('error recovery cannot select an unrelated already connected account', () => {
    const integration = { status: 'error', remote_external_tenant_id: 'catalog:shop:1' };
    assert.equal(integrationCandidateIsSelectable({ target: { connectable: false, external_tenant_id: 'catalog:shop:2' } }, integration), false);
    assert.equal(integrationCandidateIsSelectable({ target: { connectable: false, external_tenant_id: 'catalog:shop:1' } }, integration), true);
    assert.equal(integrationCandidateIsSelectable({ target: { connectable: true } }, integration), true);
});

test('a late load cannot commit results for an older revision or platform', () => {
    assert.equal(integrationLoadIsCurrent({
        currentPlatform: 'sawemly',
        currentRevision: 4,
        requestedPlatform: 'sawemly',
        revision: 4,
    }), true);
    assert.equal(integrationLoadIsCurrent({
        currentPlatform: 'catalog',
        currentRevision: 4,
        requestedPlatform: 'sawemly',
        revision: 4,
    }), false);
    assert.equal(integrationLoadIsCurrent({
        currentPlatform: 'sawemly',
        currentRevision: 5,
        requestedPlatform: 'sawemly',
        revision: 4,
    }), false);
});

test('candidate discovery is allowed only for available, connectable platforms', () => {
    assert.equal(integrationIsConnectable(integrations[0]), false);
    assert.equal(shouldRequestIntegrationCandidates({
        binding: { bound: true },
        integration: integrations[0],
    }), false);
    assert.equal(shouldRequestIntegrationCandidates({
        binding: { bound: true },
        integration: integrations[2],
    }), true);
    assert.equal(shouldRequestIntegrationCandidates({
        binding: { bound: false },
        integration: integrations[2],
    }), false);
    assert.equal(integrationIsConnectable({
        platform_code: 'sawemly',
        available: true,
        connection_id: 'connection-1',
        status: 'active',
    }), false);
});

test('candidate documents never leak between platform selections', () => {
    const document = {
        target_platform_code: 'sawemly',
        organizations: [{
            source_tenant: { id: 'wa-1' },
            organization: { id: 'organization-1', name: 'Savana' },
            candidates: [{ id: 'sawemly-1', display_name: 'Sawemly account' }],
        }],
    };

    assert.equal(integrationCandidatesForPlatform(document, 'catalog').length, 0);
    assert.deepEqual(integrationCandidatesForPlatform(document, 'sawemly'), [{
        source: { id: 'wa-1' },
        organization: { id: 'organization-1', name: 'Savana' },
        target: { id: 'sawemly-1', display_name: 'Sawemly account' },
        key: 'wa-1:sawemly-1',
    }]);
});
