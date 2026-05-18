import express from 'express';
import db from '../db/database.js';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { META_API_BASE } from '../config/index.js';
import { generalUpload as upload, uploadDir, cleanupFile } from '../config/upload.js';
import eventBus from '../services/eventBus.js';
import { resolveCredentials } from '../services/credentials.js';
import {
    buildRichTemplateContent,
    buildTemplateComponentsFromMapping,
    buildInteractivePayload,
    enrichTemplateFallbackMessages,
    normalizeTemplateComponents,
    parseTemplateShortcut,
} from '../services/messaging.js';
import { normalizeFilename } from '../services/filenames.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ============================================
// 24h Window Status (Admin)
// ============================================
router.get('/window-status/:phone', (req, res) => {
    const phone = req.params.phone;
    const { tenant_id } = req.query;

    let contact;
    if (tenant_id) {
        contact = db.prepare(
            'SELECT last_customer_message_at FROM contacts WHERE tenant_id = ? AND phone = ?'
        ).get(tenant_id, phone);
    } else {
        contact = db.prepare(
            'SELECT last_customer_message_at FROM contacts WHERE phone = ? ORDER BY last_customer_message_at DESC LIMIT 1'
        ).get(phone);
    }

    const lastMsg = contact?.last_customer_message_at ? new Date(contact.last_customer_message_at) : null;
    const windowMs = 24 * 60 * 60 * 1000;
    const isOpen = lastMsg && (Date.now() - lastMsg.getTime()) <= windowMs;

    res.json({
        is_open: isOpen,
        last_customer_message_at: lastMsg?.toISOString() || null,
        window_closes_at: lastMsg ? new Date(lastMsg.getTime() + windowMs).toISOString() : null,
    });
});

