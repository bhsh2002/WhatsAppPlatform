import express from 'express';
import crypto from 'crypto';
import db from '../db/database.js';
import { getAccessToken } from '../utils/credentials.js';

const router = express.Router();

const META_API_VERSION = 'v22.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ============================================
// Helper: Hash data for privacy (SHA-256)
// ============================================
const hashData = (value) => {
    if (!value) return null;
    return crypto.createHash('sha256').update(value.toString().toLowerCase().trim()).digest('hex');
};

// ============================================
// Helper: Get credentials
// ============================================
const getCredentials = (tenantId) => {
    if (!tenantId) return { accessToken: getAccessToken() };
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    return {
        tenant,
        accessToken: tenant?.access_token || getAccessToken(),
        datasetId: tenant?.dataset_id
    };
};

// ============================================
// List datasets for a WABA
// ============================================
router.get('/datasets/:wabaId', async (req, res) => {
    try {
        const { wabaId } = req.params;
        const tenantId = req.query.tenant_id;
        const { accessToken } = getCredentials(tenantId);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${wabaId}/dataset`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب datasets',
                details: data.error
            });
        }

        res.json({
            datasets: data.data || [data],
        });
    } catch (error) {
        console.error('[Conversions] Datasets error:', error);
        res.status(500).json({ error: 'فشل جلب datasets' });
    }
});

// ============================================
// Send conversion event(s) to Meta
// ============================================
router.post('/events/:datasetId', async (req, res) => {
    try {
        const { datasetId } = req.params;
        const { tenant_id, events } = req.body;
        const { accessToken, tenant } = getCredentials(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        if (!events || !Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'يجب توفير حدث واحد على الأقل' });
        }

        // Validate and format events
        const validEventNames = [
            'Purchase', 'AddToCart', 'Lead', 'CompleteRegistration',
            'InitiateCheckout', 'Subscribe', 'ViewContent', 'Search',
            'AddPaymentInfo', 'AddToWishlist', 'Contact', 'CustomizeProduct',
            'FindLocation', 'Schedule', 'StartTrial', 'SubmitApplication'
        ];

        const formattedEvents = events.map(event => {
            if (!event.event_name || !validEventNames.includes(event.event_name)) {
                throw new Error(`نوع الحدث غير صالح: ${event.event_name}. الأنواع المسموحة: ${validEventNames.join(', ')}`);
            }

            const formattedEvent = {
                event_name: event.event_name,
                event_time: event.event_time || Math.floor(Date.now() / 1000),
                action_source: event.action_source || 'business_messaging',
                messaging_channel: 'whatsapp',
                user_data: {}
            };

            // Hash phone number if provided
            if (event.phone) {
                formattedEvent.user_data.phones = [hashData(event.phone)];
            }

            // Hash email if provided
            if (event.email) {
                formattedEvent.user_data.emails = [hashData(event.email)];
            }

            // WAMID for message attribution
            if (event.wamid) {
                formattedEvent.user_data.madid = event.wamid;
            }

            // Custom data (value, currency, content, etc.)
            if (event.custom_data) {
                formattedEvent.custom_data = event.custom_data;
            }

            return formattedEvent;
        });

        // Send to Meta Conversions API
        const response = await fetch(
            `${META_API_BASE}/${datasetId}/events`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    data: formattedEvents
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            // Save failed events to local DB
            for (const event of events) {
                db.prepare(`
                    INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?)
                `).run(
                    tenant_id || null,
                    datasetId,
                    event.event_name,
                    new Date((event.event_time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                    event.phone || null,
                    event.wamid || null,
                    event.custom_data ? JSON.stringify(event.custom_data) : null,
                    JSON.stringify(data.error || data)
                );
            }

            return res.status(response.status).json({
                error: data.error?.message || 'فشل إرسال الأحداث',
                details: data.error
            });
        }

        // Save successful events to local DB
        for (const event of events) {
            db.prepare(`
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?)
            `).run(
                tenant_id || null,
                datasetId,
                event.event_name,
                new Date((event.event_time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                event.phone || null,
                event.wamid || null,
                event.custom_data ? JSON.stringify(event.custom_data) : null,
                JSON.stringify(data)
            );
        }

        // Log activity
        if (tenant_id && tenant) {
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'conversion_events_sent', ?, 'success')
            `).run(tenant_id, tenant.name, `تم إرسال ${events.length} حدث تحويل`);
        }

        res.json({
            success: true,
            events_received: data.events_received || events.length,
            fbtrace_id: data.fbtrace_id,
            data
        });
    } catch (error) {
        console.error('[Conversions] Send events error:', error);
        res.status(error.message?.includes('نوع الحدث') ? 400 : 500).json({
            error: error.message || 'فشل إرسال الأحداث'
        });
    }
});

