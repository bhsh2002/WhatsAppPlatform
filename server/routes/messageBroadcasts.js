import express from 'express';
import db from '../db/database.js';
import eventBus from '../services/eventBus.js';
import { resolveCredentials } from '../services/credentials.js';
import { requestMetaJson } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    deferBroadcastReservationUntilStatuses,
    handleBillingError,
    recordMetaMessageCost,
    release as releaseBilling,
    resolveLocalBillableQuantity,
    reserve as reserveBilling,
    summarizeMetaRecipientCountries,
} from '../services/billing.js';
import {
    BROADCAST_JOB_COLUMNS,
    createBroadcastProcessor,
    normalizeBroadcastRecipients,
    normalizeBroadcastString,
    parseBroadcastJobId,
} from '../services/broadcastProcessor.js';

const defaultBilling = {
    operations: BILLING_OPERATIONS,
    reserve: reserveBilling,
    commit: commitBilling,
    release: releaseBilling,
    handleError: handleBillingError,
    deferUntilStatuses: deferBroadcastReservationUntilStatuses,
    resolveLocalQuantity: resolveLocalBillableQuantity,
    summarizeCountries: summarizeMetaRecipientCountries,
};

export function createMessageBroadcastsRouter({
    database = db,
    credentialResolver = resolveCredentials,
    requestMeta = requestMetaJson,
    billing = defaultBilling,
    recordMessageCost = recordMetaMessageCost,
    broadcast = (channel, event, data) => eventBus.broadcast(channel, event, data),
    schedule = setImmediate,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    const router = express.Router();
    const processJob = createBroadcastProcessor({
        database,
        requestMeta,
        billing,
        recordMessageCost,
        broadcast,
        wait,
        includeGlobalContacts: true,
        channelForTenant: () => 'admin',
        logPrefix: 'Messages',
    });

    router.post('/broadcast', async (req, res) => {
        let reservation = null;
        try {
            const recipients = normalizeBroadcastRecipients(req.body?.recipients, { maxRecipients: 500 });
            const templateName = normalizeBroadcastString(req.body?.template_name, 512);
            const templateLanguage = req.body?.template_language == null
                ? 'ar'
                : normalizeBroadcastString(req.body.template_language, 32);
            if (!recipients) {
                return res.status(400).json({
                    error: 'recipients array is required with at most 500 valid numbers',
                });
            }
            if (!templateName) {
                return res.status(400).json({
                    error: 'template_name is required (broadcasts must use templates)',
                });
            }
            if (!templateLanguage || !/^[A-Za-z_-]{2,32}$/.test(templateLanguage)) {
                return res.status(400).json({ error: 'template_language is invalid' });
            }

            const tenantId = req.body?.tenant_id == null || req.body.tenant_id === ''
                ? null
                : parseBroadcastJobId(req.body.tenant_id);
            if (req.body?.tenant_id != null && req.body.tenant_id !== '' && !tenantId) {
                return res.status(400).json({ error: 'tenant_id is invalid' });
            }
            const credentials = await credentialResolver({
                tenantId,
                phoneNumberIdOverride: req.body?.phone_number_id,
                accessTokenOverride: req.body?.access_token,
            });
            if (tenantId && !credentials?.tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            if (credentials?.isSuspended) {
                return res.status(403).json({ error: 'Tenant is suspended' });
            }
            if (!credentials?.phoneNumberId || !credentials?.accessToken) {
                return res.status(400).json({ error: 'Missing API credentials' });
            }

            const effectiveTenantId = credentials.tenant?.id || tenantId || null;
            const template = effectiveTenantId
                ? database.prepare(`
                    SELECT id, tenant_id, name, language, category, header_type,
                           header_content, body, footer, buttons, variables
                    FROM templates
                    WHERE tenant_id = ? AND name = ?
                `).get(effectiveTenantId, templateName)
                : null;
            const localBilling = billing.resolveLocalQuantity({
                tenantId: effectiveTenantId,
                operationKey: billing.operations.WHATSAPP_BROADCAST_RECIPIENT,
                recipients,
                templateName,
                templateCategory: template?.category || null,
                fallbackQuantity: recipients.length,
            });
            reservation = billing.reserve({
                tenantId: effectiveTenantId,
                operationKey: billing.operations.WHATSAPP_BROADCAST_RECIPIENT,
                quantity: recipients.length,
                referenceType: 'broadcast',
                metadata: {
                    template_name: templateName,
                    template_category: template?.category || null,
                    recipient_count: recipients.length,
                    meta_like_billable_quantity: localBilling.quantity,
                    meta_like_summary: localBilling.summary,
                    recipient_country_counts: billing.summarizeCountries(recipients),
                },
            });
            const jobId = database.prepare(`
                INSERT INTO broadcast_jobs (
                    tenant_id, status, template_name, template_language, total_recipients
                ) VALUES (?, 'pending', ?, ?, ?)
            `).run(
                effectiveTenantId,
                templateName,
                templateLanguage,
                recipients.length,
            ).lastInsertRowid;

            res.status(202).json({ job_id: jobId, status: 'pending', total: recipients.length });
            schedule(() => processJob(jobId, {
                tenantId: effectiveTenantId,
                recipients,
                templateName,
                templateLanguage,
                templateParams: req.body?.template_params,
                variableMapping: Array.isArray(req.body?.variable_mapping) ? req.body.variable_mapping : [],
                phoneNumberId: credentials.phoneNumberId,
                accessToken: credentials.accessToken,
                tenantName: credentials.tenant?.name || null,
                billingReservation: reservation,
                localBillingModel: localBilling.pricing_model,
                template,
            }));
            return undefined;
        } catch (error) {
            if (reservation) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    console.error('[Messages] Broadcast billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, error)) return undefined;
            console.error('[Messages] Broadcast error:', error);
            return res.status(500).json({ error: 'Failed to broadcast' });
        }
    });

    router.get('/broadcast-jobs', (req, res) => {
        try {
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 20,
                maxLimit: 100,
            });
            const jobs = database.prepare(`
                SELECT ${BROADCAST_JOB_COLUMNS}
                FROM broadcast_jobs
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(limit, offset);
            const total = database.prepare('SELECT COUNT(*) AS count FROM broadcast_jobs').get().count;
            return res.json({ jobs, total });
        } catch (error) {
            console.error('[Messages] Broadcast jobs fetch error:', error);
            return res.status(500).json({ error: 'Failed to fetch broadcast jobs' });
        }
    });

    router.get('/broadcast-jobs/:id', (req, res) => {
        try {
            const jobId = parseBroadcastJobId(req.params.id);
            if (!jobId) return res.status(400).json({ error: 'Invalid job id' });
            const job = database.prepare(`
                SELECT ${BROADCAST_JOB_COLUMNS}
                FROM broadcast_jobs
                WHERE id = ?
            `).get(jobId);
            if (!job) return res.status(404).json({ error: 'Job not found' });
            return res.json(job);
        } catch (error) {
            console.error('[Messages] Broadcast job fetch error:', error);
            return res.status(500).json({ error: 'Failed to fetch broadcast job' });
        }
    });

    return router;
}

export default createMessageBroadcastsRouter();
