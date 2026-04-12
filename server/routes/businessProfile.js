import express from 'express';
import db from '../db/database.js';
import { getAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';

const router = express.Router();

// ============================================
// Helper: Get credentials from tenant or request
// ============================================
const getCredentials = (req) => {
    const tenantId = req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id;
    let phoneNumberId = null;
    let accessToken = null;

    if (tenantId) {
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (tenant) {
            phoneNumberId = tenant.phone_number_id;
            accessToken = tenant.access_token;
        }
    }

    // Fallback to defaults
    phoneNumberId = phoneNumberId || process.env.DEFAULT_PHONE_NUMBER_ID;
    accessToken = accessToken || getAccessToken();

    return { phoneNumberId, accessToken, tenantId };
};

// ============================================
// Get Business Profile
// ============================================
router.get('/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const tenantId = req.query.tenant_id;

        // Get access token
        let accessToken = getAccessToken(tenantId);
        if (tenantId) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const fields = 'about,address,description,email,profile_picture_url,vertical,websites,messaging_product';
        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/whatsapp_business_profile?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب ملف النشاط التجاري',
                details: data.error
            });
        }

        // Return the profile data (usually in data[0])
        const profile = data.data?.[0] || data;
        res.json(profile);
    } catch (error) {
        console.error('[BusinessProfile] GET error:', error);
        res.status(500).json({ error: 'فشل جلب ملف النشاط التجاري' });
    }
});

// ============================================
// Update Business Profile
// ============================================
router.post('/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const { tenant_id, about, address, description, email, vertical, websites, profile_picture_handle } = req.body;

        // Get access token
        let accessToken = getAccessToken(tenant_id);
        if (tenant_id) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        // Build update payload — only include fields that are provided
        const updatePayload = { messaging_product: 'whatsapp' };
        if (about !== undefined) updatePayload.about = about;
        if (address !== undefined) updatePayload.address = address;
        if (description !== undefined) updatePayload.description = description;
        if (email !== undefined) updatePayload.email = email;
        if (vertical !== undefined) updatePayload.vertical = vertical;
        if (websites !== undefined) updatePayload.websites = Array.isArray(websites) ? websites : [websites];
        if (profile_picture_handle !== undefined) updatePayload.profile_picture_handle = profile_picture_handle;

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/whatsapp_business_profile`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatePayload)
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل تحديث ملف النشاط التجاري',
                details: data.error
            });
        }

        // Log activity
        if (tenant_id) {
            const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenant_id);
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'business_profile_updated', 'تحديث ملف النشاط التجاري', 'success')
            `).run(tenant_id, tenant?.name || 'Unknown');
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[BusinessProfile] POST error:', error);
        res.status(500).json({ error: 'فشل تحديث ملف النشاط التجاري' });
    }
});

// ============================================
// Tenant Portal — Get own business profile
// ============================================
router.get('/me/profile', async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        if (!tenantId) {
            return res.status(403).json({ error: 'صلاحية الوصول مقتصرة على العملاء' });
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant || !tenant.phone_number_id || !tenant.access_token) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const fields = 'about,address,description,email,profile_picture_url,vertical,websites,messaging_product';
        const response = await fetch(
            `${META_API_BASE}/${tenant.phone_number_id}/whatsapp_business_profile?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${tenant.access_token}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب ملف النشاط التجاري',
                details: data.error
            });
        }

        const profile = data.data?.[0] || data;
        res.json(profile);
    } catch (error) {
        console.error('[BusinessProfile] me/profile error:', error);
        res.status(500).json({ error: 'فشل جلب ملف النشاط التجاري' });
    }
});

// ============================================
// Tenant Portal — Update own business profile
// ============================================
router.put('/me/profile', async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        if (!tenantId) {
            return res.status(403).json({ error: 'صلاحية الوصول مقتصرة على العملاء' });
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant || !tenant.phone_number_id || !tenant.access_token) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const { about, address, description, email, vertical, websites, profile_picture_handle } = req.body;

        const updatePayload = { messaging_product: 'whatsapp' };
        if (about !== undefined) updatePayload.about = about;
        if (address !== undefined) updatePayload.address = address;
        if (description !== undefined) updatePayload.description = description;
        if (email !== undefined) updatePayload.email = email;
        if (vertical !== undefined) updatePayload.vertical = vertical;
        if (websites !== undefined) updatePayload.websites = Array.isArray(websites) ? websites : [websites];
        if (profile_picture_handle !== undefined) updatePayload.profile_picture_handle = profile_picture_handle;

        const response = await fetch(
            `${META_API_BASE}/${tenant.phone_number_id}/whatsapp_business_profile`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tenant.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatePayload)
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل تحديث ملف النشاط التجاري',
                details: data.error
            });
        }

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'business_profile_updated', 'تم تحديث ملف النشاط التجاري', 'success')
        `).run(tenantId, tenant.name);

        res.json({ success: true, data });
    } catch (error) {
        console.error('[BusinessProfile] me/profile PUT error:', error);
        res.status(500).json({ error: 'فشل تحديث ملف النشاط التجاري' });
    }
});

export default router;
