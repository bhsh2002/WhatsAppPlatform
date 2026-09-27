const RELOAD_MARKER = 'wa-savana:chunk-reload-target';

const normalizeEntry = (candidate, baseUrl) => {
    if (!candidate) return null;
    try {
        const base = new URL(baseUrl);
        const entry = new URL(candidate, base);
        if (entry.origin !== base.origin || !/^\/assets\/[^?#]+\.js$/.test(entry.pathname)) {
            return null;
        }
        return entry.href;
    } catch {
        return null;
    }
};

export const moduleEntryFromHtml = (html, baseUrl) => {
    const tags = String(html || '').match(/<script\b[^>]*>/gi) || [];
    for (const tag of tags) {
        if (!/\btype\s*=\s*(["'])module\1/i.test(tag)) continue;
        const source = tag.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i)?.[2];
        const entry = normalizeEntry(source, baseUrl);
        if (entry) return entry;
    }
    return null;
};

// An old open tab can still request chunks removed by a new deployment. Reload
// only when the fresh document advertises a different application entry point.
// This leaves transient network failures to the visible error fallback instead
// of putting an offline or unhealthy browser into a reload loop.
export const recoverStaleChunk = async ({ win, doc, request }) => {
    if (win.navigator?.onLine === false) return false;

    const currentSource = doc.querySelector('script[type="module"][src]')?.getAttribute('src');
    const currentEntry = normalizeEntry(currentSource, win.location.href);
    if (!currentEntry) return false;

    let latestEntry;
    try {
        const response = await request(new URL('/index.html', win.location.origin).href, {
            cache: 'no-store',
            credentials: 'same-origin',
        });
        if (!response.ok) return false;
        latestEntry = moduleEntryFromHtml(await response.text(), win.location.href);
    } catch {
        return false;
    }

    if (!latestEntry || latestEntry === currentEntry) return false;

    // If a CDN or proxy still serves the old document after reload, the same
    // target must not trigger another automatic reload in this tab.
    try {
        if (win.sessionStorage.getItem(RELOAD_MARKER) === latestEntry) return false;
        win.sessionStorage.setItem(RELOAD_MARKER, latestEntry);
    } catch {
        // Without a reliable loop guard, leave retry to the user.
        return false;
    }

    // reload() retains pathname, query, and hash, including the intended route.
    try {
        win.location.reload();
        return true;
    } catch {
        return false;
    }
};

export const installChunkLoadRecovery = ({ win = window, doc = document, request = fetch } = {}) => {
    let checking = false;
    const onPreloadError = () => {
        if (checking) return;
        checking = true;
        // Let the rejected import reach React's error boundary while we check
        // the deployed version. Vite's event is synchronous, this check is not.
        void recoverStaleChunk({ win, doc, request })
            .catch(() => false)
            .finally(() => {
                checking = false;
            });
    };
    win.addEventListener('vite:preloadError', onPreloadError);
    return () => win.removeEventListener('vite:preloadError', onPreloadError);
};
