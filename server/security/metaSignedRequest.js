import crypto from 'node:crypto';

const decodeBase64Url = (value) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export const verifyMetaSignedRequest = (signedRequest, appSecret) => {
    if (!appSecret) throw new Error('Meta app secret is not configured');
    if (typeof signedRequest !== 'string') throw new Error('signed_request is required');

    const parts = signedRequest.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Malformed signed_request');

    const [encodedSignature, encodedPayload] = parts;
    const signature = decodeBase64Url(encodedSignature);
    const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
    if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
        throw new Error('Invalid signed_request signature');
    }

    let data;
    try {
        data = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
    } catch {
        throw new Error('Invalid signed_request payload');
    }

    if (String(data.algorithm || '').toUpperCase() !== 'HMAC-SHA256') {
        throw new Error('Unsupported signed_request algorithm');
    }
    if (data.user_id === null || data.user_id === undefined || String(data.user_id).trim() === '') {
        throw new Error('signed_request user_id is missing');
    }

    return { ...data, user_id: String(data.user_id) };
};
