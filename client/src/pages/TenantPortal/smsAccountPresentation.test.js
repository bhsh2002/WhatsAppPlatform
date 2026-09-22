import assert from 'node:assert/strict';
import test from 'node:test';

import {
    canRequestSmsStats,
    isManagedSmsAccount,
    normalizeSmsSummary,
} from './smsAccountPresentation.js';

test('managed SMS accounts are detected without changing legacy manual accounts', () => {
    assert.equal(isManagedSmsAccount({ management_mode: 'managed' }), true);
    assert.equal(isManagedSmsAccount({ managed: true }), true);
    assert.equal(isManagedSmsAccount({ management_mode: 'manual' }), false);
    assert.equal(isManagedSmsAccount({}), false);
});

test('SMS statistics helpers normalize missing values and validate custom ranges', () => {
    assert.deepEqual(normalizeSmsSummary({ sent: '4', delivered: 3, failed: -1 }), {
        pending: 0,
        sent: 4,
        delivered: 3,
        failed: 0,
        canceled: 0,
        received: 0,
        total_outgoing: 0,
    });
    assert.equal(canRequestSmsStats({ range: '7d' }), true);
    assert.equal(canRequestSmsStats({ range: 'custom', from: '2026-09-01', to: '2026-09-20' }), true);
    assert.equal(canRequestSmsStats({ range: 'custom', from: '2026-09-21', to: '2026-09-20' }), false);
});
