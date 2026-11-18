import express from 'express';

import db from '../../db/database.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../../services/billing.js';
import { SmsApiRequestStore } from '../../services/smsApiRequests.js';
import { createNativeSmsMessageCommand } from '../../services/nativeSmsMessage.js';
import {
    presentTenantSmsGatewayError,
    SmsGatewayError,
    SmsGatewayService,
} from '../../services/smsGateway.js';

const defaultBilling = {
    operations: BILLING_OPERATIONS,
    reserve: reserveBilling,
    commit: commitBilling,
    release: releaseBilling,
    handleError: handleBillingError,
};

const respondError = (res, error, billing, logger) => {
    if (billing.handleError(res, error)) return undefined;
    if (error instanceof SmsGatewayError) {
        const presented = presentTenantSmsGatewayError(error);
        return res.status(error.status).json({
            success: false,
            ...error.details,
            error: presented.message,
            code: presented.code,
            ...(error.deliveryUncertain ? { retry_same_request: true } : {}),
        });
    }
    logger.error('[ApiV1Sms] Unexpected error:', error);
    return res.status(500).json({
        success: false,
        error: 'SMS request failed',
        code: 'SMS_REQUEST_FAILED',
    });
};

export function createApiV1SmsRouter({
    database = db,
    service = new SmsGatewayService({ database }),
    billing = defaultBilling,
    requestStore = new SmsApiRequestStore({ database }),
    callbackSender = () => undefined,
    logger = console,
} = {}) {
    if (!database || !service || !billing || !requestStore) {
        throw new TypeError('API v1 SMS router requires database, service, billing and request store');
    }
    const router = express.Router();

    const tenantContext = req => {
        const tenantId = Number(req.tenantId);
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
            throw new SmsGatewayError('Invalid tenant context', 401, 'INVALID_TENANT_CONTEXT');
        }
        const tenant = database.prepare('SELECT id, name, status FROM tenants WHERE id = ?')
            .get(tenantId);
        if (!tenant) throw new SmsGatewayError('Tenant not found', 404, 'TENANT_NOT_FOUND');
        if (tenant.status === 'Suspended') {
            throw new SmsGatewayError('Tenant account is suspended', 403, 'TENANT_SUSPENDED');
        }
        return { tenantId, tenant };
    };

    router.get('/sms/accounts', (req, res) => {
        try {
            const { tenantId } = tenantContext(req);
            const accounts = service.listAccounts(tenantId).map(account => {
                const presented = service.presentAccount(account);
                return {
                    id: presented.id,
                    name: presented.name,
                    status: presented.status,
                    enabled: presented.enabled,
                    is_default: presented.is_default,
                };
            });
            return res.json({ success: true, data: accounts });
        } catch (error) {
            return respondError(res, error, billing, logger);
        }
    });

    router.get('/sms/messages/:messageId', (req, res) => {
        try {
            const { tenantId } = tenantContext(req);
            const messageId = Number(req.params.messageId);
            if (!Number.isSafeInteger(messageId) || messageId <= 0) {
                throw new SmsGatewayError(
                    'SMS message id is invalid',
                    400,
                    'SMS_MESSAGE_ID_INVALID',
                );
            }
            const message = database.prepare(`
                SELECT message.id, message.gateway_message_id, message.external_id,
                       message.direction, message.sender, message.recipient,
                       message.content AS message, message.status, message.result_code,
                       message.error_code, message.error_message, message.sent_at,
                       message.delivered_at, message.created_at, message.updated_at,
                       account.id AS sms_account_id, account.name AS sms_account_name
                FROM sms_messages message
                LEFT JOIN sms_gateway_accounts account ON account.id = message.sms_account_id
                WHERE message.tenant_id = ? AND message.id = ?
                LIMIT 1
            `).get(tenantId, messageId);
            if (!message) {
                return res.status(404).json({
                    success: false,
                    error: 'SMS message not found',
                    code: 'SMS_MESSAGE_NOT_FOUND',
                });
            }
            const account = service.getAccount(tenantId, message.sms_account_id);
            const presented = typeof service.presentMessage === 'function'
                ? service.presentMessage(message, { account })
                : message;
            return res.json({ success: true, data: presented });
        } catch (error) {
            return respondError(res, error, billing, logger);
        }
    });

    const sendMessage = createNativeSmsMessageCommand({ database, service, billing, requestStore, callbackSender, logger });
    router.post('/sms/messages', async (req, res) => {
        try {
            const response = await sendMessage({
                tenantId: req.tenantId,
                accountId: req.body?.sms_account_id,
                recipient: req.body?.recipient,
                message: req.body?.message,
                idempotencyKey: req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'],
            });
            return res.status(202).json(response);
        } catch (error) {
            return respondError(res, error, billing, logger);
        }
    });

    return router;
}