// ============================================
// Send message via Meta API
// ============================================
router.post('/send', async (req, res) => {
    try {
        const { tenant_id, recipient, type, message } = req.body;
        const shortcut = parseTemplateShortcut(req.body.message);
        const templateName = req.body.templateName || req.body.template_name || req.body.template || shortcut?.name;
        const templateLanguage = req.body.templateLanguage || req.body.template_language || shortcut?.language;
        const rawTemplateParams = req.body.templateParams ?? req.body.template_params ?? req.body.params ?? shortcut?.params ?? [];
        const normalizedTemplateParams = normalizeTemplateComponents(rawTemplateParams);
        const effectiveType = (type === 'template' || templateName) ? 'template' : (type || 'text');

        if (!recipient) {
            return res.status(400).json({ error: 'Recipient is required' });
        }

        // Get tenant credentials or use defaults
        const credentials = resolveCredentials({
            tenantId: tenant_id,
            phoneNumberIdOverride: req.body.phone_number_id,
            accessTokenOverride: req.body.access_token,
        });

        if (credentials.isSuspended) {
            return res.status(403).json({ error: 'هذا العميل معلّق ولا يمكنه إرسال الرسائل' });
        }

        const { tenant, phoneNumberId, accessToken } = credentials;

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'Missing API credentials. Configure tenant or provide phone_number_id and access_token.' });
        }

        const reqPhoneId = phoneNumberId;
        const reqToken = accessToken;

        // 24h conversation window enforcement for non-template messages (tenant sends only)
        if (effectiveType !== 'template' && tenant_id) {
            const contact = db.prepare(
                'SELECT last_customer_message_at FROM contacts WHERE tenant_id = ? AND phone = ?'
            ).get(tenant_id, recipient);

            const lastMsg = contact?.last_customer_message_at ? new Date(contact.last_customer_message_at) : null;
            const windowMs = 24 * 60 * 60 * 1000;

            if (!lastMsg || (Date.now() - lastMsg.getTime()) > windowMs) {
                return res.status(400).json({
                    error: 'نافذة المحادثة (24 ساعة) مغلقة. يمكنك فقط إرسال قوالب معتمدة.',
                    code: 'OUTSIDE_WINDOW',
                    window_closed_at: lastMsg ? new Date(lastMsg.getTime() + windowMs).toISOString() : null,
                });
            }
        }

        // Build payload
        let payload = {
            messaging_product: 'whatsapp',
            to: recipient,
        };

        if (effectiveType === 'template') {
            if (!templateName) {
                return res.status(400).json({ error: 'templateName is required for template type' });
            }

            payload.type = 'template';
            payload.template = {
                name: templateName,
                language: { code: templateLanguage || 'ar' },
            };

            // Validate template variable count if we can find the template
            if (tenant_id) {
                const tmpl = db.prepare('SELECT body FROM templates WHERE tenant_id = ? AND name = ?')
                    .get(tenant_id, templateName);
                if (tmpl) {
                    const placeholders = (tmpl.body || '').match(/\{\{\d+\}\}/g) || [];
                    const expectedCount = placeholders.length;
                    const bodyComp = normalizedTemplateParams.find(c => c.type === 'body' || c.type === 'BODY');
                    const providedCount = bodyComp?.parameters?.length || 0;
                    if (expectedCount > 0 && providedCount !== expectedCount) {
                        return res.status(400).json({
                            error: `القالب يتطلب ${expectedCount} متغيرات، تم تقديم ${providedCount}`,
                            code: 'TEMPLATE_PARAM_MISMATCH',
                            expected: expectedCount,
                            provided: providedCount,
                        });
                    }
                }
            }

            if (normalizedTemplateParams.length > 0) {
                payload.template.components = normalizedTemplateParams;
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
        let storedContent = message;
        if (effectiveType === 'template') {
            storedContent = `[Template: ${templateName}]`; // Default fallback

            if (tenant_id) {
                try {
                    const template = db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND name = ?').get(tenant_id, templateName);

                    if (template) {
                        storedContent = buildRichTemplateContent(template, normalizedTemplateParams) || storedContent;
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
            message_type: effectiveType,
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
                effectiveType === 'template' ? 'template_sent' : 'message_sent',
                effectiveType === 'template' ? `إرسال قالب: ${templateName}` : 'إرسال رسالة نصية',
                response.ok ? 'success' : 'error'
            );
            
            // Deduct credit on successful send (if tenant specified)
            if (response.ok && tenant_id) {
                db.prepare('UPDATE tenants SET credits = credits - 1 WHERE id = ? AND credits > 0')
                    .run(tenant_id);
            }
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

        const messages = enrichTemplateFallbackMessages(db.prepare(query).all(...params));

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
            LEFT JOIN contacts c ON c.phone = t.contact AND (c.tenant_id = t.tenant_id OR (c.tenant_id IS NULL AND t.tenant_id IS NULL))
            LEFT JOIN tenants ON tenants.id = t.tenant_id
            WHERE rn = 1
            ORDER BY last_interaction DESC
        `;

        const conversations = enrichTemplateFallbackMessages(db.prepare(query).all(), 'last_message');
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

        const messages = enrichTemplateFallbackMessages(db.prepare(query).all(...params));

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
        const credentials = resolveCredentials({ tenantId: tenant_id });
        const accessToken = credentials.accessToken;

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

        // Use resolveCredentials to properly decrypt tenant access tokens
        const credentials = resolveCredentials({ tenantId: tenant_id });
        const accessToken = credentials.accessToken;

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

// Upload media to Meta for admin broadcast template headers.
router.post('/media/upload-to-meta', upload.single('file'), async (req, res) => {
    try {
        const { tenant_id } = req.body;
        const file = req.file;

        if (!tenant_id) {
            if (file) cleanupFile(file.path);
            return res.status(400).json({ error: 'tenant_id is required' });
        }
        if (!file) {
            return res.status(400).json({ error: 'file is required' });
        }

        const credentials = resolveCredentials({ tenantId: tenant_id });
        if (credentials.isSuspended) {
            cleanupFile(file.path);
            return res.status(403).json({ error: 'Tenant account is suspended' });
        }

        const { phoneNumberId, accessToken } = credentials;
        if (!phoneNumberId || !accessToken) {
            cleanupFile(file.path);
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        const displayFilename = normalizeFilename(file.originalname, 'upload');
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.readFileSync(file.path), {
            filename: displayFilename,
            contentType: file.mimetype,
        });

        const uploadResponse = await fetch(`${META_API_BASE}/${phoneNumberId}/media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...form.getHeaders(),
            },
            body: form.getBuffer(),
        });

        const uploadData = await uploadResponse.json();
        cleanupFile(file.path);

        if (!uploadResponse.ok || !uploadData.id) {
            console.error('[Messages] Media upload-to-meta failed:', uploadResponse.status, uploadData);
            return res.status(400).json({
                error: 'Failed to upload media to Meta',
                details: uploadData.error?.message || uploadData,
            });
        }

        res.json({
            id: uploadData.id,
            filename: displayFilename,
            mime_type: file.mimetype,
        });
    } catch (error) {
        console.error('[Messages] Media upload-to-meta error:', error);
        if (req.file) cleanupFile(req.file.path);
        res.status(500).json({ error: 'Failed to upload media to Meta' });
    }
});

