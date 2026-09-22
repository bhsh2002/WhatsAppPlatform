import express from 'express';

import { SmsGatewayError } from '../services/smsGateway.js';

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
            if (!result.duplicate && result.message) {
                const message = result.message;
                const tenantMessage = typeof service.presentMessage === 'function'
                    ? service.presentMessage(message)
                    : message;
                if (result.event === 'sms.message.received.v1') {
                    eventBus.broadcast(`tenant:${result.tenantId}`, 'sms_message:new', tenantMessage);
                    eventBus.broadcast('admin', 'sms_message:new', message);
                    eventBus.emitConversationUpdate(result.tenantId);
                } else {
                    eventBus.broadcast(`tenant:${result.tenantId}`, 'sms_message:status', tenantMessage);
                    eventBus.broadcast('admin', 'sms_message:status', message);
                }
                if (!result.callbackHandled) {
                    Promise.resolve(callbackSender(
                        result.tenantId,
                        result.event === 'sms.message.received.v1'
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
