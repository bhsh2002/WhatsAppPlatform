import db from '../db/database.js';
import { buildRichTemplateContent } from './messageTemplateContent.js';
export { substituteVariables, normalizeTemplateComponents, parseTemplateShortcut, buildTemplateComponentsFromMapping, buildRichTemplateContent } from './messageTemplateContent.js';

const TEMPLATE_FALLBACK_RE = /^\[(?:قالب|Template):\s*([^\]]+)\]$/i;

function getFallbackTemplate(message, contentField) {
    const content = message?.[contentField];
    const messageType = message?.message_type || message?.last_message_type || message?.type;
    if (messageType !== 'template' || typeof content !== 'string') return null;
    const match = content.trim().match(TEMPLATE_FALLBACK_RE);
    if (!match) return null;
    return match[1].trim();
}

function getTemplateByName(database, templateName, tenantId, cache) {
    const key = `${tenantId || 'global'}:${templateName}`;
    if (cache?.has(key)) return cache.get(key);

    const template = tenantId
        ? database.prepare('SELECT * FROM templates WHERE tenant_id = ? AND name = ?').get(tenantId, templateName)
        : database.prepare('SELECT * FROM templates WHERE name = ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(templateName);
    cache?.set(key, template || null);
    return template;
}

export function enrichTemplateFallbackMessage(
    message,
    contentField = 'content',
    cache = new Map(),
    database = db,
) {
    const templateName = getFallbackTemplate(message, contentField);
    if (!templateName) return message;

    const template = getTemplateByName(database, templateName, message.tenant_id, cache);
    const richContent = buildRichTemplateContent(template, []);
    if (!richContent) return message;

    return {
        ...message,
        [contentField]: richContent,
    };
}

export function enrichTemplateFallbackMessages(messages, contentField = 'content', database = db) {
    const cache = new Map();
    return Array.isArray(messages)
        ? messages.map(message => enrichTemplateFallbackMessage(
            message,
            contentField,
            cache,
            database,
        ))
        : messages;
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
