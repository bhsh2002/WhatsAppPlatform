import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/index.js';
import db from '../db/database.js';

// Middleware to verify JWT token (with revocation check)
export const authMiddleware = (req, res, next) => {
    let token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ error: 'غير مصرح - يرجى تسجيل الدخول' });
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

        // Check if user account is still active
        const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(decoded.id);
        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'الحساب غير مُفعّل' });
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

// Optional auth - doesn't fail if no token, just adds user if present
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
        } catch (error) {
            // Token invalid, but we continue anyway
        }
    }

    next();
};
