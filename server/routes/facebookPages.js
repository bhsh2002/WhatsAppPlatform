import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { encrypt, decrypt } from '../services/encryption.js';

const router = express.Router();

const sanitizePage = (row) => {
    if (!row) return null;
    const { page_access_token_encrypted, ...rest } = row;
    return rest;
};

// ============================================
// List ALL linked pages (across all tenants)
// ============================================
router.get('/', (req, res) => {
    try {
        const pages = db.prepare(`
            SELECT tp.id, tp.tenant_id, tp.platform, tp.page_id, tp.page_name,
                   tp.page_category, tp.page_picture_url, tp.is_active,
                   tp.subscribed_fields, tp.webhook_subscribed, tp.created_at, tp.updated_at,
                   t.name AS tenant_name
            FROM tenant_pages tp
            JOIN tenants t ON tp.tenant_id = t.id
            ORDER BY tp.created_at DESC
        `).all();
        res.json(pages);
    } catch (error) {
        console.error('[FacebookPages] List all error:', error);
        res.status(500).json({ error: 'فشل جلب صفحات فيسبوك' });
    }
});

// ============================================
// List all linked pages for a tenant
// ============================================
router.get('/tenant/:tenantId', (req, res) => {
    try {
        const { tenantId } = req.params;
        const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const pages = db.prepare(
            'SELECT id, tenant_id, platform, page_id, page_name, page_category, page_picture_url, is_active, subscribed_fields, webhook_subscribed, created_at, updated_at FROM tenant_pages WHERE tenant_id = ? ORDER BY created_at DESC'
        ).all(tenantId);

        res.json(pages);
    } catch (error) {
        console.error('[FacebookPages] List error:', error);
        res.status(500).json({ error: 'فشل جلب صفحات فيسبوك' });
    }
});

// ============================================
// Link a new Facebook page to a tenant
// ============================================
router.post('/tenant/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { page_id, page_access_token } = req.body;

        if (!page_id || !page_access_token) {
            return res.status(400).json({ error: 'معرف الصفحة ورمز الوصول مطلوبان' });
        }

        const tenant = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const existing = db.prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND page_id = ?').get(tenantId, page_id);
        if (existing) {
            return res.status(409).json({ error: 'هذه الصفحة مربوطة بالفعل بهذا العميل' });
        }

        // Verify the page token by fetching page info from Meta
        const fields = 'name,category,picture.width(100).height(100)';
        const verifyResponse = await fetch(
            `${META_API_BASE}/${page_id}?fields=${fields}&access_token=${page_access_token}`
        );
        const verifyData = await verifyResponse.json();

        if (!verifyResponse.ok || verifyData.error) {
            const errMsg = verifyData.error?.message || 'رمز الوصول غير صالح أو الصفحة غير موجودة';
            return res.status(400).json({
                error: 'فشل التحقق من رمز الوصول',
                details: errMsg,
            });
        }

        const pageName = verifyData.name || null;
        const pageCategory = verifyData.category || null;
        const pagePictureUrl = verifyData.picture?.data?.url || null;

        // Encrypt the page access token before storing
        const encryptedToken = encrypt(page_access_token);

        const stmt = db.prepare(`
            INSERT INTO tenant_pages (tenant_id, platform, page_id, page_name, page_access_token_encrypted, page_category, page_picture_url, webhook_subscribed)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `);
        const result = stmt.run(tenantId, 'facebook', page_id, pageName, encryptedToken, pageCategory, pagePictureUrl);

        const newPage = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(result.lastInsertRowid);

        // Try to subscribe the page to our app webhooks
        let webhookSubscribed = false;
        let webhookError = null;
        try {
            const subscribedFields = JSON.parse(newPage.subscribed_fields || '["feed","messages","messaging_postbacks"]');
            const fieldsString = Array.isArray(subscribedFields) ? subscribedFields.join(',') : subscribedFields;
            const subscribeResponse = await fetch(
                `${META_API_BASE}/${page_id}/subscribed_apps`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        access_token: page_access_token,
                        subscribed_fields: fieldsString,
                    }).toString(),
                }
            );
            const subscribeData = await subscribeResponse.json();

            if (subscribeResponse.ok && subscribeData.success !== false) {
                db.prepare('UPDATE tenant_pages SET webhook_subscribed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(newPage.id);
                webhookSubscribed = true;
            } else {
                webhookError = subscribeData.error?.message || 'فشل اشتراك Webhook';
                console.warn('[FacebookPages] Webhook subscription failed:', webhookError);
            }
        } catch (err) {
            webhookError = err.message;
            console.warn('[FacebookPages] Webhook subscription error:', err.message);
        }

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'page_linked', ?, 'success')
        `).run(parseInt(tenantId), tenant.name, `ربط صفحة فيسبوك: ${pageName || page_id}`);

        const finalPage = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(newPage.id);
        const response = sanitizePage(finalPage);
        if (webhookError) {
            response._webhook_warning = webhookError;
        }
        response._webhook_subscribed = webhookSubscribed;

        res.status(201).json(response);
    } catch (error) {
        console.error('[FacebookPages] Link error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'هذه الصفحة مربوطة بالفعل بهذا العميل' });
        }
        res.status(500).json({ error: 'فشل ربط صفحة فيسبوك' });
    }
});

// ============================================
// Update a linked page
// ============================================
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { page_access_token, is_active, page_name } = req.body;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        const setClauses = [];
        const values = [];

        if (page_name !== undefined) {
            setClauses.push('page_name = ?');
            values.push(page_name);
        }

        if (is_active !== undefined) {
            setClauses.push('is_active = ?');
            values.push(is_active ? 1 : 0);
        }

        if (page_access_token !== undefined) {
            setClauses.push('page_access_token_encrypted = ?');
            values.push(encrypt(page_access_token));
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
        }

        setClauses.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        db.prepare(`UPDATE tenant_pages SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        res.json(sanitizePage(updated));
    } catch (error) {
        console.error('[FacebookPages] Update error:', error);
        res.status(500).json({ error: 'فشل تحديث الصفحة' });
    }
});

