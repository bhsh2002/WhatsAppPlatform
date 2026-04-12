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
        const bodyParamsComponent = templateComponents?.find(
            c => c.type === 'body' || c.type === 'BODY'
        );
        const bodyParams = bodyParamsComponent?.parameters || [];

        const richContent = {
            header: template.header_content ? {
                type: template.header_type,
                text: template.header_content,
            } : null,
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
