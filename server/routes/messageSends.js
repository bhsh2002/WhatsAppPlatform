import express from 'express';

import { META_API_BASE } from '../config/index.js';
import db from '../db/database.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';
import { resolveCredentials } from '../services/credentials.js';
import { getWhatsAppConversationWindow } from '../services/whatsappConversationWindow.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';
import {
    buildInteractivePayload,
    buildRichTemplateContent,
    normalizeTemplateComponents,
    parseTemplateShortcut,
} from '../services/messaging.js';
import {
    countTemplateBodyVariables,
    InvalidWhatsAppMessageError,
    normalizeInteractiveInput,
    normalizeMessageText,
    normalizeMessageType,
    normalizeTemplateLanguage,
    normalizeTemplateName,
    normalizeWhatsAppRecipient,
    parseAdminTenantId,
} from '../services/whatsappMessageValidation.js';

const MAX_TEMPLATE_COMPONENT_BYTES = 64 * 1024;

const defaultBilling = {
    operations: BILLING_OPERATIONS,
    reserve: reserveBilling,
    commit: commitBilling,
    release: releaseBilling,
    handleError: handleBillingError,
};

const normalizeTemplateParameters = raw => {
    if (raw != null && !Array.isArray(raw)) {
        throw new InvalidWhatsAppMessageError('templateParams must be an array');
    }
    const components = normalizeTemplateComponents(raw || []);
    if (components.length > 20 || Buffer.byteLength(JSON.stringify(components), 'utf8') > MAX_TEMPLATE_COMPONENT_BYTES) {
        throw new InvalidWhatsAppMessageError('templateParams are too large');
    }
    return components;
};

const sendValidationError = (res, error) => res.status(400).json({
    error: error.message,
    ...(error.details || {}),
});

