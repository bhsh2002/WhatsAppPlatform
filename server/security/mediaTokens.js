import jwt from 'jsonwebtoken';

const MEDIA_TOKEN_TTL_SECONDS = 300;
const MEDIA_TOKEN_AUDIENCE = 'media-download';

export function createMediaToken({ userId, tenantId = null, role = null }, secret) {
    if (!secret) throw new Error('JWT secret is required');

    return jwt.sign({
        sub: userId,
        tid: tenantId,
        role,
        purpose: 'media',
    }, secret, {
        expiresIn: MEDIA_TOKEN_TTL_SECONDS,
        audience: MEDIA_TOKEN_AUDIENCE,
    });
}

export function verifyMediaToken(token, secret) {
    if (!token || !secret) return null;

    try {
        const decoded = jwt.verify(token, secret, {
            audience: MEDIA_TOKEN_AUDIENCE,
        });
        return decoded.purpose === 'media' ? decoded : null;
    } catch {
        return null;
    }
}

export function isMediaDownloadRequest(req) {
    if (req?.method !== 'GET') return false;

    const requestPath = String(req.originalUrl || req.url || '')
        .split('?')[0];

    return /^\/(?:messages|portal)\/media\/[^/]+\/download\/?$/.test(requestPath);
}

export const MEDIA_TOKEN_TTL = MEDIA_TOKEN_TTL_SECONDS;
