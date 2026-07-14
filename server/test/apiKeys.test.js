import assert from 'node:assert/strict';
import test from 'node:test';
import {
    constantTimeEqual,
    digestApiKey,
    generateApiKey,
    isLegacyBcryptDigest,
} from '../security/apiKeys.js';

test('API keys are high-entropy prefixed values with stable SHA-256 digests', () => {
    const key = generateApiKey();
    const second = generateApiKey();

    assert.match(key, /^wp_[0-9a-f]{64}$/);
    assert.notEqual(key, second);
    assert.match(digestApiKey(key), /^[0-9a-f]{64}$/);
    assert.equal(digestApiKey(key), digestApiKey(key));
    assert.notEqual(digestApiKey(key), digestApiKey(second));
});

test('constant-time comparison and legacy bcrypt detection reject mismatches', () => {
    assert.equal(constantTimeEqual('same', 'same'), true);
    assert.equal(constantTimeEqual('same', 'different'), false);
    assert.equal(isLegacyBcryptDigest('$2b$12$abcdefghijklmnopqrstuv'), true);
    assert.equal(isLegacyBcryptDigest('sha256-digest'), false);
});
