import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp_platform_secret_key_2024';

// Middleware to verify JWT token
export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح - يرجى تسجيل الدخول' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
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
