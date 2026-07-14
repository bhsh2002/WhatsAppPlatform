import express from 'express';

import { META_API_BASE } from '../config/index.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';

const BUSINESS_PROFILE_FIELDS = [
    'about',
    'address',
    'description',
    'email',
    'profile_picture_url',
    'vertical',
    'websites',
    'messaging_product',
].join(',');

const buildProfileUpdate = (body = {}) => {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const payload = { messaging_product: 'whatsapp' };
    for (const field of ['about', 'address', 'description', 'email', 'vertical', 'profile_picture_handle']) {
        if (input[field] !== undefined) payload[field] = input[field];
    }
    if (input.websites !== undefined) {
        payload.websites = Array.isArray(input.websites) ? input.websites : [input.websites];
    }
    return payload;
};

export function createTenantProfileRouter({
    database,
    accessTokenForTenant,
    requestMeta = requestMetaJson,
} = {}) {
    if (!database || typeof accessTokenForTenant !== 'function') {
        throw new TypeError('Tenant profile router requires database and accessTokenForTenant');
    }
    const router = express.Router();

    router.get('/profile', (req, res) => {
        try {
            const tenant = database.prepare(`
                SELECT id, name, phone, status, tier, credits, quality, created_at
                FROM tenants
                WHERE id = ?
            `).get(req.user.tenant_id);
            if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
            return res.json(tenant);
        } catch (error) {
            console.error('[TenantProfile] Profile error:', error);
            return res.status(500).json({ error: 'فشل جلب البيانات' });
        }
    });

    router.get('/business-profile', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const tenant = database.prepare(`
                SELECT id, phone_number_id
                FROM tenants
                WHERE id = ?
            `).get(tenantId);
            const accessToken = accessTokenForTenant(tenantId);
            if (!tenant?.phone_number_id || !accessToken) {
                return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
            }

            const result = await requestMeta(
                `${META_API_BASE}/${tenant.phone_number_id}/whatsapp_business_profile?fields=${BUSINESS_PROFILE_FIELDS}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل جلب ملف النشاط التجاري');
            return res.json(result.data?.data?.[0] || result.data);
        } catch (error) {
            console.error('[TenantProfile] Business profile GET error:', error);
            return res.status(500).json({ error: 'فشل جلب ملف النشاط التجاري' });
        }
    });

    router.put('/business-profile', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const tenant = database.prepare(`
                SELECT id, name, phone_number_id
                FROM tenants
                WHERE id = ?
            `).get(tenantId);
            const accessToken = accessTokenForTenant(tenantId);
            if (!tenant?.phone_number_id || !accessToken) {
                return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
            }

            const result = await requestMeta(
                `${META_API_BASE}/${tenant.phone_number_id}/whatsapp_business_profile`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(buildProfileUpdate(req.body)),
                }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل تحديث ملف النشاط التجاري');

            database.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'business_profile_updated', 'تم تحديث ملف النشاط التجاري', 'success')
            `).run(tenantId, tenant.name);
            return res.json({ success: true, data: result.data || {} });
        } catch (error) {
            console.error('[TenantProfile] Business profile PUT error:', error);
            return res.status(500).json({ error: 'فشل تحديث ملف النشاط التجاري' });
        }
    });

    return router;
}

export default createTenantProfileRouter;
