import express from 'express';
import db from '../../db/database.js';
import crypto from 'crypto';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { META_API_BASE } from '../../config/index.js';
import { simpleUpload as upload, uploadDir, cleanupFile } from '../../config/upload.js';
import { buildRichTemplateContent, normalizeTemplateComponents, parseTemplateShortcut } from '../../services/messaging.js';
import { normalizeFilename } from '../../services/filenames.js';
import {
    SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
    buildWhatsAppBusinessEvent,
    getLatestCtwaAttribution,
    normalizeCtwaClid,
    normalizeMetaError,
    normalizePhone,
    parseCustomData,
} from '../../services/whatsappEvents.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../../services/billing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

import { getTenantCredentials as _getTenantCredentials, getAccessToken } from '../../services/credentials.js';

// Adapter: wraps shared credentials service to match existing v1 API contract
const getTenantCredentials = (tenantId) => {
    const { tenant, accessToken, phoneNumberId } = _getTenantCredentials(tenantId);
    if (!tenant || !phoneNumberId || !accessToken) return null;
    if (tenant.status === 'Suspended') return { suspended: true };
    return { phoneNumberId, accessToken };
};

// Minimal callback sender for API v1 outbound notifications
const sendCallback = async (tenantId, event, data) => {
    try {
        const settings = db.prepare(
            'SELECT callback_url, webhook_secret FROM tenant_api_settings WHERE tenant_id = ? AND callback_url IS NOT NULL'
        ).get(tenantId);
        if (!settings?.callback_url) return;

        const body = JSON.stringify({ event, timestamp: new Date().toISOString(), tenant_id: tenantId, data });
        const headers = { 'Content-Type': 'application/json' };
        if (settings.webhook_secret) {
            headers['X-Signature'] = 'sha256=' + crypto.createHmac('sha256', settings.webhook_secret).update(body).digest('hex');
        }
        fetch(settings.callback_url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) })
            .catch(err => console.error('[API v1] Callback failed:', err.message));
    } catch (e) { /* ignore */ }
};

// Health Check (public)
// ============================================
router.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: 'v1'
    });
});

