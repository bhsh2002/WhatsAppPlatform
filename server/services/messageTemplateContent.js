const TEMPLATE_MEDIA_TYPES = ['image', 'video', 'document', 'audio'];

/**
 * Substitute template variables: {{1}}, {{2}}, etc.
 *
 * @param {string} text - Template text with placeholders
 * @param {Array} params - Array of parameter values or { type, text } objects
 * @returns {string} Text with variables substituted
 */
export function substituteVariables(text, params) {
    if (!text || !params) return text;
    let result = text;
    params.forEach((param, index) => {
        if (typeof param === 'string' || typeof param === 'number') {
            result = result.replaceAll(`{{${index + 1}}}`, param);
        } else if (param.type === 'text') {
            result = result.replaceAll(`{{${index + 1}}}`, param.text);
        }
    });
    return result;
}

export function normalizeTemplateComponents(input) {
    if (!Array.isArray(input) || input.length === 0) return [];

    const looksLikeComponents = input.some(item =>
        item && typeof item === 'object' && 'type' in item && Array.isArray(item.parameters)
    );

    if (looksLikeComponents) return input;

    return [{
        type: 'body',
        parameters: input.map(param => {
            if (param && typeof param === 'object' && 'type' in param) return param;
            return { type: 'text', text: String(param ?? '') };
        }),
    }];
}

export function parseTemplateShortcut(input) {
    let data = input;

    if (typeof input === 'string' && input.trim().startsWith('{')) {
        try {
            data = JSON.parse(input);
        } catch {
            return null;
        }
    }

    if (!data || typeof data !== 'object' || !data.template) return null;

    return {
        name: String(data.template),
        params: Array.isArray(data.params) ? data.params : [],
        language: data.language || data.template_language || data.templateLanguage,
    };
}

function resolveMappedValue(varMap, contact, fallbackRecipient) {
    if (varMap.source === 'static') return varMap.value || '';
    if (varMap.source === 'contact') {
        return (contact && contact[varMap.field]) || varMap.fallback || fallbackRecipient;
    }
    return '';
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function buildHeaderParameter(varMap, contact, fallbackRecipient) {
    const mediaType = varMap.media_type?.toLowerCase?.();
    if (!TEMPLATE_MEDIA_TYPES.includes(mediaType)) {
        const text = String(resolveMappedValue(varMap, contact, fallbackRecipient) ?? '');
        return { type: 'text', text };
    }

    const sourceValue = String(resolveMappedValue(varMap, contact, fallbackRecipient) ?? '').trim();
    if (!isHttpUrl(sourceValue)) {
        throw new Error(`Invalid ${mediaType} header URL for ${fallbackRecipient}`);
    }

    const media = { link: sourceValue };
    if (mediaType === 'document' && varMap.filename) {
        media.filename = String(varMap.filename);
    }

    return {
        type: mediaType,
        [mediaType]: media,
    };
}

function componentKey(component) {
    const type = component?.type?.toLowerCase?.();
    if (type === 'button') {
        return `button:${component.sub_type || 'url'}:${component.index ?? '0'}`;
    }
    return type;
}

export function buildTemplateComponentsFromMapping(variableMapping, templateParams, contact, fallbackRecipient) {
    const normalizedTemplateParams = normalizeTemplateComponents(templateParams);
    if (!Array.isArray(variableMapping) || variableMapping.length === 0) {
        return normalizedTemplateParams;
    }

    const headerParams = [];
    const bodyParams = [];
    const buttonComponents = new Map();

    variableMapping.forEach(varMap => {
        const text = String(resolveMappedValue(varMap, contact, fallbackRecipient) ?? '');
        const parameter = { type: 'text', text };
        const section = varMap.section || 'body';

        if (section === 'header') {
            headerParams.push(buildHeaderParameter(varMap, contact, fallbackRecipient));
            return;
        }

        if (section === 'button') {
            const index = String(varMap.btn_index ?? '0');
            const subType = varMap.sub_type || 'url';
            const key = `button:${subType}:${index}`;
            if (!buttonComponents.has(key)) {
                buttonComponents.set(key, {
                    type: 'button',
                    sub_type: subType,
                    index,
                    parameters: [],
                });
            }
            buttonComponents.get(key).parameters.push(parameter);
            return;
        }

        bodyParams.push(parameter);
    });

    const components = [];
    if (headerParams.length > 0) components.push({ type: 'header', parameters: headerParams });
    if (bodyParams.length > 0) components.push({ type: 'body', parameters: bodyParams });
    components.push(...buttonComponents.values());

    const existingKeys = new Set(components.map(componentKey));
    normalizedTemplateParams.forEach(component => {
        const key = componentKey(component);
        if (!existingKeys.has(key)) {
            components.push(component);
            existingKeys.add(key);
        }
    });

    return components;
}

function getComponent(components, type) {
    return components.find(component => component?.type?.toLowerCase() === type);
}

function getParamValue(param, type) {
    if (!param || typeof param !== 'object') return null;
    return param[type] || param[type?.toUpperCase?.()] || null;
}

function normalizeHeader(template, normalizedComponents) {
    const headerType = template.header_type?.toLowerCase?.() || 'none';
    if (!headerType || headerType === 'none') return null;

    const headerComponent = getComponent(normalizedComponents, 'header');
    const headerParam = headerComponent?.parameters?.[0] || null;

    if (headerParam?.type?.toLowerCase?.() === 'text') {
        return {
            type: 'text',
            text: substituteVariables(template.header_content || '', [headerParam]),
        };
    }

    if (['image', 'video', 'document', 'audio'].includes(headerType)) {
        const mediaValue = getParamValue(headerParam, headerType) || {};
        const fallbackUrl = template.header_content || null;

        return {
            type: headerType,
            url: mediaValue.link || mediaValue.url || fallbackUrl,
            id: mediaValue.id || null,
            filename: mediaValue.filename || mediaValue.file_name || null,
        };
    }

    return template.header_content ? {
        type: headerType,
        text: template.header_content,
    } : null;
}

/**
 * Build rich template content for storage from a template record and params.
 *
 * @param {object} template - Template DB record
 * @param {Array} templateComponents - Template components with parameters
 * @returns {string} JSON string of rich content
 */
export function buildRichTemplateContent(template, templateComponents) {
    if (!template) return null;

    try {
        const normalizedComponents = normalizeTemplateComponents(templateComponents);
        const bodyParamsComponent = getComponent(normalizedComponents, 'body');
        const bodyParams = bodyParamsComponent?.parameters || [];

        const richContent = {
            header: normalizeHeader(template, normalizedComponents),
            body: substituteVariables(template.body, bodyParams),
            footer: template.footer,
            buttons: template.buttons ? JSON.parse(template.buttons) : null,
        };
        return JSON.stringify(richContent);
    } catch (e) {
        console.error('[Messaging] Failed to build rich template content:', e);
        return null;
    }
}
