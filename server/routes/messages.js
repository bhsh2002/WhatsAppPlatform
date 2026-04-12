import express from 'express';
import db from '../db/database.js';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { META_API_BASE } from '../config/index.js';
import { generalUpload as upload, uploadDir, cleanupFile } from '../config/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();


// Send message via Meta API
router.post('/send', async (req, res) => {
    try {
        const { tenant_id, recipient, type, message, templateName, templateLanguage, templateParams } = req.body;

        if (!recipient) {
            return res.status(400).json({ error: 'Recipient is required' });
        }

        // Get tenant credentials or use defaults
        let phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
        let accessToken = process.env.DEFAULT_ACCESS_TOKEN;
        let tenant = null;

        if (tenant_id) {
            tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant) {
                if (tenant.status === 'Suspended') {
                    return res.status(403).json({ error: 'هذا العميل معلّق ولا يمكنه إرسال الرسائل' });
                }
                phoneNumberId = tenant.phone_number_id || phoneNumberId;
                accessToken = tenant.access_token || accessToken;
            }
        }

        // Also accept direct credentials in request (for console testing)
        const reqPhoneId = req.body.phone_number_id || phoneNumberId;
        const reqToken = req.body.access_token || accessToken;

        if (!reqPhoneId || !reqToken) {
            return res.status(400).json({ error: 'Missing API credentials. Configure tenant or provide phone_number_id and access_token.' });
        }

        // Build payload
        let payload = {
            messaging_product: 'whatsapp',
            to: recipient,
        };

        if (type === 'template') {
            payload.type = 'template';
            payload.template = {
                name: templateName,
                language: { code: templateLanguage || 'ar' },
            };
            if (templateParams && templateParams.length > 0) {
                payload.template.components = templateParams;
            }
        } else {
            payload.type = 'text';
            payload.text = { body: message };
        }

        console.log('[Messages] Sending to Meta:', JSON.stringify(payload, null, 2));

        // Send to Meta API
        const response = await fetch(`${META_API_BASE}/${reqPhoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${reqToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        // Save message to database
        const substituteVariables = (text, params) => {
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
        };

        let storedContent = message;
        if (type === 'template') {
            storedContent = `[Template: ${templateName}]`; // Default fallback

            if (tenant_id) {
                try {
                    const template = db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND name = ?').get(tenant_id, templateName);

                    if (template) {
                        // Extract params for body
                        const bodyParamsComponent = templateParams?.find(c => c.type === 'body' || c.type === 'BODY');
                        const bodyParams = bodyParamsComponent?.parameters || [];

                        const richContent = {
                            header: template.header_content ? {
                                type: template.header_type,
                                text: template.header_content // Image/Video headers handling might need more logic
                            } : null,
                            body: substituteVariables(template.body, bodyParams),
                            footer: template.footer,
                            buttons: template.buttons ? JSON.parse(template.buttons) : null
                        };
                        storedContent = JSON.stringify(richContent);
                    }
                } catch (e) {
                    console.error('Failed to construct rich template content:', e);
                }
            }
        }

        const messageRecord = {
            tenant_id: tenant?.id || null,
            direction: 'outgoing',
            recipient: recipient,
            message_type: type || 'text',
            content: storedContent,
            status: response.ok ? 'sent' : 'failed',
            wamid: data.messages?.[0]?.id || null,
            error_message: data.error?.message || null,
        };

        db.prepare(`
      INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
            reqPhoneId,
            messageRecord.recipient,
            messageRecord.message_type,
            messageRecord.content,
            messageRecord.status,
            messageRecord.wamid,
            messageRecord.error_message
        );

        // Log activity
        if (tenant) {
            db.prepare(`
        INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(
                tenant.id,
                tenant.name,
                type === 'template' ? 'template_sent' : 'message_sent',
                type === 'template' ? `إرسال قالب: ${templateName}` : 'إرسال رسالة نصية',
                response.ok ? 'success' : 'error'
            );
        }

        if (response.ok) {
            res.json({
                success: true,
                message_id: data.messages?.[0]?.id,
                data
            });
        } else {
            res.status(response.status).json({
                success: false,
                error: data.error?.message || 'Failed to send message',
                data
            });
        }
    } catch (error) {
        console.error('[Messages] Send error:', error);
        res.status(500).json({ error: 'Failed to send message', details: error.message });
    }
});

// Get message logs
router.get('/logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const tenant_id = req.query.tenant_id;
        const direction = req.query.direction;

        let query = 'SELECT m.*, t.name as tenant_name FROM messages m LEFT JOIN tenants t ON m.tenant_id = t.id';
        const conditions = [];
        const params = [];

        if (tenant_id) {
            conditions.push('m.tenant_id = ?');
            params.push(tenant_id);
        }

        if (direction) {
            conditions.push('m.direction = ?');
            params.push(direction);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const messages = db.prepare(query).all(...params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM messages m';
        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
        }
        const total = db.prepare(countQuery).get(...params.slice(0, -2)).total;

        res.json({
            messages,
            total,
            limit,
            offset
        });
    } catch (error) {
        console.error('[Messages] Logs fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch message logs' });
    }
});

// Get webhook logs
router.get('/webhook-logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const logs = db.prepare(`
      SELECT * FROM webhook_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);

        res.json(logs);
    } catch (error) {
        console.error('[Messages] Webhook logs fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch webhook logs' });
    }
});

