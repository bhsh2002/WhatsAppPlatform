import {
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
} from '../config/index.js';

export const FACEBOOK_CONTENT_PROMPT_VERSION = 'facebook-content-v1';

const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        variants: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string', maxLength: 160 },
                    body: { type: 'string', maxLength: 5000 },
                    hashtags: {
                        type: 'array',
                        maxItems: 12,
                        items: { type: 'string', maxLength: 80 },
                    },
                    cta: { type: 'string', maxLength: 300 },
                },
                required: ['title', 'body', 'hashtags', 'cta'],
                additionalProperties: false,
            },
        },
    },
    required: ['variants'],
    additionalProperties: false,
};

const contentText = value => String(value || '').trim();
const listText = value => (Array.isArray(value) ? value : [])
    .map(item => contentText(item))
    .filter(Boolean);

const productFacts = product => {
    if (!product) return 'لا يوجد منتج مرتبط بهذا الطلب.';
    return JSON.stringify({
        name: product.name || null,
        description: product.description || null,
        price: Number(product.price || 0),
        currency: product.currency || 'LYD',
        category: product.category || null,
        sku: product.sku || null,
        product_url: product.product_url || null,
        availability: product.availability || null,
    });
};

export const buildFacebookContentPrompt = ({
    action,
    inputText,
    product,
    settings,
    variants = 1,
} = {}) => {
    const instructions = [
        'أنت مساعد تحرير متخصص في كتابة منشورات أصلية لصفحات Facebook التجارية.',
        'اكتب بلغة العميل المحددة، وبأسلوب بشري طبيعي بعيد عن العبارات العامة والنمط الآلي.',
        'لا تخترع أسعاراً أو روابط أو مواصفات أو عروضاً. حقائق المنتج المعطاة ثابتة ولا يجوز تغييرها.',
        'لا تستخدم أياً من الكلمات الممنوعة. ضمّن الكلمات المطلوبة عندما تكون ملائمة.',
        'أعد نصاً صالحاً للنشر مباشرة، مع فقرات قصيرة ودعوة واضحة مناسبة.',
        'لا تذكر أنك نموذج ذكاء اصطناعي ولا تشرح خطواتك.',
    ].join(' ');
    const input = [
        `نوع المهمة: ${action === 'rewrite' ? 'إعادة صياغة' : action === 'variants' ? 'إنشاء بدائل' : 'توليد محتوى'}.`,
        `عدد البدائل المطلوب: ${Math.min(Math.max(Number(variants) || 1, 1), 5)}.`,
        `اللغة: ${settings.language || 'ar'}.`,
        `النبرة: ${settings.tone || 'professional'}.`,
        `هوية الكتابة: ${settings.brand_voice || 'واضحة، موثوقة، ومباشرة'}.`,
        `الجمهور: ${settings.audience || 'عملاء الصفحة المحتملون والحاليون'}.`,
        `الدعوة الافتراضية: ${settings.default_cta || 'اختر دعوة مناسبة غير مبالغ فيها'}.`,
        `مستوى الرموز التعبيرية: ${settings.emoji_level || 'light'}.`,
        `الكلمات المطلوبة: ${listText(settings.required_terms).join('، ') || 'لا توجد'}.`,
        `الكلمات الممنوعة: ${listText(settings.banned_terms).join('، ') || 'لا توجد'}.`,
        `وسوم الصفحة المفضلة: ${listText(settings.hashtags).join('، ') || 'لا توجد'}.`,
        `حقائق المنتج غير القابلة للتغيير: ${productFacts(product)}.`,
        `النص أو الفكرة المدخلة: ${contentText(inputText) || 'أنشئ منشوراً مناسباً من حقائق المنتج وهوية الصفحة.'}`,
    ].join('\n');
    return { instructions, input };
};

