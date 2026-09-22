import express from 'express';

import db from '../../db/database.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../../services/billing.js';
import { SmsApiRequestStore, smsApiRequestHash } from '../../services/smsApiRequests.js';
import {
    presentTenantSmsGatewayError,
    SmsGatewayError,
    SmsGatewayService,
} from '../../services/smsGateway.js';

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

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

const postAcceptanceError = error => {
    if (error?.deliveryUncertain) return error;
    const wrapped = new SmsGatewayError(
        'SMS was accepted but local confirmation is incomplete; retry the same request',
        503,
        'SMS_POST_ACCEPT_RECOVERY_REQUIRED',
    );
    wrapped.deliveryUncertain = true;
    wrapped.cause = error;
    return wrapped;
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

    router.post('/sms/messages', async (req, res) => {
        let reservation = null;
        let gatewayAccepted = false;
        let apiRequest = null;
        try {
            const { tenantId, tenant } = tenantContext(req);
            const idempotencyKey = String(
                req.get?.('Idempotency-Key')
                || req.headers?.['idempotency-key']
                || '',
            ).trim();
            if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
                throw new SmsGatewayError(
                    'A valid Idempotency-Key header is required (8-128 characters)',
                    400,
                    'INVALID_IDEMPOTENCY_KEY',
                );
            }
            const rawAccountId = req.body?.sms_account_id;
            const accountId = rawAccountId == null || rawAccountId === ''
                ? null
                : Number(rawAccountId);
            if (accountId !== null && (!Number.isSafeInteger(accountId) || accountId <= 0)) {
                throw new SmsGatewayError(
                    'sms_account_id is invalid',
                    422,
                    'SMS_ACCOUNT_INVALID',
                );
            }
            const requestHash = smsApiRequestHash({
                smsAccountSelector: accountId,
                recipient: req.body?.recipient,
                message: req.body?.message,
            });
            const previous = requestStore.inspect({
                tenantId,
                idempotencyKey,
                requestHash,
            });
            if (previous?.status === 'accepted') {
                if (!previous.response) {
                    throw new SmsGatewayError(
                        'تعذر استعادة نتيجة طلب SMS السابق',
                        500,
                        'SMS_REQUEST_RESULT_INVALID',
                    );
                }
                return res.status(202).json(previous.response);
            }
            const resolvedAccountId = previous?.sms_account_id
                || service.requireActiveAccount(tenantId, accountId).id;
            const claim = requestStore.claim({
                tenantId,
                idempotencyKey,
                smsAccountId: resolvedAccountId,
                requestHash,
            });
            if (claim.mode === 'accepted') {
                if (!claim.response) {
                    throw new SmsGatewayError(
                        'تعذر استعادة نتيجة طلب SMS السابق',
                        500,
                        'SMS_REQUEST_RESULT_INVALID',
                    );
                }
                return res.status(202).json(claim.response);
            }
            apiRequest = claim.request;
            const resolvedAccount = service.requireActiveAccount(
                tenantId,
                apiRequest.sms_account_id,
            );
            reservation = claim.reservation;
            if (!reservation) {
                reservation = billing.reserve({
                    tenantId,
                    operationKey: billing.operations.SMS_TEXT,
                    quantity: 1,
                    referenceType: 'api_sms_message',
                    idempotencyKey: `billing:${tenantId}:api-sms:${idempotencyKey}:attempt:${apiRequest.attempt}`,
                    metadata: {
                        channel: 'sms',
                        api_version: 'v1',
                        sms_account_id: resolvedAccount.id,
                        api_request_id: apiRequest.id,
                        attempt: apiRequest.attempt,
                    },
                });
                requestStore.attachBilling(apiRequest.id, reservation?.id);
            }
            const result = await service.send(tenantId, {
                accountId: resolvedAccount.id,
                recipient: req.body?.recipient,
                message: req.body?.message,
                idempotencyKey,
            });
            gatewayAccepted = true;
            billing.commit(reservation, {
                referenceId: result.message.message_id,
                description: 'خصم رسالة SMS عبر API',
            });
            const stored = service.storeMessage(result.account, result.message);
            try {
                await callbackSender(tenantId, 'sms_message_accepted', {
                    message_id: stored.id,
                    gateway_message_id: stored.gateway_message_id,
                    sms_account_id: stored.sms_account_id,
                    recipient: stored.recipient,
                    status: stored.status,
                }, {
                    dedupeKey: `sms-api-accepted:${tenantId}:${idempotencyKey}`,
                });
            } catch (error) {
                logger.error('[ApiV1Sms] Callback failed:', error);
            }
            try {
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, 'api_sms_sent', ?, 'success')
                `).run(tenantId, tenant.name || 'Unknown', `SMS API message ${stored.id} accepted`);
            } catch (error) {
                logger.error('[ApiV1Sms] Activity log failed:', error);
            }
            const response = {
                success: true,
                data: {
                    message_id: stored.id,
                    gateway_message_id: stored.gateway_message_id,
                    external_id: stored.external_id,
                    sms_account_id: stored.sms_account_id,
                    sms_account_name: stored.sms_account_name,
                    recipient: stored.recipient,
                    status: stored.status,
                },
            };
            requestStore.accept(apiRequest.id, response);
            reservation = null;
            apiRequest = null;
            return res.status(202).json(response);
        } catch (error) {
            const responseError = gatewayAccepted ? postAcceptanceError(error) : error;
            if (gatewayAccepted) {
                logger.error('[ApiV1Sms] Post-acceptance recovery required:', error);
            }
            if (reservation && !gatewayAccepted && reservation.status !== 'committed'
                && !responseError.deliveryUncertain) {
                try {
                    billing.release(reservation, responseError.message);
                } catch (releaseError) {
                    logger.error('[ApiV1Sms] Billing release failed:', releaseError);
                }
            }
            if (apiRequest) {
                try {
                    requestStore.fail(apiRequest.id, responseError);
                } catch (stateError) {
                    logger.error('[ApiV1Sms] Request state update failed:', stateError);
                }
            }
            return respondError(res, responseError, billing, logger);
        }
    });

    return router;
}
