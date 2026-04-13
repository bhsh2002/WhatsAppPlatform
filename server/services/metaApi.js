import { META_API_BASE } from '../config/index.js';

// ============================================
// Meta WhatsApp Cloud API Client
// ============================================
// Single implementation used by admin routes, tenant portal, and external API v1.

/**
 * Send a text message via Meta API
 */
export async function sendTextMessage(phoneNumberId, accessToken, recipient, text) {
    const payload = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: text },
    };
    return sendToMeta(phoneNumberId, accessToken, payload);
}

/**
 * Send a template message via Meta API
 */
export async function sendTemplateMessage(phoneNumberId, accessToken, recipient, templateName, languageCode, components) {
    const payload = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
            name: templateName,
            language: { code: languageCode || 'ar' },
        },
    };
    if (components && components.length > 0) {
        payload.template.components = components;
    }
    return sendToMeta(phoneNumberId, accessToken, payload);
}

/**
 * Send a media message by URL
 */
export async function sendMediaByUrl(phoneNumberId, accessToken, recipient, type, mediaUrl, caption) {
    const payload = {
        messaging_product: 'whatsapp',
        to: recipient,
        type,
        [type]: { link: mediaUrl },
    };
    if (caption && ['image', 'video', 'document'].includes(type)) {
        payload[type].caption = caption;
    }
    return sendToMeta(phoneNumberId, accessToken, payload);
}

/**
 * Send a media message by media ID (pre-uploaded)
 */
export async function sendMediaById(phoneNumberId, accessToken, recipient, type, mediaId, caption, filename) {
    const payload = {
        messaging_product: 'whatsapp',
        to: recipient,
        type,
        [type]: { id: mediaId },
    };
    if (caption) payload[type].caption = caption;
    if (filename && type === 'document') payload[type].filename = filename;
    return sendToMeta(phoneNumberId, accessToken, payload);
}

/**
 * Send an interactive message (button or list)
 */
export async function sendInteractiveMessage(phoneNumberId, accessToken, recipient, interactive) {
    const payload = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'interactive',
        interactive,
    };
    return sendToMeta(phoneNumberId, accessToken, payload);
}

/**
 * Upload media to Meta API
 * @returns {{ id: string }} The media ID
 */
export async function uploadMedia(phoneNumberId, accessToken, formData, formHeaders) {
    const response = await fetch(`${META_API_BASE}/${phoneNumberId}/media`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            ...formHeaders,
        },
        body: formData,
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

/**
 * Get media URL from Meta API
 */
export async function getMediaUrl(accessToken, mediaId) {
    const response = await fetch(`${META_API_BASE}/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

/**
 * Download media binary from Meta CDN URL
 */
export async function downloadMedia(accessToken, mediaUrl) {
    const response = await fetch(mediaUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: response.body,
        arrayBuffer: () => response.arrayBuffer(),
    };
}

/**
 * Mark a message as read
 * Sends read receipt to Meta so the customer sees the blue ticks
 * 
 * @param {string} phoneNumberId - The phone number ID
 * @param {string} accessToken - Access token
 * @param {string} messageId - The WhatsApp message ID to mark as read
 * @returns {Promise<{ok: boolean, status: number, data: object}>}
 */
export async function markMessageAsRead(phoneNumberId, accessToken, messageId) {
    const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
    };
    
    const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    
    const data = await response.json();
    return {
        ok: response.ok,
        status: response.status,
        data,
    };
}

// ============================================
// Internal: Send payload to Meta API
// ============================================
async function sendToMeta(phoneNumberId, accessToken, payload) {
    const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    return {
        ok: response.ok,
        status: response.status,
        messageId: data.messages?.[0]?.id || null,
        error: data.error || null,
        data,
    };
}
