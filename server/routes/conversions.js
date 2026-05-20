import express from 'express';
import db from '../db/database.js';
import { getAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';
import {
    SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
    buildWhatsAppBusinessEvent,
    getLatestCtwaAttribution,
    normalizeCtwaClid,
    normalizeMetaError,
    normalizePhone,
    parseCustomData,
} from '../services/whatsappEvents.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';

const router = express.Router();

// ============================================
// Helper: Get credentials
// ============================================
const getCredentials = (tenantId) => {
    if (!tenantId) return { accessToken: getAccessToken() };
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    return {
        tenant,
        accessToken: getAccessToken(tenantId),
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
    let billingReservation = null;
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

        const resolveEventCtwa = (event) => (
            normalizeCtwaClid(event.ctwa_clid)
            || getLatestCtwaAttribution(db, tenant_id, normalizePhone(event.phone))?.last_ctwa_clid
            || ''
        );

        const formattedEvents = events.map(event => {
            return buildWhatsAppBusinessEvent({
                eventName: event.event_name,
                wabaId: tenant?.waba_id,
                ctwaClid: resolveEventCtwa(event),
                customData: parseCustomData(event.custom_data),
                eventTime: event.event_time || Math.floor(Date.now() / 1000),
            });
        });

        billingReservation = reserveBilling({
            tenantId: tenant_id || null,
            operationKey: BILLING_OPERATIONS.WHATSAPP_EVENT_CONVERSION,
            quantity: events.length,
            referenceType: 'conversion_event',
            metadata: { dataset_id: datasetId, event_count: events.length },
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
            releaseBilling(billingReservation, data.error?.message || 'Meta conversion events failed');
            // Save failed events to local DB
            for (const event of events) {
                db.prepare(`
                    INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response, ctwa_clid)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)
                `).run(
                    tenant_id || null,
                    datasetId,
                    event.event_name,
                    new Date((event.event_time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                    event.phone || null,
                    event.wamid || null,
                    event.custom_data ? JSON.stringify(event.custom_data) : null,
                    JSON.stringify(data.error || data),
                    resolveEventCtwa(event) || null
                );
            }

            const metaError = normalizeMetaError(data);
            return res.status(response.status).json({
                error: metaError?.message || data.error?.message || 'فشل إرسال الأحداث',
                details: data.error,
                fbtrace_id: metaError?.fbtrace_id || null,
            });
        }

        // Save successful events to local DB
        for (const event of events) {
            db.prepare(`
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response, ctwa_clid)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)
            `).run(
                tenant_id || null,
                datasetId,
                event.event_name,
                new Date((event.event_time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                event.phone || null,
                event.wamid || null,
                event.custom_data ? JSON.stringify(event.custom_data) : null,
                JSON.stringify(data),
                resolveEventCtwa(event) || null
            );
        }

        // Log activity
        if (tenant_id && tenant) {
            commitBilling(billingReservation, {
                quantity: data.events_received || events.length,
                referenceId: data.fbtrace_id || null,
                description: `خصم إرسال ${data.events_received || events.length} حدث WhatsApp Events API`,
            });

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
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[Conversions] Billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[Conversions] Send events error:', error);
        res.status(error.statusCode || (error.message?.includes('نوع الحدث') ? 400 : 500)).json({
            error: error.message || 'فشل إرسال الأحداث',
            supported_events: error.supportedEvents || SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
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
    let billingReservation = null;
    try {
        const tenantId = req.user?.tenant_id || req.body.tenant_id;
        const { phone, event_name, wamid, custom_data, ctwa_clid } = req.body;

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
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, ctwa_clid)
                VALUES (?, 'local', ?, ?, ?, ?, ?, 'local_only', ?)
            `).run(
                tenantId,
                event_name,
                new Date().toISOString(),
                phone || null,
                wamid || null,
                custom_data ? JSON.stringify(custom_data) : null,
                normalizeCtwaClid(ctwa_clid) || null
            );

            return res.json({
                success: true,
                note: 'الحدث تم حفظه محلياً فقط. لإرساله إلى Meta، يجب إعداد Dataset ID'
            });
        }

        const storedAttribution = getLatestCtwaAttribution(db, tenantId, normalizePhone(phone));
        const resolvedCtwaClid = normalizeCtwaClid(ctwa_clid) || storedAttribution?.last_ctwa_clid || '';
        const formattedEvent = buildWhatsAppBusinessEvent({
            eventName: event_name,
            wabaId: tenant.waba_id,
            ctwaClid: resolvedCtwaClid,
            customData: parseCustomData(custom_data),
        });

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_EVENT_CONVERSION,
            quantity: 1,
            referenceType: 'conversion_event',
            metadata: { dataset_id: datasetId, event_name },
        });

        const response = await fetch(
            `${META_API_BASE}/${datasetId}/events`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAccessToken(tenantId)}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ data: [formattedEvent] })
            }
        );

        const data = await response.json();
        const status = response.ok ? 'sent' : 'failed';

        // Save to local DB
        db.prepare(`
            INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response, ctwa_clid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenantId,
            datasetId,
            event_name,
            new Date().toISOString(),
            phone || null,
            wamid || null,
            custom_data ? JSON.stringify(custom_data) : null,
            status,
            JSON.stringify(data),
            resolvedCtwaClid || null
        );

        if (response.ok) {
            commitBilling(billingReservation, {
                referenceId: data.fbtrace_id || null,
                description: `خصم إرسال حدث WhatsApp Events API: ${event_name}`,
            });

            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'conversion_event_logged', ?, 'success')
            `).run(tenantId, tenant.name, `تسجيل حدث: ${event_name}`);

            res.json({ success: true, data });
        } else {
            releaseBilling(billingReservation, data.error?.message || 'Meta conversion event failed');
            const metaError = normalizeMetaError(data);
            res.status(response.status).json({
                error: metaError?.message || data.error?.message || 'فشل إرسال الحدث',
                details: data.error,
                fbtrace_id: metaError?.fbtrace_id || null,
            });
        }
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[Conversions] Log event billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[Conversions] Log event error:', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'فشل تسجيل الحدث',
            supported_events: error.supportedEvents || SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
        });
    }
});

export default router;
