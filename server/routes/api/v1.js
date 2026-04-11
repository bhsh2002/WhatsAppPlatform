import express from 'express';
import db from '../../db/database.js';
import crypto from 'crypto';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const META_API_VERSION = 'v22.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB limit
});

// ============================================
// Helper: Get tenant credentials
// ============================================
const getTenantCredentials = (tenantId) => {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant || !tenant.phone_number_id || !tenant.access_token) {
        return null;
    }
    return {
        phoneNumberId: tenant.phone_number_id,
        accessToken: tenant.access_token
    };
};

// ============================================
// Helper: Send webhook callback
// ============================================
const sendCallback = async (tenantId, event, data) => {
    try {
        const settings = db.prepare(`
            SELECT * FROM tenant_api_settings 
            WHERE tenant_id = ? AND callback_url IS NOT NULL
        `).get(tenantId);

        if (!settings || !settings.callback_url) return;

        const payload = {
            event,
            timestamp: new Date().toISOString(),
            tenant_id: tenantId,
            data
        };

        const signature = crypto.createHmac('sha256', settings.webhook_secret)
            .update(JSON.stringify(payload))
            .digest('hex');

        await fetch(settings.callback_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature': `sha256=${signature}`
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('[API v1] Callback failed:', error);
    }
};

// ============================================
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
    try {
        const tenantId = req.tenantId;
        const { recipient, type = 'text', message, template_name, template_language, template_params } = req.body;

        if (!recipient) {
            return res.status(400).json({ error: 'recipient is required' });
        }

        // Get tenant credentials
        const credentials = getTenantCredentials(tenantId);
        if (!credentials) {
            return res.status(400).json({ error: 'WhatsApp API credentials not configured' });
        }

        // Normalize recipient (remove + prefix)
        const normalizedRecipient = recipient.replace(/\+/g, '').trim();

        // Build payload
        let payload = {
            messaging_product: 'whatsapp',
            to: normalizedRecipient
        };

        if (type === 'template' && template_name) {
            // Get template from database
            const template = db.prepare(`
                SELECT * FROM templates 
                WHERE tenant_id = ? AND name = ? AND status = 'approved'
            `).get(tenantId, template_name);

            if (!template) {
                return res.status(404).json({ error: 'Template not found or not approved' });
            }

            payload.type = 'template';
            payload.template = {
                name: template_name,
                language: { code: template_language || template.language || 'en' }
            };

            // Add parameters if provided
            if (template_params && Array.isArray(template_params)) {
                payload.template.components = [{
                    type: 'body',
                    parameters: template_params.map(p => ({ type: 'text', text: p }))
                }];
            }
        } else {
            // Text message
            if (!message) {
                return res.status(400).json({ error: 'message is required for text type' });
            }
            payload.type = 'text';
            payload.text = { body: message };
        }

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
            return res.status(response.status).json({ 
                error: data.error?.message || 'Failed to send message',
                details: data.error 
            });
        }

        // Save to database
        const messageId = data.messages?.[0]?.id;
        let content = message;
        if (type === 'template') {
            content = JSON.stringify({ template: template_name, params: template_params });
        }

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid)
            VALUES (?, 'outgoing', ?, ?, ?, 'sent', ?)
        `).run(tenantId, normalizedRecipient, type, content || '', messageId);

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
            type,
            status: 'sent'
        });

        res.json({
            success: true,
            message_id: messageId,
            recipient: normalizedRecipient
        });

    } catch (error) {
        console.error('[API v1] Send message error:', error);
        res.status(500).json({ error: 'Failed to send message', message: error.message });
    }
});

// ============================================
// Send Media (via URL)
// ============================================
router.post('/messages/send-media', async (req, res) => {
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
            return res.status(response.status).json({ 
                error: data.error?.message || 'Failed to send media',
                details: data.error 
            });
        }

        const messageId = data.messages?.[0]?.id;

        // Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, media_url)
            VALUES (?, 'outgoing', ?, ?, ?, 'sent', ?, ?)
        `).run(tenantId, normalizedRecipient, type, caption || '', messageId, media_url);

        res.json({
            success: true,
            message_id: messageId,
            recipient: normalizedRecipient
        });

    } catch (error) {
        console.error('[API v1] Send media error:', error);
        res.status(500).json({ error: 'Failed to send media', message: error.message });
    }
});

