import crypto from 'node:crypto';

const digest = value => crypto.createHash('sha256').update(String(value || '')).digest();

export function createMetricsAuth({ token = process.env.METRICS_TOKEN } = {}) {
    const configuredToken = String(token || '').trim();
    const configuredDigest = digest(configuredToken);

    return (req, res, next) => {
        if (!configuredToken) {
            return res.status(404).json({ error: 'Not found' });
        }

        const authorization = String(req.get?.('authorization') || '');
        const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
        const suppliedDigest = digest(match?.[1] || '');
        if (!match || !crypto.timingSafeEqual(configuredDigest, suppliedDigest)) {
            res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        return next();
    };
}
