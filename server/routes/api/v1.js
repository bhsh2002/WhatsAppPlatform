import express from 'express';
import db from '../../db/database.js';
import { TenantCallbackOutbox } from '../../services/tenantCallbackOutbox.js';
import { createApiV1EventsRouter } from './v1Events.js';
import { createApiV1MessagingRouter } from './v1Messaging.js';
import { createApiV1QueriesRouter } from './v1Queries.js';
import { createApiV1SmsRouter } from './v1Sms.js';

const router = express.Router();
export const callbackOutbox = new TenantCallbackOutbox({ database: db });

// Callback producers wait only for the durable local enqueue. Network delivery
// is handled independently by the background outbox worker.
export const sendCallback = (tenantId, event, data, options) => (
    callbackOutbox.enqueue(tenantId, event, data, options)
);

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
router.use(createApiV1SmsRouter({ database: db, callbackSender: sendCallback }));
router.use(createApiV1QueriesRouter({ database: db }));
router.use(createApiV1EventsRouter({ database: db }));

export default router;
