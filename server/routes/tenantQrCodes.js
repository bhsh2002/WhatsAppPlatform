import express from 'express';

import { META_API_BASE } from '../config/index.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';

const getTenantQrContext = (database, accessTokenForTenant, tenantId) => {
    const tenant = database.prepare(`
        SELECT id, name, phone_number_id
        FROM tenants
        WHERE id = ?
    `).get(tenantId);
    const accessToken = accessTokenForTenant(tenantId);
    return { tenant, accessToken };
};

export function createTenantQrCodesRouter({
    database,
    accessTokenForTenant,
    requestMeta = requestMetaJson,
} = {}) {
    if (!database || typeof accessTokenForTenant !== 'function') {
        throw new TypeError('Tenant QR router requires database and accessTokenForTenant');
    }
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const { tenant, accessToken } = getTenantQrContext(database, accessTokenForTenant, tenantId);
            if (!tenant?.phone_number_id || !accessToken) {
                return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
            }

            const result = await requestMeta(
                `${META_API_BASE}/${tenant.phone_number_id}/message_qrdls`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل جلب رموز QR');
            return res.json({
                qr_codes: Array.isArray(result.data?.data) ? result.data.data : [],
                paging: result.data?.paging || null,
            });
        } catch (error) {
            console.error('[TenantQrCodes] List error:', error);
            return res.status(500).json({ error: 'فشل جلب رموز QR' });
        }
    });

    router.post('/', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const prefilledMessage = typeof req.body?.prefilled_message === 'string'
                ? req.body.prefilled_message.trim()
                : '';
            if (!prefilledMessage) {
                return res.status(400).json({ error: 'نص الرسالة المعبأة مسبقاً مطلوب' });
            }

            const { tenant, accessToken } = getTenantQrContext(database, accessTokenForTenant, tenantId);
            if (!tenant?.phone_number_id || !accessToken) {
                return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
            }
            const result = await requestMeta(
                `${META_API_BASE}/${tenant.phone_number_id}/message_qrdls`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        prefilled_message: prefilledMessage,
                        generate_qr_image: req.body?.generate_qr_image || 'PNG',
                    }),
                }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل إنشاء رمز QR');

            database.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'qr_code_created', 'إنشاء رمز QR جديد', 'success')
            `).run(tenantId, tenant.name);
            return res.json({ success: true, data: result.data || {} });
        } catch (error) {
            console.error('[TenantQrCodes] Create error:', error);
            return res.status(500).json({ error: 'فشل إنشاء رمز QR' });
        }
    });

    router.delete('/:qrCodeId', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const qrCodeId = String(req.params.qrCodeId || '').trim();
            if (!qrCodeId || qrCodeId.length > 256) {
                return res.status(400).json({ error: 'معرّف رمز QR غير صالح' });
            }
            const { tenant, accessToken } = getTenantQrContext(database, accessTokenForTenant, tenantId);
            if (!tenant?.phone_number_id || !accessToken) {
                return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
            }

            const result = await requestMeta(
                `${META_API_BASE}/${tenant.phone_number_id}/message_qrdls/${encodeURIComponent(qrCodeId)}`,
                {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${accessToken}` },
                }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل حذف رمز QR');
            return res.json({ success: true });
        } catch (error) {
            console.error('[TenantQrCodes] Delete error:', error);
            return res.status(500).json({ error: 'فشل حذف رمز QR' });
        }
    });

    return router;
}

export default createTenantQrCodesRouter;
