import crypto from 'crypto';

// ============================================
// Encryption Service for Sensitive Data
// ============================================
// Uses AES-256-GCM for reversible encryption (access tokens)
// Uses bcrypt for one-way hashing (API keys)

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

let encryptionKey = null;

/**
 * Initialize encryption with the CRYPTO_KEY from environment
 * Must be called at server startup
 */
export function initEncryption() {
    const keyHex = process.env.CRYPTO_KEY;
    if (!keyHex) {
        throw new Error('CRYPTO_KEY environment variable is not set');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error('CRYPTO_KEY must be 64 hex characters (32 bytes)');
    }
    encryptionKey = Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns a base64-encoded string containing IV + auth tag + ciphertext
 * 
 * @param {string} plaintext - The data to encrypt
 * @returns {string} Encrypted data (base64)
 */
export function encrypt(plaintext) {
    if (!encryptionKey) {
        throw new Error('Encryption not initialized. Call initEncryption() first.');
    }
    if (!plaintext) return null;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
    
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // Format: IV (12 bytes) | Auth Tag (16 bytes) | Ciphertext
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded encrypted string
 * 
 * @param {string} encryptedData - The encrypted data (base64)
 * @returns {string|null} Decrypted plaintext or null if input is empty
 */
export function decrypt(encryptedData) {
    if (!encryptionKey) {
        throw new Error('Encryption not initialized. Call initEncryption() first.');
    }
    if (!encryptedData) return null;

    try {
        const combined = Buffer.from(encryptedData, 'base64');
        
        const iv = combined.subarray(0, IV_LENGTH);
        const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
        const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
        
        const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
        decipher.setAuthTag(authTag);
        
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        
        return decrypted.toString('utf8');
    } catch (error) {
        console.error('[Encryption] Decryption failed:', error.message);
        return null;
    }
}

/**
 * Check if a value appears to be encrypted
 * Encrypted values are base64 with minimum length of IV + auth tag
 * 
 * @param {string} value - Value to check
 * @returns {boolean} True if value appears to be encrypted
 */
export function isEncrypted(value) {
    if (!value) return false;
    // Encrypted format: base64(12 byte IV + 16 byte auth tag + ciphertext)
    // Minimum length: 12 + 16 + 1 = 29 bytes = ~40 base64 chars
    if (value.length < 40) return false;
    // Check if it's valid base64
    try {
        const decoded = Buffer.from(value, 'base64');
        return decoded.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1;
    } catch {
        return false;
    }
}

/**
 * Decrypt a value if it appears to be encrypted, otherwise return as-is
 * Useful for backward compatibility during migration
 * 
 * @param {string} value - Value that may be encrypted
 * @returns {string} Decrypted value or original
 */
export function decryptIfEncrypted(value) {
    if (!value) return value;
    if (isEncrypted(value)) {
        return decrypt(value) || value;
    }
    return value;
}
