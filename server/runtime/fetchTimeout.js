const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MIN_FETCH_TIMEOUT_MS = 1_000;
const MAX_FETCH_TIMEOUT_MS = 120_000;
const DEFAULT_SAFE_FETCH_ATTEMPTS = 3;
const MAX_SAFE_FETCH_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 5_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const INSTALL_MARKER = Symbol.for('whatsapp-platform.fetch-timeout-installed');

export const normalizeFetchTimeout = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_FETCH_TIMEOUT_MS;
    return Math.min(MAX_FETCH_TIMEOUT_MS, Math.max(MIN_FETCH_TIMEOUT_MS, parsed));
};

export const normalizeSafeFetchAttempts = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SAFE_FETCH_ATTEMPTS;
    return Math.min(MAX_SAFE_FETCH_ATTEMPTS, Math.max(1, parsed));
};

const retryAfterMs = (response, attempt) => {
    const value = response?.headers?.get?.('retry-after');
    if (value) {
        const seconds = Number(value);
        if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, seconds * 1000));
        const dateDelay = Date.parse(value) - Date.now();
        if (Number.isFinite(dateDelay)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, dateDelay));
    }
    return Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** (attempt - 1)));
};

const releaseResponse = async response => {
    try {
        await response?.body?.cancel?.();
    } catch {
        // The connection may already be closed; retry can still proceed.
    }
};

export const createFetchWithDefaultTimeout = (fetchImplementation, timeoutMs, {
    safeAttempts = DEFAULT_SAFE_FETCH_ATTEMPTS,
    sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
} = {}) => {
    if (typeof fetchImplementation !== 'function') throw new Error('Global fetch is not available');
    const normalizedTimeout = normalizeFetchTimeout(timeoutMs);
    const normalizedAttempts = normalizeSafeFetchAttempts(safeAttempts);

    return async (input, init = {}) => {
        const method = String(init.method || 'GET').toUpperCase();
        const attempts = method === 'GET' || method === 'HEAD' ? normalizedAttempts : 1;
        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const signal = init.signal || AbortSignal.timeout(normalizedTimeout);
            try {
                const response = await fetchImplementation(input, { ...init, signal });
                if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) return response;
                await releaseResponse(response);
                await sleep(retryAfterMs(response, attempt));
            } catch (error) {
                lastError = error;
                if (attempt === attempts || signal.aborted && init.signal) throw error;
                await sleep(Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** (attempt - 1))));
            }
        }

        throw lastError || new Error('External fetch failed');
    };
};

export const installGlobalFetchTimeout = ({
    timeoutMs = process.env.OUTBOUND_FETCH_TIMEOUT_MS,
    safeAttempts = process.env.OUTBOUND_SAFE_FETCH_ATTEMPTS,
} = {}) => {
    if (globalThis[INSTALL_MARKER]) return globalThis.fetch;
    globalThis.fetch = createFetchWithDefaultTimeout(globalThis.fetch, timeoutMs, { safeAttempts });
    globalThis[INSTALL_MARKER] = true;
    return globalThis.fetch;
};
