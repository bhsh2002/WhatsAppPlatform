import express from 'express';

import { META_API_BASE } from '../config/index.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';
import { resolveTenantWhatsAppContext } from '../services/whatsappNumbers.js';

const getTenantQrContext = (database, accessTokenForTenant, req) => resolveTenantWhatsAppContext({
    database,
    tenantId: req.user?.tenant_id,
    request: req,
    accessTokenForTenant,
});

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
            const context = getTenantQrContext(database, accessTokenForTenant, req);
            if (context.error) return res.status(context.status).json({ error: context.error, code: context.code });

            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(context.phoneNumberId)}/message_qrdls`,
                { headers: { Authorization: `Bearer ${context.accessToken}` } }
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

            const context = getTenantQrContext(database, accessTokenForTenant, req);
            if (context.error) return res.status(context.status).json({ error: context.error, code: context.code });
            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(context.phoneNumberId)}/message_qrdls`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${context.accessToken}`,
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
            `).run(tenantId, context.tenant.name);
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
            const context = getTenantQrContext(database, accessTokenForTenant, req);
            if (context.error) return res.status(context.status).json({ error: context.error, code: context.code });

            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(context.phoneNumberId)}/message_qrdls/${encodeURIComponent(qrCodeId)}`,
                {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${context.accessToken}` },
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
