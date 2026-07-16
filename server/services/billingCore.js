export const BILLING_OPERATIONS = Object.freeze({
    WHATSAPP_TEXT: 'whatsapp.text',
    WHATSAPP_TEMPLATE: 'whatsapp.template',
    WHATSAPP_MEDIA: 'whatsapp.media',
    WHATSAPP_INTERACTIVE: 'whatsapp.interactive',
    WHATSAPP_BROADCAST_RECIPIENT: 'whatsapp.broadcast_recipient',
    WHATSAPP_CONTACT_VERIFICATION_TEMPLATE: 'whatsapp.contact_verification_template',
    MESSENGER_REPLY: 'messenger.reply',
    MESSENGER_UTILITY: 'messenger.utility',
    MESSENGER_BOT_REPLY: 'messenger.bot_reply',
    FACEBOOK_POST_CREATE: 'facebook.post_create',
    FACEBOOK_POST_EDIT: 'facebook.post_edit',
    FACEBOOK_POST_DELETE: 'facebook.post_delete',
    FACEBOOK_PHOTO_POST_CREATE: 'facebook.photo_post_create',
    FACEBOOK_COMMENT_REPLY: 'facebook.comment_reply',
    FACEBOOK_COMMENT_HIDE: 'facebook.comment_hide',
    FACEBOOK_COMMENT_LIKE: 'facebook.comment_like',
    FACEBOOK_COMMENT_UNLIKE: 'facebook.comment_unlike',
    FACEBOOK_COMMENT_DELETE: 'facebook.comment_delete',
    FACEBOOK_POST_LIKE: 'facebook.post_like',
    FACEBOOK_POST_UNLIKE: 'facebook.post_unlike',
    FACEBOOK_POST_COMMENT: 'facebook.post_comment',
    FACEBOOK_AI_GENERATION: 'facebook.ai_generation',
    WHATSAPP_EVENT_CONVERSION: 'whatsapp.event_conversion',
});

export class BillingError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'BillingError';
        this.status = details.status || 402;
        this.code = details.code || 'INSUFFICIENT_BALANCE';
        this.details = details;
    }

    toResponse() {
        return {
            success: false,
            error: this.message,
            code: this.code,
            ...this.details,
        };
    }
}

export const toInt = (value, fallback = 0) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const serializeJson = (value) => {
    if (value === undefined || value === null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({ unparseable: true });
    }
};

export const normalizeMetaCategory = (value) => {
    const category = String(value || '').trim().toLowerCase();
    if (['marketing', 'marketing_lite', 'utility', 'authentication', 'authentication_international', 'service', 'referral_conversion'].includes(category)) {
        return category;
    }
    return category || null;
};

export const normalizePricingType = (value) => String(value || '').trim().toLowerCase();

export const normalizePhoneDigits = (value) => String(value || '').replace(/[^\d]/g, '');

export const normalizeBillableFlag = (value) => {
    if (value === true || value === 1 || value === 'true') return 1;
    if (value === false || value === 0 || value === 'false') return 0;
    return null;
};

export const normalizeStatusPricing = (pricing = null) => {
    if (!pricing) return null;
    return {
        pricing_model: pricing.pricing_model || pricing.model || null,
        billable: normalizeBillableFlag(pricing.billable),
        category: normalizeMetaCategory(pricing.category || pricing.pricing_category),
        type: normalizePricingType(pricing.type || pricing.pricing_type),
    };
};

export function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

export function handleBillingError(res, error) {
    if (error instanceof BillingError) {
        return res.status(error.status).json(error.toResponse());
    }
    return null;
}
