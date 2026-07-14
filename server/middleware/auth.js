import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/index.js';
import db from '../db/database.js';
import {
    createMediaToken,
    isMediaDownloadRequest,
    verifyMediaToken,
} from '../security/mediaTokens.js';
import { getSessionCookie } from '../security/sessionCookie.js';

const getCurrentUserIdentity = userId => db.prepare(`
    SELECT id, username, role, tenant_id, is_active, tokens_revoked_at
    FROM users
    WHERE id = ?
`).get(userId);

const applyCurrentIdentity = (decoded, user) => {
    const identity = {
        ...decoded,
        id: user.id,
        username: user.username,
        role: user.role,
    };

    if (user.tenant_id === null || user.tenant_id === undefined) {
        delete identity.tenant_id;
    } else {
        identity.tenant_id = user.tenant_id;
    }

    return identity;
};

// ============================================
// Short-lived media token (for <img>/<video> URLs)
// ============================================
/**
 * Generate a short-lived HMAC-signed token for media access.
 * This avoids exposing the full JWT in URL query params.
 */
export function generateMediaToken(userId, tenantId = null, role = null) {
    return createMediaToken({ userId, tenantId, role }, JWT_SECRET);
}

export const getRequestAuthToken = req => {
    const authHeader = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return { token: authHeader.slice(7).trim(), mode: 'bearer' };
    }
    const sessionToken = getSessionCookie(req);
    return sessionToken ? { token: sessionToken, mode: 'cookie' } : { token: null, mode: null };
};

// ============================================
// Main auth middleware (with media token fallback)
// ============================================
export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token;
    let authMode = null;
    let isMediaToken = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
        authMode = 'bearer';
    } else if (req.query?.media_token && isMediaDownloadRequest(req)) {
        // Short-lived token is accepted only for the two media download routes.
        token = req.query.media_token;
        isMediaToken = true;
        authMode = 'media';
    } else {
        token = getSessionCookie(req);
        if (token) authMode = 'cookie';
    }

    if (!token) {
        return res.status(401).json({ error: 'غير مصرح - يرجى تسجيل الدخول' });
    }

    // Handle media token separately (simpler validation, no revocation check needed)
    if (isMediaToken) {
        const mediaUser = verifyMediaToken(token, JWT_SECRET);
        if (!mediaUser) {
            return res.status(401).json({ error: 'رمز وسائط غير صالح أو منتهي' });
        }

        const user = db.prepare(
            'SELECT id, role, tenant_id, is_active, tokens_revoked_at FROM users WHERE id = ?'
        ).get(mediaUser.sub);

        const tokenTenantId = mediaUser.tid ?? null;
        const currentTenantId = user?.tenant_id ?? null;
        const roleMatches = user?.role === (mediaUser.role || null);
        const tenantMatches = currentTenantId === tokenTenantId;
        const issuedBeforeRevocation = user?.tokens_revoked_at && mediaUser.iat
            ? mediaUser.iat < new Date(user.tokens_revoked_at).getTime() / 1000
            : false;

        if (!user?.is_active || !roleMatches || !tenantMatches || issuedBeforeRevocation) {
            return res.status(401).json({ error: 'رمز وسائط غير صالح أو منتهي' });
        }

        req.user = {
            id: user.id,
            tenant_id: currentTenantId,
            role: user.role,
        };
        req.authMode = authMode;
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check if token has been revoked (by jti)
        if (decoded.jti) {
            const revoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(decoded.jti);
            if (revoked) {
                return res.status(401).json({ error: 'تم إلغاء الجلسة — يرجى تسجيل الدخول مجدداً' });
            }
        }

        // Check if user account exists and is active
        const user = getCurrentUserIdentity(decoded.id);
        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'الحساب غير مُفعّل' });
        }

        // Check if all user tokens were revoked (user-level revocation)
        // Token is invalid if it was issued before the revocation timestamp
        if (user.tokens_revoked_at && decoded.iat) {
            const revokedAt = new Date(user.tokens_revoked_at).getTime() / 1000;
            if (decoded.iat < revokedAt) {
                return res.status(401).json({ error: 'تم إلغاء الجلسة — يرجى تسجيل الدخول مجدداً' });
            }
        }

        // Roles and tenant assignments can change while a JWT is still valid.
        // Always enforce the current database identity instead of stale claims.
        req.user = applyCurrentIdentity(decoded, user);
        req.authToken = token;
        req.authMode = authMode;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'رمز غير صالح أو منتهي الصلاحية' });
    }
};

// Middleware to check admin role
export const adminMiddleware = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'صلاحيات غير كافية' });
    }
};

// Optional auth - doesn't fail if no token, but validates properly if present
export const optionalAuth = (req, res, next) => {
    const { token, mode } = getRequestAuthToken(req);

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);

            // Check revocation
            if (decoded.jti) {
                const revoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(decoded.jti);
                if (revoked) {
                    return next(); // Token revoked, continue without user
                }
            }

            // Check if user account is still active
            const user = getCurrentUserIdentity(decoded.id);
            if (!user || !user.is_active) {
                return next(); // User inactive, continue without user
            }

            // Check user-level revocation
            if (user.tokens_revoked_at && decoded.iat) {
                const revokedAt = new Date(user.tokens_revoked_at).getTime() / 1000;
                if (decoded.iat < revokedAt) {
                    return next(); // Token revoked at user level, continue without user
                }
            }

            req.user = applyCurrentIdentity(decoded, user);
            req.authToken = token;
            req.authMode = mode;
        } catch (error) {
            // Token invalid, but we continue anyway
        }
    }

    next();
};
