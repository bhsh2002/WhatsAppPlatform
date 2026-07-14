import express from 'express';

import { META_API_BASE } from '../../config/index.js';
import db from '../../db/database.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../../services/billing.js';
import { getAccessToken } from '../../services/credentials.js';
import {
    readMetaResponse,
    sanitizeStoredMetaResponse,
    sendMetaFailure,
} from '../../services/metaHttp.js';
import { parseListPagination } from '../../services/pagination.js';
import {
    SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
    buildWhatsAppBusinessEvent,
    getLatestCtwaAttribution,
    normalizeCtwaClid,
    parseCustomData,
} from '../../services/whatsappEvents.js';
import {
    InvalidWhatsAppMessageError,
    normalizeWhatsAppRecipient,
} from '../../services/whatsappMessageValidation.js';

const MAX_EVENTS_PER_REQUEST = 100;
const MAX_EVENT_CUSTOM_DATA_BYTES = 64 * 1024;
const MAX_EVENT_TEXT_LENGTH = 1024;
const MIN_EVENT_TIME_SECONDS = 946684800;
const FORBIDDEN_CONTROLS = /[\u0000-\u001f\u007f]/;

const defaultBilling = {
    operations: BILLING_OPERATIONS,
    reserve: reserveBilling,
    commit: commitBilling,
    release: releaseBilling,
    handleError: handleBillingError,
};

const normalizeOptionalText = (value, field) => {
    if (value == null || value === '') return '';
    if (typeof value !== 'string') {
        throw new InvalidWhatsAppMessageError(`${field} must be a string`);
    }
    const normalized = value.trim();
    if (
        !normalized
        || normalized.length > MAX_EVENT_TEXT_LENGTH
        || FORBIDDEN_CONTROLS.test(normalized)
    ) {
        throw new InvalidWhatsAppMessageError(`${field} is invalid`);
    }
    return normalized;
};

const normalizeEventTime = (value, nowMs) => {
    if (value == null || value === '') return Math.floor(nowMs / 1000);
    const normalized = Number(value);
    if (
        !Number.isSafeInteger(normalized)
        || normalized < MIN_EVENT_TIME_SECONDS
        || normalized > Math.floor(nowMs / 1000) + 300
    ) {
        throw new InvalidWhatsAppMessageError('event_time is invalid');
    }
    return normalized;
};

const normalizeCustomData = value => {
    if (value == null) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new InvalidWhatsAppMessageError('custom_data must be an object');
    }
    let encoded;
    try {
        encoded = JSON.stringify(value);
    } catch {
        throw new InvalidWhatsAppMessageError('custom_data must be JSON serializable');
    }
    if (Buffer.byteLength(encoded, 'utf8') > MAX_EVENT_CUSTOM_DATA_BYTES) {
        throw new InvalidWhatsAppMessageError('custom_data is too large');
    }
    return parseCustomData(value);
};

const publicEvent = event => {
    const safeMeta = sanitizeStoredMetaResponse(event.meta_response, {
        successFields: event.status === 'sent' ? ['events_received', 'fbtrace_id'] : [],
    });
    return {
        ...event,
        meta_response: safeMeta ? JSON.stringify(safeMeta) : null,
    };
};