// Send media message
router.post('/send-media', async (req, res) => {
    try {
        const { tenant_id, recipient, type, mediaUrl, caption } = req.body;
        const hasDocumentFilename = type === 'document' && Boolean(req.body.filename);
        const displayFilename = type === 'document' ? normalizeFilename(req.body.filename) : null;

        if (!recipient || !type || !mediaUrl) {
            return res.status(400).json({ error: 'Recipient, type, and mediaUrl are required' });
        }

        // Get credentials
        const credentials = resolveCredentials({
            tenantId: tenant_id,
            phoneNumberIdOverride: req.body.phone_number_id,
            accessTokenOverride: req.body.access_token,
        });

        const { tenant, phoneNumberId, accessToken } = credentials;
        const reqPhoneId = phoneNumberId;
        const reqToken = accessToken;

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
        if (hasDocumentFilename) {
            payload.document.filename = displayFilename;
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
            sender: reqPhoneId,
            recipient: recipient,
            message_type: type,
            content: type === 'document' ? (caption ? `${displayFilename}\n\n${caption}` : displayFilename) : (caption || `[${type}]`),
            status: response.ok ? 'sent' : 'failed',
            wamid: data.messages?.[0]?.id || null,
            error_message: data.error?.message || null,
            media_url: mediaUrl,
        };

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, error_message, media_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
            messageRecord.sender,
            messageRecord.recipient,
            messageRecord.message_type,
            messageRecord.content,
            messageRecord.status,
            messageRecord.wamid,
            messageRecord.error_message,
            messageRecord.media_url
        );

        // Deduct credit if tenant specified
        if (tenant_id && response.ok) {
            db.prepare('UPDATE tenants SET credits = credits - 1 WHERE id = ? AND credits > 0').run(tenant_id);
        }

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
        const credentials = resolveCredentials({
            tenantId: tenant_id,
            phoneNumberIdOverride: req.body.phone_number_id,
            accessTokenOverride: req.body.access_token,
        });

        let phoneNumberId = credentials.phoneNumberId;
        let accessToken = credentials.accessToken;

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // 1. Upload media directly to Phone Number ID (simpler than Resumable API)
        const displayFilename = normalizeFilename(file.originalname, 'upload');
        const form = new FormData();

        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.readFileSync(file.path), {
            filename: displayFilename,
            contentType: file.mimetype
        });

        const uploadUrl = `${META_API_BASE}/${phoneNumberId}/media`;

        console.log(`[Messages] Uploading media to ${uploadUrl}`);

        // Convert form-data to buffer for compatibility with native fetch
        const formBuffer = form.getBuffer();
        const formHeaders = form.getHeaders();

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...formHeaders
            },
            body: formBuffer
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
        if (type === 'document') {
            payload.document.filename = displayFilename;
        }

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
            sender: phoneNumberId,
            recipient: recipient,
            message_type: type,
            content: type === 'document' ? (caption ? `${displayFilename}\n\n${caption}` : displayFilename) : (caption || `[${type}]`),
            status: 'sent',
            wamid: data.messages?.[0]?.id || null,
            error_message: null,
            media_id: mediaId, // Store media_id for retrieval
            media_mime_type: file.mimetype
        };

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, error_message, media_id, media_mime_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
            messageRecord.sender,
            messageRecord.recipient,
            messageRecord.message_type,
            messageRecord.content,
            messageRecord.status,
            messageRecord.wamid,
            messageRecord.error_message,
            messageRecord.media_id,
            messageRecord.media_mime_type
        );

        // Deduct credit if tenant specified
        if (tenant_id && response.ok) {
            db.prepare('UPDATE tenants SET credits = credits - 1 WHERE id = ? AND credits > 0').run(tenant_id);
        }

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

        // Validate buttons/sections based on type
        if (interactive_type === 'button' && (!buttons || !Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3)) {
            return res.status(400).json({ error: 'buttons must be an array of 1-3 items' });
        }
        if (interactive_type === 'list' && (!sections || !Array.isArray(sections) || sections.length === 0)) {
            return res.status(400).json({ error: 'sections must be a non-empty array for list type' });
        }

        // Get credentials
        const credentials = resolveCredentials({
            tenantId: tenant_id,
            phoneNumberIdOverride: req.body.phone_number_id,
            accessTokenOverride: req.body.access_token,
        });

        const { tenant, phoneNumberId, accessToken } = credentials;

        const reqPhoneId = phoneNumberId;
        const reqToken = accessToken;

        if (!reqPhoneId || !reqToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // Build interactive payload using shared service
        const interactive = buildInteractivePayload({
            interactiveType: interactive_type,
            bodyText: body_text,
            headerText: header_text,
            footerText: footer_text,
            buttons: buttons,
            sections: sections,
            listButtonText: list_button_text,
        });

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
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, error_message)
            VALUES (?, 'outgoing', ?, ?, 'interactive', ?, ?, ?, ?)
        `).run(
            tenant?.id || null,
            reqPhoneId,
            recipient,
            JSON.stringify({ type: interactive_type, body: body_text, header: header_text, footer: footer_text, buttons: interactive_type === 'button' ? buttons : undefined, list_button: list_button_text }),
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
            
            // Deduct credit if tenant specified
            if (response.ok && tenant_id) {
                db.prepare('UPDATE tenants SET credits = credits - 1 WHERE id = ? AND credits > 0').run(tenant_id);
            }
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

// ============================================
// Broadcast (Admin) — Async with job tracking
// ============================================
router.post('/broadcast', async (req, res) => {
    try {
        const { tenant_id, recipients, template_name, template_language, template_params } = req.body;

        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'recipients array is required' });
        }
        if (!template_name) {
            return res.status(400).json({ error: 'template_name is required (broadcasts must use templates)' });
        }
        if (recipients.length > 500) {
            return res.status(400).json({ error: 'Maximum 500 recipients per broadcast' });
        }

        const credentials = resolveCredentials({
            tenantId: tenant_id,
            phoneNumberIdOverride: req.body.phone_number_id,
            accessTokenOverride: req.body.access_token,
        });

        const { tenant, phoneNumberId, accessToken: resolvedToken } = credentials;
        const finalAccessToken = resolvedToken;

        if (tenant && tenant.credits !== null && tenant.credits < recipients.length) {
            return res.status(402).json({
                error: `رصيد غير كافٍ. مطلوب ${recipients.length}، متاح ${tenant.credits}`,
                code: 'INSUFFICIENT_CREDITS',
                required: recipients.length,
                available: tenant.credits,
            });
        }

        if (!phoneNumberId || !finalAccessToken) {
            return res.status(400).json({ error: 'Missing API credentials' });
        }

        // Create broadcast job
        const jobResult = db.prepare(`
            INSERT INTO broadcast_jobs (tenant_id, status, template_name, template_language, total_recipients)
            VALUES (?, 'pending', ?, ?, ?)
        `).run(tenant_id || null, template_name, template_language || 'ar', recipients.length);

        const jobId = jobResult.lastInsertRowid;

        // Respond immediately
        res.status(202).json({ job_id: jobId, status: 'pending', total: recipients.length });

        // Process in background
        setImmediate(() => processBroadcastJob(jobId, {
            tenant_id, recipients, template_name, template_language, template_params,
            variable_mapping: req.body.variable_mapping,
            phoneNumberId, finalAccessToken, tenant,
        }));

    } catch (error) {
        console.error('[Messages] Broadcast error:', error);
        res.status(500).json({ error: 'Failed to broadcast' });
    }
});

// Broadcast job statuses
router.get('/broadcast-jobs', (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        const jobs = db.prepare(
            'SELECT * FROM broadcast_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(parseInt(limit), parseInt(offset));
        const total = db.prepare('SELECT COUNT(*) as count FROM broadcast_jobs').get().count;
        res.json({ jobs, total });
    } catch (error) {
        console.error('[Messages] Broadcast jobs fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch broadcast jobs' });
    }
});

router.get('/broadcast-jobs/:id', (req, res) => {
    try {
        const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(req.params.id);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json(job);
    } catch (error) {
        console.error('[Messages] Broadcast job fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch broadcast job' });
    }
});

// Background broadcast processor
async function processBroadcastJob(jobId, params) {
    const { tenant_id, recipients, template_name, template_language, template_params,
            variable_mapping, phoneNumberId, finalAccessToken, tenant } = params;

    try {
        db.prepare("UPDATE broadcast_jobs SET status = 'running' WHERE id = ?").run(jobId);

        const results = [];
        let sent = 0, failed = 0;
        const batchSize = 5;
        const batchDelay = 200;
        const total = recipients.length;
        const templateRecord = tenant_id
            ? db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND name = ?').get(tenant_id, template_name)
            : null;

        for (let i = 0; i < total; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);

            const batchPromises = batch.map(async (recipient) => {
                try {
                    const formattedRecipient = recipient.replace(/\+/g, '').trim();
                    const payload = {
                        messaging_product: 'whatsapp',
                        to: formattedRecipient,
                        type: 'template',
                        template: {
                            name: template_name,
                            language: { code: template_language || 'ar' },
                        },
                    };

                    const contact = Array.isArray(variable_mapping) && variable_mapping.length > 0
                        ? db.prepare(
                            'SELECT phone, profile_name, label, notes FROM contacts WHERE phone = ? AND (tenant_id = ? OR tenant_id IS NULL) ORDER BY tenant_id DESC LIMIT 1'
                        ).get(formattedRecipient, tenant_id || null)
                        : null;
                    const components = buildTemplateComponentsFromMapping(variable_mapping, template_params, contact, formattedRecipient);
                    if (components.length > 0) {
                        payload.template.components = components;
                    }

                    const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${finalAccessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(payload),
                    });

                    const data = await response.json();

                    if (response.ok) {
                        const messageId = data.messages?.[0]?.id;
                        const storedContent = buildRichTemplateContent(templateRecord, payload.template.components || [])
                            || `[قالب: ${template_name}]`;
                        db.prepare(`
                            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
                            VALUES (?, 'outgoing', ?, ?, 'template', ?, 'sent', ?)
                        `).run(tenant_id || null, phoneNumberId, formattedRecipient, storedContent, messageId);
                        return { recipient: formattedRecipient, status: 'sent', message_id: messageId };
                    } else {
                        return { recipient: formattedRecipient, status: 'failed', error: data.error?.message };
                    }
                } catch (err) {
                    return { recipient, status: 'failed', error: err.message };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            sent += batchResults.filter(r => r.status === 'sent').length;
            failed += batchResults.filter(r => r.status === 'failed').length;

            const progress = Math.round(((i + batch.length) / total) * 100);
            db.prepare(
                'UPDATE broadcast_jobs SET sent_count = ?, failed_count = ?, progress_pct = ? WHERE id = ?'
            ).run(sent, failed, progress, jobId);

            eventBus.broadcast('admin', 'broadcast:progress', { job_id: jobId, progress_pct: progress, sent_count: sent, failed_count: failed });

            if (i + batchSize < total) {
                await new Promise(r => setTimeout(r, batchDelay));
            }
        }

        // Deduct credits
        if (tenant_id && sent > 0) {
            db.prepare('UPDATE tenants SET credits = credits - ? WHERE id = ? AND credits >= ?')
                .run(sent, tenant_id, sent);
        }

        // Log activity
        if (tenant) {
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'broadcast', ?, ?)
            `).run(tenant_id, tenant.name,
                `بث ${template_name} إلى ${total} مستلم (${sent} نجاح، ${failed} فشل)`,
                failed === 0 ? 'success' : 'partial');
        }

        db.prepare(`
            UPDATE broadcast_jobs SET status = 'completed', sent_count = ?, failed_count = ?,
                progress_pct = 100, results = ?, completed_at = datetime('now', 'localtime') WHERE id = ?
        `).run(sent, failed, JSON.stringify(results), jobId);

        eventBus.broadcast('admin', 'broadcast:complete', { job_id: jobId, sent, failed });

    } catch (error) {
        console.error('[Messages] Broadcast job error:', error);
        db.prepare(`
            UPDATE broadcast_jobs SET status = 'failed', error = ?, completed_at = datetime('now', 'localtime') WHERE id = ?
        `).run(error.message, jobId);
        eventBus.broadcast('admin', 'broadcast:complete', { job_id: jobId, sent: 0, failed: 0, error: error.message });
    }
}

