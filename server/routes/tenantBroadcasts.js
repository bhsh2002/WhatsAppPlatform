import express from 'express';

import { requestMetaJson } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';
import {
    BROADCAST_JOB_COLUMNS,
    createBroadcastProcessor,
    normalizeBroadcastRecipients,
    normalizeBroadcastString,
    parseBroadcastJobId,
} from '../services/broadcastProcessor.js';
import { resolveTenantWhatsAppContext } from '../services/whatsappNumbers.js';

export function createTenantBroadcastsRouter({
    database,
    accessTokenForTenant,
    requestMeta = requestMetaJson,
    billing,
    recordMessageCost,
    broadcast = () => undefined,
    schedule = setImmediate,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    if (
        !database
        || typeof accessTokenForTenant !== 'function'
        || !billing
        || typeof recordMessageCost !== 'function'
    ) {
        throw new TypeError('Tenant broadcasts router requires database, credentials and billing');
    }

    const router = express.Router();
    const processJob = createBroadcastProcessor({
        database,
        requestMeta,
        billing,
        recordMessageCost,
        broadcast,
        wait,
        includeGlobalContacts: false,
        channelForTenant: tenantId => `tenant:${tenantId}`,
        logPrefix: 'TenantBroadcasts',
    });

    router.post('/broadcast', async (req, res) => {
        let reservation = null;
        try {
            const tenantId = req.user.tenant_id;
            const recipients = normalizeBroadcastRecipients(req.body?.recipients, { maxRecipients: 100 });
            const templateName = normalizeBroadcastString(req.body?.template_name, 512);
            const templateLanguage = req.body?.template_language == null
                ? 'ar'
                : normalizeBroadcastString(req.body.template_language, 32);
            if (!recipients) {
                return res.status(400).json({
                    error: 'قائمة المستلمين مطلوبة وبحد أقصى 100 رقم صالح',
                });
            }
            if (!templateName) return res.status(400).json({ error: 'اسم القالب مطلوب' });
            if (!templateLanguage || !/^[A-Za-z_-]{2,32}$/.test(templateLanguage)) {
                return res.status(400).json({ error: 'لغة القالب غير صالحة' });
            }

            const context = resolveTenantWhatsAppContext({
                database,
                tenantId,
                request: req,
                accessTokenForTenant,
            });
            if (context.error) {
                return res.status(context.status).json({ error: context.error, code: context.code });
            }
            const { tenant, phoneNumberId, accessToken } = context;
            const template = database.prepare(`
                SELECT id, tenant_id, name, language, category, header_type,
                       header_content, body, footer, buttons, variables
                FROM templates
                WHERE tenant_id = ? AND name = ?
            `).get(tenantId, templateName);
            if (!template) return res.status(400).json({ error: 'القالب غير موجود' });

            const localBilling = billing.resolveLocalQuantity({
                tenantId,
                operationKey: billing.operations.WHATSAPP_BROADCAST_RECIPIENT,
                recipients,
                templateName,
                templateCategory: template.category || null,
                fallbackQuantity: recipients.length,
            });
            reservation = billing.reserve({
                tenantId,
                operationKey: billing.operations.WHATSAPP_BROADCAST_RECIPIENT,
                quantity: recipients.length,
                referenceType: 'broadcast',
                metadata: {
                    template_name: templateName,
                    template_category: template.category || null,
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
            `).run(tenantId, templateName, templateLanguage, recipients.length).lastInsertRowid;
            res.status(202).json({ job_id: jobId, status: 'pending', total: recipients.length });
            schedule(() => processJob(jobId, {
                tenantId,
                recipients,
                templateName,
                templateLanguage,
                templateParams: req.body?.template_params,
                variableMapping: Array.isArray(req.body?.variable_mapping) ? req.body.variable_mapping : [],
                phoneNumberId,
                accessToken,
                tenantName: tenant.name,
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
                    console.error('[TenantBroadcasts] Billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, error)) return undefined;
            console.error('[TenantBroadcasts] Broadcast error:', error);
            return res.status(500).json({ error: 'فشل البث' });
        }
    });

    router.get('/broadcast-jobs', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 20,
                maxLimit: 100,
            });
            const jobs = database.prepare(`
                SELECT ${BROADCAST_JOB_COLUMNS}
                FROM broadcast_jobs
                WHERE tenant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(tenantId, limit, offset);
            const total = database.prepare(`
                SELECT COUNT(*) AS count FROM broadcast_jobs WHERE tenant_id = ?
            `).get(tenantId).count;
            return res.json({ jobs, total });
        } catch (error) {
            console.error('[TenantBroadcasts] Jobs fetch error:', error);
            return res.status(500).json({ error: 'فشل جلب وظائف البث' });
        }
    });

    router.get('/broadcast-jobs/:id', (req, res) => {
        try {
            const jobId = parseBroadcastJobId(req.params.id);
            if (!jobId) return res.status(400).json({ error: 'معرّف الوظيفة غير صالح' });
            const job = database.prepare(`
                SELECT ${BROADCAST_JOB_COLUMNS}
                FROM broadcast_jobs
                WHERE id = ? AND tenant_id = ?
            `).get(jobId, req.user.tenant_id);
            if (!job) return res.status(404).json({ error: 'الوظيفة غير موجودة' });
            return res.json(job);
        } catch (error) {
            console.error('[TenantBroadcasts] Job fetch error:', error);
            return res.status(500).json({ error: 'فشل جلب وظيفة البث' });
        }
    });

    return router;
}

export default createTenantBroadcastsRouter;
