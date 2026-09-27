import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyMetaTokenStatus,
    isMetaTokenExpiring,
    isMetaTokenReady,
} from '../services/metaTokenStatus.js';

const NOW = Date.parse('2026-09-27T12:00:00.000Z');

test('Meta tokens are ready only when valid and not near expiry', () => {
    assert.equal(classifyMetaTokenStatus({ is_valid: true }, { now: NOW }), 'valid');
    assert.equal(
        classifyMetaTokenStatus({ is_valid: true, expires_at: (NOW + 8 * 24 * 60 * 60 * 1000) / 1000 }, { now: NOW }),
        'valid'
    );
    assert.equal(isMetaTokenReady('valid'), true);
    assert.equal(isMetaTokenReady('unchecked'), false);
    assert.equal(isMetaTokenReady('expired'), false);
    assert.equal(isMetaTokenReady('expiring'), false);
});

test('Meta tokens nearing expiry are classified as warnings rather than ready', () => {
    const expiring = classifyMetaTokenStatus({
        is_valid: true,
        expires_at: (NOW + 2 * 24 * 60 * 60 * 1000) / 1000,
    }, { now: NOW });
    const expired = classifyMetaTokenStatus({
        is_valid: true,
        expires_at: (NOW - 1000) / 1000,
    }, { now: NOW });

    assert.equal(expiring, 'expiring');
    assert.equal(isMetaTokenExpiring(expiring), true);
    assert.equal(expired, 'expired');
    assert.equal(classifyMetaTokenStatus({ is_valid: false }, { now: NOW }), 'invalid');
});

