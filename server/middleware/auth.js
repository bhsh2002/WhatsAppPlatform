import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { JWT_SECRET } from '../config/index.js';
import db from '../db/database.js';

// ============================================
// Short-lived media token (for <img>/<video> URLs)
// ============================================
const MEDIA_TOKEN_TTL = 300; // 5 minutes

/**
 * Generate a short-lived HMAC-signed token for media access.
 * This avoids exposing the full JWT in URL query params.
 */
export function generateMediaToken(userId, tenantId = null, role = null) {
    const payload = {
        sub: userId,
        tid: tenantId,
        role: role,
        purpose: 'media',
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: MEDIA_TOKEN_TTL });
}

/**
 * Verify a media-specific token and return user info.
 */
function verifyMediaToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.purpose !== 'media') return null;
        return decoded;
    } catch {
        return null;
    }
}

// ============================================
// Main auth middleware (with media token fallback)
// ============================================
export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token;
    let isMediaToken = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query && req.query.media_token) {
        // Short-lived media token for <img>/<video> src URLs
        token = req.query.media_token;
        isMediaToken = true;
    }

    if (!token) {
        return res.status(401).json({ error: 'غير مصرح - يرجى تسجيل الدخول' });
    }

    // Handle media token separately (simpler validation, no revocation check needed)
    if (isMediaToken) {
        const mediaUser = verifyMediaToken(token);
        if (!mediaUser) {
            return res.status(401).json({ error: 'رمز وسائط غير صالح أو منتهي' });
        }
        // Minimal user object for media routes (includes role for admin middleware)
        req.user = {
            id: mediaUser.sub,
            tenant_id: mediaUser.tid,
            role: mediaUser.role || null,
        };
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
        const user = db.prepare('SELECT is_active, tokens_revoked_at FROM users WHERE id = ?').get(decoded.id);
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

        req.user = decoded;
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
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
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
            const user = db.prepare('SELECT is_active, tokens_revoked_at FROM users WHERE id = ?').get(decoded.id);
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

            req.user = decoded;
        } catch (error) {
            // Token invalid, but we continue anyway
        }
    }

    next();
};