// ============================================
// Send Document (upload)
// ============================================
router.post('/messages/send-document', upload.single('file'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { recipient, caption, filename } = req.body;
        const file = req.file;

        if (!recipient || !file) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'recipient and file are required' });
        }

        const credentials = getTenantCredentials(tenantId);
        if (!credentials) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'WhatsApp API credentials not configured' });
        }

        const normalizedRecipient = recipient.replace(/\+/g, '').trim();

        // Upload to Meta
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.createReadStream(file.path), file.originalname);

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
                filename: filename || file.originalname,
                caption: caption || ''
            }
        };

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
            return res.status(response.status).json({ 
                error: data.error?.message || 'Failed to send document',
                details: data.error 
            });
        }

        const messageId = data.messages?.[0]?.id;

        // Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, media_id, media_mime_type)
            VALUES (?, 'outgoing', ?, 'document', ?, 'sent', ?, ?, ?)
        `).run(tenantId, normalizedRecipient, caption || file.originalname, messageId, mediaId, file.mimetype);

        res.json({
            success: true,
            message_id: messageId,
            media_id: mediaId,
            recipient: normalizedRecipient
        });

    } catch (error) {
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
            return res.status(response.status).json({
                error: data.error?.message || 'Failed to send interactive message',
                details: data.error
            });
        }

        const messageId = data.messages?.[0]?.id;

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid)
            VALUES (?, 'outgoing', ?, 'interactive', ?, 'sent', ?)
        `).run(tenantId, normalizedRecipient, JSON.stringify({ type: interactive_type, body: body_text }), messageId);

        res.json({ success: true, message_id: messageId, recipient: normalizedRecipient });
    } catch (error) {
        console.error('[API v1] Send interactive error:', error);
        res.status(500).json({ error: 'Failed to send interactive message', message: error.message });
    }
});

// ============================================
// Send Conversion Event
// ============================================
router.post('/events', async (req, res) => {
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

        const hashData = (value) => {
            if (!value) return null;
            return crypto.createHash('sha256').update(value.toString().toLowerCase().trim()).digest('hex');
        };

        const formattedEvents = events.map(event => {
            const formatted = {
                event_name: event.event_name,
                event_time: event.event_time || Math.floor(Date.now() / 1000),
                action_source: event.action_source || 'business_messaging',
                messaging_channel: 'whatsapp',
                user_data: {}
            };

            if (event.phone) formatted.user_data.phones = [hashData(event.phone)];
            if (event.email) formatted.user_data.emails = [hashData(event.email)];
            if (event.custom_data) formatted.custom_data = event.custom_data;

            return formatted;
        });

        const response = await fetch(`${META_API_BASE}/${tenant.dataset_id}/events`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tenant.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: formattedEvents })
        });

        const data = await response.json();
        const status = response.ok ? 'sent' : 'failed';

        // Save all events locally
        for (const event of events) {
            db.prepare(`
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenantId,
                tenant.dataset_id,
                event.event_name,
                new Date((event.event_time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                event.phone || null,
                event.wamid || null,
                event.custom_data ? JSON.stringify(event.custom_data) : null,
                status,
                JSON.stringify(data)
            );
        }

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'Failed to send events',
                details: data.error
            });
        }

        res.json({
            success: true,
            events_received: data.events_received || events.length,
            fbtrace_id: data.fbtrace_id
        });
    } catch (error) {
        console.error('[API v1] Send events error:', error);
        res.status(500).json({ error: 'Failed to send conversion events', message: error.message });
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