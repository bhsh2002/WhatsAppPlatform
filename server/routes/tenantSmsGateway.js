import crypto from 'node:crypto';
import express from 'express';

import { SmsGatewayError } from '../services/smsGateway.js';

const respondError = (res, error) => {
    if (error instanceof SmsGatewayError) {
        return res.status(error.status).json({
            error: error.message,
            code: error.code,
            ...error.details,
            ...(error.deliveryUncertain ? { retry_same_request: true } : {}),
        });
    }
    console.error('[TenantSmsGateway] Unexpected error:', error);
    return res.status(500).json({ error: 'فشل تنفيذ عملية حساب SMS', code: 'SMS_GATEWAY_ERROR' });
};

const rejectReleasedIdempotency = reservation => {
    if (!reservation || !['released', 'failed'].includes(String(reservation.status))) return;
    throw new SmsGatewayError(
        'انتهت المحاولة السابقة؛ أعد الإرسال بمعرف طلب جديد',
        409,
        'SMS_IDEMPOTENCY_RETRY_REQUIRED',
        { new_idempotency_key_required: true },
    );
};

const postAcceptanceError = error => {
    if (error?.deliveryUncertain) return error;
    const wrapped = new SmsGatewayError(
        'قُبل الطلب لدى بوابة SMS لكن لم يكتمل حفظ التأكيد؛ أعد الطلب نفسه بنفس المعرف',
        503,
        'SMS_POST_ACCEPT_RECOVERY_REQUIRED',
    );
    wrapped.deliveryUncertain = true;
    wrapped.cause = error;
    return wrapped;
};