export function createApiV1EventsRouter({
    database = db,
    accessTokenForTenant = getAccessToken,
    billing = defaultBilling,
    fetchImpl = globalThis.fetch,
    parseMetaResponse = readMetaResponse,
    logger = console,
    now = () => Date.now(),
    apiBase = META_API_BASE,
} = {}) {
    if (
        !database
        || typeof accessTokenForTenant !== 'function'
        || !billing
        || typeof fetchImpl !== 'function'
        || typeof parseMetaResponse !== 'function'
    ) {
        throw new TypeError('API v1 events router requires database, credentials, billing and fetch');
    }
    const router = express.Router();

    const tenantContext = (req, res) => {
        const tenantId = Number(req.tenantId);
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
            res.status(401).json({ error: 'Invalid tenant context' });
            return null;
        }
        const tenant = database.prepare(`
            SELECT id, name, status, dataset_id, waba_id
            FROM tenants
            WHERE id = ?
        `).get(tenantId);
        if (!tenant) {
            res.status(404).json({ error: 'Tenant not found' });
            return null;
        }
        if (tenant.status === 'Suspended') {
            res.status(403).json({ error: 'Tenant account is suspended' });
            return null;
        }
        if (!tenant.dataset_id) {
            res.status(400).json({ error: 'Dataset ID not configured for this tenant' });
            return null;
        }
        const accessToken = accessTokenForTenant(tenantId);
        if (!accessToken) {
            res.status(400).json({ error: 'WhatsApp API credentials not configured' });
            return null;
        }
        return {
            tenantId,
            tenant,
            datasetId: String(tenant.dataset_id),
            accessToken: String(accessToken),
        };
    };

    const normalizeEvents = (events, context, nowMs) => {
        if (!Array.isArray(events) || events.length === 0) {
            throw new InvalidWhatsAppMessageError('events array is required');
        }
        if (events.length > MAX_EVENTS_PER_REQUEST) {
            throw new InvalidWhatsAppMessageError(
                `events supports at most ${MAX_EVENTS_PER_REQUEST} items`,
            );
        }
        return events.map((event, index) => {
            if (!event || typeof event !== 'object' || Array.isArray(event)) {
                throw new InvalidWhatsAppMessageError(`events[${index}] is invalid`);
            }
            const phone = event.phone == null || event.phone === ''
                ? ''
                : normalizeWhatsAppRecipient(event.phone);
            const storedAttribution = getLatestCtwaAttribution(
                database,
                context.tenantId,
                phone,
            );
            const ctwaClid = normalizeOptionalText(
                normalizeCtwaClid(event.ctwa_clid) || storedAttribution?.last_ctwa_clid,
                `events[${index}].ctwa_clid`,
            );
            const eventTime = normalizeEventTime(event.event_time, nowMs);
            const customData = normalizeCustomData(event.custom_data);
            const eventName = normalizeOptionalText(event.event_name, `events[${index}].event_name`);
            const wamid = normalizeOptionalText(event.wamid, `events[${index}].wamid`);
            return {
                outbound: buildWhatsAppBusinessEvent({
                    eventName,
                    wabaId: context.tenant.waba_id,
                    ctwaClid,
                    customData,
                    eventTime,
                }),
                eventName,
                eventTime,
                phone,
                wamid,
                customData,
                ctwaClid,
            };
        });
    };

    const persistEvents = ({ context, events, metaResult, storedMetaResponse }) => {
        const insert = database.prepare(`
            INSERT INTO conversion_events (
                tenant_id, dataset_id, event_name, event_time, phone, wamid,
                custom_data, status, meta_response, ctwa_clid
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const store = database.transaction(items => {
            for (const event of items) {
                insert.run(
                    context.tenantId,
                    context.datasetId,
                    event.eventName,
                    new Date(event.eventTime * 1000).toISOString(),
                    event.phone || null,
                    event.wamid || null,
                    Object.keys(event.customData).length > 0
                        ? JSON.stringify(event.customData)
                        : null,
                    metaResult.ok ? 'sent' : 'failed',
                    JSON.stringify(storedMetaResponse),
                    event.ctwaClid || null,
                );
            }
        });
        store(events);
    };

    router.post('/events', async (req, res) => {
        let reservation = null;
        let billingSettled = false;
        try {
            const context = tenantContext(req, res);
            if (!context) return undefined;
            const normalizedEvents = normalizeEvents(req.body?.events, context, now());
            reservation = billing.reserve({
                tenantId: context.tenantId,
                operationKey: billing.operations.WHATSAPP_EVENT_CONVERSION,
                quantity: normalizedEvents.length,
                referenceType: 'conversion_event',
                metadata: {
                    dataset_id: context.datasetId,
                    event_count: normalizedEvents.length,
                    api_version: 'v1',
                },
            });
            const response = await fetchImpl(
                `${apiBase}/${encodeURIComponent(context.datasetId)}/events`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${context.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ data: normalizedEvents.map(event => event.outbound) }),
                },
            );
            const metaResult = await parseMetaResponse(response);
            const data = metaResult.data || {};
            const eventsReceived = Number.isSafeInteger(data.events_received)
                && data.events_received >= 0
                ? data.events_received
                : normalizedEvents.length;
            const storedMetaResponse = metaResult.ok
                ? { events_received: eventsReceived, fbtrace_id: data.fbtrace_id || null }
                : { error: metaResult.error };
            const warnings = [];
            try {
                persistEvents({
                    context,
                    events: normalizedEvents,
                    metaResult,
                    storedMetaResponse,
                });
            } catch (error) {
                warnings.push('local_event_store_failed');
                logger.error('[ApiV1Events] Local event store failed:', error);
            }

            billingSettled = true;
            try {
                if (metaResult.ok) {
                    billing.commit(reservation, {
                        quantity: eventsReceived,
                        referenceId: data.fbtrace_id || null,
                        description: `خصم إرسال ${eventsReceived} حدث WhatsApp Events API عبر API`,
                    });
                } else {
                    billing.release(
                        reservation,
                        metaResult.error?.message || 'Meta conversion events failed',
                    );
                }
            } catch (error) {
                warnings.push(metaResult.ok ? 'billing_commit_failed' : 'billing_release_failed');
                logger.error('[ApiV1Events] Billing settlement failed:', error);
            }

            if (!metaResult.ok) {
                return sendMetaFailure(
                    res,
                    metaResult,
                    'Failed to send events',
                    warnings.length > 0 ? { warnings } : {},
                );
            }
            return res.json({
                success: true,
                events_received: eventsReceived,
                fbtrace_id: data.fbtrace_id,
                ...(warnings.length > 0 ? { warnings } : {}),
            });
        } catch (error) {
            if (reservation && !billingSettled) {
                billingSettled = true;
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    logger.error('[ApiV1Events] Billing release failed:', releaseError);
                }
            }
            if (error instanceof InvalidWhatsAppMessageError || error.statusCode === 400) {
                return res.status(400).json({
                    error: error.message,
                    supported_events: error.supportedEvents || SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
                });
            }
            if (billing.handleError(res, error)) return undefined;
            logger.error('[ApiV1Events] Send events error:', error);
            return res.status(500).json({ error: 'Failed to send conversion events' });
        }
    });

    router.get('/events/history', (req, res) => {
        try {
            const tenantId = Number(req.tenantId);
            if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
                return res.status(401).json({ error: 'Invalid tenant context' });
            }
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 50,
                maxLimit: 100,
            });
            const events = database.prepare(`
                SELECT id, tenant_id, dataset_id, event_name, event_time, phone,
                       wamid, custom_data, status, meta_response, ctwa_clid, created_at
                FROM conversion_events
                WHERE tenant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(tenantId, limit, offset).map(publicEvent);
            const total = database.prepare(`
                SELECT COUNT(*) AS count
                FROM conversion_events
                WHERE tenant_id = ?
            `).get(tenantId)?.count || 0;
            return res.json({ events, total, limit, offset });
        } catch (error) {
            logger.error('[ApiV1Events] Events history error:', error);
            return res.status(500).json({ error: 'Failed to get events history' });
        }
    });

    return router;
}

export default createApiV1EventsRouter;
