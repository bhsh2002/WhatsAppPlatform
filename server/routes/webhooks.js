import express from 'express';
import crypto from 'crypto';
import db from '../db/database.js';

const router = express.Router();

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

if (!VERIFY_TOKEN) console.warn('⚠️ WARNING: WEBHOOK_VERIFY_TOKEN is missing. Webhook verification will fail.');
if (!APP_SECRET) console.warn('⚠️ WARNING: META_APP_SECRET is missing. Incoming webhooks cannot be securely verified.');

// ============================================
// Helper: Forward webhook to tenant's URL
// ============================================
const forwardToTenantWebhook = async (tenantId, event, data) => {
    try {
        const settings = db.prepare(`
            SELECT * FROM tenant_api_settings 
            WHERE tenant_id = ? AND is_active = 1 AND webhook_url IS NOT NULL
        `).get(tenantId);

        if (!settings || !settings.webhook_url) return;

        const payload = {
            event,
            timestamp: new Date().toISOString(),
            tenant_id: tenantId,
            data
        };

        // Sign payload with webhook secret
        const signature = crypto.createHmac('sha256', settings.webhook_secret)
            .update(JSON.stringify(payload))
            .digest('hex');

        // Fire and forget - don't wait for response
        fetch(settings.webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature': `sha256=${signature}`,
                'X-Tenant-Id': String(tenantId)
            },
            body: JSON.stringify(payload)
        }).catch(err => {
            console.error('[Webhook] Forward to tenant failed:', err.message);
        });

        console.log('[Webhook] Forwarding to tenant webhook:', settings.webhook_url);
    } catch (error) {
        console.error('[Webhook] Forward error:', error);
    }
};

// ============================================
// Helper: Send status callback to tenant
// ============================================
const sendStatusCallback = async (tenantId, data) => {
    try {
        const settings = db.prepare(`
            SELECT * FROM tenant_api_settings 
            WHERE tenant_id = ? AND callback_url IS NOT NULL
        `).get(tenantId);

        if (!settings || !settings.callback_url) return;

        const payload = {
            event: 'message_status',
            timestamp: new Date().toISOString(),
            tenant_id: tenantId,
            data
        };

        const signature = crypto.createHmac('sha256', settings.webhook_secret)
            .update(JSON.stringify(payload))
            .digest('hex');

        fetch(settings.callback_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature': `sha256=${signature}`,
                'X-Tenant-Id': String(tenantId)
            },
            body: JSON.stringify(payload)
        }).catch(err => {
            console.error('[Callback] Status callback failed:', err.message);
        });
    } catch (error) {
        console.error('[Callback] Error:', error);
    }
};

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
    // Validate signature if APP_SECRET is provided
    if (APP_SECRET) {
        const signature = req.headers['x-hub-signature-256'];
        
        if (!signature || !req.rawBody) {
            console.error('[Webhook] Missing signature or rawBody');
            return res.sendStatus(403);
        }

        const expectedSignature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
        
        if (signature !== expectedSignature) {
            console.error('[Webhook] Invalid signature — rejecting request');
            return res.sendStatus(403);
        }
    } else {
        console.warn('[Webhook] Skipping signature validation — APP_SECRET not set');
    }

    const body = req.body;


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

                    // Handle contact profile updates
                    if (value.contacts) {
                        value.contacts.forEach(contact => {
                            const profileName = contact.profile?.name || null;
                            const phone = contact.wa_id;

                            if (phone) {
                                db.prepare(`
                                    INSERT INTO contacts (phone, profile_name, updated_at)
                                    VALUES (?, ?, CURRENT_TIMESTAMP)
                                    ON CONFLICT(phone) DO UPDATE SET
                                        profile_name = COALESCE(excluded.profile_name, contacts.profile_name),
                                        updated_at = CURRENT_TIMESTAMP
                                `).run(phone, profileName);

                                console.log('[Webhook] Contact profile saved:', phone, profileName);
                            }
                        });
                    }

                    // Handle incoming messages
                    if (value.messages) {
                        value.messages.forEach(message => {
                            // Extract media info if present
                            const mediaInfo = extractMediaInfo(message);

                            const messageData = {
                                tenant_id: tenant?.id || null,
                                direction: 'incoming',
                                sender: message.from,
                                recipient: phoneNumberId,
                                message_type: message.type,
                                content: extractMessageContent(message),
                                status: 'received',
                                wamid: message.id,
                                media_id: mediaInfo.id,
                                media_mime_type: mediaInfo.mimeType,
                            };

                            db.prepare(`
                INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, media_id, media_mime_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                                messageData.tenant_id,
                                messageData.direction,
                                messageData.sender,
                                messageData.recipient,
                                messageData.message_type,
                                messageData.content,
                                messageData.status,
                                messageData.wamid,
                                messageData.media_id,
                                messageData.media_mime_type
                            );

// Log activity
                            if (tenant) {
                                db.prepare(`
                   INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                   VALUES (?, ?, 'message_received', ?, 'success')
                 `).run(tenant.id, tenant.name, `رسالة واردة من ${message.from}`);
                            }

                            // Forward to tenant's webhook URL
                            if (tenant?.id) {
                                forwardToTenantWebhook(tenant.id, 'message_received', {
                                    from: message.from,
                                    message_id: message.id,
                                    type: message.type,
                                    content: extractMessageContent(message),
                                    profile_name: value.contacts?.[0]?.profile?.name || null,
                                    timestamp: new Date().toISOString()
                                });
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

                            // Send callback for status update
                            if (tenant?.id) {
                                sendStatusCallback(tenant.id, {
                                    message_id: status.id,
                                    status: status.status,
                                    recipient: status.recipient,
                                    timestamp: status.timestamp || new Date().toISOString()
                                });
                            }

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

// Helper to extract media info from message
function extractMediaInfo(message) {
    const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];

    for (const type of mediaTypes) {
        if (message[type]) {
            return {
                id: message[type].id || null,
                mimeType: message[type].mime_type || null,
                filename: message[type].filename || null,
            };
        }
    }

    return { id: null, mimeType: null, filename: null };
}

export default router;
