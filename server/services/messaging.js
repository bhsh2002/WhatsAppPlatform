import db from '../db/database.js';

// ============================================
// Messaging Service — DB persistence & helpers
// ============================================
// Single implementation for saving messages and related logic.

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

/**
 * Save an outgoing message to the database.
 * 
 * @param {object} options
 * @returns {object} The saved message record
 */
export function saveOutgoingMessage({
    tenantId = null,
    sender,
    recipient,
    messageType = 'text',
    content = '',
    status = 'sent',
    wamid = null,
    errorMessage = null,
    mediaUrl = null,
    mediaId = null,
    mediaMimeType = null,
}) {
    const result = db.prepare(`
        INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, error_message, media_url, media_id, media_mime_type)
        VALUES (?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        tenantId,
        sender,
        recipient,
        messageType,
        content,
        status,
        wamid,
        errorMessage,
        mediaUrl || null,
        mediaId || null,
        mediaMimeType || null,
    );

    return { id: result.lastInsertRowid };
}

/**
 * Log an activity event.
 */
export function logActivity(tenantId, tenantName, eventType, description, status = 'success') {
    db.prepare(`
        INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
        VALUES (?, ?, ?, ?, ?)
    `).run(tenantId, tenantName || 'Unknown', eventType, description, status);
}

/**
 * Build interactive message payload.
 * 
 * @param {object} options
 * @returns {object} Interactive payload for Meta API
 */
export function buildInteractivePayload({
    interactiveType,
    bodyText,
    headerText,
    footerText,
    buttons,
    sections,
    listButtonText,
}) {
    const interactive = {
        type: interactiveType,
        body: { text: bodyText },
    };

    if (headerText) {
        interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
        interactive.footer = { text: footerText };
    }

    if (interactiveType === 'button') {
        interactive.action = {
            buttons: buttons.map((btn, i) => ({
                type: 'reply',
                reply: {
                    id: btn.id || `btn_${i}`,
                    title: btn.title,
                },
            })),
        };
    } else if (interactiveType === 'list') {
        interactive.action = {
            button: listButtonText || 'عرض الخيارات',
            sections: sections.map(section => ({
                title: section.title,
                rows: (section.rows || []).map(row => ({
                    id: row.id,
                    title: row.title,
                    description: row.description || '',
                })),
            })),
        };
    }

    return interactive;
}