// ============================================
// Get local event history
// ============================================
router.get('/events/history', (req, res) => {
    try {
        const tenantId = req.query.tenant_id || req.user?.tenant_id;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const eventName = req.query.event_name;

        let query = 'SELECT * FROM conversion_events';
        const conditions = [];
        const params = [];

        if (tenantId) {
            conditions.push('tenant_id = ?');
            params.push(tenantId);
        }

        if (eventName) {
            conditions.push('event_name = ?');
            params.push(eventName);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const events = db.prepare(query).all(...params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM conversion_events';
        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
        }
        const total = db.prepare(countQuery).get(...params.slice(0, -2))?.total || 0;

        // Get summary stats
        let statsCondition = tenantId ? 'WHERE tenant_id = ?' : '';
        const statsParams = tenantId ? [tenantId] : [];

        const stats = {
            totalEvents: total,
            sentEvents: db.prepare(`SELECT COUNT(*) as count FROM conversion_events ${statsCondition} ${statsCondition ? 'AND' : 'WHERE'} status = 'sent'`).get(...statsParams)?.count || 0,
            failedEvents: db.prepare(`SELECT COUNT(*) as count FROM conversion_events ${statsCondition} ${statsCondition ? 'AND' : 'WHERE'} status = 'failed'`).get(...statsParams)?.count || 0,
            eventBreakdown: db.prepare(`
                SELECT event_name, COUNT(*) as count 
                FROM conversion_events 
                ${statsCondition}
                GROUP BY event_name 
                ORDER BY count DESC
            `).all(...statsParams)
        };

        res.json({ events, total, limit, offset, stats });
    } catch (error) {
        console.error('[Conversions] History error:', error);
        res.status(500).json({ error: 'فشل جلب سجل الأحداث' });
    }
});

// ============================================
// Log event from conversation (tenant portal)
// ============================================
router.post('/log-event', async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id || req.body.tenant_id;
        const { phone, event_name, wamid, custom_data } = req.body;

        if (!tenantId) {
            return res.status(403).json({ error: 'صلاحية الوصول مقتصرة على العملاء' });
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const datasetId = tenant.dataset_id;
        if (!datasetId) {
            // Save locally only if no dataset configured
            db.prepare(`
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status)
                VALUES (?, 'local', ?, ?, ?, ?, ?, 'local_only')
            `).run(
                tenantId,
                event_name,
                new Date().toISOString(),
                phone || null,
                wamid || null,
                custom_data ? JSON.stringify(custom_data) : null
            );

            return res.json({
                success: true,
                note: 'الحدث تم حفظه محلياً فقط. لإرساله إلى Meta، يجب إعداد Dataset ID'
            });
        }

        // If dataset is configured, send to Meta
        const formattedEvent = {
            event_name,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'business_messaging',
            messaging_channel: 'whatsapp',
            user_data: {}
        };

        if (phone) formattedEvent.user_data.phones = [hashData(phone)];
        if (wamid) formattedEvent.user_data.madid = wamid;
        if (custom_data) formattedEvent.custom_data = custom_data;

        const response = await fetch(
            `${META_API_BASE}/${datasetId}/events`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tenant.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ data: [formattedEvent] })
            }
        );

        const data = await response.json();
        const status = response.ok ? 'sent' : 'failed';

        // Save to local DB
        db.prepare(`
            INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenantId,
            datasetId,
            event_name,
            new Date().toISOString(),
            phone || null,
            wamid || null,
            custom_data ? JSON.stringify(custom_data) : null,
            status,
            JSON.stringify(data)
        );

        if (response.ok) {
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'conversion_event_logged', ?, 'success')
            `).run(tenantId, tenant.name, `تسجيل حدث: ${event_name}`);

            res.json({ success: true, data });
        } else {
            res.status(response.status).json({
                error: data.error?.message || 'فشل إرسال الحدث',
                details: data.error
            });
        }
    } catch (error) {
        console.error('[Conversions] Log event error:', error);
        res.status(500).json({ error: 'فشل تسجيل الحدث' });
    }
});

export default router;
