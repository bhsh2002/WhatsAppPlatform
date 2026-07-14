import crypto from 'crypto';

export function generateApiKey() {
    return `wp_${crypto.randomBytes(32).toString('hex')}`;
}

export function digestApiKey(apiKey) {
    return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

export function constantTimeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left), 'utf8');
    const rightBuffer = Buffer.from(String(right), 'utf8');

    return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isLegacyBcryptDigest(value) {
    return /^\$2[aby]\$/.test(String(value || ''));
}
