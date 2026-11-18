import { AsyncLocalStorage } from 'node:async_hooks';

const headerName = 'X-Savana-Owner-Fixture-Result-Binding';
const mime = value => typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : null;
const commandKey = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,255}$/.test(value) && !['.', '..'].includes(value);

// Associate only one real result response with this particular private read.
// The header is diagnostic metadata, never authority. The delegate/transport
// retains all authentication and body validation; no response bytes are read.
export const createOwnerJourneyResultBindingCapture = ({ coreOrigin }) => {
    let origin;
    try { origin = new URL(coreOrigin); } catch { throw new TypeError('A fixed Core origin is required'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== coreOrigin || origin.username || origin.password
        || origin.pathname !== '/' || origin.search || origin.hash) throw new TypeError('A fixed Core origin is required');
    const active = new AsyncLocalStorage();
    const wrapFetch = delegate => {
        if (typeof delegate !== 'function') throw new TypeError('An actual fetch delegate is required');
        return async (input, options = {}) => {
            const state = active.getStore();
            let target; let eligible = false; let attempt = false;
            if (state && !state.finished) {
                try {
                    target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
                    // Ordinary before/after command, identity or discovery reads
                    // are allowed. Another result lookup cannot supply this one.
                    attempt = /^\/v1\/integration\/workspace\/commands\/[^/]+\/result$/.test(target.pathname);
                    if (attempt) {
                        state.attempts++;
                        const method = String(options.method ?? input?.method ?? 'GET').toUpperCase();
                        const encoded = encodeURIComponent(state.commandId);
                        const expected = `/v1/integration/workspace/commands/${encoded}/result`;
                        const raw = `/v1/integration/workspace/commands/${state.commandId}/result`;
                        eligible = state.valid && target.origin === coreOrigin && !target.username && !target.password && !target.hash
                            && method === 'GET' && options.body === undefined
                            && [expected, raw].includes(target.pathname) && target.searchParams.size === 1
                            && ['json', 'csv'].includes(target.searchParams.get('format'));
                        if (!eligible) state.invalid = true;
                    }
                } catch { /* A malformed target is still handled unchanged by the actual delegate. */ }
            }
            const response = await delegate(input, options);
            if (state && attempt && eligible && !state.finished) {
                try {
                    const format = target.searchParams.get('format');
                    const header = response.headers.get(headerName);
                    const normalHash = response.headers.get('X-Savana-Result-SHA256');
                    if (response.status !== 200 || response.url !== target.href
                        || mime(response.headers.get('Content-Type')) !== (format === 'csv' ? 'text/csv' : 'application/json')
                        || !/^[a-f0-9]{64}$/.test(normalHash || '')
                        || typeof header !== 'string' || !/^[A-Za-z0-9_-]{1,8192}$/.test(header)) state.invalid = true;
                    else state.header = header;
                } catch { state.invalid = true; }
            }
            return response;
        };
    };
    const run = (commandId, asyncRead) => {
        if (typeof asyncRead !== 'function') throw new TypeError('An actual result read is required');
        const state = { commandId, valid: commandKey(commandId), attempts: 0, invalid: false, header: null, finished: false };
        return active.run(state, async () => {
            try {
                const value = await asyncRead();
                return { value, header: state.valid && !state.invalid && state.attempts === 1 ? state.header : null };
            } finally { state.finished = true; }
        });
    };
    return { wrapFetch, run };
};