// ============================================
// Unlink a page (unsubscribe webhook + delete)
// ============================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        // Try to unsubscribe the page from our webhooks
        const accessToken = decrypt(existing.page_access_token_encrypted);
        if (accessToken) {
            try {
                await fetch(
                    `${META_API_BASE}/${existing.page_id}/subscribed_apps?access_token=${accessToken}`,
                    { method: 'DELETE' }
                );
            } catch (err) {
                console.warn('[FacebookPages] Failed to unsubscribe webhook on unlink:', err.message);
            }
        }

        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(existing.tenant_id);

        db.prepare('DELETE FROM tenant_pages WHERE id = ?').run(id);

        // Log activity
        if (tenant) {
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'page_unlinked', ?, 'success')
            `).run(existing.tenant_id, tenant.name, `فك ربط صفحة فيسبوك: ${existing.page_name || existing.page_id}`);
        }

        res.json({ message: 'تم فك ربط الصفحة بنجاح' });
    } catch (error) {
        console.error('[FacebookPages] Delete error:', error);
        res.status(500).json({ error: 'فشل فك ربط الصفحة' });
    }
});

// ============================================
// Verify a page token still works
// ============================================
router.post('/:id/verify', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        const accessToken = decrypt(existing.page_access_token_encrypted);
        if (!accessToken) {
            return res.status(400).json({ error: 'رمز الوصول غير متوفر أو غير صالح' });
        }

        const fields = 'name,category,picture.width(100).height(100)';
        const response = await fetch(
            `${META_API_BASE}/${existing.page_id}?fields=${fields}&access_token=${accessToken}`
        );
        const data = await response.json();

        if (!response.ok || data.error) {
            return res.status(400).json({
                valid: false,
                error: data.error?.message || 'رمز الوصول غير صالح',
            });
        }

        // Update page info if changed
        const updates = [];
        const values = [];
        if (data.name && data.name !== existing.page_name) {
            updates.push('page_name = ?');
            values.push(data.name);
        }
        if (data.category && data.category !== existing.page_category) {
            updates.push('page_category = ?');
            values.push(data.category);
        }
        if (data.picture?.data?.url && data.picture.data.url !== existing.page_picture_url) {
            updates.push('page_picture_url = ?');
            values.push(data.picture.data.url);
        }
        if (updates.length > 0) {
            updates.push('updated_at = CURRENT_TIMESTAMP');
            values.push(id);
            db.prepare(`UPDATE tenant_pages SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }

        const refreshed = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        res.json({
            valid: true,
            page: sanitizePage(refreshed),
            info: {
                name: data.name,
                category: data.category,
                picture: data.picture?.data?.url || null,
            },
        });
    } catch (error) {
        console.error('[FacebookPages] Verify error:', error);
        res.status(500).json({ error: 'فشل التحقق من رمز الوصول' });
    }
});

// ============================================
// Re-subscribe a page to webhooks
// ============================================
router.post('/:id/subscribe', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        const accessToken = decrypt(existing.page_access_token_encrypted);
        if (!accessToken) {
            return res.status(400).json({ error: 'رمز الوصول غير متوفر أو غير صالح' });
        }

        const subscribedFields = JSON.parse(existing.subscribed_fields || '["feed","messages","messaging_postbacks"]');
        const fieldsString = Array.isArray(subscribedFields) ? subscribedFields.join(',') : subscribedFields;

        const response = await fetch(
            `${META_API_BASE}/${existing.page_id}/subscribed_apps`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    access_token: accessToken,
                    subscribed_fields: fieldsString,
                }).toString(),
            }
        );
        const data = await response.json();

        if (!response.ok || data.error) {
            return res.status(response.status || 400).json({
                error: data.error?.message || 'فشل اشتراك Webhook',
                details: data.error,
            });
        }

        db.prepare('UPDATE tenant_pages SET webhook_subscribed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(id);

        const updated = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        res.json({
            success: true,
            page: sanitizePage(updated),
        });
    } catch (error) {
        console.error('[FacebookPages] Subscribe error:', error);
        res.status(500).json({ error: 'فشل اشتراك Webhook' });
    }
});

// ============================================
// GET /:id/subscription-status — Check webhook subscription status
// ============================================
router.get('/:id/subscription-status', async (req, res) => {
    try {
        const { id } = req.params;
        const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });

        const accessToken = decrypt(page.page_access_token_encrypted);
        if (!accessToken) {
            return res.status(400).json({ error: 'رمز الوصول غير متوفر' });
        }

        const response = await fetch(
            `${META_API_BASE}/${page.page_id}/subscribed_apps?access_token=${accessToken}`
        );
        const data = await response.json();

        res.json({
            page_id: page.page_id,
            page_name: page.page_name,
            webhook_subscribed_in_db: !!page.webhook_subscribed,
            meta_response: data,
        });
    } catch (error) {
        console.error('[FacebookPages] Subscription status error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;