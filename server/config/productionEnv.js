const PLACEHOLDER_MARKERS = [
    'change-me',
    'example',
    'placeholder',
    'replace-me',
    'secret',
    'your-',
];

const REQUIRED_PRODUCTION_VALUES = [
    'JWT_SECRET',
    'CRYPTO_KEY',
    'METRICS_TOKEN',
    'WEBHOOK_VERIFY_TOKEN',
    'META_APP_ID',
    'META_APP_SECRET',
    'META_WEBHOOK_CALLBACK_URL',
    'FACEBOOK_REDIRECT_URI',
    'WA_EMBEDDED_SIGNUP_CONFIG_ID',
    'PUBLIC_APP_URL',
    'CORS_ORIGINS',
    'SMS_GATEWAY_CALLBACK_BASE_URL',
    'SMS_GATEWAY_PROVISIONING_SECRET',
];

const normalized = value => String(value || '').trim();

const isPlaceholder = value => PLACEHOLDER_MARKERS.some(marker => (
    normalized(value).toLowerCase().includes(marker)
));

const parseUrl = (value, name, errors) => {
    try {
        const url = new URL(normalized(value));
        if (url.username || url.password || url.search || url.hash) {
            errors.push(`${name} must not contain credentials, a query, or a fragment`);
        }
        return url;
    } catch {
        errors.push(`${name} must be a valid absolute URL`);
        return null;
    }
};

const requireHttps = (url, name, errors) => {
    if (url && url.protocol !== 'https:') {
        errors.push(`${name} must use HTTPS`);
    }
};

const requireSameOrigin = (url, publicUrl, name, errors) => {
    if (url && publicUrl && url.origin !== publicUrl.origin) {
        errors.push(`${name} must use the PUBLIC_APP_URL origin`);
    }
};

