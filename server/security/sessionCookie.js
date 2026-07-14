export const SESSION_COOKIE_NAME = 'wa_session';
export const SESSION_COOKIE_PATH = '/api';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const getSessionCookieOptions = ({
    production = process.env.NODE_ENV === 'production',
    maxAge = SESSION_MAX_AGE_MS,
} = {}) => ({
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    maxAge,
    priority: 'high',
});

export const setSessionCookie = (res, token, options = {}) => (
    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(options))
);

export const clearSessionCookie = res => (
    res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: SESSION_COOKIE_PATH,
    })
);

export const parseCookieHeader = header => {
    const cookies = {};
    if (!header || typeof header !== 'string') return cookies;

    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator <= 0) continue;
        const name = part.slice(0, separator).trim();
        const rawValue = part.slice(separator + 1).trim();
        if (!name) continue;
        try {
            cookies[name] = decodeURIComponent(rawValue);
        } catch {
            cookies[name] = rawValue;
        }
    }
    return cookies;
};

export const getSessionCookie = req => (
    parseCookieHeader(req.headers?.cookie)[SESSION_COOKIE_NAME] || null
);
