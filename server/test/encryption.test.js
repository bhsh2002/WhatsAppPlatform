import assert from 'node:assert/strict';
import test from 'node:test';
import { decrypt, encrypt, initEncryption } from '../services/encryption.js';

test('encryption initialization requires exactly 64 hexadecimal characters', () => {
    const original = process.env.CRYPTO_KEY;
    try {
        process.env.CRYPTO_KEY = 'short';
        assert.throws(() => initEncryption(), /64 hex characters/);

        process.env.CRYPTO_KEY = 'z'.repeat(64);
        assert.throws(() => initEncryption(), /64 hex characters/);

        process.env.CRYPTO_KEY = 'a'.repeat(64);
        assert.doesNotThrow(() => initEncryption());
    } finally {
        if (original === undefined) delete process.env.CRYPTO_KEY;
        else process.env.CRYPTO_KEY = original;
    }
});

test('AES-GCM encryption round-trips without returning plaintext', () => {
    const original = process.env.CRYPTO_KEY;
    try {
        process.env.CRYPTO_KEY = 'b'.repeat(64);
        initEncryption();
        const plaintext = 'sensitive-token';
        const ciphertext = encrypt(plaintext);

        assert.notEqual(ciphertext, plaintext);
        assert.equal(decrypt(ciphertext), plaintext);
    } finally {
        if (original === undefined) delete process.env.CRYPTO_KEY;
        else process.env.CRYPTO_KEY = original;
    }
});
