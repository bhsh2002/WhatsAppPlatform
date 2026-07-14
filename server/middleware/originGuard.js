const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const normalizeOrigin = value => {
    if (!value) return null;
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};

const getRequestOrigin = req => {
    const host = req.get?.('host') || req.headers?.host;
    if (!host) return null;
    const forwardedProto = req.get?.('x-forwarded-proto') || req.headers?.['x-forwarded-proto'];
    const protocol = String(forwardedProto || req.protocol || 'http').split(',')[0].trim();
    return normalizeOrigin(`${protocol}://${host}`);
};

export const createOriginGuard = ({ allowedOrigins = [] } = {}) => {
    const allowed = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));

    return (req, res, next) => {
        if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return next();

        const suppliedOrigin = req.get?.('origin') || req.headers?.origin;
        // Non-browser clients and Meta callbacks generally omit Origin. Their
        // authentication/signature checks remain the relevant protection.
        if (!suppliedOrigin) return next();

        const origin = normalizeOrigin(suppliedOrigin);
        const requestOrigin = getRequestOrigin(req);
        if (origin && (origin === requestOrigin || allowed.has(origin))) return next();

        return res.status(403).json({
            error: 'Request origin is not allowed',
            code: 'ORIGIN_NOT_ALLOWED',
        });
    };
};