export function validateProductionEnv(env = process.env) {
    if (normalized(env.NODE_ENV).toLowerCase() !== 'production') return;

    const errors = [];
    const missing = REQUIRED_PRODUCTION_VALUES.filter(name => !normalized(env[name]));
    if (missing.length > 0) {
        errors.push(`missing required values: ${missing.join(', ')}`);
    }

    if (normalized(env.JWT_SECRET).length < 32 || isPlaceholder(env.JWT_SECRET)) {
        errors.push('JWT_SECRET must be at least 32 non-placeholder characters');
    }
    if (!/^[0-9a-f]{64}$/i.test(normalized(env.CRYPTO_KEY))) {
        errors.push('CRYPTO_KEY must be exactly 64 hexadecimal characters');
    }
    if (normalized(env.METRICS_TOKEN).length < 32 || isPlaceholder(env.METRICS_TOKEN)) {
        errors.push('METRICS_TOKEN must be at least 32 non-placeholder characters');
    }
    if (
        normalized(env.WEBHOOK_VERIFY_TOKEN).length < 32
        || isPlaceholder(env.WEBHOOK_VERIFY_TOKEN)
    ) {
        errors.push('WEBHOOK_VERIFY_TOKEN must be at least 32 non-placeholder characters');
    }
    if (normalized(env.META_APP_SECRET).length < 32 || isPlaceholder(env.META_APP_SECRET)) {
        errors.push('META_APP_SECRET must be at least 32 non-placeholder characters');
    }
    if (
        normalized(env.SMS_GATEWAY_PROVISIONING_SECRET).length < 32
        || isPlaceholder(env.SMS_GATEWAY_PROVISIONING_SECRET)
    ) {
        errors.push('SMS_GATEWAY_PROVISIONING_SECRET must be at least 32 non-placeholder characters');
    }
    if (!/^\d{5,}$/.test(normalized(env.META_APP_ID))) {
        errors.push('META_APP_ID must be a numeric Meta application ID');
    }
    if (!/^\d{5,}$/.test(normalized(env.WA_EMBEDDED_SIGNUP_CONFIG_ID))) {
        errors.push('WA_EMBEDDED_SIGNUP_CONFIG_ID must be a numeric Meta configuration ID');
    }

    const sensitiveValues = [
        env.JWT_SECRET,
        env.CRYPTO_KEY,
        env.METRICS_TOKEN,
        env.WEBHOOK_VERIFY_TOKEN,
        env.META_APP_SECRET,
        env.SMS_GATEWAY_PROVISIONING_SECRET,
    ].map(normalized).filter(Boolean);
    if (new Set(sensitiveValues).size !== sensitiveValues.length) {
        errors.push('production secrets and tokens must be distinct');
    }

    const publicUrl = parseUrl(env.PUBLIC_APP_URL, 'PUBLIC_APP_URL', errors);
    requireHttps(publicUrl, 'PUBLIC_APP_URL', errors);
    if (
        publicUrl
        && (publicUrl.pathname !== '/' || publicUrl.port)
    ) {
        errors.push('PUBLIC_APP_URL must be an HTTPS origin without a path or explicit port');
    }

    const corsOrigins = normalized(env.CORS_ORIGINS)
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
    if (corsOrigins.length === 0) {
        errors.push('CORS_ORIGINS must contain at least PUBLIC_APP_URL');
    }
    const parsedCorsOrigins = corsOrigins.map((origin, index) => {
        const url = parseUrl(origin, `CORS_ORIGINS entry ${index + 1}`, errors);
        requireHttps(url, `CORS_ORIGINS entry ${index + 1}`, errors);
        if (url && (url.pathname !== '/' || url.port || url.origin !== origin)) {
            errors.push(`CORS_ORIGINS entry ${index + 1} must be an HTTPS origin only`);
        }
        return url?.origin;
    }).filter(Boolean);
    if (publicUrl && !parsedCorsOrigins.includes(publicUrl.origin)) {
        errors.push('CORS_ORIGINS must include PUBLIC_APP_URL');
    }

    const metaWebhookUrl = parseUrl(
        env.META_WEBHOOK_CALLBACK_URL,
        'META_WEBHOOK_CALLBACK_URL',
        errors,
    );
    requireHttps(metaWebhookUrl, 'META_WEBHOOK_CALLBACK_URL', errors);
    requireSameOrigin(metaWebhookUrl, publicUrl, 'META_WEBHOOK_CALLBACK_URL', errors);
    if (metaWebhookUrl && metaWebhookUrl.pathname !== '/api/webhook') {
        errors.push('META_WEBHOOK_CALLBACK_URL must end with /api/webhook');
    }

    const facebookRedirectUrl = parseUrl(
        env.FACEBOOK_REDIRECT_URI,
        'FACEBOOK_REDIRECT_URI',
        errors,
    );
    requireHttps(facebookRedirectUrl, 'FACEBOOK_REDIRECT_URI', errors);
    requireSameOrigin(facebookRedirectUrl, publicUrl, 'FACEBOOK_REDIRECT_URI', errors);
    if (facebookRedirectUrl && facebookRedirectUrl.pathname !== '/auth/facebook/callback') {
        errors.push('FACEBOOK_REDIRECT_URI must end with /auth/facebook/callback');
    }

    const smsCallbackUrl = parseUrl(
        env.SMS_GATEWAY_CALLBACK_BASE_URL,
        'SMS_GATEWAY_CALLBACK_BASE_URL',
        errors,
    );
    requireHttps(smsCallbackUrl, 'SMS_GATEWAY_CALLBACK_BASE_URL', errors);
    requireSameOrigin(smsCallbackUrl, publicUrl, 'SMS_GATEWAY_CALLBACK_BASE_URL', errors);
    if (
        smsCallbackUrl
        && smsCallbackUrl.pathname !== '/api/integrations/sms-gateway/events'
    ) {
        errors.push(
            'SMS_GATEWAY_CALLBACK_BASE_URL must end with '
            + '/api/integrations/sms-gateway/events'
        );
    }

    const integrationFlag = normalized(env.SAVANA_INTEGRATIONS_ENABLED).toLowerCase();
    if (integrationFlag && !['0', '1', 'false', 'true'].includes(integrationFlag)) {
        errors.push('SAVANA_INTEGRATIONS_ENABLED must be true, false, 1, or 0');
    }

    if (errors.length > 0) {
        throw new Error(`Invalid production environment:\n- ${errors.join('\n- ')}`);
    }
}
