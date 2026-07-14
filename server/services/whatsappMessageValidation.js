import net from 'node:net';

import { isPublicIpAddress } from '../security/outboundUrl.js';

const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE_RE = /^[A-Za-z_-]{2,32}$/;
const MEDIA_ID_RE = /^[A-Za-z0-9._:-]{1,512}$/;
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);
const CAPTION_MEDIA_TYPES = new Set(['image', 'video', 'document']);

export class InvalidWhatsAppMessageError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'InvalidWhatsAppMessageError';
        this.details = details;
    }
}

export const parseAdminTenantId = value => {
    if (value == null || value === '') return null;
    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) {
        throw new InvalidWhatsAppMessageError('tenant_id is invalid');
    }
    const tenantId = Number(normalized);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
        throw new InvalidWhatsAppMessageError('tenant_id is invalid');
    }
    return tenantId;
};

export const normalizeWhatsAppRecipient = value => {
    if (typeof value !== 'string' || /[^\d+\s()-]/.test(value)) {
        throw new InvalidWhatsAppMessageError('Recipient is invalid');
    }
    const normalized = value.replace(/[^\d]/g, '');
    if (!/^\d{7,15}$/.test(normalized)) {
        throw new InvalidWhatsAppMessageError('Recipient is invalid');
    }
    return normalized;
};

export const normalizeMessageText = (value, field, maxLength, { optional = false } = {}) => {
    if (value == null && optional) return null;
    if (typeof value !== 'string') {
        throw new InvalidWhatsAppMessageError(`${field} must be a string`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || FORBIDDEN_CONTROLS.test(normalized)) {
        throw new InvalidWhatsAppMessageError(`${field} is invalid`);
    }
    return normalized;
};

export const normalizeTemplateName = value => {
    if (typeof value !== 'string') {
        throw new InvalidWhatsAppMessageError('templateName is required for template type');
    }
    const normalized = value.trim();
    if (!TEMPLATE_NAME_RE.test(normalized)) {
        throw new InvalidWhatsAppMessageError('templateName is invalid');
    }
    return normalized;
};

export const normalizeTemplateLanguage = value => {
    const normalized = value == null ? 'ar' : String(value).trim();
    if (!TEMPLATE_LANGUAGE_RE.test(normalized)) {
        throw new InvalidWhatsAppMessageError('templateLanguage is invalid');
    }
    return normalized;
};

export const normalizeMessageType = (value, hasTemplateName) => {
    const normalized = value == null || value === '' ? 'text' : String(value).trim().toLowerCase();
    const effective = normalized === 'template' || hasTemplateName ? 'template' : normalized;
    if (!['text', 'template'].includes(effective)) {
        throw new InvalidWhatsAppMessageError('type must be "text" or "template"');
    }
    return effective;
};

export const normalizeWhatsAppMediaId = value => {
    if (typeof value !== 'string' || !MEDIA_ID_RE.test(value.trim())) {
        throw new InvalidWhatsAppMessageError('Media id is invalid');
    }
    return value.trim();
};

export const normalizeWhatsAppMediaType = value => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!MEDIA_TYPES.has(normalized)) {
        throw new InvalidWhatsAppMessageError(
            'type must be one of: image, video, audio, document',
        );
    }
    return normalized;
};

export const normalizeWhatsAppMediaUrl = value => {
    if (typeof value !== 'string') {
        throw new InvalidWhatsAppMessageError('mediaUrl is invalid');
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > 2048 || FORBIDDEN_CONTROLS.test(normalized)) {
        throw new InvalidWhatsAppMessageError('mediaUrl is invalid');
    }
    try {
        const url = new URL(normalized);
        const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        const literalIp = net.isIP(hostname);
        if (
            url.protocol !== 'https:'
            || url.username
            || url.password
            || (url.port && url.port !== '443')
            || !hostname
            || hostname === 'localhost'
            || hostname.endsWith('.localhost')
            || hostname.endsWith('.local')
            || hostname.endsWith('.internal')
            || hostname.endsWith('.home.arpa')
            || (literalIp && !isPublicIpAddress(hostname))
        ) {
            throw new Error('unsafe media URL');
        }
        return url.toString();
    } catch {
        throw new InvalidWhatsAppMessageError('mediaUrl must be a public HTTPS URL');
    }
};

export const normalizeWhatsAppMediaCaption = (value, mediaType) => {
    if (value == null || value === '') return '';
    if (!CAPTION_MEDIA_TYPES.has(mediaType)) {
        throw new InvalidWhatsAppMessageError(`caption is not supported for ${mediaType}`);
    }
    return normalizeMessageText(value, 'caption', 1024);
};

