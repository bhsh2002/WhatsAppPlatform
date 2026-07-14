import express from 'express';
import db from '../../db/database.js';
import crypto from 'crypto';
import { decryptIfEncrypted } from '../../services/encryption.js';
import { safeOutboundFetch } from '../../security/outboundUrl.js';
import { createApiV1EventsRouter } from './v1Events.js';
import { createApiV1MessagingRouter } from './v1Messaging.js';
import { createApiV1QueriesRouter } from './v1Queries.js';

const router = express.Router();

// Minimal callback sender for API v1 outbound notifications
const sendCallback = async (tenantId, event, data) => {
    try {
        const settings = db.prepare(
            'SELECT callback_url, webhook_secret FROM tenant_api_settings WHERE tenant_id = ? AND callback_url IS NOT NULL'
        ).get(tenantId);
        if (!settings?.callback_url) return;

        const body = JSON.stringify({ event, timestamp: new Date().toISOString(), tenant_id: tenantId, data });
        const headers = { 'Content-Type': 'application/json' };
        const webhookSecret = decryptIfEncrypted(settings.webhook_secret);
        if (webhookSecret) {
            headers['X-Signature'] = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
        }
        safeOutboundFetch(settings.callback_url, { method: 'POST', headers, body, timeoutMs: 10000 })
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

router.use(createApiV1MessagingRouter({ database: db, callbackSender: sendCallback }));
router.use(createApiV1QueriesRouter({ database: db }));
router.use(createApiV1EventsRouter({ database: db }));

export default router;