// ============================================
// Contact Management (Admin)
// ============================================

// List contacts with search, pagination, tenant filter
router.get('/contacts', (req, res) => {
    try {
        const { search, tenant_id, label, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = [];
        let params = [];

        if (tenant_id) {
            where.push('c.tenant_id = ?');
            params.push(tenant_id);
        }
        if (search) {
            where.push('(c.phone LIKE ? OR c.profile_name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (label) {
            where.push('c.label = ?');
            params.push(label);
        }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const contacts = db.prepare(`
            SELECT c.*, t.name as tenant_name,
                (SELECT COUNT(*) FROM messages m WHERE
                    m.tenant_id = c.tenant_id AND (m.sender = c.phone OR m.recipient = c.phone)
                ) as message_count
            FROM contacts c
            LEFT JOIN tenants t ON c.tenant_id = t.id
            ${whereClause}
            ORDER BY c.updated_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, parseInt(limit), offset);

        const total = db.prepare(`SELECT COUNT(*) as count FROM contacts c ${whereClause}`).get(...params);

        res.json({
            contacts,
            total: total.count,
            page: parseInt(page),
            limit: parseInt(limit),
        });
    } catch (error) {
        console.error('[Messages] Contacts list error:', error);
        res.status(500).json({ error: 'Failed to list contacts' });
    }
});

// Update contact label/notes
router.put('/contacts/:id', (req, res) => {
    try {
        const { label, notes, profile_name } = req.body;
        const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
        if (!contact) {
            return res.status(404).json({ error: 'جهة الاتصال غير موجودة' });
        }

        db.prepare(`
            UPDATE contacts SET
                label = COALESCE(?, label),
                notes = COALESCE(?, notes),
                profile_name = COALESCE(?, profile_name),
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(label, notes, profile_name, req.params.id);

        const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        console.error('[Messages] Contact update error:', error);
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

// Create a new contact manually
router.post('/contacts', async (req, res) => {
    try {
        const { tenant_id, phone, profile_name, label, notes, verify } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '').trim();

        if (formattedPhone.length < 7) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        if (!tenant_id) {
            const existing = db.prepare('SELECT * FROM contacts WHERE tenant_id IS NULL AND phone = ?')
                .get(formattedPhone);

            if (existing) {
                return res.status(409).json({ error: 'Contact already exists', contact: existing });
            }

            const result = db.prepare(`
                INSERT INTO contacts (tenant_id, phone, profile_name, label, notes, updated_at)
                VALUES (NULL, ?, ?, ?, ?, datetime('now', 'localtime'))
            `).run(formattedPhone, profile_name || null, label || null, notes || null);

            const newContact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
            return res.status(201).json(newContact);
        }

        const existing = db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?')
            .get(tenant_id, formattedPhone);

        if (existing) {
            return res.status(409).json({ error: 'Contact already exists', contact: existing });
        }

        if (!verify) {
            const result = db.prepare(`
                INSERT INTO contacts (tenant_id, phone, profile_name, label, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
            `).run(tenant_id, formattedPhone, profile_name || null, label || null, notes || null);

            const newContact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
            return res.status(201).json(newContact);
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        const creds = await resolveCredentials(tenant_id);
        if (!creds || !creds.accessToken || !creds.phoneNumberId) {
            return res.status(400).json({ error: 'WhatsApp API credentials not configured for this tenant' });
        }

        const template = db.prepare(
            "SELECT * FROM templates WHERE tenant_id = ? AND status = 'approved' ORDER BY id ASC LIMIT 1"
        ).get(tenant_id);

        if (!template) {
            return res.status(400).json({ error: 'No approved template found. Add an approved template first to verify contacts.' });
        }

        const payload = {
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'template',
            template: {
                name: template.name,
                language: { code: template.language || 'ar' },
            },
        };

        console.log('[Messages] Verifying contact via template:', formattedPhone);

        const response = await fetch(`${META_API_BASE}/${creds.phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${creds.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data.error?.message || data.error?.error_string || 'Unknown error';
            const isNotFound = data.error?.code === 131026 || errorMsg.includes('not found') || errorMsg.includes('not a valid');
            console.error('[Messages] Contact verification failed:', errorMsg);
            return res.status(400).json({
                error: isNotFound ? 'Number not found on WhatsApp' : 'Failed to verify number',
                details: errorMsg,
                code: data.error?.code,
            });
        }

        const waId = data.contacts?.[0]?.wa_id || formattedPhone;
        const messageId = data.messages?.[0]?.id || null;

        const result = db.prepare(`
            INSERT INTO contacts (tenant_id, phone, profile_name, label, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).run(tenant_id, waId, profile_name || label || null, label || null, notes || null);

        const newContact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);

        let storedContent = `[Greeting template: ${template.name}]`;
        try {
            const richContent = {
                header: template.header_content ? { type: template.header_type, text: template.header_content } : null,
                body: template.body || '',
                footer: template.footer,
                buttons: template.buttons ? JSON.parse(template.buttons) : null,
            };
            storedContent = JSON.stringify(richContent);
        } catch (_) {}

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tenant_id, 'outgoing', creds.phoneNumberId, waId, 'template', storedContent, 'sent', messageId);

        db.prepare('UPDATE tenants SET credits = credits - 1 WHERE id = ? AND credits > 0').run(tenant_id);

        eventBus.emitNewMessage({
            tenant_id: tenant_id,
            direction: 'outgoing',
            sender: creds.phoneNumberId,
            recipient: waId,
            message_type: 'template',
            content: storedContent,
            wamid: messageId,
            created_at: new Date().toISOString(),
        });
        eventBus.emitConversationUpdate(tenant_id);

        res.status(201).json({ contact: newContact, template_sent: true });
    } catch (error) {
        console.error('[Messages] Contact create error:', error);
        res.status(500).json({ error: 'Failed to create contact' });
    }
});

// Delete a contact
router.delete('/contacts/:id', (req, res) => {
    try {
        const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: 'Contact deleted' });
    } catch (error) {
        console.error('[Messages] Contact delete error:', error);
        res.status(500).json({ error: 'Failed to delete contact' });
    }
});

// ============================================
// Mark message as read (Admin)
// ============================================
router.post('/mark-read', async (req, res) => {
    try {
        const { message_id, tenant_id, phone_number_id, access_token } = req.body;

        if (!message_id) {
            return res.status(400).json({ error: 'message_id is required' });
        }

        const { phoneNumberId, accessToken, isSuspended } = resolveCredentials({
            tenantId: tenant_id,
            phoneNumberIdOverride: phone_number_id,
            accessTokenOverride: access_token,
        });

        if (isSuspended) {
            return res.status(403).json({ error: 'Tenant is suspended' });
        }

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'Missing phone_number_id or access_token' });
        }

        const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: message_id,
            }),
        });

        const data = await response.json();

        if (response.ok) {
            res.json({ success: true });
        } else {
            console.error('[Messages] Mark read failed:', data.error);
            res.status(response.status).json({ success: false, error: data.error?.message || 'Failed to mark as read' });
        }
    } catch (error) {
        console.error('[Messages] Mark read error:', error);
        res.status(500).json({ error: 'Failed to mark message as read' });
    }
});

export default router;
