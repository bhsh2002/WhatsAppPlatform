import { workspaceLabel } from './connectionsDataPresentation.js';

const stages = new Set(['idle', 'authorizing', 'business', 'account', 'phone', 'connected', 'expired']);
const codes = new Set(['authorize', 'await_authorization', 'choose_business', 'choose_account', 'choose_phone', 'connected', 'restart_authorization', 'configure_meta']);
const text = (value, max = 1024) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const named = value => Boolean(workspaceLabel(value, null));
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));

export const guidedWhatsAppStatusIsValid = (value, now = Date.now()) => Boolean(exact(value,
    ['stage', 'configured', 'expires_at', 'choices', 'connection', 'next_action', 'webhook_status', 'authorization_url', 'state'])
    && stages.has(value.stage) && typeof value.configured === 'boolean' && (value.expires_at === null || date(value.expires_at))
    && (!['authorizing', 'business', 'account', 'phone'].includes(value.stage) || (date(value.expires_at) && Date.parse(value.expires_at) > now))
    && Array.isArray(value.choices) && value.choices.every(row => exact(row, ['value', 'label', 'detail'])
        && text(row.value, 16_384) && named(row.label) && typeof row.detail === 'string')
    && new Set(value.choices.map(row => row.value)).size === value.choices.length
    && (['business', 'account', 'phone'].includes(value.stage) || value.choices.length === 0)
    && exact(value.connection, ['connected', 'numbers']) && typeof value.connection.connected === 'boolean'
    && Array.isArray(value.connection.numbers) && value.connection.numbers.every(row => exact(row, ['label', 'is_default'])
        && named(row.label) && typeof row.is_default === 'boolean')
    && value.connection.connected === (value.connection.numbers.length > 0)
    && (value.stage !== 'connected' || value.connection.connected)
    && exact(value.next_action, ['code', 'label', 'href']) && codes.has(value.next_action.code) && named(value.next_action.label)
    && value.next_action.href === '/portal/integrations'
    && ['confirmed', 'unknown', 'not_checked'].includes(value.webhook_status));

export const guidedWhatsAppAuthorizationUrl = (value, { appOrigin, state } = {}) => {
    if (!text(value, 8192) || !text(state)) return null;
    try {
        const url = new URL(value), app = new URL(appOrigin);
        const callback = new URL(url.searchParams.get('redirect_uri'));
        const meta = url.protocol === 'https:' && url.hostname === 'www.facebook.com' && !url.port;
        const local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && app.protocol === 'http:'
            && ['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname);
        if (!(meta || local) || url.username || url.password || url.hash || !/^\/v\d+\.\d+\/dialog\/oauth$/.test(url.pathname)
            || callback.origin !== app.origin || callback.pathname !== '/auth/facebook/callback' || callback.search || callback.hash || callback.username || callback.password
            || ['state', 'response_type', 'redirect_uri'].some(key => url.searchParams.getAll(key).length !== 1)
            || url.searchParams.get('state') !== state || url.searchParams.get('response_type') !== 'code'
            || [...url.searchParams.keys()].some(key => ['access_token', 'refresh_token', 'id_token', 'client_secret', 'password', 'token', 'code'].includes(key.toLowerCase()))) return null;
        return url.href;
    } catch { return null; }
};

export const matchMetaOAuthPopup = ({ event, origin, popup, state }) => Boolean(popup && text(state)
    && event?.origin === origin && event.source === popup && event.data?.state === state
    && ['FB_OAUTH_CALLBACK', 'FB_OAUTH_ERROR'].includes(event.data?.type)
    && (event.data.type !== 'FB_OAUTH_CALLBACK' || text(event.data.code, 8192)));

export const guidedWhatsAppPopupMessage = ({ event, origin, popup, state, expiresAt, now = Date.now() }) => {
    if (!date(expiresAt) || Date.parse(expiresAt) <= now || !matchMetaOAuthPopup({ event, origin, popup, state })) return null;
    return event.data.type === 'FB_OAUTH_CALLBACK' ? { kind: 'complete', code: event.data.code, state } : { kind: 'error' };
};

export const guidedWhatsAppChoice = (document, value, expectedStage, now = Date.now()) => guidedWhatsAppStatusIsValid(document, now)
    && document.configured && document.stage === expectedStage ? document.choices.find(row => row.value === value) || null : null;
export const guidedWhatsAppReviewKey = document => JSON.stringify([document?.stage, document?.expires_at,
    document?.choices?.map(row => [row.value, row.label, row.detail]), document?.connection]);
export const whatsappNumberDisplayName = number => workspaceLabel(number?.label, null)
    || workspaceLabel(number?.verified_name, null) || workspaceLabel(number?.display_phone_number, null) || null;
