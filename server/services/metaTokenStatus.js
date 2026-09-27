const DEFAULT_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export const classifyMetaTokenStatus = (tokenData, {
    now = Date.now(),
    expiryWarningMs = DEFAULT_EXPIRY_WARNING_MS,
} = {}) => {
    if (tokenData?.is_valid !== true) return 'invalid';

    const expiresAtSeconds = Number(tokenData?.expires_at);
    if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0) return 'valid';

    const expiresAt = expiresAtSeconds * 1000;
    if (expiresAt <= now) return 'expired';
    if (expiresAt <= now + expiryWarningMs) return 'expiring';
    return 'valid';
};

export const isMetaTokenReady = status => status === 'valid';

export const isMetaTokenExpiring = status => status === 'expiring';

