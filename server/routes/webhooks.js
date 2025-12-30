import express from 'express';
import db from '../db/database.js';

const router = express.Router();

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'whatsapp_platform_verify_token_2024';

// Webhook verification (GET request from Meta)
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[Webhook] Verification request:', { mode, token, challenge: challenge?.substring(0, 20) + '...' });

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[Webhook] Verification successful');
        res.status(200).send(challenge);
    } else {
        console.log('[Webhook] Verification failed - token mismatch');
        res.sendStatus(403);
    }
});

// Webhook events handler (POST request from Meta)
router.post('/', (req, res) => {
    console.log('🔥 RAW REQUEST 🔥', req);
    console.log('🔥 RAW BODY 🔥', req.body);
    const body = req.body;

    console.log('[Webhook] Received event:', JSON.stringify(body, null, 2));

    // Always respond 200 OK quickly to Meta
    res.sendStatus(200);

    try {
        // Log the raw webhook
        db.prepare(`
      INSERT INTO webhook_logs (event_type, payload)
      VALUES (?, ?)
    `).run(body.object || 'unknown', JSON.stringify(body));

        // Process WhatsApp Business Account Events
        if (body.object === 'whatsapp_business_account') {
            const entries = body.entry || [];

            entries.forEach(entry => {
                const changes = entry.changes || [];

                changes.forEach(change => {
                    const value = change.value;
                    const phoneNumberId = value.metadata?.phone_number_id;

                    // Find tenant by phone_number_id
                    const tenant = db.prepare('SELECT * FROM tenants WHERE phone_number_id = ?').get(phoneNumberId);

                    // Handle incoming messages
                    if (value.messages) {
                        value.messages.forEach(message => {
                            const messageData = {
                                tenant_id: tenant?.id || null,
                                direction: 'incoming',
                                sender: message.from,
                                recipient: phoneNumberId,
                                message_type: message.type,
                                content: extractMessageContent(message),
                                status: 'received',
                                wamid: message.id,
                            };

                            db.prepare(`
                INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                                messageData.tenant_id,
                                messageData.direction,
                                messageData.sender,
                                messageData.recipient,
                                messageData.message_type,
                                messageData.content,
                                messageData.status,
                                messageData.wamid
                            );

                            // Log activity
                            if (tenant) {
                                db.prepare(`
                  INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                  VALUES (?, ?, 'message_received', ?, 'success')
                `).run(tenant.id, tenant.name, `رسالة واردة من ${message.from}`);
                            }

                            console.log('[Webhook] Incoming message saved:', message.id);
                        });
                    }

                    // Handle message status updates
                    if (value.statuses) {
                        value.statuses.forEach(status => {
                            db.prepare(`
                UPDATE messages SET status = ? WHERE wamid = ?
              `).run(status.status, status.id);

                            console.log('[Webhook] Status update:', status.id, '->', status.status);

                            // Log failed messages
                            if (status.status === 'failed' && tenant) {
                                const errors = status.errors?.map(e => e.message).join(', ') || 'Unknown error';
                                db.prepare(`
                  INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                  VALUES (?, ?, 'message_failed', ?, 'error')
                `).run(tenant.id, tenant.name, `فشل إرسال الرسالة: ${errors}`);
                            }
                        });
                    }

                    // Handle account quality updates
                    if (value.account_update) {
                        const update = value.account_update;
                        if (tenant && update.phone_number_quality_rating) {
                            const qualityMap = {
                                'GREEN': 'High',
                                'YELLOW': 'Medium',
                                'RED': 'Low'
                            };
                            const newQuality = qualityMap[update.phone_number_quality_rating] || 'Medium';

                            db.prepare('UPDATE tenants SET quality = ? WHERE id = ?').run(newQuality, tenant.id);

                            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'quality_update', ?, ?)
              `).run(
                                tenant.id,
                                tenant.name,
                                `تحديث جودة الرقم: ${update.phone_number_quality_rating}`,
                                newQuality === 'Low' ? 'error' : newQuality === 'Medium' ? 'warning' : 'success'
                            );

                            console.log('[Webhook] Quality update for tenant:', tenant.id, '->', newQuality);
                        }
                    }
                });
            });
        }
    } catch (error) {
        console.error('[Webhook] Processing error:', error);
    }
});

// Helper to extract message content based on type
function extractMessageContent(message) {
    switch (message.type) {
        case 'text':
            return message.text?.body || '';
        case 'image':
            return `[Image: ${message.image?.caption || 'No caption'}]`;
        case 'video':
            return `[Video: ${message.video?.caption || 'No caption'}]`;
        case 'audio':
            return '[Audio message]';
        case 'document':
            return `[Document: ${message.document?.filename || 'Unknown'}]`;
        case 'location':
            return `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
        case 'sticker':
            return '[Sticker]';
        case 'button':
            return message.button?.text || '[Button response]';
        case 'interactive':
            if (message.interactive?.type === 'button_reply') {
                return message.interactive.button_reply?.title || '[Button reply]';
            }
            if (message.interactive?.type === 'list_reply') {
                return message.interactive.list_reply?.title || '[List reply]';
            }
            return '[Interactive message]';
        default:
            return `[${message.type} message]`;
    }
}

export default router;
