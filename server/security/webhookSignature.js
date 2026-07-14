import crypto from 'crypto';

export function unsignedWebhooksAllowed({ appSecret, nodeEnv, allowUnsigned }) {
    if (appSecret) return true;
    return nodeEnv !== 'production' && allowUnsigned === true;
}

export function verifyMetaWebhookSignature({ appSecret, signature, rawBody }) {
    if (!appSecret || !signature || !rawBody) return false;

    const expectedSignature = `sha256=${crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex')}`;

    const supplied = Buffer.from(String(signature), 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');

    return supplied.length === expected.length
        && crypto.timingSafeEqual(supplied, expected);
}