// ============================================
// Send Text Message
// ============================================
router.post('/messages/send', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.tenantId;
        const { recipient, type = 'text', message, template_language } = req.body;
        const shortcut = parseTemplateShortcut(req.body.message);
        const templateName = req.body.template_name || req.body.templateName || req.body.template || shortcut?.name;
        const templateParams = req.body.template_params ?? req.body.templateParams ?? req.body.params ?? shortcut?.params ?? [];
        const templateLanguage = template_language || shortcut?.language;
        const effectiveType = (type === 'template' || templateName) ? 'template' : type;

        if (!recipient) {
            return res.status(400).json({ error: 'recipient is required' });
        }

        // Get tenant credentials
        const credentials = getTenantCredentials(tenantId);
        if (!credentials) {
            return res.status(400).json({ error: 'WhatsApp API credentials not configured' });
        }
        if (credentials.suspended) {
            return res.status(403).json({ error: 'Tenant account is suspended' });
        }

        // Normalize recipient (remove + prefix)
        const normalizedRecipient = recipient.replace(/\+/g, '').trim();

        // Build payload
        let payload = {
            messaging_product: 'whatsapp',
            to: normalizedRecipient
        };

        let template = null;
        let normalizedTemplateComponents = [];

        if (effectiveType === 'template') {
            if (!templateName) {
                return res.status(400).json({ error: 'template_name is required for template type' });
            }

            // Get template from database
            template = db.prepare(`
                SELECT * FROM templates 
                WHERE tenant_id = ? AND name = ? AND status = 'approved'
            `).get(tenantId, templateName);

            if (!template) {
                return res.status(404).json({ error: 'Template not found or not approved' });
            }

            payload.type = 'template';
            payload.template = {
                name: templateName,
                language: { code: templateLanguage || template.language || 'en' }
            };

            // Add parameters if provided
            normalizedTemplateComponents = normalizeTemplateComponents(templateParams);
            if (normalizedTemplateComponents.length > 0) {
                payload.template.components = normalizedTemplateComponents;
            }
        } else {
            // Text message
            if (!message) {
                return res.status(400).json({ error: 'message is required for text type' });
            }
            payload.type = 'text';
            payload.text = { body: message };
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: effectiveType === 'template' ? BILLING_OPERATIONS.WHATSAPP_TEMPLATE : BILLING_OPERATIONS.WHATSAPP_TEXT,
            quantity: 1,
            referenceType: 'api_message',
            metadata: {
                recipient: normalizedRecipient,
                message_type: effectiveType,
                template_name: templateName || null,
                template_category: template?.category || null,
                api_version: 'v1',
            },
        });

        // Send to Meta
        const response = await fetch(`${META_API_BASE}/${credentials.phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[API v1] Meta error:', data);
            releaseBilling(billingReservation, data.error?.message || 'Meta send failed');
            return res.status(response.status).json({ 
                error: data.error?.message || 'Failed to send message',
                details: data.error 
            });
        }

        // Save to database
        const messageId = data.messages?.[0]?.id;
        commitBilling(billingReservation, {
            referenceId: messageId,
            description: effectiveType === 'template'
                ? `خصم إرسال قالب WhatsApp عبر API: ${templateName}`
                : 'خصم إرسال رسالة WhatsApp نصية عبر API',
        });

        let content = message;
        if (effectiveType === 'template') {
            content = buildRichTemplateContent(template, normalizedTemplateComponents)
                || JSON.stringify({ template: templateName, params: templateParams });
        }

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
            VALUES (?, 'outgoing', ?, ?, ?, ?, 'sent', ?)
        `).run(tenantId, credentials.phoneNumberId, normalizedRecipient, effectiveType, content || '', messageId);

        // Log activity
        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'api_message_sent', 'إرسال رسالة عبر API', 'success')
        `).run(tenantId, tenant?.name || 'Unknown');

        // Send callback notification
        sendCallback(tenantId, 'message_sent', {
            message_id: messageId,
            recipient: normalizedRecipient,
            type: effectiveType,
            status: 'sent'
        });

        res.json({
            success: true,
            message_id: messageId,
            recipient: normalizedRecipient
        });

    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[API v1] Billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[API v1] Send message error:', error);
        res.status(500).json({ error: 'Failed to send message', message: error.message });
    }
});

// ============================================
// Send Media (via URL)
// ============================================
router.post('/messages/send-media', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.tenantId;
        const { recipient, type, media_url, caption } = req.body;

        if (!recipient || !type || !media_url) {
            return res.status(400).json({ error: 'recipient, type, and media_url are required' });
        }

        const validTypes = ['image', 'video', 'audio', 'document'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
        }

        const credentials = getTenantCredentials(tenantId);
        if (!credentials) {
            return res.status(400).json({ error: 'WhatsApp API credentials not configured' });
        }
        if (credentials.suspended) {
            return res.status(403).json({ error: 'Tenant account is suspended' });
        }

        const normalizedRecipient = recipient.replace(/\+/g, '').trim();

        const payload = {
            messaging_product: 'whatsapp',
            to: normalizedRecipient,
            type: type,
            [type]: {
                link: media_url
            }
        };

        if (caption && ['image', 'video', 'document'].includes(type)) {
            payload[type].caption = caption;
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_MEDIA,
            quantity: 1,
            referenceType: 'api_message',
            metadata: { recipient: normalizedRecipient, message_type: type, media_source: 'url', api_version: 'v1' },
        });

        const response = await fetch(`${META_API_BASE}/${credentials.phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[API v1] Send media error:', data);
            releaseBilling(billingReservation, data.error?.message || 'Meta media send failed');
            return res.status(response.status).json({ 
                error: data.error?.message || 'Failed to send media',
                details: data.error 
            });
        }

        const messageId = data.messages?.[0]?.id;
        commitBilling(billingReservation, {
            referenceId: messageId,
            description: `خصم إرسال وسائط WhatsApp عبر API: ${type}`,
        });

        // Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, media_url)
            VALUES (?, 'outgoing', ?, ?, ?, ?, 'sent', ?, ?)
        `).run(tenantId, credentials.phoneNumberId, normalizedRecipient, type, caption || '', messageId, media_url);

        res.json({
            success: true,
            message_id: messageId,
            recipient: normalizedRecipient
        });

    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[API v1] Media billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[API v1] Send media error:', error);
        res.status(500).json({ error: 'Failed to send media', message: error.message });
    }
});

// ============================================
// Send Document (upload)
// ============================================
router.post('/messages/send-document', upload.single('file'), async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.tenantId;
        const { recipient, caption, filename } = req.body;
        const file = req.file;
        const displayFilename = file ? normalizeFilename(filename || file.originalname) : normalizeFilename(filename);

        if (!recipient || !file) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'recipient and file are required' });
        }

        const credentials = getTenantCredentials(tenantId);
        if (!credentials) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'WhatsApp API credentials not configured' });
        }
        if (credentials.suspended) {
            if (file) fs.unlinkSync(file.path);
            return res.status(403).json({ error: 'Tenant account is suspended' });
        }

        const normalizedRecipient = recipient.replace(/\+/g, '').trim();

        // Upload to Meta
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.createReadStream(file.path), displayFilename);

        const uploadResponse = await fetch(`${META_API_BASE}/${credentials.phoneNumberId}/media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.accessToken}`,
                ...form.getHeaders()
            },
            body: form
        });

        const uploadData = await uploadResponse.json();

        // Cleanup
        try {
            fs.unlinkSync(file.path);
        } catch (e) {}

        if (!uploadResponse.ok || !uploadData.id) {
            console.error('[API v1] Upload error:', uploadData);
            return res.status(400).json({ 
                error: 'Failed to upload file',
                details: uploadData.error?.message || uploadData 
            });
        }

        const mediaId = uploadData.id;

        // Send message
        const payload = {
            messaging_product: 'whatsapp',
            to: normalizedRecipient,
            type: 'document',
            document: {
                id: mediaId,
                filename: displayFilename,
                caption: caption || ''
            }
        };

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_MEDIA,
            quantity: 1,
            referenceType: 'api_message',
            metadata: { recipient: normalizedRecipient, message_type: 'document', media_source: 'file', api_version: 'v1' },
        });

        const response = await fetch(`${META_API_BASE}/${credentials.phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[API v1] Send document error:', data);
            releaseBilling(billingReservation, data.error?.message || 'Meta document send failed');
            return res.status(response.status).json({ 
                error: data.error?.message || 'Failed to send document',
                details: data.error 
            });
        }

        const messageId = data.messages?.[0]?.id;
        commitBilling(billingReservation, {
            referenceId: messageId,
            description: 'خصم إرسال مستند WhatsApp عبر API',
        });

        // Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, media_id, media_mime_type)
            VALUES (?, 'outgoing', ?, ?, 'document', ?, 'sent', ?, ?, ?)
        `).run(
            tenantId,
            credentials.phoneNumberId,
            normalizedRecipient,
            caption ? `${displayFilename}\n\n${caption}` : displayFilename,
            messageId,
            mediaId,
            file.mimetype
        );

        res.json({
            success: true,
            message_id: messageId,
            media_id: mediaId,
            recipient: normalizedRecipient
        });

    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[API v1] Document billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[API v1] Send document error:', error);
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        res.status(500).json({ error: 'Failed to send document', message: error.message });
    }
});

// ============================================
// Get Conversations
// ============================================
router.get('/conversations', (req, res) => {
    try {
        const tenantId = req.tenantId;

        const conversations = db.prepare(`
            SELECT 
                t.contact,
                t.created_at as last_interaction,
                t.content as last_message,
                t.message_type as last_message_type,
                c.profile_name,
                (
                    SELECT COUNT(*) 
                    FROM messages m2 
                    WHERE m2.sender = t.contact 
                    AND m2.direction = 'incoming' 
                    AND m2.status = 'received'
                    AND m2.tenant_id = ?
                ) as unread_count
            FROM (
                SELECT 
                    id,
                    content,
                    created_at,
                    message_type,
                    tenant_id,
                    CASE 
                        WHEN direction = 'incoming' THEN sender 
                        ELSE recipient 
                    END as contact,
                    ROW_NUMBER() OVER (
                        PARTITION BY (
                            CASE 
                                WHEN direction = 'incoming' THEN sender 
                                ELSE recipient 
                            END
                        )
                        ORDER BY created_at DESC, id DESC
                    ) as rn
                FROM messages
                WHERE tenant_id = ?
            ) t
            LEFT JOIN contacts c ON c.phone = t.contact
            WHERE rn = 1
            ORDER BY last_interaction DESC
        `).all(tenantId, tenantId);

        res.json(conversations);

    } catch (error) {
        console.error('[API v1] Get conversations error:', error);
        res.status(500).json({ error: 'Failed to get conversations' });
    }
});

// ============================================
// Get Messages for Conversation
// ============================================
router.get('/conversations/:phone/messages', (req, res) => {
    try {
        const tenantId = req.tenantId;
        const phone = req.params.phone;
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;

        const messages = db.prepare(`
            SELECT * FROM messages 
            WHERE tenant_id = ? AND (sender = ? OR recipient = ?)
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(tenantId, phone, phone, limit, offset);

        res.json(messages.reverse()); // Return in chronological order

    } catch (error) {
        console.error('[API v1] Get messages error:', error);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// ============================================
// Get Templates
// ============================================
router.get('/templates', (req, res) => {
    try {
        const tenantId = req.tenantId;
        const status = req.query.status || 'approved';

        const templates = db.prepare(`
            SELECT * FROM templates 
            WHERE tenant_id = ? AND status = ?
            ORDER BY created_at DESC
        `).all(tenantId, status);

        res.json(templates);

    } catch (error) {
        console.error('[API v1] Get templates error:', error);
        res.status(500).json({ error: 'Failed to get templates' });
    }
});

// ============================================
// Get Single Template
// ============================================
router.get('/templates/:id', (req, res) => {
    try {
        const tenantId = req.tenantId;
        const templateId = req.params.id;

        const template = db.prepare(`
            SELECT * FROM templates 
            WHERE id = ? AND tenant_id = ?
        `).get(templateId, tenantId);

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json(template);

    } catch (error) {
        console.error('[API v1] Get template error:', error);
        res.status(500).json({ error: 'Failed to get template' });
    }
});

// ============================================
// Send Interactive Message
// ============================================
router.post('/messages/send-interactive', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.tenantId;
        const { recipient, interactive_type, body_text, header_text, footer_text, buttons, sections, list_button_text } = req.body;

        if (!recipient || !interactive_type || !body_text) {
            return res.status(400).json({ error: 'recipient, interactive_type, and body_text are required' });
        }

        if (!['button', 'list'].includes(interactive_type)) {
            return res.status(400).json({ error: 'interactive_type must be "button" or "list"' });
        }

        const credentials = getTenantCredentials(tenantId);
        if (!credentials) {
            return res.status(400).json({ error: 'WhatsApp API credentials not configured' });
        }
        if (credentials.suspended) {
            return res.status(403).json({ error: 'Tenant account is suspended' });
        }

        const normalizedRecipient = recipient.replace(/\+/g, '').trim();

        const interactive = {
            type: interactive_type,
            body: { text: body_text }
        };

        if (header_text) interactive.header = { type: 'text', text: header_text };
        if (footer_text) interactive.footer = { text: footer_text };

        if (interactive_type === 'button') {
            if (!buttons || !Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
                return res.status(400).json({ error: 'buttons must be an array of 1-3 items' });
            }
            interactive.action = {
                buttons: buttons.map((btn, i) => ({
                    type: 'reply',
                    reply: { id: btn.id || `btn_${i}`, title: btn.title }
                }))
            };
        } else {
            if (!sections || !Array.isArray(sections) || sections.length === 0) {
                return res.status(400).json({ error: 'sections required for list type' });
            }
            interactive.action = {
                button: list_button_text || 'View Options',
                sections: sections.map(s => ({
                    title: s.title,
                    rows: (s.rows || []).map(r => ({ id: r.id, title: r.title, description: r.description || '' }))
                }))
            };
        }

        const payload = {
            messaging_product: 'whatsapp',
            to: normalizedRecipient,
            type: 'interactive',
            interactive
        };

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
            quantity: 1,
            referenceType: 'api_message',
            metadata: { recipient: normalizedRecipient, interactive_type, api_version: 'v1' },
        });

        const response = await fetch(`${META_API_BASE}/${credentials.phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta interactive send failed');
            return res.status(response.status).json({
                error: data.error?.message || 'Failed to send interactive message',
                details: data.error
            });
        }

        const messageId = data.messages?.[0]?.id;
        commitBilling(billingReservation, {
            referenceId: messageId,
            description: `خصم إرسال رسالة WhatsApp تفاعلية عبر API (${interactive_type})`,
        });

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
            VALUES (?, 'outgoing', ?, ?, 'interactive', ?, 'sent', ?)
        `).run(tenantId, credentials.phoneNumberId, normalizedRecipient, JSON.stringify({ type: interactive_type, body: body_text }), messageId);

        res.json({ success: true, message_id: messageId, recipient: normalizedRecipient });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[API v1] Interactive billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[API v1] Send interactive error:', error);
        res.status(500).json({ error: 'Failed to send interactive message', message: error.message });
    }
});

