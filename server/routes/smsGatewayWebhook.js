import express from 'express';

import { SmsGatewayError } from '../services/smsGateway.js';
import { smsBrowserNotificationSource } from '../services/smsApiRequests.js';

export const createSmsGatewayWebhookRouter = ({
    service,
    eventBus,
    callbackSender = () => undefined,
}) => {
    const router = express.Router();
    router.post('/:webhookKey', (req, res) => {
        try {
            const result = service.acceptWebhook(req.params.webhookKey, {
                deliveryId: req.get('X-SMS-Gateway-Delivery-Id'),
                timestamp: req.get('X-SMS-Gateway-Timestamp'),
                signature: req.get('X-SMS-Gateway-Signature'),
            }, req.rawBody || Buffer.from(JSON.stringify(req.body || {})));
            if (result.message) {
                const message = result.message;
                const tenantMessage = typeof service.presentMessage === 'function'
                    ? service.presentMessage(message)
                    : message;
                const incoming = result.event === 'sms.message.received.v1';

                if (!result.duplicate) {
                    eventBus.broadcast(
                        `tenant:${result.tenantId}`,
                        incoming ? 'sms_message:new' : 'sms_message:status',
                        tenantMessage,
                    );
                    eventBus.broadcast(
                        'admin',
                        incoming ? 'sms_message:new' : 'sms_message:status',
                        message,
                    );
                    if (incoming) eventBus.emitConversationUpdate(result.tenantId);
                }

                // The Web Push outbox deduplicates this stable source. Repeat
                // its projection for authenticated webhook replays so a crash
                // after SMS storage cannot permanently lose the notification.
                if (incoming) {
                    eventBus.emitBrowserMessage?.({
                        tenantId: result.tenantId,
                        channel: 'sms',
                        sourceId: smsBrowserNotificationSource(message),
                    });
                } else if (['failed', 'rejected', 'canceled', 'cancelled'].includes(
                    String(message.status || '').toLowerCase()
                )) {
                    eventBus.emitBrowserAlert?.({
                        tenantId: result.tenantId,
                        code: 'SMS_MESSAGE_FAILED',
                        sourceId: smsBrowserNotificationSource(message),
                        severity: 'warning',
                    });
                }

                if (!result.duplicate && !result.callbackHandled) {
                    Promise.resolve(callbackSender(
                        result.tenantId,
                        incoming
                            ? 'sms_message_received'
                            : 'sms_message_status_changed',
                        tenantMessage,
                    )).catch(error => {
                        console.error('[SmsGatewayWebhook] Tenant callback failed:', error.message);
                    });
                }
            }
            if (!result.duplicate && result.ussd) {
                const tenantUssd = typeof service.presentUssd === 'function'
                    ? service.presentUssd(result.ussd)
                    : result.ussd;
                eventBus.broadcast(`tenant:${result.tenantId}`, 'sms_ussd:updated', tenantUssd);
                eventBus.broadcast('admin', 'sms_ussd:updated', result.ussd);
            }
            return res.json({ accepted: true, duplicate: result.duplicate });
        } catch (error) {
            if (error instanceof SmsGatewayError) {
                return res.status(error.status).json({ error: error.message, code: error.code });
            }
            console.error('[SmsGatewayWebhook] Unexpected error:', error);
            return res.status(500).json({ error: 'Webhook processing failed' });
        }
    });
    return router;
};