export const createTenantSmsGatewayRouter = ({
    service,
    billing,
    allowManualConfiguration = ['1', 'true'].includes(
        String(process.env.SMS_GATEWAY_ALLOW_TENANT_MANUAL_CONFIG || '').toLowerCase(),
    ),
}) => {
    if (!billing) throw new TypeError('Tenant SMS gateway router requires billing');
    const router = express.Router();

    router.get('/ussd', (req, res) => {
        try {
            return res.json({
                data: service.listUssd(req.user.tenant_id, {
                    accountId: req.query.account_id,
                    limit: req.query.limit,
                }),
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/stats', async (req, res) => {
        try {
            return res.json({
                data: await service.stats(req.user.tenant_id, {
                    accountId: req.query.account_id,
                    range: req.query.range,
                    from: req.query.from,
                    to: req.query.to,
                    groupBy: req.query.group_by,
                }),
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/', (req, res) => {
        try {
            return res.json({
                data: service.listAccounts(req.user.tenant_id)
                    .map(account => service.presentAccount(account, {
                        includeTechnical: allowManualConfiguration,
                    })),
                manual_configuration_allowed: allowManualConfiguration,
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/', async (req, res) => {
        try {
            if (!allowManualConfiguration) {
                throw new SmsGatewayError(
                    'تتم إضافة حسابات SMS بواسطة الإدارة',
                    403,
                    'SMS_MANUAL_CONFIG_DISABLED',
                );
            }
            const result = await service.configure(req.user.tenant_id, req.body || {});
            return res.status(201).json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.put('/:accountId', async (req, res) => {
        try {
            if (!allowManualConfiguration) {
                throw new SmsGatewayError(
                    'تتم إدارة حسابات SMS بواسطة الإدارة',
                    403,
                    'SMS_MANUAL_CONFIG_DISABLED',
                );
            }
            return res.json(await service.configure(
                req.user.tenant_id,
                req.body || {},
                req.params.accountId,
            ));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.delete('/:accountId', async (req, res) => {
        try {
            if (!allowManualConfiguration) {
                throw new SmsGatewayError(
                    'تتم إدارة حسابات SMS بواسطة الإدارة',
                    403,
                    'SMS_MANUAL_CONFIG_DISABLED',
                );
            }
            return res.json(await service.disable(req.user.tenant_id, req.params.accountId));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/:accountId/health', async (req, res) => {
        try {
            return res.json(await service.health(req.user.tenant_id, req.params.accountId));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/:accountId/devices', async (req, res) => {
        try {
            return res.json({ data: await service.devices(req.user.tenant_id, req.params.accountId) });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/:accountId/ussd', async (req, res) => {
        let reservation = null;
        let gatewayAccepted = false;
        try {
            const idempotencyKey = req.get('Idempotency-Key') || crypto.randomUUID();
            service.requireActiveAccount(req.user.tenant_id, req.params.accountId);
            reservation = billing.reserve({
                tenantId: req.user.tenant_id,
                operationKey: billing.operations.SMS_USSD,
                quantity: 1,
                referenceType: 'sms_ussd',
                idempotencyKey: `billing:${req.user.tenant_id}:sms-ussd:${req.params.accountId}:${idempotencyKey}`,
                metadata: { channel: 'sms', sms_account_id: Number(req.params.accountId) },
            });
            rejectReleasedIdempotency(reservation);
            const result = await service.sendUssd(req.user.tenant_id, {
                accountId: req.params.accountId,
                request: req.body?.request,
                deviceId: req.body?.device_id,
                simSlot: req.body?.sim_slot,
                idempotencyKey,
            });
            gatewayAccepted = true;
            billing.commit(reservation, {
                referenceId: result.ussd.ussd_id,
                description: 'خصم طلب USSD',
            });
            reservation = null;
            return res.status(202).json({
                success: true,
                data: service.presentUssd(
                    service.storeUssd(result.account, result.ussd),
                    { account: result.account },
                ),
            });
        } catch (error) {
            const responseError = gatewayAccepted ? postAcceptanceError(error) : error;
            if (gatewayAccepted) {
                console.error('[TenantSmsGateway] USSD post-acceptance recovery required:', error);
            }
            if (reservation && !responseError.deliveryUncertain) {
                try {
                    billing.release(reservation, responseError.message);
                } catch (releaseError) {
                    console.error('[TenantSmsGateway] USSD billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, responseError)) return undefined;
            return respondError(res, responseError);
        }
    });

    router.post('/:accountId/ussd/:ussdId/refresh', async (req, res) => {
        try {
            const account = service.getAccount(req.user.tenant_id, req.params.accountId);
            const refreshed = await service.refreshUssd(
                    req.user.tenant_id,
                    req.params.accountId,
                    req.params.ussdId,
                );
            return res.json({ data: service.presentUssd(refreshed, { account }) });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/:accountId/test', async (req, res) => {
        let reservation = null;
        let gatewayAccepted = false;
        try {
            const idempotencyKey = req.get('Idempotency-Key') || `wa-test:${crypto.randomUUID()}`;
            service.requireActiveAccount(req.user.tenant_id, req.params.accountId);
            reservation = billing.reserve({
                tenantId: req.user.tenant_id,
                operationKey: billing.operations.SMS_TEXT,
                quantity: 1,
                referenceType: 'sms_message',
                idempotencyKey: `billing:${req.user.tenant_id}:${idempotencyKey}`,
                metadata: { channel: 'sms', test: true, sms_account_id: Number(req.params.accountId) },
            });
            rejectReleasedIdempotency(reservation);
            const result = await service.send(req.user.tenant_id, {
                accountId: req.params.accountId,
                recipient: req.body?.recipient,
                message: req.body?.message || 'Wa Savana SMS integration test',
                idempotencyKey,
            });
            gatewayAccepted = true;
            billing.commit(reservation, {
                referenceId: result.message.message_id,
                description: 'خصم رسالة اختبار SMS',
            });
            reservation = null;
            const stored = service.storeMessage(result.account, result.message);
            return res.status(202).json({
                success: true,
                data: service.presentMessage(stored, { account: result.account }),
            });
        } catch (error) {
            const responseError = gatewayAccepted ? postAcceptanceError(error) : error;
            if (gatewayAccepted) {
                console.error('[TenantSmsGateway] Test SMS post-acceptance recovery required:', error);
            }
            if (reservation && !responseError.deliveryUncertain) {
                try {
                    billing.release(reservation, responseError.message);
                } catch (releaseError) {
                    console.error('[TenantSmsGateway] Billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, responseError)) return undefined;
            return respondError(res, responseError);
        }
    });

    return router;
};
