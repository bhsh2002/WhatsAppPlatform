import {
    isValidTimeZone,
    normalizeScheduleDays,
    normalizeScheduleTimes,
    normalizeTimeZone,
    parseStoredList,
} from '../services/facebookContentSchedule.js';
import { requireTenant, validateLinkedPage } from './messengerBotShared.js';

export const CONTENT_ITEM_STATUSES = new Set(['draft', 'review', 'approved', 'archived']);
export const CONTENT_ITEM_KINDS = new Set(['manual', 'product', 'ai']);
export const APPROVAL_MODES = new Set(['manual', 'approved_only', 'automatic']);
export const EMOJI_LEVELS = new Set(['none', 'light', 'medium']);

export const DEFAULT_CONTENT_SETTINGS = Object.freeze({
    timezone: 'Africa/Tripoli',
    language: 'ar',
    tone: 'professional',
    brand_voice: '',
    audience: '',
    default_cta: '',
    required_terms: [],
    banned_terms: [],
    hashtags: [],
    emoji_level: 'light',
    approval_mode: 'manual',
    allowed_days: [0, 1, 2, 3, 4, 5, 6],
    posting_start_time: '08:00',
    posting_end_time: '22:00',
    daily_post_limit: 3,
    no_repeat_days: 14,
    ai_enabled: true,
    auto_pause_failures: 3,
});

export const contentError = (message, status = 400, code = 'INVALID_CONTENT_INPUT') => {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
};

export const boundedText = (value, {
    field,
    max,
    required = false,
    fallback = null,
} = {}) => {
    const normalized = String(value ?? '').trim();
    if (required && !normalized) throw contentError(`${field} مطلوب`, 400, 'REQUIRED_FIELD');
    if (normalized.length > max) {
        throw contentError(`${field} يتجاوز الحد الأقصى ${max} حرفاً`, 400, 'FIELD_TOO_LONG');
    }
    return normalized || fallback;
};

export const boundedInteger = (value, {
    field,
    min,
    max,
    fallback,
} = {}) => {
    const parsed = Number.parseInt(value, 10);
    const normalized = Number.isInteger(parsed) ? parsed : fallback;
    if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
        throw contentError(`${field} يجب أن يكون بين ${min} و${max}`, 400, 'INVALID_NUMBER');
    }
    return normalized;
};

export const booleanValue = (value, fallback = false) => {
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
    return fallback;
};

export const normalizeStringList = (value, { maxItems = 30, maxLength = 80 } = {}) => {
    const source = Array.isArray(value) ? value : parseStoredList(value, []);
    return [...new Set(source
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(item => item.slice(0, maxLength)))]
        .slice(0, maxItems);
};

export const normalizeOptionalUrl = (value, field = 'الرابط') => {
    const normalized = boundedText(value, { field, max: 2048, fallback: null });
    if (!normalized) return null;
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        throw contentError(`${field} غير صالح`, 400, 'INVALID_URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw contentError(`${field} يجب أن يكون HTTP أو HTTPS من دون بيانات دخول`, 400, 'INVALID_URL');
    }
    return parsed.toString();
};

export const requireContentTenant = (database, req, res) => requireTenant(database, req, res);

export const requireContentPage = (database, tenantId, linkedPageId) => {
    const pageId = Number.parseInt(linkedPageId, 10);
    if (!Number.isInteger(pageId)) {
        throw contentError('صفحة Facebook مطلوبة', 400, 'PAGE_REQUIRED');
    }
    const page = validateLinkedPage(database, tenantId, pageId);
    if (!page) throw contentError('صفحة Facebook غير موجودة أو غير مفعلة', 404, 'PAGE_NOT_FOUND');
    return page;
};

