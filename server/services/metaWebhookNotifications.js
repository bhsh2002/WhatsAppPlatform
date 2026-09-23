import crypto from 'node:crypto';

const sha256 = value => crypto.createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

const canonicalize = value => {
    if (Array.isArray(value)) {
        return value.map(item => item === undefined ? null : canonicalize(item));
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .filter(key => value[key] !== undefined)
                .map(key => [key, canonicalize(value[key])]),
        );
    }
    return value;
};

const stableDigest = value => sha256(JSON.stringify(canonicalize(value ?? null)));

// Fallback notification identifiers must be deterministic without persisting
// message bodies, postback payloads or account-alert details in clear text.
export const metaWebhookNotificationSource = value => `meta:${stableDigest(value)}`;
