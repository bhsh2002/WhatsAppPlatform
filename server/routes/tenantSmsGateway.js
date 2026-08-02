import crypto from 'node:crypto';
import express from 'express';

import { SmsGatewayError } from '../services/smsGateway.js';

const respondError = (res, error) => {
    if (error instanceof SmsGatewayError) {
        return res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
    }
    console.error('[TenantSmsGateway] Unexpected error:', error);
    return res.status(500).json({ error: 'فشل تنفيذ عملية حساب SMS', code: 'SMS_GATEWAY_ERROR' });
};

export const createTenantSmsGatewayRouter = ({ service, billing }) => {
    if (!billing) throw new TypeError('Tenant SMS gateway router requires billing');
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            return res.json({
                data: service.listAccounts(req.user.tenant_id)
                    .map(account => service.presentAccount(account)),
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/', async (req, res) => {
        try {
            const result = await service.configure(req.user.tenant_id, req.body || {});
            return res.status(201).json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.put('/:accountId', async (req, res) => {
        try {
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

    router.post('/:accountId/test', async (req, res) => {
        let reservation = null;
        try {
            const idempotencyKey = `wa-test:${crypto.randomUUID()}`;
            reservation = billing.reserve({
                tenantId: req.user.tenant_id,
                operationKey: billing.operations.SMS_TEXT,
                quantity: 1,
                referenceType: 'sms_message',
                idempotencyKey: `billing:${req.user.tenant_id}:${idempotencyKey}`,
                metadata: { channel: 'sms', test: true, sms_account_id: Number(req.params.accountId) },
            });
            const result = await service.send(req.user.tenant_id, {
                accountId: req.params.accountId,
                recipient: req.body?.recipient,
                message: req.body?.message || 'Wa Savana SMS integration test',
                idempotencyKey,
            });
            billing.commit(reservation, {
                referenceId: result.message.message_id,
                description: 'خصم رسالة اختبار SMS',
            });
            reservation = null;
            const stored = service.storeMessage(result.account, result.message);
            return res.status(202).json({ success: true, data: stored });
        } catch (error) {
            if (reservation) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    console.error('[TenantSmsGateway] Billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, error)) return undefined;
            return respondError(res, error);
        }
    });

    return router;
};
