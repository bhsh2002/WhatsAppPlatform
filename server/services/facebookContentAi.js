import {
    AI_FALLBACK_PROVIDER,
    AI_PRIMARY_PROVIDER,
    AI_PROVIDER_TIMEOUT_MS,
    GEMINI_API_KEY,
    GEMINI_BASE_URL,
    GEMINI_MODEL,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
} from '../config/index.js';

export const FACEBOOK_CONTENT_PROMPT_VERSION = 'facebook-content-v2';

const SUPPORTED_PROVIDERS = new Set(['openai', 'gemini']);
export const FACEBOOK_CONTENT_AI_ACTIONS = new Set([
    'generate',
    'rewrite',
    'variants',
    'improve_cta',
    'hashtags',
    'shorten',
    'tone',
    'comment_reply',
]);
const REFUSAL_FINISH_REASONS = new Set([
    'SAFETY',
    'RECITATION',
    'LANGUAGE',
    'BLOCKLIST',
    'PROHIBITED_CONTENT',
    'SPII',
]);

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

const withoutUnsupportedGeminiSchemaKeywords = value => {
    if (Array.isArray(value)) return value.map(withoutUnsupportedGeminiSchemaKeywords);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => key !== 'maxLength')
            .map(([key, child]) => [key, withoutUnsupportedGeminiSchemaKeywords(child)]),
    );
};

const GEMINI_OUTPUT_SCHEMA = withoutUnsupportedGeminiSchemaKeywords(OUTPUT_SCHEMA);

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

const pageFacts = (page, settings) => {
    if (!page) return 'لم يتم اختيار صفحة محددة.';
    return JSON.stringify({
        name: page.page_name || null,
        category: page.page_category || null,
        brand_voice: settings.brand_voice || null,
        audience: settings.audience || null,
    });
};

const actionDefinition = action => ({
    generate: {
        label: 'توليد محتوى جديد',
        rule: 'حوّل الفكرة أو حقائق المنتج إلى منشور جديد. لا تعامل الفكرة كنص يجب نسخه حرفياً.',
    },
    rewrite: {
        label: 'إعادة صياغة',
        rule: 'أعد كتابة النص مع الحفاظ على معناه وحقائقه وروابطه. غيّر الصياغة والبنية ولا تضف ادعاءات جديدة.',
    },
    variants: {
        label: 'إنشاء بدائل',
        rule: 'أنشئ بدائل مختلفة فعلاً في الاستهلال والبنية والدعوة للإجراء مع ثبات الحقائق.',
    },
    improve_cta: {
        label: 'تحسين الدعوة للإجراء',
        rule: 'حافظ على متن المنشور وحقائقه، وحسّن الدعوة للإجراء لتكون واضحة وطبيعية وغير مضللة.',
    },
    hashtags: {
        label: 'اقتراح الوسوم',
        rule: 'حافظ على النص الأصلي، واقترح وسوماً قليلة محددة ومرتبطة مباشرة بموضوع المنشور والصفحة.',
    },
    shorten: {
        label: 'اختصار المنشور',
        rule: 'اختصر النص بوضوح مع الاحتفاظ بالرسالة والحقائق الأساسية والدعوة المهمة.',
    },
    tone: {
        label: 'تغيير النبرة',
        rule: 'أعد صياغة النص بالنبرة المطلوبة في تعليمات المهمة مع الحفاظ على المعنى والحقائق.',
    },
    comment_reply: {
        label: 'اقتراح رد على تعليق',
        rule: 'اكتب رداً قصيراً ومباشراً ومناسباً للتعليق. لا تنشئ منشوراً ولا وسوماً، ولا تطلب بيانات حساسة علناً.',
    },
}[action] || {
    label: 'توليد محتوى',
    rule: 'نفّذ المهمة المطلوبة من دون اختراع حقائق.',
});