export const requireSharedProduct = (database, tenantId, productId, {
    activeOnly = false,
} = {}) => {
    const id = Number.parseInt(productId, 10);
    if (!Number.isInteger(id)) throw contentError('المنتج غير صالح', 400, 'INVALID_PRODUCT');
    const product = database.prepare(`
        SELECT p.*,
               (
                   SELECT image_url
                   FROM bot_product_images
                   WHERE product_id = p.id AND tenant_id = p.tenant_id
                   ORDER BY is_primary DESC, sort_order ASC, id ASC
                   LIMIT 1
               ) AS primary_image_url
        FROM bot_products p
        WHERE p.id = ? AND p.tenant_id = ?
          ${activeOnly ? "AND p.is_active = 1 AND p.availability = 'available'" : ''}
        LIMIT 1
    `).get(id, tenantId);
    if (!product) throw contentError('المنتج غير موجود أو غير متاح', 404, 'PRODUCT_NOT_FOUND');
    return {
        ...product,
        image_url: product.primary_image_url || product.image_url || null,
    };
};

export const renderProductPost = (template, product) => {
    const price = Number(product.price || 0);
    const values = {
        name: product.name,
        price: price ? price.toLocaleString('ar-LY') : '',
        currency: product.currency || 'LYD',
        description: product.description || '',
        category: product.category || '',
        sku: product.sku || '',
        url: product.product_url || '',
    };
    const fallback = [
        product.name,
        product.description,
        price ? `${values.price} ${values.currency}` : '',
        product.product_url,
    ].filter(Boolean).join('\n\n');
    const source = String(template || '').trim() || fallback;
    return source
        .replace(/\{(name|price|currency|description|category|sku|url)\}/g, (_, key) => values[key])
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

export const presentContentSettings = row => {
    const source = row || {};
    return {
        id: source.id || null,
        tenant_id: source.tenant_id || null,
        linked_page_id: source.linked_page_id || null,
        timezone: normalizeTimeZone(source.timezone || DEFAULT_CONTENT_SETTINGS.timezone),
        language: source.language || DEFAULT_CONTENT_SETTINGS.language,
        tone: source.tone || DEFAULT_CONTENT_SETTINGS.tone,
        brand_voice: source.brand_voice || '',
        audience: source.audience || '',
        default_cta: source.default_cta || '',
        required_terms: normalizeStringList(source.required_terms_json),
        banned_terms: normalizeStringList(source.banned_terms_json),
        hashtags: normalizeStringList(source.hashtags_json),
        emoji_level: EMOJI_LEVELS.has(source.emoji_level)
            ? source.emoji_level
            : DEFAULT_CONTENT_SETTINGS.emoji_level,
        approval_mode: APPROVAL_MODES.has(source.approval_mode)
            ? source.approval_mode
            : DEFAULT_CONTENT_SETTINGS.approval_mode,
        allowed_days: normalizeScheduleDays(parseStoredList(source.allowed_days_json, DEFAULT_CONTENT_SETTINGS.allowed_days)),
        posting_start_time: normalizeScheduleTimes([source.posting_start_time || DEFAULT_CONTENT_SETTINGS.posting_start_time])[0],
        posting_end_time: normalizeScheduleTimes([source.posting_end_time || DEFAULT_CONTENT_SETTINGS.posting_end_time])[0],
        daily_post_limit: boundedInteger(source.daily_post_limit, {
            field: 'الحد اليومي',
            min: 1,
            max: 24,
            fallback: DEFAULT_CONTENT_SETTINGS.daily_post_limit,
        }),
        no_repeat_days: boundedInteger(source.no_repeat_days, {
            field: 'فترة منع التكرار',
            min: 0,
            max: 365,
            fallback: DEFAULT_CONTENT_SETTINGS.no_repeat_days,
        }),
        ai_enabled: booleanValue(source.ai_enabled, DEFAULT_CONTENT_SETTINGS.ai_enabled),
        auto_pause_failures: boundedInteger(source.auto_pause_failures, {
            field: 'حد أخطاء الإيقاف',
            min: 1,
            max: 20,
            fallback: DEFAULT_CONTENT_SETTINGS.auto_pause_failures,
        }),
        created_at: source.created_at || null,
        updated_at: source.updated_at || null,
    };
};

export const getEffectiveContentSettings = (database, tenantId, linkedPageId = null) => {
    const pageSettings = linkedPageId
        ? database.prepare(`
            SELECT *
            FROM facebook_content_settings
            WHERE tenant_id = ? AND linked_page_id = ?
            LIMIT 1
        `).get(tenantId, linkedPageId)
        : null;
    const tenantSettings = database.prepare(`
        SELECT *
        FROM facebook_content_settings
        WHERE tenant_id = ? AND linked_page_id IS NULL
        LIMIT 1
    `).get(tenantId);
    return presentContentSettings(pageSettings || tenantSettings || {
        tenant_id: tenantId,
        linked_page_id: linkedPageId || null,
        ...DEFAULT_CONTENT_SETTINGS,
    });
};

export const normalizeContentSettingsInput = (body = {}, current = DEFAULT_CONTENT_SETTINGS) => {
    const timezone = body.timezone ?? current.timezone;
    if (!isValidTimeZone(timezone)) {
        throw contentError('المنطقة الزمنية غير صالحة', 400, 'INVALID_TIMEZONE');
    }
    const emojiLevel = body.emoji_level ?? current.emoji_level;
    const approvalMode = body.approval_mode ?? current.approval_mode;
    if (!EMOJI_LEVELS.has(emojiLevel)) throw contentError('مستوى الرموز التعبيرية غير صالح');
    if (!APPROVAL_MODES.has(approvalMode)) throw contentError('وضع الموافقة غير صالح');

    return {
        timezone: normalizeTimeZone(timezone),
        language: boundedText(body.language ?? current.language, {
            field: 'اللغة',
            max: 16,
            required: true,
        }),
        tone: boundedText(body.tone ?? current.tone, {
            field: 'النبرة',
            max: 80,
            required: true,
        }),
        brand_voice: boundedText(body.brand_voice ?? current.brand_voice, {
            field: 'هوية الكتابة',
            max: 2000,
            fallback: null,
        }),
        audience: boundedText(body.audience ?? current.audience, {
            field: 'الجمهور',
            max: 1000,
            fallback: null,
        }),
        default_cta: boundedText(body.default_cta ?? current.default_cta, {
            field: 'الدعوة لاتخاذ إجراء',
            max: 300,
            fallback: null,
        }),
        required_terms: normalizeStringList(body.required_terms ?? current.required_terms),
        banned_terms: normalizeStringList(body.banned_terms ?? current.banned_terms),
        hashtags: normalizeStringList(body.hashtags ?? current.hashtags),
        emoji_level: emojiLevel,
        approval_mode: approvalMode,
        allowed_days: normalizeScheduleDays(body.allowed_days ?? current.allowed_days),
        posting_start_time: normalizeScheduleTimes([body.posting_start_time ?? current.posting_start_time])[0],
        posting_end_time: normalizeScheduleTimes([body.posting_end_time ?? current.posting_end_time])[0],
        daily_post_limit: boundedInteger(body.daily_post_limit ?? current.daily_post_limit, {
            field: 'الحد اليومي',
            min: 1,
            max: 24,
            fallback: DEFAULT_CONTENT_SETTINGS.daily_post_limit,
        }),
        no_repeat_days: boundedInteger(body.no_repeat_days ?? current.no_repeat_days, {
            field: 'فترة منع التكرار',
            min: 0,
            max: 365,
            fallback: DEFAULT_CONTENT_SETTINGS.no_repeat_days,
        }),
        ai_enabled: booleanValue(body.ai_enabled, current.ai_enabled),
        auto_pause_failures: boundedInteger(body.auto_pause_failures ?? current.auto_pause_failures, {
            field: 'حد أخطاء الإيقاف',
            min: 1,
            max: 20,
            fallback: DEFAULT_CONTENT_SETTINGS.auto_pause_failures,
        }),
    };
};

export const sendContentError = (res, error, fallback = 'فشلت عملية استوديو المحتوى') => {
    if (error?.status) {
        return res.status(error.status).json({
            error: error.message,
            code: error.code || 'CONTENT_STUDIO_ERROR',
        });
    }
    console.error('[FacebookContentStudio]', error);
    return res.status(500).json({ error: fallback, code: 'CONTENT_STUDIO_ERROR' });
};