// Get conversations list (grouped by contact)
router.get('/conversations', (req, res) => {
    try {
        const query = `
            SELECT 
                t.contact,
                t.tenant_id,
                tenants.name as tenant_name,
                t.created_at as last_interaction,
                t.content as last_message,
                t.message_type as last_message_type,
                c.profile_name,
                c.profile_picture_url,
                (
                    SELECT COUNT(*) 
                    FROM messages m2 
                    WHERE m2.sender = t.contact 
                    AND m2.direction = 'incoming' 
                    AND m2.status = 'received'
                    AND (m2.tenant_id = t.tenant_id OR (m2.tenant_id IS NULL AND t.tenant_id IS NULL))
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
                        ), tenant_id 
                        ORDER BY created_at DESC, id DESC
                    ) as rn
                FROM messages
            ) t
            LEFT JOIN contacts c ON c.phone = t.contact
            LEFT JOIN tenants ON tenants.id = t.tenant_id
            WHERE rn = 1
            ORDER BY last_interaction DESC
        `;

        const conversations = db.prepare(query).all();
        res.json(conversations);
    } catch (error) {
        console.error('[Messages] Conversations fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// Get thread messages
router.get('/conversations/:number/messages', (req, res) => {
    try {
        const contactNumber = req.params.number;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const tenant_id = req.query.tenant_id;

        console.log(`[Messages] Fetching thread for ${contactNumber}, tenant_id: ${tenant_id} (${typeof tenant_id})`);

        let query = `
            SELECT * FROM messages 
            WHERE (sender = ? OR recipient = ?)
        `;
        const params = [contactNumber, contactNumber];

        if (tenant_id && tenant_id !== 'null' && tenant_id !== 'undefined') {
            query += ` AND tenant_id = ?`;
            params.push(tenant_id);
        } else {
            // Strict separation: If no tenant specified, only show messages with NULL tenant
            query += ` AND tenant_id IS NULL`;
        }

        query += ` ORDER BY created_at ASC`;
        // query += ` LIMIT ? OFFSET ?`; // Disable pagination for now as client expects all history usually or handles slicing? 
        // Original code had limit/offset but client usually requests without offset. 
        // I'll keep limit/offset but I need to push them to params.

        // Actually original had .all(..., limit, offset). 
        // Let's keep it simply ordered by ASC for chat view. The original text had LIMIT ? OFFSET ?.
        // I will just return all for simplicity as per chat requirement usually, or respect limit.

        const messages = db.prepare(query).all(...params);

        // Mark incoming messages as read (tenant aware)
        let updateQuery = `
            UPDATE messages 
            SET status = 'read' 
            WHERE sender = ? AND direction = 'incoming' AND status = 'received'
        `;
        const updateParams = [contactNumber];

        if (tenant_id) {
            updateQuery += ` AND tenant_id = ?`;
            updateParams.push(tenant_id);
        }

        db.prepare(updateQuery).run(...updateParams);

        res.json(messages);
    } catch (error) {
        console.error('[Messages] Thread fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch thread messages' });
    }
});

// Get media URL from Meta API
router.get('/media/:mediaId', async (req, res) => {
    try {
        const { mediaId } = req.params;
        const { tenant_id } = req.query;

        // Get credentials
        let accessToken = process.env.DEFAULT_ACCESS_TOKEN;

        if (tenant_id) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant?.access_token) {
                accessToken = tenant.access_token;
            }
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // Get media URL from Meta
        const response = await fetch(`${META_API_BASE}/${mediaId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        const data = await response.json();

        if (response.ok && data.url) {
            res.json({ url: data.url, mime_type: data.mime_type });
        } else {
            res.status(response.status).json({ error: data.error?.message || 'Failed to get media URL' });
        }
    } catch (error) {
        console.error('[Messages] Media fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch media' });
    }
});

// Download media from Meta and proxy to client
router.get('/media/:mediaId/download', async (req, res) => {
    try {
        const { mediaId } = req.params;
        const { tenant_id } = req.query;

        let accessToken = process.env.DEFAULT_ACCESS_TOKEN;

        if (tenant_id) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant?.access_token) {
                accessToken = tenant.access_token;
            }
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // First get the media URL
        const urlResponse = await fetch(`${META_API_BASE}/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        const urlData = await urlResponse.json();

        if (!urlResponse.ok || !urlData.url) {
            return res.status(urlResponse.status).json({ error: 'Failed to get media URL' });
        }

        // Download the actual media
        const mediaResponse = await fetch(urlData.url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (!mediaResponse.ok) {
            return res.status(mediaResponse.status).json({ error: 'Failed to download media' });
        }

        // Set content type and pipe the response
        res.setHeader('Content-Type', urlData.mime_type || 'application/octet-stream');
        const arrayBuffer = await mediaResponse.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (error) {
        console.error('[Messages] Media download error:', error);
        res.status(500).json({ error: 'Failed to download media' });
    }
});

// Send media message
router.post('/send-media', async (req, res) => {
    try {
        const { tenant_id, recipient, type, mediaUrl, caption } = req.body;

        if (!recipient || !type || !mediaUrl) {
            return res.status(400).json({ error: 'Recipient, type, and mediaUrl are required' });
        }

        // Get credentials
        let phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
        let accessToken = process.env.DEFAULT_ACCESS_TOKEN;
        let tenant = null;

        if (tenant_id) {
            tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant) {
                phoneNumberId = tenant.phone_number_id || phoneNumberId;
                accessToken = tenant.access_token || accessToken;
            }
        }

        const reqPhoneId = req.body.phone_number_id || phoneNumberId;
        const reqToken = req.body.access_token || accessToken;

        if (!reqPhoneId || !reqToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // Build media payload
        const payload = {
            messaging_product: 'whatsapp',
            to: recipient,
            type: type,
            [type]: {
                link: mediaUrl,
            }
        };

        if (caption && (type === 'image' || type === 'video' || type === 'document')) {
            payload[type].caption = caption;
        }

        console.log('[Messages] Sending media to Meta:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${META_API_BASE}/${reqPhoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${reqToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        // Save to database
        const messageRecord = {
            tenant_id: tenant?.id || null,
            direction: 'outgoing',
            recipient: recipient,
            message_type: type,
            content: caption || `[${type}]`,
            status: response.ok ? 'sent' : 'failed',
            wamid: data.messages?.[0]?.id || null,
            error_message: data.error?.message || null,
            media_url: mediaUrl,
        };

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, error_message, media_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
            messageRecord.recipient,
            messageRecord.message_type,
            messageRecord.content,
            messageRecord.status,
            messageRecord.wamid,
            messageRecord.error_message,
            messageRecord.media_url
        );

        if (response.ok) {
            res.json({ success: true, message_id: data.messages?.[0]?.id, data });
        } else {
            res.status(response.status).json({ success: false, error: data.error?.message, data });
        }
    } catch (error) {
        console.error('[Messages] Send media error:', error);
        res.status(500).json({ error: 'Failed to send media message' });
    }
});

// Upload media to Meta and send message
router.post('/send-media-file', upload.single('file'), async (req, res) => {
    try {
        const { tenant_id, recipient, type, caption } = req.body;
        const file = req.file;

        if (!recipient || !file) {
            return res.status(400).json({ error: 'Recipient and file are required' });
        }

        // Get tenant credentials
        let phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
        let accessToken = process.env.DEFAULT_ACCESS_TOKEN;

        if (tenant_id) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant?.access_token) {
                phoneNumberId = tenant.phone_number_id;
                accessToken = tenant.access_token;
            } else if (req.body.phone_number_id && req.body.access_token) {
                phoneNumberId = req.body.phone_number_id;
                accessToken = req.body.access_token;
            }
        } else if (req.body.phone_number_id && req.body.access_token) {
            phoneNumberId = req.body.phone_number_id;
            accessToken = req.body.access_token;
        }

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // 1. Upload media directly to Phone Number ID (simpler than Resumable API)
        const form = new FormData();

        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.createReadStream(file.path), file.originalname);

        const uploadUrl = `${META_API_BASE}/${phoneNumberId}/media`;

        console.log(`[Messages] Uploading media to ${uploadUrl}`);

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...form.getHeaders()
            },
            body: form
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok) {
            console.error('[Messages] Meta Upload Error Response:', JSON.stringify(uploadData));
        }

        if (!uploadData.id) {
            console.error('Media upload failed:', uploadData);
            return res.status(400).json({ error: 'Failed to upload media to Meta', details: uploadData });
        }

        const mediaId = uploadData.id;
        console.log(`[Messages] Media uploaded. ID: ${mediaId}`);

        // 2. Send message with media ID
        // Note: 'link' is only for URL-based media. For ID-based, we use 'id'.
        let payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
            type: type,
        };

        payload[type] = {
            id: mediaId,
            caption: caption || ''
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

        // Clean up text file
        try {
            fs.unlinkSync(file.path);
        } catch (e) {
            console.warn('Failed to delete temp file:', e);
        }

        if (!response.ok) {
            return res.status(response.status).json({ success: false, error: data.error?.message, data });
        }

        // Save to database
        const messageRecord = {
            tenant_id: tenant_id || null, // Ensure tenant_id is stored
            direction: 'outgoing',
            recipient: recipient,
            message_type: type,
            content: caption || `[${type}]`,
            status: 'sent',
            wamid: data.messages?.[0]?.id || null,
            error_message: null,
            media_id: mediaId, // Store media_id for retrieval
            media_mime_type: file.mimetype
        };

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, error_message, media_id, media_mime_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
            messageRecord.recipient,
            messageRecord.message_type,
            messageRecord.content,
            messageRecord.status,
            messageRecord.wamid,
            messageRecord.error_message,
            messageRecord.media_id,
            messageRecord.media_mime_type
        );

        res.json({ success: true, message_id: data.messages?.[0]?.id, data });

    } catch (error) {
        console.error('[Messages] Send media file error:', error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Failed to process media file' });
    }
});

