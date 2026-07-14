import express from 'express';

import { META_API_BASE } from '../config/index.js';
import {
    buildInteractivePayload,
    buildRichTemplateContent,
    enrichTemplateFallbackMessages,
    normalizeTemplateComponents,
    parseTemplateShortcut,
} from '../services/messaging.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';
import { getWhatsAppConversationWindow } from '../services/whatsappConversationWindow.js';
import {
    InvalidWhatsAppMessageError,
    normalizeInteractiveInput,
} from '../services/whatsappMessageValidation.js';
import { createTenantWhatsAppMediaRouter } from './tenantWhatsAppMedia.js';

const normalizeString = (value, maxLength) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : null;
};

const normalizeRecipient = value => {
    const normalized = normalizeString(value, 64)?.replace(/\+/g, '').replace(/\s/g, '');
    return normalized && /^\d{5,20}$/.test(normalized) ? normalized : null;
};

export function createTenantWhatsAppMessagingRouter({
    database,
    accessTokenForTenant,
    billing,
    emitNewMessage = () => undefined,
    emitConversationUpdate = () => undefined,
    fetchImpl = globalThis.fetch,
} = {}) {
    if (!database || typeof accessTokenForTenant !== 'function' || !billing || typeof fetchImpl !== 'function') {
        throw new TypeError('Tenant WhatsApp messaging router requires database, credentials, billing and fetch');
    }
    const db = database;
    const getAccessToken = accessTokenForTenant;
    const reserveBilling = billing.reserve;
    const commitBilling = billing.commit;
    const releaseBilling = billing.release;
    const handleBillingError = billing.handleError;
    const BILLING_OPERATIONS = billing.operations;
    const fetch = fetchImpl;
    const eventBus = { emitNewMessage, emitConversationUpdate };
    const router = express.Router();

// Conversations
// ============================================
router.get('/conversations', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { limit, offset } = parseListPagination(req.query, { defaultLimit: 100 });

        const conversations = enrichTemplateFallbackMessages(db.prepare(`
            SELECT
                t.contact,
                t.created_at as last_interaction,
                t.content as last_message,
                t.message_type as last_message_type,
                c.profile_name,
                c.profile_picture_url,
                c.last_ctwa_clid,
                c.last_ctwa_source_id,
                c.last_ctwa_source_type,
                c.last_ctwa_source_url,
                c.last_ctwa_received_at,
                (
                    SELECT COUNT(*)
                    FROM messages m2
                    WHERE m2.sender = t.contact
                    AND m2.direction = 'incoming'
                    AND m2.status = 'received'
                    AND m2.tenant_id = ?
                ) as unread_count
            FROM (
                SELECT
                    id,
                    content,
                    created_at,
                    message_type,
                    tenant_id,
                    CASE
                        WHEN direction = 'incoming' THEN sender
                        ELSE recipient
                    END as contact,
                    ROW_NUMBER() OVER (
                        PARTITION BY (
                            CASE
                                WHEN direction = 'incoming' THEN sender
                                ELSE recipient
                            END
                        )
                        ORDER BY created_at DESC, id DESC
                    ) as rn
                FROM messages
                WHERE tenant_id = ?
            ) t
            LEFT JOIN contacts c ON c.phone = t.contact AND c.tenant_id = t.tenant_id
            WHERE rn = 1
            ORDER BY last_interaction DESC
            LIMIT ? OFFSET ?
        `).all(tenantId, tenantId, limit, offset), 'last_message', db);

        res.json(conversations);
    } catch (error) {
        console.error('[TenantPortal] Conversations error:', error);
        res.status(500).json({ error: 'فشل جلب المحادثات' });
    }
});

