import crypto from 'node:crypto';
import express from 'express';

import { SmsGatewayError } from '../services/smsGateway.js';

const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/i;

const respondError = (res, error) => {
    if (error instanceof SmsGatewayError) {
        return res.status(error.status).json({
            success: false,
            error: error.message,
            code: error.code,
            ...error.details,
        });
    }
    console.error('[SmsGatewayProvisioning] Unexpected error:', error);
    return res.status(500).json({
        success: false,
        error: 'SMS provisioning failed',
        code: 'SMS_PROVISION_FAILED',
    });
};

const validSignature = ({ secret, timestamp, deliveryId, signature, rawBody }) => {
    const match = String(signature || '').match(SIGNATURE_PATTERN);
    if (!match) return false;
    const expected = crypto.createHmac('sha256', secret)
        .update(`${timestamp}.${deliveryId}.`)
        .update(rawBody)
        .digest('hex');
    const suppliedBuffer = Buffer.from(match[1].toLowerCase(), 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return suppliedBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
};

export const createSmsGatewayProvisioningRouter = ({
    service,
    secret = process.env.SMS_GATEWAY_PROVISIONING_SECRET,
    now = () => Date.now(),
} = {}) => {
    if (!service) throw new TypeError('SMS Gateway provisioning router requires service');
    const router = express.Router();

    router.post('/', async (req, res) => {
        try {
            const provisioningSecret = String(secret || '');
            if (provisioningSecret.length < 32) {
                throw new SmsGatewayError(
                    'خدمة ربط SMS غير مهيأة',
                    503,
                    'SMS_PROVISION_NOT_CONFIGURED',
                );
            }
            const timestamp = String(req.get('X-Savana-Timestamp') || '');
            const deliveryId = String(req.get('X-Savana-Delivery-Id') || '');
            if (!/^\d{10,11}$/.test(timestamp)
                || Math.abs(now() / 1000 - Number(timestamp)) > 300) {
                throw new SmsGatewayError(
                    'انتهت صلاحية طلب الربط',
                    401,
                    'SMS_PROVISION_EXPIRED',
                );
            }
            if (!Buffer.isBuffer(req.rawBody)) {
                throw new SmsGatewayError(
                    'تعذر التحقق من المحتوى الأصلي لطلب الربط',
                    400,
                    'SMS_PROVISION_RAW_BODY_REQUIRED',
                );
            }
            const rawBody = req.rawBody;
            if (!validSignature({
                secret: provisioningSecret,
                timestamp,
                deliveryId,
                signature: req.get('X-Savana-Signature'),
                rawBody,
            })) {
                throw new SmsGatewayError(
                    'توقيع طلب الربط غير صالح',
                    401,
                    'SMS_PROVISION_SIGNATURE_INVALID',
                );
            }
            const result = await service.acceptProvisioningDelivery({
                deliveryId,
                requestHash: crypto.createHash('sha256').update(rawBody).digest('hex'),
                payload: req.body || {},
            });
            return res.status(200).json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });

    return router;
};