export const normalizeWhatsAppMediaFilename = (value, mediaType) => {
    if (value == null || value === '') return null;
    if (mediaType !== 'document') {
        throw new InvalidWhatsAppMessageError('filename is supported only for document media');
    }
    return normalizeMessageText(value, 'filename', 240);
};

export const isAllowedMetaMediaUrl = value => {
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        return url.protocol === 'https:'
            && !url.username
            && !url.password
            && (!url.port || url.port === '443')
            && (
                hostname === 'lookaside.fbsbx.com'
                || hostname === 'graph.facebook.com'
                || hostname.endsWith('.fbcdn.net')
            );
    } catch {
        return false;
    }
};

export const countTemplateBodyVariables = body => {
    const indexes = [...String(body || '').matchAll(/\{\{(\d+)\}\}/g)]
        .map(match => Number(match[1]))
        .filter(index => Number.isSafeInteger(index) && index > 0);
    return indexes.length > 0 ? Math.max(...indexes) : 0;
};

const normalizeButton = (button, index) => {
    if (!button || typeof button !== 'object' || Array.isArray(button)) {
        throw new InvalidWhatsAppMessageError(`buttons[${index}] is invalid`);
    }
    const title = normalizeMessageText(button.title, `buttons[${index}].title`, 20);
    const id = button.id == null
        ? undefined
        : normalizeMessageText(String(button.id), `buttons[${index}].id`, 256);
    return { ...(id ? { id } : {}), title };
};

const normalizeRow = (row, sectionIndex, rowIndex) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new InvalidWhatsAppMessageError(
            `sections[${sectionIndex}].rows[${rowIndex}] is invalid`,
        );
    }
    return {
        id: normalizeMessageText(
            row.id,
            `sections[${sectionIndex}].rows[${rowIndex}].id`,
            200,
        ),
        title: normalizeMessageText(
            row.title,
            `sections[${sectionIndex}].rows[${rowIndex}].title`,
            24,
        ),
        description: row.description == null
            ? ''
            : normalizeMessageText(
                row.description,
                `sections[${sectionIndex}].rows[${rowIndex}].description`,
                72,
            ),
    };
};

export const normalizeInteractiveInput = (body = {}) => {
    const recipient = normalizeWhatsAppRecipient(body.recipient);
    const interactiveType = typeof body.interactive_type === 'string'
        ? body.interactive_type.trim().toLowerCase()
        : '';
    if (!['button', 'list'].includes(interactiveType)) {
        throw new InvalidWhatsAppMessageError('interactive_type must be "button" or "list"');
    }
    const bodyText = normalizeMessageText(body.body_text, 'body_text', 1024);
    const headerText = body.header_text == null
        ? null
        : normalizeMessageText(body.header_text, 'header_text', 60);
    const footerText = body.footer_text == null
        ? null
        : normalizeMessageText(body.footer_text, 'footer_text', 60);

    if (interactiveType === 'button') {
        if (!Array.isArray(body.buttons) || body.buttons.length < 1 || body.buttons.length > 3) {
            throw new InvalidWhatsAppMessageError('buttons must be an array of 1-3 items');
        }
        return {
            recipient,
            interactiveType,
            bodyText,
            headerText,
            footerText,
            buttons: body.buttons.map(normalizeButton),
            sections: [],
            listButtonText: null,
        };
    }

    if (!Array.isArray(body.sections) || body.sections.length < 1 || body.sections.length > 10) {
        throw new InvalidWhatsAppMessageError('sections must be an array of 1-10 items');
    }
    let totalRows = 0;
    const sections = body.sections.map((section, sectionIndex) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) {
            throw new InvalidWhatsAppMessageError(`sections[${sectionIndex}] is invalid`);
        }
        if (!Array.isArray(section.rows) || section.rows.length === 0) {
            throw new InvalidWhatsAppMessageError(`sections[${sectionIndex}].rows is required`);
        }
        totalRows += section.rows.length;
        return {
            title: section.title == null
                ? undefined
                : normalizeMessageText(section.title, `sections[${sectionIndex}].title`, 24),
            rows: section.rows.map((row, rowIndex) => normalizeRow(row, sectionIndex, rowIndex)),
        };
    });
    if (totalRows > 10) {
        throw new InvalidWhatsAppMessageError('interactive lists support at most 10 rows');
    }
    return {
        recipient,
        interactiveType,
        bodyText,
        headerText,
        footerText,
        buttons: [],
        sections,
        listButtonText: body.list_button_text == null
            ? 'عرض الخيارات'
            : normalizeMessageText(body.list_button_text, 'list_button_text', 20),
    };
};
