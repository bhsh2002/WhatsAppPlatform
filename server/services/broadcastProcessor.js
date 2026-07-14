import { META_API_BASE } from '../config/index.js';
import {
    buildRichTemplateContent,
    buildTemplateComponentsFromMapping,
} from './messaging.js';

export const BROADCAST_JOB_COLUMNS = `
    id, tenant_id, status, template_name, template_language,
    total_recipients, sent_count, failed_count, progress_pct,
    results, error, created_at, completed_at
`;

export const parseBroadcastJobId = value => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim()
        ? parsed
        : null;
};

export const normalizeBroadcastRecipients = (value, { maxRecipients }) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > maxRecipients) return null;
    const normalized = value.map(recipient => (
        typeof recipient === 'string'
            ? recipient.replace(/\+/g, '').replace(/\s/g, '').trim()
            : ''
    ));
    if (normalized.some(recipient => !/^\d{5,20}$/.test(recipient))) return null;
    return [...new Set(normalized)];
};

export const normalizeBroadcastString = (value, maxLength) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : null;
};

export function createBroadcastProcessor({
    database,
    requestMeta,
    billing,
    recordMessageCost,
    broadcast = () => undefined,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    includeGlobalContacts = false,
    channelForTenant = tenantId => `tenant:${tenantId}`,
    apiBase = META_API_BASE,
    logPrefix = 'Broadcasts',
} = {}) {
    if (
        !database
        || typeof requestMeta !== 'function'
        || !billing
        || typeof recordMessageCost !== 'function'
    ) {
        throw new TypeError('Broadcast processor requires database, Meta, billing and cost dependencies');
    }

    const findContact = (recipient, tenantId) => {
        if (!tenantId) {
            return includeGlobalContacts
                ? database.prepare(`
                    SELECT phone, profile_name, label, notes
                    FROM contacts
                    WHERE phone = ? AND tenant_id IS NULL
                    LIMIT 1
                `).get(recipient)
                : null;
        }
        if (includeGlobalContacts) {
            return database.prepare(`
                SELECT phone, profile_name, label, notes
                FROM contacts
                WHERE phone = ? AND (tenant_id = ? OR tenant_id IS NULL)
                ORDER BY tenant_id DESC
                LIMIT 1
            `).get(recipient, tenantId);
        }
        return database.prepare(`
            SELECT phone, profile_name, label, notes
            FROM contacts
            WHERE phone = ? AND tenant_id = ?
            LIMIT 1
        `).get(recipient, tenantId);
    };

    return async function processBroadcastJob(jobId, params) {
        const {
            tenantId,
            recipients,
            templateName,
            templateLanguage,
            templateParams,
            variableMapping,
            phoneNumberId,
            accessToken,
            tenantName,
            billingReservation,
            localBillingModel,
            template,
        } = params;

        try {
            database.prepare(`
                UPDATE broadcast_jobs SET status = 'running'
                WHERE id = ? AND tenant_id IS ?
            `).run(jobId, tenantId);
            const results = [];
            let sent = 0;
            let failed = 0;
            const batchSize = 5;

            for (let index = 0; index < recipients.length; index += batchSize) {
                const batch = recipients.slice(index, index + batchSize);
                const batchResults = await Promise.all(batch.map(async recipient => {
                    try {
                        const payload = {
                            messaging_product: 'whatsapp',
                            to: recipient,
                            type: 'template',
                            template: {
                                name: templateName,
                                language: { code: templateLanguage },
                            },
                        };
                        const contact = variableMapping.length > 0
                            ? findContact(recipient, tenantId)
                            : null;
                        const components = buildTemplateComponentsFromMapping(
                            variableMapping,
                            templateParams,
                            contact,
                            recipient,
                        );
                        if (components.length > 0) payload.template.components = components;

                        const metaResult = await requestMeta(
                            `${apiBase}/${encodeURIComponent(phoneNumberId)}/messages`,
                            {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify(payload),
                            },
                        );
                        if (!metaResult.ok) {
                            return {
                                recipient,
                                status: 'failed',
                                error: metaResult.error?.message || 'فشل إرسال رسالة البث',
                            };
                        }

                        const messageId = metaResult.data?.messages?.[0]?.id || null;
                        const storedContent = buildRichTemplateContent(
                            template,
                            payload.template.components || [],
                        ) || `[قالب: ${templateName}]`;
                        const warnings = [];
                        try {
                            database.prepare(`
                                INSERT INTO messages (
                                    tenant_id, direction, sender, recipient,
                                    message_type, content, status, wamid
                                ) VALUES (?, 'outgoing', ?, ?, 'template', ?, 'sent', ?)
                            `).run(tenantId, phoneNumberId, recipient, storedContent, messageId);
                        } catch (error) {
                            warnings.push('local_message_store_failed');
                            console.error(`[${logPrefix}] Local message store failed:`, error);
                        }
                        try {
                            recordMessageCost({
                                tenantId,
                                broadcastJobId: jobId,
                                wamid: messageId,
                                recipient,
                                operationKey: billing.operations.WHATSAPP_BROADCAST_RECIPIENT,
                                messageType: 'template',
                                templateName,
                                templateCategory: template?.category || null,
                                metadata: {
                                    template_name: templateName,
                                    template_category: template?.category || null,
                                    recipient,
                                    broadcast_job_id: jobId,
                                },
                            });
                        } catch (error) {
                            warnings.push('meta_cost_record_failed');
                            console.error(`[${logPrefix}] Meta cost record failed:`, error);
                        }
                        return {
                            recipient,
                            status: 'sent',
                            message_id: messageId,
                            ...(warnings.length > 0 ? { warnings } : {}),
                        };
                    } catch (error) {
                        return { recipient, status: 'failed', error: error.message };
                    }
                }));
                results.push(...batchResults);
                sent += batchResults.filter(result => result.status === 'sent').length;
                failed += batchResults.filter(result => result.status === 'failed').length;
                const progress = Math.round(((index + batch.length) / recipients.length) * 100);
                database.prepare(`
                    UPDATE broadcast_jobs
                    SET sent_count = ?, failed_count = ?, progress_pct = ?
                    WHERE id = ? AND tenant_id IS ?
                `).run(sent, failed, progress, jobId, tenantId);
                broadcast(channelForTenant(tenantId), 'broadcast:progress', {
                    job_id: jobId,
                    progress_pct: progress,
                    sent_count: sent,
                    failed_count: failed,
                });
                if (index + batchSize < recipients.length) await wait(200);
            }

            if (billingReservation) {
                if (sent === 0) {
                    billing.release(billingReservation, 'No successful broadcast recipients');
                } else {
                    const successfulRecipients = results
                        .filter(result => result.status === 'sent')
                        .map(result => result.recipient);
                    if (localBillingModel === 'meta_cost_plus_credits') {
                        billing.deferUntilStatuses(billingReservation, {
                            jobId,
                            quantity: sent,
                            metadata: {
                                template_name: templateName,
                                template_category: template?.category || null,
                                recipient_country_counts: billing.summarizeCountries(successfulRecipients),
                            },
                        });
                    } else {
                        const successfulBilling = localBillingModel === 'meta_like'
                            ? billing.resolveLocalQuantity({
                                tenantId,
                                operationKey: billing.operations.WHATSAPP_BROADCAST_RECIPIENT,
                                recipients: successfulRecipients,
                                templateName,
                                templateCategory: template?.category || null,
                                fallbackQuantity: sent,
                            })
                            : { quantity: sent, summary: null };
                        billing.commit(billingReservation, {
                            quantity: successfulBilling.quantity,
                            referenceId: String(jobId),
                            description: `خصم بث WhatsApp: ${templateName} (${successfulBilling.quantity} من ${sent} مستلم قابل للفوترة محليا)`,
                            meta: {
                                template_name: templateName,
                                template_category: template?.category || null,
                                recipient_country_counts: billing.summarizeCountries(successfulRecipients),
                                meta_like_billable_quantity: successfulBilling.quantity,
                                meta_like_summary: successfulBilling.summary,
                            },
                        });
                    }
                }
            }

            database.transaction(() => {
                if (tenantId && tenantName) {
                    database.prepare(`
                        INSERT INTO activity_logs (
                            tenant_id, tenant_name, event_type, description, status
                        ) VALUES (?, ?, 'broadcast', ?, ?)
                    `).run(
                        tenantId,
                        tenantName,
                        `بث ${templateName} إلى ${recipients.length} مستلم (${sent} نجاح، ${failed} فشل)`,
                        failed === 0 ? 'success' : 'partial',
                    );
                }
                database.prepare(`
                    UPDATE broadcast_jobs
                    SET status = 'completed', sent_count = ?, failed_count = ?,
                        progress_pct = 100, results = ?,
                        completed_at = datetime('now', 'localtime')
                    WHERE id = ? AND tenant_id IS ?
                `).run(sent, failed, JSON.stringify(results), jobId, tenantId);
            })();
            broadcast(channelForTenant(tenantId), 'broadcast:complete', { job_id: jobId, sent, failed });
        } catch (error) {
            console.error(`[${logPrefix}] Broadcast job error:`, error);
            if (billingReservation) {
                try {
                    billing.release(billingReservation, error.message);
                } catch (releaseError) {
                    console.error(`[${logPrefix}] Billing release error:`, releaseError);
                }
            }
            database.prepare(`
                UPDATE broadcast_jobs
                SET status = 'failed', error = ?, completed_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id IS ?
            `).run(error.message, jobId, tenantId);
            broadcast(channelForTenant(tenantId), 'broadcast:complete', {
                job_id: jobId,
                sent: 0,
                failed: 0,
                error: error.message,
            });
        }
    };
}
