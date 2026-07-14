const RETRYABLE_META_STATUS = new Set([429, 500, 502, 503, 504]);

export const normalizePublicMetaError = (data, status, fallback = 'Meta API request failed') => {
    const source = data?.error && typeof data.error === 'object' ? data.error : {};
    return {
        message: source.error_user_msg || source.user_message || source.message || fallback,
        type: source.type || null,
        code: source.code ?? null,
        subcode: source.error_subcode ?? source.subcode ?? null,
        status,
        retryable: RETRYABLE_META_STATUS.has(status) || source.is_transient === true,
    };
};

const parseStoredJson = value => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

export const sanitizeStoredMetaResponse = (value, {
    successFields = [],
    fallbackStatus = 400,
} = {}) => {
    const data = parseStoredJson(value);
    if (!data || typeof data !== 'object') return null;

    if (data.error && typeof data.error === 'object') {
        const status = Number.isInteger(data.error.status)
            ? data.error.status
            : Number.isInteger(data.status) ? data.status : fallbackStatus;
        return { error: normalizePublicMetaError(data, status) };
    }

    return Object.fromEntries(
        successFields
            .filter(field => Object.hasOwn(data, field))
            .map(field => [field, data[field]])
    );
};

export const readMetaJson = async response => {
    const text = await response.text();
    if (!text) return { data: null, parseError: null };
    try {
        return { data: JSON.parse(text), parseError: null };
    } catch {
        return { data: null, parseError: new Error('Meta API returned an invalid JSON response') };
    }
};

const normalizeHttpStatus = status => (
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502
);

export const readMetaResponse = async response => {
    const { data, parseError } = await readMetaJson(response);
    const missingBody = data === null && response.status !== 204;
    const ok = response.ok && !parseError && !missingBody;
    const error = ok
        ? null
        : normalizePublicMetaError(
            data,
            response.status,
            parseError?.message || (missingBody
                ? 'Meta API returned an empty JSON response'
                : `Meta API request failed with HTTP ${response.status}`)
        );

    return { ok, status: response.status, data, error, headers: response.headers };
};

export const sendMetaFailure = (res, result, fallback = 'Meta API request failed', extra = {}) => {
    const details = result?.error || normalizePublicMetaError(null, 502, fallback);
    return res.status(normalizeHttpStatus(result?.status)).json({
        ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}),
        error: details.message || fallback,
        details,
    });
};

export const requestMetaJson = async (url, init = {}, { fetchImpl = globalThis.fetch } = {}) => {
    const response = await fetchImpl(url, init);
    return readMetaResponse(response);
};