// ============================================
// Send Conversion Event
// ============================================
router.post('/events', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.tenantId;
        const { events } = req.body;

        if (!events || !Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'events array is required' });
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(400).json({ error: 'Tenant not found' });
        }

        if (!tenant.dataset_id) {
            return res.status(400).json({ error: 'Dataset ID not configured for this tenant' });
        }

        const formattedEvents = events.map(event => {
            const storedAttribution = getLatestCtwaAttribution(db, tenantId, normalizePhone(event.phone));
            const resolvedCtwaClid = normalizeCtwaClid(event.ctwa_clid) || storedAttribution?.last_ctwa_clid || '';
            return buildWhatsAppBusinessEvent({
                eventName: event.event_name,
                wabaId: tenant.waba_id,
                ctwaClid: resolvedCtwaClid,
                customData: parseCustomData(event.custom_data),
                eventTime: event.event_time || Math.floor(Date.now() / 1000),
            });
        });

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_EVENT_CONVERSION,
            quantity: events.length,
            referenceType: 'conversion_event',
            metadata: { dataset_id: tenant.dataset_id, event_count: events.length, api_version: 'v1' },
        });

        const response = await fetch(`${META_API_BASE}/${tenant.dataset_id}/events`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken(tenantId)}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: formattedEvents })
        });

        const data = await response.json();
        const status = response.ok ? 'sent' : 'failed';

        // Save all events locally
        for (const event of events) {
            const storedAttribution = getLatestCtwaAttribution(db, tenantId, normalizePhone(event.phone));
            const resolvedCtwaClid = normalizeCtwaClid(event.ctwa_clid) || storedAttribution?.last_ctwa_clid || '';
            db.prepare(`
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response, ctwa_clid)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenantId,
                tenant.dataset_id,
                event.event_name,
                new Date((event.event_time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                event.phone || null,
                event.wamid || null,
                event.custom_data ? JSON.stringify(event.custom_data) : null,
                status,
                JSON.stringify(data),
                resolvedCtwaClid || null
            );
        }

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta conversion events failed');
            const metaError = normalizeMetaError(data);
            return res.status(response.status).json({
                error: metaError?.message || data.error?.message || 'Failed to send events',
                details: data.error,
                fbtrace_id: metaError?.fbtrace_id || null,
            });
        }

        commitBilling(billingReservation, {
            quantity: data.events_received || events.length,
            referenceId: data.fbtrace_id || null,
            description: `خصم إرسال ${data.events_received || events.length} حدث WhatsApp Events API عبر API`,
        });

        res.json({
            success: true,
            events_received: data.events_received || events.length,
            fbtrace_id: data.fbtrace_id
        });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[API v1] Events billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[API v1] Send events error:', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to send conversion events',
            supported_events: error.supportedEvents || SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
        });
    }
});

// ============================================
// Get Conversion Events History
// ============================================
router.get('/events/history', (req, res) => {
    try {
        const tenantId = req.tenantId;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const events = db.prepare(`
            SELECT * FROM conversion_events 
            WHERE tenant_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(tenantId, limit, offset);

        const total = db.prepare('SELECT COUNT(*) as count FROM conversion_events WHERE tenant_id = ?').get(tenantId)?.count || 0;

        res.json({ events, total, limit, offset });
    } catch (error) {
        console.error('[API v1] Events history error:', error);
        res.status(500).json({ error: 'Failed to get events history' });
    }
});

export default router;
