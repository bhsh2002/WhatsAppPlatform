import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/index.js';
import db from '../db/database.js';

// Middleware to verify JWT token (with revocation check)
export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح - يرجى تسجيل الدخول' });
    }

    const token = authHeader.split(' ')[1];

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