export function createMessageSendsRouter({
    database = db,
    credentialResolver = resolveCredentials,
    requestMeta = requestMetaJson,
    billing = defaultBilling,
    now = () => Date.now(),
    apiBase = META_API_BASE,
} = {}) {
    const router = express.Router();

    const resolveContext = async body => {
        const requestedTenantId = parseAdminTenantId(body?.tenant_id);
        const credentials = await credentialResolver({
            tenantId: requestedTenantId,
            phoneNumberIdOverride: body?.phone_number_id,
            accessTokenOverride: body?.access_token,
        });
        if (requestedTenantId && !credentials?.tenant) {
            return { error: 'Tenant not found', status: 404 };
        }
        if (credentials?.isSuspended) {
            return { error: 'هذا العميل معلّق ولا يمكنه إرسال الرسائل', status: 403 };
        }
        if (!credentials?.phoneNumberId || !credentials?.accessToken) {
            return { error: 'Missing API credentials', status: 400 };
        }
        return {
            tenantId: credentials.tenant?.id || requestedTenantId || null,
            tenant: credentials.tenant || null,
            phoneNumberId: String(credentials.phoneNumberId),
            accessToken: String(credentials.accessToken),
        };
    };

    const persistOutcome = ({
        tenantId,
        tenant,
        phoneNumberId,
        recipient,
        messageType,
        content,
        metaResult,
        messageId,
        activityType,
        activityDescription,
    }) => {
        const warnings = [];
        try {
            database.prepare(`
                INSERT INTO messages (
                    tenant_id, direction, sender, recipient, message_type,
                    content, status, wamid, error_message
                ) VALUES (?, 'outgoing', ?, ?, ?, ?, ?, ?, ?)
            `).run(
                tenantId,
                phoneNumberId,
                recipient,
                messageType,
                content,
                metaResult.ok ? 'sent' : 'failed',
                messageId,
                metaResult.error?.message || null,
            );
        } catch (error) {
            warnings.push('local_message_store_failed');
            console.error('[MessageSends] Local message store failed:', error);
        }
        if (tenant) {
            try {
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, ?, ?, ?)
                `).run(
                    tenantId,
                    tenant.name,
                    activityType,
                    activityDescription,
                    metaResult.ok ? 'success' : 'error',
                );
            } catch (error) {
                warnings.push('activity_log_store_failed');
                console.error('[MessageSends] Activity log store failed:', error);
            }
        }
        return warnings;
    };

    router.post('/send', async (req, res) => {
        let reservation = null;
        let billingSettled = false;
        try {
            const body = req.body || {};
            const recipient = normalizeWhatsAppRecipient(body.recipient);
            const shortcut = parseTemplateShortcut(body.message);
            const rawTemplateName = body.templateName
                || body.template_name
                || body.template
                || shortcut?.name;
            const messageType = normalizeMessageType(body.type, Boolean(rawTemplateName));
            const context = await resolveContext(body);
            if (context.error) return res.status(context.status).json({ error: context.error });

            let payload;
            let storedContent;
            let template = null;
            let templateName = null;
            if (messageType === 'template') {
                templateName = normalizeTemplateName(rawTemplateName);
                const templateLanguage = normalizeTemplateLanguage(
                    body.templateLanguage || body.template_language || shortcut?.language,
                );
                const rawTemplateParams = body.templateParams
                    ?? body.template_params
                    ?? body.params
                    ?? shortcut?.params
                    ?? [];
                const templateParameters = normalizeTemplateParameters(rawTemplateParams);
                if (context.tenantId) {
                    template = database.prepare(`
                        SELECT id, tenant_id, name, language, category, header_type,
                               header_content, body, footer, buttons, variables
                        FROM templates
                        WHERE tenant_id = ? AND name = ?
                    `).get(context.tenantId, templateName) || null;
                }
                if (template) {
                    const expected = countTemplateBodyVariables(template.body);
                    const bodyComponent = templateParameters.find(
                        component => component?.type?.toLowerCase?.() === 'body',
                    );
                    const provided = bodyComponent?.parameters?.length || 0;
                    if (expected > 0 && provided !== expected) {
                        throw new InvalidWhatsAppMessageError(
                            `القالب يتطلب ${expected} متغيرات، تم تقديم ${provided}`,
                            { code: 'TEMPLATE_PARAM_MISMATCH', expected, provided },
                        );
                    }
                }
                payload = {
                    messaging_product: 'whatsapp',
                    to: recipient,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: templateLanguage },
                        ...(templateParameters.length > 0 ? { components: templateParameters } : {}),
                    },
                };
                storedContent = buildRichTemplateContent(template, templateParameters)
                    || `[Template: ${templateName}]`;
            } else {
                const message = normalizeMessageText(body.message, 'message', 4096);
                const window = getWhatsAppConversationWindow(
                    database,
                    context.tenantId,
                    recipient,
                    now(),
                );
                if (!window.isOpen) {
                    return res.status(400).json({
                        error: 'نافذة المحادثة (24 ساعة) مغلقة. يمكنك فقط إرسال قوالب معتمدة.',
                        code: 'OUTSIDE_WINDOW',
                        window_closed_at: window.closesAt,
                    });
                }
                payload = {
                    messaging_product: 'whatsapp',
                    to: recipient,
                    type: 'text',
                    text: { body: message },
                };
                storedContent = message;
            }

            reservation = billing.reserve({
                tenantId: context.tenantId,
                operationKey: messageType === 'template'
                    ? billing.operations.WHATSAPP_TEMPLATE
                    : billing.operations.WHATSAPP_TEXT,
                quantity: 1,
                referenceType: 'message',
                metadata: {
                    recipient,
                    message_type: messageType,
                    template_name: templateName,
                    template_category: template?.category || null,
                },
            });
            const metaResult = await requestMeta(
                `${apiBase}/${encodeURIComponent(context.phoneNumberId)}/messages`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${context.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                },
            );
            const messageId = metaResult.data?.messages?.[0]?.id || null;
            const warnings = persistOutcome({
                ...context,
                recipient,
                messageType,
                content: storedContent,
                metaResult,
                messageId,
                activityType: messageType === 'template' ? 'template_sent' : 'message_sent',
                activityDescription: messageType === 'template'
                    ? `إرسال قالب: ${templateName}`
                    : 'إرسال رسالة نصية',
            });

            if (metaResult.ok) {
                if (context.tenantId) {
                    billing.commit(reservation, {
                        referenceId: messageId,
                        description: messageType === 'template'
                            ? `خصم إرسال قالب WhatsApp: ${templateName}`
                            : 'خصم إرسال رسالة WhatsApp نصية',
                    });
                }
                billingSettled = true;
                return res.json({
                    success: true,
                    message_id: messageId,
                    data: metaResult.data || {},
                    ...(warnings.length > 0 ? { warnings } : {}),
                });
            }

            billing.release(reservation, metaResult.error?.message || 'Meta send failed');
            billingSettled = true;
            return sendMetaFailure(res, metaResult, 'Failed to send message',
                warnings.length > 0 ? { warnings } : {});
        } catch (error) {
            if (reservation && !billingSettled) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    console.error('[MessageSends] Billing release error:', releaseError);
                }
            }
            if (error instanceof InvalidWhatsAppMessageError) {
                return sendValidationError(res, error);
            }
            if (billing.handleError(res, error)) return undefined;
            console.error('[MessageSends] Send error:', error);
            return res.status(500).json({ error: 'Failed to send message' });
        }
    });

    router.post('/send-interactive', async (req, res) => {
        let reservation = null;
        let billingSettled = false;
        try {
            const input = normalizeInteractiveInput(req.body || {});
            const context = await resolveContext(req.body || {});
            if (context.error) return res.status(context.status).json({ error: context.error });
            const window = getWhatsAppConversationWindow(
                database,
                context.tenantId,
                input.recipient,
                now(),
            );
            if (!window.isOpen) {
                return res.status(400).json({
                    error: 'نافذة المحادثة (24 ساعة) مغلقة. يمكنك فقط إرسال قوالب معتمدة.',
                    code: 'OUTSIDE_WINDOW',
                    window_closed_at: window.closesAt,
                });
            }
            const interactive = buildInteractivePayload(input);
            const payload = {
                messaging_product: 'whatsapp',
                to: input.recipient,
                type: 'interactive',
                interactive,
            };
            reservation = billing.reserve({
                tenantId: context.tenantId,
                operationKey: billing.operations.WHATSAPP_INTERACTIVE,
                quantity: 1,
                referenceType: 'message',
                metadata: {
                    recipient: input.recipient,
                    interactive_type: input.interactiveType,
                },
            });
            const metaResult = await requestMeta(
                `${apiBase}/${encodeURIComponent(context.phoneNumberId)}/messages`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${context.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                },
            );
            const messageId = metaResult.data?.messages?.[0]?.id || null;
            const storedContent = JSON.stringify({
                type: input.interactiveType,
                body: input.bodyText,
                header: input.headerText,
                footer: input.footerText,
                ...(input.interactiveType === 'button' ? { buttons: input.buttons } : {
                    sections: input.sections,
                    list_button: input.listButtonText,
                }),
            });
            const warnings = persistOutcome({
                ...context,
                recipient: input.recipient,
                messageType: 'interactive',
                content: storedContent,
                metaResult,
                messageId,
                activityType: 'interactive_sent',
                activityDescription: `إرسال رسالة تفاعلية (${input.interactiveType})`,
            });

            if (metaResult.ok) {
                if (context.tenantId) {
                    billing.commit(reservation, {
                        referenceId: messageId,
                        description: `خصم إرسال رسالة WhatsApp تفاعلية (${input.interactiveType})`,
                    });
                }
                billingSettled = true;
                return res.json({
                    success: true,
                    message_id: messageId,
                    data: metaResult.data || {},
                    ...(warnings.length > 0 ? { warnings } : {}),
                });
            }

            billing.release(reservation, metaResult.error?.message || 'Meta interactive send failed');
            billingSettled = true;
            return sendMetaFailure(res, metaResult, 'Failed to send interactive message',
                warnings.length > 0 ? { warnings } : {});
        } catch (error) {
            if (reservation && !billingSettled) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    console.error('[MessageSends] Interactive billing release error:', releaseError);
                }
            }
            if (error instanceof InvalidWhatsAppMessageError) {
                return sendValidationError(res, error);
            }
            if (billing.handleError(res, error)) return undefined;
            console.error('[MessageSends] Interactive send error:', error);
            return res.status(500).json({ error: 'Failed to send interactive message' });
        }
    });

    return router;
}

export default createMessageSendsRouter();
