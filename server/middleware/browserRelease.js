const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BROWSER_METADATA = ['sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user'];
export const BROWSER_RELEASE_HEADER = 'X-WA-Client-Release';

const configuredRelease = value => {
    const release = String(value ?? '').trim();
    if (release && !/^[a-f0-9]{64}$/.test(release)) {
        throw new Error('WA_BROWSER_RELEASE must be empty or a lowercase SHA-256 content identifier');
    }
    return release;
};

const hasHeader = (req, name) => Object.keys(req.headers || {})
    .some(key => key.toLowerCase() === name)
    || req.get?.(name) !== undefined;

// Sec-Fetch-Mode alone is also emitted by Node fetch. Origin presence (even
// "null") or the remaining browser metadata identifies this compatibility
// check; it never replaces authentication, signature or permission checks.
export const isBrowserReleaseRequest = req => hasHeader(req, 'origin')
    || BROWSER_METADATA.some(name => hasHeader(req, name));

export const browserReleaseStatus = ({ release = process.env.WA_BROWSER_RELEASE } = {}) => {
    const current = configuredRelease(release);
    return { enabled: Boolean(current), release: current || null };
};

export const createBrowserReleaseGuard = ({ release = process.env.WA_BROWSER_RELEASE } = {}) => {
    const current = configuredRelease(release);
    return (req, res, next) => {
        if (!current || SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())
            || !isBrowserReleaseRequest(req)) return next();
        const supplied = req.get?.(BROWSER_RELEASE_HEADER)
            ?? req.headers?.[BROWSER_RELEASE_HEADER.toLowerCase()];
        if (supplied === current) return next();
        return res.status(409).set('Cache-Control', 'no-store').json({
            error: 'يرجى تحديث الصفحة للحصول على الإصدار الحالي، ثم مراجعة الطلب وإرساله من جديد.',
            code: 'refresh_required',
            refresh_required: true,
        });
    };
};