export const buildFacebookContentPrompt = ({
    action,
    inputText,
    page,
    product,
    settings,
    taskInstruction = '',
    variants = 1,
} = {}) => {
    const task = actionDefinition(action);
    const instructions = [
        'أنت مساعد تحرير متخصص في كتابة منشورات أصلية لصفحات Facebook التجارية.',
        'اكتب بلغة العميل المحددة، وبأسلوب بشري طبيعي بعيد عن العبارات العامة والنمط الآلي.',
        'اربط النتيجة بهوية الصفحة المحددة والفكرة أو النص المصدر، وتجنب المقدمات الجاهزة التي تصلح لأي صفحة.',
        'لا تخترع أسعاراً أو روابط أو مواصفات أو عروضاً. حقائق المنتج المعطاة ثابتة ولا يجوز تغييرها.',
        'لا تستخدم أياً من الكلمات الممنوعة. ضمّن الكلمات المطلوبة عندما تكون ملائمة.',
        'أعد نصاً صالحاً للنشر مباشرة، مع فقرات قصيرة ودعوة واضحة مناسبة.',
        'لا تعدّل المنشور الأصلي؛ أعد نتيجة جديدة قابلة للمراجعة.',
        task.rule,
        'لا تذكر أنك نموذج ذكاء اصطناعي ولا تشرح خطواتك.',
    ].join(' ');
    const input = [
        `نوع المهمة: ${task.label}.`,
        `تعليمات المهمة الإضافية: ${contentText(taskInstruction) || 'لا توجد'}.`,
        `عدد البدائل المطلوب: ${Math.min(Math.max(Number(variants) || 1, 1), 5)}.`,
        `هوية الصفحة المستهدفة: ${pageFacts(page, settings)}.`,
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

const aiError = (message, {
    status = 502,
    code = 'AI_SERVICE_UNAVAILABLE',
    provider = null,
    providerFailure = false,
    refused = false,
    internalCode = null,
    internalMessage = null,
} = {}) => {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    error.provider = provider;
    error.providerFailure = providerFailure;
    error.refused = refused;
    error.internalCode = internalCode;
    error.internalMessage = internalMessage;
    return error;
};

const notConfiguredError = () => aiError('مساعد الكتابة غير مهيأ على الخادم', {
    status: 503,
    code: 'AI_NOT_CONFIGURED',
});

const providerUnavailableError = (provider, {
    status = 502,
    internalCode = null,
    internalMessage = null,
} = {}) => aiError(
    status === 429
        ? 'خدمة مساعد الكتابة مشغولة حالياً. حاول مرة أخرى بعد قليل.'
        : 'خدمة مساعد الكتابة غير متاحة حالياً. حاول مرة أخرى لاحقاً.',
    {
        status: status === 429 ? 429 : 502,
        code: status === 429 ? 'AI_CAPACITY_EXCEEDED' : 'AI_SERVICE_UNAVAILABLE',
        provider,
        providerFailure: true,
        internalCode,
        internalMessage,
    },
);

const refusalError = (provider, detail = null) => aiError(
    'تعذر إنشاء هذا المحتوى. عدّل النص وحاول مرة أخرى.',
    {
        status: 422,
        code: 'AI_REQUEST_REFUSED',
        provider,
        refused: true,
        internalMessage: detail,
    },
);

const parseStructuredVariantText = text => {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw aiError('تعذر قراءة نتيجة مساعد الكتابة. حاول مرة أخرى.', {
            code: 'AI_INVALID_JSON',
        });
    }
    if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
        throw aiError('لم يتم إنشاء أي بديل صالح. حاول مرة أخرى.', {
            code: 'AI_NO_VARIANTS',
        });
    }
    return parsed.variants.map(variant => ({
        title: contentText(variant.title).slice(0, 160),
        body: contentText(variant.body).slice(0, 5000),
        hashtags: listText(variant.hashtags).slice(0, 12),
        cta: contentText(variant.cta).slice(0, 300),
    })).filter(variant => variant.title && variant.body);
};

export const extractStructuredFacebookContent = response => {
    if (response?.status === 'incomplete') {
        throw aiError('تعذر إكمال إنشاء المحتوى. حاول مرة أخرى.', {
            code: 'AI_INCOMPLETE',
            internalCode: response.incomplete_details?.reason || null,
        });
    }
    const message = Array.isArray(response?.output)
        ? response.output.find(item => item?.type === 'message')
        : null;
    const content = Array.isArray(message?.content) ? message.content[0] : null;
    if (content?.type === 'refusal') {
        throw refusalError('openai', content.refusal || null);
    }
    if (content?.type !== 'output_text' || !content.text) {
        throw aiError('لم يرجع مساعد الكتابة محتوى صالحاً. حاول مرة أخرى.', {
            code: 'AI_EMPTY_RESPONSE',
        });
    }
    return parseStructuredVariantText(content.text);
};

export const extractStructuredGeminiContent = response => {
    if (response?.promptFeedback?.blockReason) {
        throw refusalError('gemini', response.promptFeedback.blockReason);
    }
    const candidate = Array.isArray(response?.candidates) ? response.candidates[0] : null;
    if (REFUSAL_FINISH_REASONS.has(candidate?.finishReason)) {
        throw refusalError('gemini', candidate.finishMessage || candidate.finishReason);
    }
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw aiError('تعذر إكمال إنشاء المحتوى. حاول مرة أخرى.', {
            code: 'AI_INCOMPLETE',
            internalCode: candidate.finishReason,
            internalMessage: candidate.finishMessage || null,
        });
    }
    const text = Array.isArray(candidate?.content?.parts)
        ? candidate.content.parts.map(part => contentText(part?.text)).filter(Boolean).join('')
        : '';
    if (!text) {
        throw aiError('لم يرجع مساعد الكتابة محتوى صالحاً. حاول مرة أخرى.', {
            code: 'AI_EMPTY_RESPONSE',
        });
    }
    return parseStructuredVariantText(text);
};

