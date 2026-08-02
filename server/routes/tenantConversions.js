import express from 'express';

import { META_API_BASE } from '../config/index.js';
import { requestMetaJson, sanitizeStoredMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';
import {
    hasWhatsAppNumbersTable,
    resolveTenantWhatsAppContext,
} from '../services/whatsappNumbers.js';
import {
    SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
    buildWhatsAppBusinessEvent,
    getLatestCtwaAttribution,
    normalizeCtwaClid,
    normalizePhone,
    parseCustomData,
} from '../services/whatsappEvents.js';

const PERMISSION_REQUIRED = 'whatsapp_business_manage_events';
const EVENT_COLUMNS = `
    id, tenant_id, phone_number_id, dataset_id, event_name, event_time, phone, wamid,
    custom_data, status, meta_response, ctwa_clid, created_at
`;

const normalizeDatasetId = (value) => {
    if (value === null) return null;
    if (!['string', 'number'].includes(typeof value)) return undefined;
    const normalized = String(value).trim();
    if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        return undefined;
    }
    return normalized;
};

const normalizeEventName = (value) => typeof value === 'string' ? value.trim() : '';

const storedCustomData = (value) => {
    const normalized = parseCustomData(value);
    return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
};

const insertConversionEvent = (database, {
    tenantId,
    phoneNumberId,
    datasetId,
    eventName,
    eventTime,
    phone,
    wamid,
    customData,
    status,
    metaResponse = null,
    ctwaClid = null,
}) => database.prepare(`
    INSERT INTO conversion_events (
        tenant_id, phone_number_id, dataset_id, event_name, event_time, phone, wamid,
        custom_data, status, meta_response, ctwa_clid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    tenantId,
    phoneNumberId || null,
    datasetId,
    eventName,
    eventTime,
    phone || null,
    wamid || null,
    storedCustomData(customData),
    status,
    metaResponse ? JSON.stringify(metaResponse) : null,
    normalizeCtwaClid(ctwaClid) || null
);

const publicEvent = (event) => {
    const safeMeta = sanitizeStoredMetaResponse(event.meta_response, {
        successFields: event.status === 'sent' ? ['events_received', 'fbtrace_id'] : [],
    });
    return {
        ...event,
        meta_response: safeMeta ? JSON.stringify(safeMeta) : null,
    };
};

export function createTenantConversionsRouter({
    database,
    accessTokenForTenant,
    requestMeta = requestMetaJson,
    billing,
} = {}) {
    if (!database || typeof accessTokenForTenant !== 'function' || !billing) {
        throw new TypeError('Tenant conversions router requires database, credentials and billing');
    }
    const router = express.Router();

    const resolveContext = (req, { requireToken = true } = {}) => {
        const tenantId = req.user.tenant_id;
        if (!hasWhatsAppNumbersTable(database)) {
            const tenant = database.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (!tenant) {
                return { error: 'العميل غير موجود', status: 404, code: 'TENANT_NOT_FOUND' };
            }
            const accessToken = accessTokenForTenant(tenantId);
            if (requireToken && !accessToken) {
                return {
                    tenant,
                    error: 'بيانات اعتماد WhatsApp/Meta مفقودة',
                    status: 400,
                    code: 'WHATSAPP_TOKEN_REQUIRED',
                };
            }
            return {
                tenantId,
                tenant,
                phoneNumberId: tenant.phone_number_id || null,
                wabaId: tenant.waba_id || null,
                datasetId: tenant.dataset_id || null,
                accessToken: accessToken || null,
                number: null,
            };
        }
        return resolveTenantWhatsAppContext({
            database,
            tenantId,
            request: req,
            accessTokenForTenant,
            requireToken,
        });
    };

    const sendContextFailure = (res, context) => res.status(context.status || 400).json({
        error: context.error,
        code: context.code,
    });

    router.get('/conversions/datasets', async (req, res) => {
        try {
            const context = resolveContext(req);
            if (context.error) return sendContextFailure(res, context);
            if (!context.wabaId) {
                return res.status(400).json({ error: 'WABA ID غير متوفر لهذا العميل' });
            }

            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(context.wabaId)}/dataset`,
                { headers: { Authorization: `Bearer ${context.accessToken}` } }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل جلب Datasets من Meta');
            const data = result.data || {};
            return res.json({
                phone_number_id: context.phoneNumberId,
                waba_id: context.wabaId,
                datasets: Array.isArray(data.data) ? data.data : [data].filter((item) => item?.id),
            });
        } catch (error) {
            console.error('[TenantConversions] Datasets error:', error);
            return res.status(500).json({ error: 'فشل جلب Datasets' });
        }
    });

    router.patch('/meta-settings', (req, res) => {
        try {
            const context = resolveContext(req, { requireToken: false });
            if (context.error) return sendContextFailure(res, context);
            const tenantId = context.tenantId;
            const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
                ? req.body
                : {};
            if (!Object.hasOwn(body, 'dataset_id')) {
                return res.status(400).json({ error: 'dataset_id مطلوب' });
            }
            const datasetId = normalizeDatasetId(body.dataset_id);
            if (datasetId === undefined) {
                return res.status(400).json({ error: 'dataset_id غير صالح' });
            }
            const tenant = context.tenant;

            database.transaction(() => {
                if (context.number) {
                    database.prepare(`
                        UPDATE tenant_whatsapp_numbers
                        SET dataset_id = ?, updated_at = datetime('now', 'localtime')
                        WHERE tenant_id = ? AND phone_number_id = ?
                    `).run(datasetId, tenantId, context.phoneNumberId);
                }
                if (!context.number || context.number.is_default) {
                    database.prepare(`
                        UPDATE tenants
                        SET dataset_id = ?, updated_at = datetime('now', 'localtime')
                        WHERE id = ?
                    `).run(datasetId, tenantId);
                }
                database.prepare(`
                    INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                    VALUES (?, ?, 'meta_settings_updated', 'تحديث Dataset ID لأحداث WhatsApp', 'success')
                `).run(tenantId, tenant.name);
            })();
            return res.json({
                success: true,
                phone_number_id: context.phoneNumberId,
                dataset_id: datasetId,
            });
        } catch (error) {
            console.error('[TenantConversions] Settings error:', error);
            return res.status(500).json({ error: 'فشل تحديث إعدادات Meta' });
        }
    });

    router.get('/conversions/history', (req, res) => {
        try {
            const context = resolveContext(req, { requireToken: false });
            if (context.error) return sendContextFailure(res, context);
            const tenantId = context.tenantId;
            const tenant = context.tenant;
            const numberScoped = !!context.number;
            const numberPredicate = numberScoped ? ' AND phone_number_id = ?' : '';
            const scopeArgs = numberScoped ? [tenantId, context.phoneNumberId] : [tenantId];
            const { limit, offset } = parseListPagination(req.query, { defaultLimit: 50, maxLimit: 100 });
            const events = database.prepare(`
                SELECT ${EVENT_COLUMNS}
                FROM conversion_events
                WHERE tenant_id = ?${numberPredicate}
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(...scopeArgs, limit, offset).map(publicEvent);
            const totals = database.prepare(`
                SELECT COUNT(*) AS total_events,
                       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_events,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_events,
                       SUM(CASE WHEN status = 'local_only' THEN 1 ELSE 0 END) AS local_only_events,
                       MAX(CASE WHEN status = 'sent' THEN created_at END) AS last_success_at,
                       MAX(CASE WHEN status = 'failed' THEN created_at END) AS last_failure_at
                FROM conversion_events
                WHERE tenant_id = ?${numberPredicate}
            `).get(...scopeArgs) || {};
            const eventBreakdown = database.prepare(`
                SELECT event_name, COUNT(*) AS count
                FROM conversion_events
                WHERE tenant_id = ?${numberPredicate}
                GROUP BY event_name
                ORDER BY count DESC, event_name ASC
            `).all(...scopeArgs);
            const lastFailedEvent = database.prepare(`
                SELECT id, event_name, meta_response, created_at
                FROM conversion_events
                WHERE tenant_id = ?${numberPredicate} AND status = 'failed'
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            `).get(...scopeArgs);
            const lastSentEvent = database.prepare(`
                SELECT id, event_name, meta_response, created_at
                FROM conversion_events
                WHERE tenant_id = ?${numberPredicate} AND status = 'sent'
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            `).get(...scopeArgs);
            const lastFailedError = sanitizeStoredMetaResponse(lastFailedEvent?.meta_response)?.error || null;
            const lastSentMeta = sanitizeStoredMetaResponse(lastSentEvent?.meta_response, {
                successFields: ['events_received', 'fbtrace_id'],
            });
            const accessToken = context.accessToken;
            const tenantTokenPresent = !!(
                context.number?.access_token_encrypted
                || tenant.access_token
                || tenant.access_token_encrypted
            );

            return res.json({
                events,
                total: Number(totals.total_events) || 0,
                limit,
                offset,
                stats: {
                    totalEvents: Number(totals.total_events) || 0,
                    sentEvents: Number(totals.sent_events) || 0,
                    failedEvents: Number(totals.failed_events) || 0,
                    localOnlyEvents: Number(totals.local_only_events) || 0,
                    lastSuccessAt: totals.last_success_at || null,
                    lastFailureAt: totals.last_failure_at || null,
                    eventBreakdown,
                },
                phone_number_id: context.phoneNumberId,
                dataset_id: context.datasetId,
                waba_id: context.wabaId,
                whatsapp_token_present: !!accessToken,
                tenant_whatsapp_token_present: tenantTokenPresent,
                events_api_ready: !!context.datasetId && !!accessToken,
                supported_events: SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
                last_success: lastSentEvent ? {
                    id: lastSentEvent.id,
                    event_name: lastSentEvent.event_name,
                    created_at: lastSentEvent.created_at,
                    events_received: lastSentMeta?.events_received ?? null,
                    fbtrace_id: lastSentMeta?.fbtrace_id || null,
                } : null,
                last_failure: lastFailedEvent ? {
                    id: lastFailedEvent.id,
                    event_name: lastFailedEvent.event_name,
                    created_at: lastFailedEvent.created_at,
                    error_message: lastFailedError?.message || null,
                    error_code: lastFailedError?.code || null,
                    error_subcode: lastFailedError?.subcode || null,
                } : null,
            });
        } catch (error) {
            console.error('[TenantConversions] History error:', error);
            return res.status(500).json({ error: 'فشل جلب سجل الأحداث' });
        }
    });

    router.post('/conversions/log-event', async (req, res) => {
        let billingReservation = null;
        try {
            const context = resolveContext(req, { requireToken: false });
            if (context.error) return sendContextFailure(res, context);
            const tenantId = context.tenantId;
            const eventName = normalizeEventName(req.body?.event_name);
            if (!eventName) return res.status(400).json({ error: 'اسم الحدث مطلوب' });
            if (!SUPPORTED_WHATSAPP_BUSINESS_EVENTS.includes(eventName)) {
                return res.status(400).json({
                    error: `نوع الحدث غير مدعوم في WhatsApp Business Messaging Events API: ${eventName}`,
                    supported_events: SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
                    permission_required: PERMISSION_REQUIRED,
                });
            }

            const tenant = context.tenant;

            const eventTime = new Date().toISOString();
            if (!context.datasetId) {
                insertConversionEvent(database, {
                    tenantId,
                    phoneNumberId: context.phoneNumberId,
                    datasetId: 'local',
                    eventName,
                    eventTime,
                    phone: req.body?.phone,
                    wamid: req.body?.wamid,
                    customData: req.body?.custom_data,
                    status: 'local_only',
                    ctwaClid: req.body?.ctwa_clid,
                });
                return res.json({
                    success: true,
                    sent_to_meta: false,
                    status: 'local_only',
                    permission_required: PERMISSION_REQUIRED,
                    note: 'الحدث تم حفظه محلياً فقط لأن Dataset ID غير مضاف للعميل.',
                });
            }

            const accessToken = context.accessToken;
            if (!accessToken) {
                return res.status(400).json({
                    error: 'بيانات اعتماد WhatsApp/Meta مفقودة',
                    permission_required: PERMISSION_REQUIRED,
                });
            }
            const normalizedPhone = normalizePhone(req.body?.phone);
            const storedAttribution = getLatestCtwaAttribution(
                database,
                tenantId,
                normalizedPhone,
                context.phoneNumberId,
            );
            const resolvedCtwaClid = normalizeCtwaClid(req.body?.ctwa_clid)
                || storedAttribution?.last_ctwa_clid
                || '';
            const customData = parseCustomData(req.body?.custom_data);
            let formattedEvent;
            try {
                formattedEvent = buildWhatsAppBusinessEvent({
                    eventName,
                    wabaId: context.wabaId,
                    ctwaClid: resolvedCtwaClid,
                    customData,
                });
            } catch (validationError) {
                const validationResponse = {
                    error: {
                        message: validationError.message,
                        type: 'local_validation',
                        code: validationError.reason || 'invalid_whatsapp_business_event',
                        supported_events: validationError.supportedEvents || undefined,
                    },
                };
                insertConversionEvent(database, {
                    tenantId,
                    phoneNumberId: context.phoneNumberId,
                    datasetId: context.datasetId,
                    eventName,
                    eventTime,
                    phone: req.body?.phone,
                    wamid: req.body?.wamid,
                    customData,
                    status: 'failed',
                    metaResponse: validationResponse,
                    ctwaClid: resolvedCtwaClid,
                });
                return res.status(validationError.statusCode || 400).json({
                    error: validationError.message,
                    details: validationResponse.error,
                    permission_required: PERMISSION_REQUIRED,
                    dataset_id: context.datasetId,
                    supported_events: validationError.supportedEvents || SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
                });
            }

            billingReservation = billing.reserve({
                tenantId,
                operationKey: billing.operations.WHATSAPP_EVENT_CONVERSION,
                quantity: 1,
                referenceType: 'conversion_event',
                metadata: {
                    phone_number_id: context.phoneNumberId,
                    dataset_id: context.datasetId,
                    event_name: eventName,
                },
            });
            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(context.datasetId)}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ data: [formattedEvent] }),
                }
            );
            const data = result.data || {};
            insertConversionEvent(database, {
                tenantId,
                phoneNumberId: context.phoneNumberId,
                datasetId: context.datasetId,
                eventName,
                eventTime,
                phone: req.body?.phone,
                wamid: req.body?.wamid,
                customData,
                status: result.ok ? 'sent' : 'failed',
                metaResponse: result.ok ? data : { error: result.error },
                ctwaClid: resolvedCtwaClid,
            });

            if (!result.ok) {
                billing.release(billingReservation, result.error?.message || 'Meta conversion event failed');
                return sendMetaFailure(res, result, 'فشل إرسال الحدث', {
                    permission_required: PERMISSION_REQUIRED,
                    dataset_id: context.datasetId,
                });
            }

            billing.commit(billingReservation, {
                referenceId: data.fbtrace_id || null,
                description: `خصم إرسال حدث WhatsApp Events API: ${eventName}`,
            });
            database.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'conversion_event_logged', ?, 'success')
            `).run(tenantId, tenant.name, `تسجيل حدث: ${eventName}`);
            return res.json({
                success: true,
                sent_to_meta: true,
                status: 'sent',
                phone_number_id: context.phoneNumberId,
                dataset_id: context.datasetId,
                events_received: data.events_received,
                fbtrace_id: data.fbtrace_id,
                data,
            });
        } catch (error) {
            if (billingReservation) {
                try {
                    billing.release(billingReservation, error.message);
                } catch (releaseError) {
                    console.error('[TenantConversions] Billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, error)) return undefined;
            console.error('[TenantConversions] Log event error:', error);
            return res.status(500).json({ error: 'فشل تسجيل الحدث' });
        }
    });

    return router;
}

export default createTenantConversionsRouter;
