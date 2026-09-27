const RETRYABLE_META_STATUS = new Set([429, 500, 502, 503, 504]);
const PUBLIC_META_TYPES = new Set([
    'APIException',
    'GraphAPIException',
    'GraphMethodException',
    'OAuthException',
]);
const SAFE_EXCEPTION_NAMES = new Set(['AbortError', 'Error', 'SyntaxError', 'TimeoutError', 'TypeError']);
const SAFE_EXCEPTION_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT',
    'SQLITE_BUSY', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE',
    'UND_ERR_CONNECT_TIMEOUT',
]);
const SAFE_PUBLIC_META_MESSAGES = new Set([
    'Meta API returned an invalid JSON response',
    'Meta API returned an empty JSON response',
    'Meta access token is invalid or expired',
    'Meta rate limit reached',
    'Meta permission is missing or denied',
    'Meta service is temporarily unavailable',
    'Meta rejected the request',
    'Meta API request failed',
]);
const ARABIC_META_MESSAGES = {
    'Meta access token is invalid or expired': 'رمز وصول Meta غير صالح أو منتهي الصلاحية',
    'Meta rate limit reached': 'تم تجاوز حد طلبات Meta، حاول لاحقاً',
    'Meta permission is missing or denied': 'الصلاحية المطلوبة من Meta غير متاحة',
    'Meta service is temporarily unavailable': 'خدمة Meta غير متاحة مؤقتاً',
    'Meta rejected the request': 'رفضت Meta الطلب',
    'Meta API returned an invalid JSON response': 'أعادت Meta استجابة غير صالحة',
    'Meta API returned an empty JSON response': 'أعادت Meta استجابة فارغة',
};

const normalizeHttpStatus = status => (
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502
);

const safeMetaMessage = (code, status, fallback, sourceMessage, hasMetaError) => {
    if (SAFE_PUBLIC_META_MESSAGES.has(sourceMessage)) return sourceMessage;
    if (fallback === 'Meta API returned an invalid JSON response'
        || fallback === 'Meta API returned an empty JSON response') return fallback;
    if (code === 190 || status === 401) return 'Meta access token is invalid or expired';
    if (status === 429 || [4, 17, 32, 613].includes(code)) return 'Meta rate limit reached';
    if (status === 403 || [10, 200, 299].includes(code)) return 'Meta permission is missing or denied';
    if (RETRYABLE_META_STATUS.has(status)) return 'Meta service is temporarily unavailable';
    if (hasMetaError) return 'Meta rejected the request';
    return 'Meta API request failed';
};

export const normalizePublicMetaError = (data, status, fallback = 'Meta API request failed') => {
    const source = data?.error && typeof data.error === 'object' ? data.error : {};
    const safeStatus = normalizeHttpStatus(status);
    const code = Number.isSafeInteger(source.code) && source.code >= 0 ? source.code : null;
    const rawSubcode = source.error_subcode ?? source.subcode;
    const subcode = Number.isSafeInteger(rawSubcode) && rawSubcode >= 0 ? rawSubcode : null;
    return {
        message: safeMetaMessage(code, safeStatus, fallback, source.message, !!data?.error),
        type: PUBLIC_META_TYPES.has(source.type) ? source.type : null,
        code,
        subcode,
        status: safeStatus,
        retryable: RETRYABLE_META_STATUS.has(safeStatus)
            || source.is_transient === true
            || source.retryable === true,
    };
};

// Log only fixed classifications. Fetch exceptions can include credentials in their
// message, cause, request URL, or custom properties; never log the exception object.
export const summarizeMetaException = error => ({
    name: SAFE_EXCEPTION_NAMES.has(error?.name) ? error.name : 'Error',
    code: SAFE_EXCEPTION_CODES.has(error?.code) ? error.code : null,
});

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

export const readMetaResponse = async response => {
    const { data, parseError } = await readMetaJson(response);
    const missingBody = data === null && response.status !== 204;
    const ok = response.ok && !parseError && !missingBody && !data?.error;
    const status = response.ok && data?.error ? 502 : response.status;
    const error = ok
        ? null
        : normalizePublicMetaError(
            data,
            status,
            parseError?.message || (missingBody
                ? 'Meta API returned an empty JSON response'
                : 'Meta API request failed')
        );

    // Failed upstream bodies are untrusted and may contain credentials or request URLs.
    // Callers receive only the normalized error, never the raw failure payload.
    return { ok, status, data: ok ? data : null, error, headers: response.headers };
};

export const sendMetaFailure = (res, result, fallback = 'Meta API request failed', extra = {}) => {
    const details = result?.error
        ? normalizePublicMetaError({ error: result.error }, result.status, fallback)
        : normalizePublicMetaError(null, 502, fallback);
    // The fallback is code-owned route copy, used only to select language. Never
    // echo it: an accidental dynamic fallback could itself contain a secret.
    const arabic = typeof fallback === 'string' && /[\u0600-\u06ff]/.test(fallback);
    const message = arabic
        ? (ARABIC_META_MESSAGES[details.message] || 'فشل طلب Meta')
        : details.message;
    return res.status(normalizeHttpStatus(result?.status)).json({
        ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}),
        error: message,
        details: { ...details, message },
    });
};

export const requestMetaJson = async (url, init = {}, { fetchImpl = globalThis.fetch } = {}) => {
    const response = await fetchImpl(url, init);
    return readMetaResponse(response);
};