const enforceContentPolicy = (variants, settings) => {
    const banned = listText(settings.banned_terms).map(term => term.toLocaleLowerCase('ar'));
    const accepted = variants.filter(variant => {
        const text = `${variant.title}\n${variant.body}\n${variant.cta}`.toLocaleLowerCase('ar');
        return !banned.some(term => term && text.includes(term));
    });
    if (!accepted.length) {
        throw aiError('المحتوى الناتج لم يطابق قواعد الكتابة المحددة', {
            status: 422,
            code: 'AI_POLICY_VIOLATION',
        });
    }
    return accepted;
};

const validateRequest = ({ action, inputText }) => {
    if (!FACEBOOK_CONTENT_AI_ACTIONS.has(action)) {
        throw aiError('نوع طلب التوليد غير صالح', {
            status: 400,
            code: 'INVALID_AI_ACTION',
        });
    }
    if (!['generate', 'variants'].includes(action) && !contentText(inputText)) {
        throw aiError('النص مطلوب لتنفيذ هذه المهمة', {
            status: 400,
            code: 'AI_INPUT_REQUIRED',
        });
    }
};

const fetchProvider = async (url, init, {
    provider,
    fetchImpl,
    timeoutMs,
} = {}) => {
    try {
        return await fetchImpl(url, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        throw providerUnavailableError(provider, {
            internalCode: error?.name || 'NETWORK_ERROR',
            internalMessage: error?.message || null,
        });
    }
};

const parseProviderJson = async (response, provider) => {
    try {
        return await response.json();
    } catch {
        throw providerUnavailableError(provider, {
            status: response.status,
            internalCode: 'INVALID_PROVIDER_RESPONSE',
        });
    }
};

const providerHttpError = (provider, response, data) => providerUnavailableError(provider, {
    status: response.status,
    internalCode: data?.error?.code || data?.error?.status || null,
    internalMessage: data?.error?.message || null,
});

const normalizeProviderOutputError = (error, provider) => {
    if (error?.refused || error?.code === 'AI_POLICY_VIOLATION') return error;
    if (error?.providerFailure) return error;
    return providerUnavailableError(provider, {
        status: error?.status,
        internalCode: error?.code || 'INVALID_PROVIDER_OUTPUT',
        internalMessage: error?.internalMessage || error?.message || null,
    });
};

export async function requestOpenAiFacebookContent({
    action = 'generate',
    inputText = '',
    page = null,
    product = null,
    settings = {},
    taskInstruction = '',
    variants = 1,
    fetchImpl = globalThis.fetch,
    apiKey = OPENAI_API_KEY,
    model = OPENAI_MODEL,
    baseUrl = OPENAI_BASE_URL,
    timeoutMs = AI_PROVIDER_TIMEOUT_MS,
} = {}) {
    validateRequest({ action, inputText });
    if (!contentText(apiKey)) throw notConfiguredError();
    const prompt = buildFacebookContentPrompt({
        action,
        inputText,
        page,
        product,
        settings,
        taskInstruction,
        variants,
    });
    const response = await fetchProvider(
        `${String(baseUrl).replace(/\/$/, '')}/responses`,
        {
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
        },
        { provider: 'openai', fetchImpl, timeoutMs },
    );
    const data = await parseProviderJson(response, 'openai');
    if (!response.ok) throw providerHttpError('openai', response, data);
    let output;
    try {
        output = enforceContentPolicy(extractStructuredFacebookContent(data), settings);
    } catch (error) {
        throw normalizeProviderOutputError(error, 'openai');
    }
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

export async function requestGeminiFacebookContent({
    action = 'generate',
    inputText = '',
    page = null,
    product = null,
    settings = {},
    taskInstruction = '',
    variants = 1,
    fetchImpl = globalThis.fetch,
    apiKey = GEMINI_API_KEY,
    model = GEMINI_MODEL,
    baseUrl = GEMINI_BASE_URL,
    timeoutMs = AI_PROVIDER_TIMEOUT_MS,
} = {}) {
    validateRequest({ action, inputText });
    if (!contentText(apiKey)) throw notConfiguredError();
    const prompt = buildFacebookContentPrompt({
        action,
        inputText,
        page,
        product,
        settings,
        taskInstruction,
        variants,
    });
    const response = await fetchProvider(
        `${String(baseUrl).replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: {
                'x-goog-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: prompt.instructions }],
                },
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt.input }],
                }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseJsonSchema: GEMINI_OUTPUT_SCHEMA,
                    maxOutputTokens: 1400,
                    thinkingConfig: {
                        thinkingLevel: 'low',
                    },
                },
            }),
        },
        { provider: 'gemini', fetchImpl, timeoutMs },
    );
    const data = await parseProviderJson(response, 'gemini');
    if (!response.ok) throw providerHttpError('gemini', response, data);
    let output;
    try {
        output = enforceContentPolicy(extractStructuredGeminiContent(data), settings);
    } catch (error) {
        throw normalizeProviderOutputError(error, 'gemini');
    }
    return {
        variants: output,
        model: data.modelVersion || model,
        response_id: data.responseId || null,
        usage: {
            input_tokens: Number(data.usageMetadata?.promptTokenCount) || null,
            output_tokens: (
                Number(data.usageMetadata?.candidatesTokenCount)
                + Number(data.usageMetadata?.thoughtsTokenCount)
            ) || null,
        },
        prompt_version: FACEBOOK_CONTENT_PROMPT_VERSION,
    };
}

const DEFAULT_PROVIDER_REQUESTS = {
    openai: requestOpenAiFacebookContent,
    gemini: requestGeminiFacebookContent,
};

const providerName = value => {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_PROVIDERS.has(normalized) ? normalized : '';
};

export const resolveAiProviderOrder = ({
    primaryProvider = AI_PRIMARY_PROVIDER,
    fallbackProvider = AI_FALLBACK_PROVIDER,
} = {}) => [...new Set([
    providerName(primaryProvider),
    providerName(fallbackProvider),
].filter(Boolean))];

const mergedProviderConfig = overrides => ({
    openai: {
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        baseUrl: OPENAI_BASE_URL,
        ...(overrides?.openai || {}),
    },
    gemini: {
        apiKey: GEMINI_API_KEY,
        model: GEMINI_MODEL,
        baseUrl: GEMINI_BASE_URL,
        ...(overrides?.gemini || {}),
    },
});

export const isFacebookContentAiConfigured = ({
    primaryProvider = AI_PRIMARY_PROVIDER,
    fallbackProvider = AI_FALLBACK_PROVIDER,
    providerConfig = null,
} = {}) => {
    const config = mergedProviderConfig(providerConfig);
    return resolveAiProviderOrder({ primaryProvider, fallbackProvider })
        .some(provider => Boolean(contentText(config[provider]?.apiKey)));
};

const logProviderEvent = (logger, level, {
    provider,
    nextProvider = null,
    error,
} = {}) => {
    const writer = logger?.[level];
    if (typeof writer !== 'function') return;
    writer.call(logger, '[FacebookContentAI] Provider request failed', {
        provider,
        next_provider: nextProvider,
        code: error?.code || null,
        status: error?.status || null,
        upstream_code: error?.internalCode || null,
    });
};

export async function requestFacebookContent({
    action = 'generate',
    inputText = '',
    page = null,
    product = null,
    settings = {},
    taskInstruction = '',
    variants = 1,
    fetchImpl = globalThis.fetch,
    primaryProvider = AI_PRIMARY_PROVIDER,
    fallbackProvider = AI_FALLBACK_PROVIDER,
    providerConfig = null,
    providerRequests = DEFAULT_PROVIDER_REQUESTS,
    timeoutMs = AI_PROVIDER_TIMEOUT_MS,
    logger = console,
} = {}) {
    validateRequest({ action, inputText });
    const config = mergedProviderConfig(providerConfig);
    const providers = resolveAiProviderOrder({ primaryProvider, fallbackProvider })
        .filter(provider => (
            contentText(config[provider]?.apiKey)
            && typeof providerRequests[provider] === 'function'
        ));
    if (!providers.length) throw notConfiguredError();

    let lastError = null;
    for (let index = 0; index < providers.length; index += 1) {
        const provider = providers[index];
        try {
            const result = await providerRequests[provider]({
                action,
                inputText,
                page,
                product,
                settings,
                taskInstruction,
                variants,
                fetchImpl,
                timeoutMs,
                ...config[provider],
            });
            return {
                ...result,
                provider,
                fallback_used: index > 0,
            };
        } catch (error) {
            const normalized = normalizeProviderOutputError(error, provider);
            if (!normalized.providerFailure || normalized.refused) throw normalized;
            lastError = normalized;
            const nextProvider = providers[index + 1] || null;
            logProviderEvent(logger, nextProvider ? 'warn' : 'error', {
                provider,
                nextProvider,
                error: normalized,
            });
            if (!nextProvider) break;
        }
    }
    throw lastError || providerUnavailableError(providers[0]);
}
