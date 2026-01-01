import express from 'express';
import db from '../db/database.js';

const router = express.Router();

const META_API_VERSION = 'v22.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

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
        const messageRecord = {
            tenant_id: tenant?.id || null,
            direction: 'outgoing',
            recipient: recipient,
            message_type: type || 'text',
            content: type === 'template' ? `[Template: ${templateName}]` : message,
            status: response.ok ? 'sent' : 'failed',
            wamid: data.messages?.[0]?.id || null,
            error_message: data.error?.message || null,
        };

        db.prepare(`
      INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
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
                contact,
                created_at as last_interaction,
                content as last_message,
                (
                    SELECT COUNT(*) 
                    FROM messages m2 
                    WHERE m2.sender = t.contact 
                    AND m2.direction = 'incoming' 
                    AND m2.status = 'received'
                ) as unread_count
            FROM (
                SELECT 
                    id,
                    content,
                    created_at,
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
            ) t
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

        const messages = db.prepare(`
            SELECT * FROM messages 
            WHERE sender = ? OR recipient = ?
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
        `).all(contactNumber, contactNumber, limit, offset);

        res.json(messages);
    } catch (error) {
        console.error('[Messages] Thread fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch thread messages' });
    }
});

export default router;