// Get messages for a specific conversation
router.get('/conversations/:phone/messages', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const contactPhone = normalizeRecipient(req.params.phone);
        if (!contactPhone) return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
        const { limit, offset } = parseListPagination(req.query, { defaultLimit: 100 });

        const messages = enrichTemplateFallbackMessages(db.prepare(`
            SELECT * FROM (
                SELECT
                    id, tenant_id, direction, recipient, sender, message_type,
                    content, status, wamid, error_message, media_id, media_url,
                    media_mime_type, referral_ctwa_clid, referral_source_id,
                    referral_source_type, referral_source_url, created_at
                FROM messages
                WHERE tenant_id = ? AND (sender = ? OR recipient = ?)
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            ) ORDER BY created_at ASC, id ASC
        `).all(tenantId, contactPhone, contactPhone, limit, offset), 'content', db);

        // Mark incoming messages as read
        db.prepare(`
            UPDATE messages
            SET status = 'read'
            WHERE tenant_id = ? AND sender = ? AND direction = 'incoming' AND status = 'received'
        `).run(tenantId, contactPhone);

        res.json(messages);
    } catch (error) {
        console.error('[TenantPortal] Thread messages error:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل' });
    }
});

// ============================================
// Conversation Window Status
// ============================================
router.get('/messages/window/:phone', (req, res) => {
    const tenantId = req.user.tenant_id;
    const phone = normalizeRecipient(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
    const window = getWhatsAppConversationWindow(db, tenantId, phone);

    res.json({
        is_open: window.isOpen,
        last_customer_message_at: window.lastCustomerMessageAt,
        window_closes_at: window.closesAt,
    });
});

// ============================================
// Send Message
// ============================================
router.post('/messages/send', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { type, templateId } = req.body;
        const recipient = normalizeRecipient(req.body.recipient);
        const message = typeof req.body.message === 'string' ? req.body.message.trim() : req.body.message;
        const shortcut = parseTemplateShortcut(req.body.message);
        const templateName = req.body.templateName || req.body.template_name || req.body.template || shortcut?.name;
        const rawTemplateComponents = req.body.components
            ?? req.body.templateParams
            ?? req.body.template_params
            ?? req.body.params
            ?? shortcut?.params
            ?? [];
        const normalizedTemplateComponents = normalizeTemplateComponents(rawTemplateComponents);
        if (type && !['text', 'template'].includes(type)) {
            return res.status(400).json({ error: 'نوع الرسالة غير صالح' });
        }
        const effectiveType = (type === 'template' || templateId || templateName) ? 'template' : 'text';

        if (!recipient) {
            return res.status(400).json({ error: 'رقم المستلم مطلوب' });
        }

        // Get tenant credentials
        const tenant = db.prepare(`
            SELECT id, name, phone_number_id, status FROM tenants WHERE id = ?
        `).get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = getAccessToken(tenantId);

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        if (tenant.status === 'Suspended') {
            return res.status(403).json({ error: 'حسابك معلّق ولا يمكنك إرسال الرسائل. تواصل مع المدير.' });
        }

        if (effectiveType !== 'template' && !normalizeString(message, 4096)) {
            return res.status(400).json({ error: 'نص الرسالة مطلوب وبحد أقصى 4096 حرفًا' });
        }

        // 24h conversation window enforcement (non-template messages only)
        if (effectiveType !== 'template') {
            const window = getWhatsAppConversationWindow(db, tenantId, recipient);
            if (!window.isOpen) {
                return res.status(400).json({
                    error: 'نافذة المحادثة (24 ساعة) مغلقة. يمكنك فقط إرسال قوالب معتمدة.',
                    code: 'OUTSIDE_WINDOW',
                    window_closed_at: window.closesAt,
                    hint: 'استخدم قالب رسالة معتمد لإعادة فتح المحادثة',
                });
            }
        }

        let payload = {
            messaging_product: 'whatsapp',
            to: recipient,
        };

        let selectedTemplate = null;

        if (effectiveType === 'template') {
            // Get template from database
            selectedTemplate = templateId
                ? db.prepare(`
                    SELECT id, tenant_id, name, language, category, header_type,
                           header_content, body, footer, buttons, variables, status,
                           meta_template_id, quality_score, parameter_format
                    FROM templates WHERE id = ? AND tenant_id = ?
                `).get(templateId, tenantId)
                : db.prepare(`
                    SELECT id, tenant_id, name, language, category, header_type,
                           header_content, body, footer, buttons, variables, status,
                           meta_template_id, quality_score, parameter_format
                    FROM templates WHERE name = ? AND tenant_id = ?
                `).get(templateName, tenantId);

            if (!selectedTemplate) {
                return res.status(404).json({ error: 'القالب غير موجود' });
            }

            payload.type = 'template';
            payload.template = {
                name: selectedTemplate.name,
                language: { code: selectedTemplate.language || 'ar' },
            };

            // Validate template variable count
            const placeholders = (selectedTemplate.body || '').match(/\{\{\d+\}\}/g) || [];
            const expectedCount = placeholders.length;

            let providedParams = [];
            if (normalizedTemplateComponents.length > 0) {
                const bodyComp = normalizedTemplateComponents.find(c => c.type === 'body' || c.type === 'BODY');
                providedParams = bodyComp?.parameters || [];
            } else if (selectedTemplate.variables) {
                try {
                    const variables = JSON.parse(selectedTemplate.variables);
                    providedParams = variables.body || [];
                } catch (e) { }
            }

            if (expectedCount > 0 && providedParams.length !== expectedCount) {
                return res.status(400).json({
                    error: `القالب يتطلب ${expectedCount} متغيرات، تم تقديم ${providedParams.length}`,
                    code: 'TEMPLATE_PARAM_MISMATCH',
                    expected: expectedCount,
                    provided: providedParams.length,
                });
            }

            // Add components if provided (from user input)
            if (normalizedTemplateComponents.length > 0) {
                payload.template.components = normalizedTemplateComponents;
            } else if (providedParams.length > 0) {
                payload.template.components = [{
                    type: 'body',
                    parameters: providedParams.map(v => typeof v === 'string' ? { type: 'text', text: v } : v)
                }];
            }
        } else {
            payload.type = 'text';
            payload.text = { body: message };
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: effectiveType === 'template' ? BILLING_OPERATIONS.WHATSAPP_TEMPLATE : BILLING_OPERATIONS.WHATSAPP_TEXT,
            quantity: 1,
            referenceType: 'message',
            metadata: {
                recipient,
                message_type: effectiveType,
                template_name: selectedTemplate?.name || templateName || null,
                template_category: selectedTemplate?.category || null,
            },
        });

        const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        let storedContent = message;
        if (effectiveType === 'template') {
            try {
                storedContent = buildRichTemplateContent(selectedTemplate, payload.template.components || normalizedTemplateComponents)
                    || `[قالب: ${selectedTemplate?.name || templateName || templateId}]`;
            } catch (e) {
                console.error('Failed to construct rich template content:', e);
                storedContent = `[قالب: ${selectedTemplate?.name || templateName || templateId}]`;
            }
        }

        // Save message to database
        const messageRecord = {
            tenant_id: tenantId,
            direction: 'outgoing',
            recipient: recipient,
            message_type: effectiveType,
            content: storedContent,
            status: metaResult.ok ? 'sent' : 'failed',
            wamid: data.messages?.[0]?.id || null,
            error_message: metaResult.error?.message || null,
        };

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
            phoneNumberId,
            messageRecord.recipient,
            messageRecord.message_type,
            messageRecord.content,
            messageRecord.status,
            messageRecord.wamid,
            messageRecord.error_message
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            tenantId,
            tenant.name,
            effectiveType === 'template' ? 'template_sent' : 'message_sent',
            effectiveType === 'template' ? `إرسال قالب: ${selectedTemplate?.name || templateName || templateId}` : 'إرسال رسالة نصية',
            metaResult.ok ? 'success' : 'error'
        );

        if (metaResult.ok) {
            commitBilling(billingReservation, {
                referenceId: data.messages?.[0]?.id || null,
                description: effectiveType === 'template'
                    ? `خصم إرسال قالب WhatsApp: ${selectedTemplate?.name || templateName || templateId}`
                    : 'خصم إرسال رسالة WhatsApp نصية',
            });

            // Emit SSE events for real-time UI update
            eventBus.emitNewMessage({
                tenant_id: tenantId,
                direction: 'outgoing',
                sender: phoneNumberId,
                recipient: messageRecord.recipient,
                message_type: messageRecord.message_type,
                content: messageRecord.content,
                wamid: data.messages?.[0]?.id,
                created_at: new Date().toISOString(),
            });
            eventBus.emitConversationUpdate(tenantId);

            res.json({ success: true, message_id: data.messages?.[0]?.id, data });
        } else {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta send failed');
            sendMetaFailure(res, metaResult, 'فشل إرسال الرسالة');
        }
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Send message error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة' });
    }
});

