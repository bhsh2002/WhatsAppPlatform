// Meta pagination links can include access tokens. Treat them only as a cursor
// source, then rebuild the next request from the endpoint we chose ourselves.
export const safeMetaNextPageUrl = (value, initialUrl) => {
    if (!value || typeof value !== 'string') return null;
    try {
        const initial = new URL(initialUrl);
        const next = new URL(value);
        if (initial.protocol !== 'https:' || next.protocol !== 'https:'
            || next.origin !== initial.origin || next.pathname !== initial.pathname
            || initial.searchParams.has('access_token') || initial.searchParams.has('input_token')) {
            return null;
        }
        const cursors = next.searchParams.getAll('after');
        if (cursors.length !== 1 || !cursors[0] || cursors[0].length > 2048
            || /[\u0000-\u001f\u007f]/.test(cursors[0])) return null;
        initial.searchParams.set('after', cursors[0]);
        return initial.toString();
    } catch {
        return null;
    }
};
