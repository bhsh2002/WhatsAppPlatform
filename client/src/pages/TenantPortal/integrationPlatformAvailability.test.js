import assert from 'node:assert/strict';
import test from 'node:test';

import {
    integrationCandidatesForPlatform,
    integrationIsConnectable,
    integrationLoadIsCurrent,
    resolveAvailablePlatform,
    shouldRequestIntegrationCandidates,
} from './integrationPlatformAvailability.js';

const integrations = [
    { platform_code: 'pos', available: false, status: 'disconnected' },
    { platform_code: 'catalog', available: false, status: 'disconnected' },
    { platform_code: 'sawemly', available: true, status: 'disconnected' },
];

test('the first available platform replaces an unavailable selection', () => {
    assert.equal(resolveAvailablePlatform(integrations, 'catalog'), 'sawemly');
    assert.equal(resolveAvailablePlatform(integrations, 'sawemly'), 'sawemly');
    assert.equal(resolveAvailablePlatform(integrations.slice(0, 2), 'catalog'), null);
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