// ============================================
// Send Interactive Message
// ============================================
router.post('/messages/send-interactive', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const input = normalizeInteractiveInput(req.body || {});
        const {
            recipient,
            interactiveType: interactive_type,
            bodyText: body_text,
            headerText: header_text,
            footerText: footer_text,
            listButtonText: list_button_text,
            buttons,
            sections,
        } = input;

        // Get tenant credentials
        const tenant = db.prepare(`
            SELECT id, name, phone_number_id, status FROM tenants WHERE id = ?
        `).get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = getAccessToken(tenantId);

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        if (tenant.status === 'Suspended') {
            return res.status(403).json({ error: 'حسابك معلّق ولا يمكنك إرسال الرسائل. تواصل مع المدير.' });
        }

        const window = getWhatsAppConversationWindow(db, tenantId, recipient);
        if (!window.isOpen) {
            return res.status(400).json({
                error: 'نافذة المحادثة (24 ساعة) مغلقة. يمكنك فقط إرسال قوالب معتمدة.',
                code: 'OUTSIDE_WINDOW',
                window_closed_at: window.closesAt,
            });
        }

        // Build interactive payload using shared service
        const interactive = buildInteractivePayload({
            interactiveType: interactive_type,
            bodyText: body_text,
            headerText: header_text,
            footerText: footer_text,
            buttons: buttons,
            sections: sections,
            listButtonText: list_button_text,
        });

        const payload = {
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'interactive',
            interactive
        };

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
            quantity: 1,
            referenceType: 'message',
            metadata: { recipient, interactive_type },
        });

        const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (metaResult.ok) {
            commitBilling(billingReservation, {
                referenceId: data.messages?.[0]?.id || null,
                description: `خصم إرسال رسالة WhatsApp تفاعلية (${interactive_type})`,
            });
        } else {
            releaseBilling(billingReservation, metaResult.error?.message || 'Meta interactive send failed');
        }

        // Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, error_message)
            VALUES (?, 'outgoing', ?, ?, 'interactive', ?, ?, ?, ?)
        `).run(
            tenantId,
            phoneNumberId,
            recipient,
            JSON.stringify({ type: interactive_type, body: body_text, header: header_text, footer: footer_text, buttons: interactive_type === 'button' ? buttons : undefined, list_button: list_button_text }),
            metaResult.ok ? 'sent' : 'failed',
            data.messages?.[0]?.id || null,
            metaResult.error?.message || null
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'interactive_sent', ?, ?)
        `).run(tenantId, tenant.name, `إرسال رسالة تفاعلية (${interactive_type})`, metaResult.ok ? 'success' : 'error');

        if (metaResult.ok) {
            // Emit SSE events for real-time UI update
            eventBus.emitNewMessage({
                tenant_id: tenantId,
                direction: 'outgoing',
                sender: phoneNumberId,
                recipient: recipient,
                message_type: 'interactive',
                content: JSON.stringify({ type: interactive_type, body: body_text }),
                wamid: data.messages?.[0]?.id,
                created_at: new Date().toISOString(),
            });
            eventBus.emitConversationUpdate(tenantId);

            res.json({ success: true, message_id: data.messages?.[0]?.id, data });
        } else {
            sendMetaFailure(res, metaResult, 'فشل إرسال الرسالة التفاعلية');
        }
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Interactive billing release error:', releaseError);
            }
        }
        if (error instanceof InvalidWhatsAppMessageError) {
            return res.status(400).json({ error: error.message });
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Send interactive error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة التفاعلية' });
    }
});

// ============================================
    router.use(createTenantWhatsAppMediaRouter({
        database: db,
        accessTokenForTenant: getAccessToken,
        billing,
        emitNewMessage,
        emitConversationUpdate,
        fetchImpl: fetch,
    }));

    return router;
}

export default createTenantWhatsAppMessagingRouter;