// Send interactive message (buttons or list)
router.post('/send-interactive', async (req, res) => {
    try {
        const { tenant_id, recipient, interactive_type, body_text, header_text, footer_text, buttons, sections, list_button_text } = req.body;

        if (!recipient || !interactive_type || !body_text) {
            return res.status(400).json({ error: 'recipient, interactive_type, and body_text are required' });
        }

        if (!['button', 'list'].includes(interactive_type)) {
            return res.status(400).json({ error: 'interactive_type must be "button" or "list"' });
        }

        // Get credentials
        let phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
        let accessToken = process.env.DEFAULT_ACCESS_TOKEN;
        let tenant = null;

        if (tenant_id) {
            tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant) {
                phoneNumberId = tenant.phone_number_id || phoneNumberId;
                accessToken = tenant.access_token || accessToken;
            }
        }

        const reqPhoneId = req.body.phone_number_id || phoneNumberId;
        const reqToken = req.body.access_token || accessToken;

        if (!reqPhoneId || !reqToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // Build interactive payload
        const interactive = {
            type: interactive_type,
            body: { text: body_text }
        };

        if (header_text) {
            interactive.header = { type: 'text', text: header_text };
        }
        if (footer_text) {
            interactive.footer = { text: footer_text };
        }

        if (interactive_type === 'button') {
            if (!buttons || !Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
                return res.status(400).json({ error: 'buttons must be an array of 1-3 items' });
            }
            interactive.action = {
                buttons: buttons.map((btn, i) => ({
                    type: 'reply',
                    reply: {
                        id: btn.id || `btn_${i}`,
                        title: btn.title
                    }
                }))
            };
        } else if (interactive_type === 'list') {
            if (!sections || !Array.isArray(sections) || sections.length === 0) {
                return res.status(400).json({ error: 'sections must be a non-empty array for list type' });
            }
            interactive.action = {
                button: list_button_text || 'عرض الخيارات',
                sections: sections.map(section => ({
                    title: section.title,
                    rows: (section.rows || []).map(row => ({
                        id: row.id,
                        title: row.title,
                        description: row.description || ''
                    }))
                }))
            };
        }

        const payload = {
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'interactive',
            interactive
        };

        console.log('[Messages] Sending interactive to Meta:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${META_API_BASE}/${reqPhoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${reqToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        // Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, error_message)
            VALUES (?, 'outgoing', ?, 'interactive', ?, ?, ?, ?)
        `).run(
            tenant?.id || null,
            recipient,
            JSON.stringify({ type: interactive_type, body: body_text, header: header_text }),
            response.ok ? 'sent' : 'failed',
            data.messages?.[0]?.id || null,
            data.error?.message || null
        );

        // Log activity
        if (tenant) {
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'interactive_sent', ?, ?)
            `).run(tenant.id, tenant.name, `إرسال رسالة تفاعلية (${interactive_type})`, response.ok ? 'success' : 'error');
        }

        if (response.ok) {
            res.json({ success: true, message_id: data.messages?.[0]?.id, data });
        } else {
            res.status(response.status).json({ success: false, error: data.error?.message, data });
        }
    } catch (error) {
        console.error('[Messages] Send interactive error:', error);
        res.status(500).json({ error: 'Failed to send interactive message' });
    }
});

export default router;