export const extractStructuredFacebookContent = response => {
    if (response?.status === 'incomplete') {
        const error = new Error('استجابة التوليد غير مكتملة');
        error.code = response.incomplete_details?.reason || 'AI_INCOMPLETE';
        throw error;
    }
    const message = Array.isArray(response?.output)
        ? response.output.find(item => item?.type === 'message')
        : null;
    const content = Array.isArray(message?.content) ? message.content[0] : null;
    if (content?.type === 'refusal') {
        const error = new Error(content.refusal || 'رفض مزود الذكاء الاصطناعي الطلب');
        error.code = 'AI_REFUSAL';
        error.refused = true;
        throw error;
    }
    if (content?.type !== 'output_text' || !content.text) {
        const error = new Error('لم يرجع مزود الذكاء الاصطناعي محتوى صالحاً');
        error.code = 'AI_EMPTY_RESPONSE';
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(content.text);
    } catch {
        const error = new Error('تعذر قراءة المحتوى المولد');
        error.code = 'AI_INVALID_JSON';
        throw error;
    }
    if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
        const error = new Error('لم يتم توليد أي بديل');
        error.code = 'AI_NO_VARIANTS';
        throw error;
    }
    return parsed.variants.map(variant => ({
        title: contentText(variant.title).slice(0, 160),
        body: contentText(variant.body).slice(0, 5000),
        hashtags: listText(variant.hashtags).slice(0, 12),
        cta: contentText(variant.cta).slice(0, 300),
    })).filter(variant => variant.title && variant.body);
};

const enforceContentPolicy = (variants, settings) => {
    const banned = listText(settings.banned_terms).map(term => term.toLocaleLowerCase('ar'));
    const accepted = variants.filter(variant => {
        const text = `${variant.title}\n${variant.body}\n${variant.cta}`.toLocaleLowerCase('ar');
        return !banned.some(term => term && text.includes(term));
    });
    if (!accepted.length) {
        const error = new Error('المحتوى المولد خالف قائمة الكلمات الممنوعة');
        error.code = 'AI_POLICY_VIOLATION';
        throw error;
    }
    return accepted;
};

export async function requestFacebookContent({
    action = 'generate',
    inputText = '',
    product = null,
    settings = {},
    variants = 1,
    fetchImpl = globalThis.fetch,
    apiKey = OPENAI_API_KEY,
    model = OPENAI_MODEL,
    baseUrl = OPENAI_BASE_URL,
} = {}) {
    if (!apiKey) {
        const error = new Error('مفتاح مزود الذكاء الاصطناعي غير مضبوط على الخادم');
        error.status = 503;
        error.code = 'AI_NOT_CONFIGURED';
        throw error;
    }
    if (!['generate', 'rewrite', 'variants'].includes(action)) {
        const error = new Error('نوع طلب التوليد غير صالح');
        error.status = 400;
        error.code = 'INVALID_AI_ACTION';
        throw error;
    }
    if (action === 'rewrite' && !contentText(inputText)) {
        const error = new Error('النص مطلوب لإعادة الصياغة');
        error.status = 400;
        error.code = 'AI_INPUT_REQUIRED';
        throw error;
    }

    const prompt = buildFacebookContentPrompt({
        action,
        inputText,
        product,
        settings,
        variants,
    });
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            reasoning: { effort: 'low' },
            instructions: prompt.instructions,
            input: prompt.input,
            max_output_tokens: 1400,
            text: {
                format: {
                    type: 'json_schema',
                    name: 'facebook_content_variants',
                    schema: OUTPUT_SCHEMA,
                    strict: true,
                },
            },
        }),
    });
    let data;
    try {
        data = await response.json();
    } catch {
        const error = new Error('مزود الذكاء الاصطناعي أعاد استجابة غير صالحة');
        error.status = 502;
        error.code = 'AI_INVALID_RESPONSE';
        throw error;
    }
    if (!response.ok) {
        const error = new Error(data?.error?.message || `فشل طلب التوليد (${response.status})`);
        error.status = response.status === 429 ? 429 : 502;
        error.code = data?.error?.code || 'AI_PROVIDER_ERROR';
        throw error;
    }
    const output = enforceContentPolicy(extractStructuredFacebookContent(data), settings);
    return {
        variants: output,
        model: data.model || model,
        response_id: data.id || null,
        usage: {
            input_tokens: Number(data.usage?.input_tokens) || null,
            output_tokens: Number(data.usage?.output_tokens) || null,
        },
        prompt_version: FACEBOOK_CONTENT_PROMPT_VERSION,
    };
}
