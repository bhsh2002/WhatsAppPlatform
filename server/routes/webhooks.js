import express from 'express';
import crypto from 'crypto';
import db from '../db/database.js';
import eventBus from '../services/eventBus.js';

const router = express.Router();

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

if (!VERIFY_TOKEN) console.warn('⚠️ WARNING: WEBHOOK_VERIFY_TOKEN is missing. Webhook verification will fail.');
if (!APP_SECRET) console.warn('⚠️ WARNING: META_APP_SECRET is missing. Incoming webhooks cannot be securely verified.');

// ============================================
// Helper: Log webhook failure to dead-letter queue
// ============================================
const logWebhookFailure = (tenantId, eventType, payload, errorMessage) => {
    try {
        db.prepare(`
            INSERT INTO webhook_failures (tenant_id, event_type, payload, error_message)
            VALUES (?, ?, ?, ?)
        `).run(tenantId, eventType, JSON.stringify(payload), errorMessage);
    } catch (e) {
        console.error('[Webhook] Failed to log webhook failure:', e.message);
    }
};

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

        const body = JSON.stringify(payload);
        const headers = {
            'Content-Type': 'application/json',
            'X-Tenant-Id': String(tenantId)
        };

        // Sign payload if webhook secret is configured
        if (settings.webhook_secret) {
            const signature = crypto.createHmac('sha256', settings.webhook_secret)
                .update(body).digest('hex');
            headers['X-Signature'] = `sha256=${signature}`;
        }

        // Retry with exponential backoff (3 attempts)
        const maxRetries = 3;
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(settings.webhook_url, {
                    method: 'POST',
                    headers,
                    body,
                    signal: AbortSignal.timeout(10000), // 10s timeout
                });
                if (response.ok) return; // Success
                if (response.status >= 400 && response.status < 500) {
                    // Client error - don't retry but log failure
                    logWebhookFailure(tenantId, event, payload, `Client error: ${response.status}`);
                    return;
                }
                lastError = `HTTP ${response.status}`;
            } catch (err) {
                lastError = err.message;
                if (attempt === maxRetries) {
                    console.error(`[Webhook] Forward to tenant ${tenantId} failed after ${maxRetries} attempts:`, err.message);
                    logWebhookFailure(tenantId, event, payload, lastError);
                    return;
                }
            }
            // Wait before retry: 1s, 2s, 4s
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
        
        // All retries exhausted
        if (lastError) {
            logWebhookFailure(tenantId, event, payload, lastError);
        }
    } catch (error) {
        console.error('[Webhook] Forward error:', error.message);
        logWebhookFailure(tenantId, event, { tenant_id: tenantId, data }, error.message);
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

        const body = JSON.stringify(payload);
        const headers = {
            'Content-Type': 'application/json',
            'X-Tenant-Id': String(tenantId)
        };

        if (settings.webhook_secret) {
            const signature = crypto.createHmac('sha256', settings.webhook_secret)
                .update(body).digest('hex');
            headers['X-Signature'] = `sha256=${signature}`;
        }

        fetch(settings.callback_url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10000),
        }).catch(err => {
            console.error('[Callback] Status callback failed:', err.message);
        });
    } catch (error) {
        console.error('[Callback] Error:', error.message);
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
        
        // Timing-safe comparison to prevent timing attacks
        const sigBuffer = Buffer.from(signature, 'utf8');
        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        
        if (sigBuffer.length !== expectedBuffer.length ||!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
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
        // Log the raw webhook (tenant_id will be updated after resolution)
        const logResult = db.prepare(`
      INSERT INTO webhook_logs (event_type, payload)
      VALUES (?, ?)
    `).run(body.object || 'unknown', JSON.stringify(body));
        const webhookLogId = logResult.lastInsertRowid;

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

                    // Associate webhook log with resolved tenant
                    if (tenant) {
                        db.prepare('UPDATE webhook_logs SET tenant_id = ? WHERE id = ?')
                            .run(tenant.id, webhookLogId);
                    }

                    // Handle contact profile updates
                    if (value.contacts) {
                        value.contacts.forEach(contact => {
                            const profileName = contact.profile?.name || null;
                            const phone = contact.wa_id;
                            const tenantId = tenant?.id || null;

                            if (phone) {
                                db.prepare(`
                                    INSERT INTO contacts (tenant_id, phone, profile_name, last_customer_message_at, updated_at)
                                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                                    ON CONFLICT(tenant_id, phone) DO UPDATE SET
                                        profile_name = COALESCE(excluded.profile_name, contacts.profile_name),
                                        last_customer_message_at = CURRENT_TIMESTAMP,
                                        updated_at = CURRENT_TIMESTAMP
                                `).run(tenantId, phone, profileName);
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

                            // SSE: push to connected clients
                            eventBus.emitNewMessage({
                                tenant_id: tenant?.id || null,
                                direction: 'incoming',
                                sender: message.from,
                                message_type: message.type,
                                content: extractMessageContent(message),
                                wamid: message.id,
                                profile_name: value.contacts?.[0]?.profile?.name || null,
                                created_at: new Date().toISOString(),
                            });
                            eventBus.emitConversationUpdate(tenant?.id || null);
                        });
                    }

// Handle message status updates
                    if (value.statuses) {
                        value.statuses.forEach(status => {
                            db.prepare(`
                UPDATE messages SET status = ? WHERE wamid = ?
              `).run(status.status, status.id);

                            console.log('[Webhook] Status update:', status.id, '->', status.status);

                            // SSE: push status update
                            eventBus.emitStatusUpdate({
                                wamid: status.id,
                                status: status.status,
                                tenant_id: tenant?.id || null,
                            });

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

        // ============================================
        // Facebook Page Events
        // ============================================
        if (body.object === 'page') {
            const entries = body.entry || [];

            for (const entry of entries) {
                const pageId = entry.id;

                // Look up which tenant owns this page
                const linkedPage = db.prepare(
                    'SELECT * FROM tenant_pages WHERE page_id = ? AND is_active = 1'
                ).get(pageId);

                if (!linkedPage) {
                    console.warn(`[Webhook] Received page event for unlinked page: ${pageId}`);
                    continue;
                }

                // Associate webhook log with the tenant
                db.prepare('UPDATE webhook_logs SET tenant_id = ? WHERE id = ?')
                    .run(linkedPage.tenant_id, webhookLogId);

                // Handle feed changes (posts, comments)
                if (entry.changes) {
                    for (const change of entry.changes) {
                        if (change.field === 'feed') {
                            const value = change.value;
                            const item = value.item;
                            const verb = value.verb;

                            console.log(`[Webhook/FB] Page ${pageId} | ${item} ${verb}`);

                            const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?')
                                .get(linkedPage.tenant_id);

                            const fbEventData = {
                                tenant_id: linkedPage.tenant_id,
                                page_id: pageId,
                                item,
                                verb,
                                post_id: value.post_id,
                                comment_id: value.comment_id,
                                from: value.from,
                                message: value.message,
                                created_time: value.created_time,
                            };

                            eventBus.broadcast('admin', 'fb_page_event', fbEventData);
                            eventBus.broadcast(`tenant:${linkedPage.tenant_id}`, 'fb_page_event', fbEventData);

                            if (item === 'comment' && verb === 'add') {
                                db.prepare(`
                                    INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                                    VALUES (?, ?, 'fb_new_comment', ?, 'info')
                                `).run(
                                    linkedPage.tenant_id,
                                    tenant?.name || 'Unknown',
                                    `تعليق جديد على صفحة ${linkedPage.page_name || pageId}: "${(value.message || '').substring(0, 50)}"`
                                );
                            }

                            forwardToTenantWebhook(linkedPage.tenant_id, `fb_${item}_${verb}`, value);
                        }
                    }
                }

                // Handle messaging (Messenger inbox)
                if (entry.messaging) {
                    for (const event of entry.messaging) {
                        console.log(`[Webhook] Page ${pageId} messaging event:`, event.sender?.id);
                        // TODO: Process Messenger messages in Phase 2
                    }
                }
            }
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
