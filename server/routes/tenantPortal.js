import express from 'express';
import db, { generateApiKey } from '../db/database.js';
import crypto from 'crypto';
import FormData from 'form-data';
import fs from 'fs';
import { Blob } from 'buffer';
import path from 'path';
import { fileURLToPath } from 'url';
import { META_API_BASE, META_APP_ID, META_APP_SECRET, FACEBOOK_REDIRECT_URI, WA_EMBEDDED_SIGNUP_CONFIG_ID, META_API_VERSION } from '../config/index.js';
import { documentUpload, mediaUpload, simpleUpload, uploadDir, cleanupFile } from '../config/upload.js';
import eventBus from '../services/eventBus.js';
import { decryptIfEncrypted, encrypt } from '../services/encryption.js';
import {
    buildRichTemplateContent,
    buildTemplateComponentsFromMapping,
    buildInteractivePayload,
    enrichTemplateFallbackMessages,
    normalizeTemplateComponents,
    parseTemplateShortcut,
    saveOutgoingMessage,
} from '../services/messaging.js';
import { getAccessToken } from '../services/credentials.js';
import { testRules } from '../services/autoResponder.js';
import {
    getTimestampMs,
    insertMessengerMessage,
    normalizeMessengerTimestamp,
    selectMessengerMessages,
} from '../services/messengerMessages.js';
import { normalizeFilename } from '../services/filenames.js';
import {
    FACEBOOK_OAUTH_SCOPES as FACEBOOK_REVIEW_SCOPES,
    FACEBOOK_WEBHOOK_FIELDS,
    buildMetaReviewReadiness,
    listMetaReviewSnapshots,
    saveMetaReviewSnapshot,
} from '../services/metaReadiness.js';
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
    getBillingSummary,
    getInvoices as getBillingInvoices,
    getLedger as getBillingLedger,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ============================================
// Middleware to ensure user is a tenant (has tenant_id)
// ============================================
const ensureTenant = (req, res, next) => {
    if (!req.user || !req.user.tenant_id) {
        return res.status(403).json({ error: 'صلاحية الوصول مقتصرة على العملاء فقط' });
    }
    const tenant = db.prepare('SELECT status FROM tenants WHERE id = ?').get(req.user.tenant_id);
    if (!tenant) {
        return res.status(404).json({ error: 'العميل غير موجود' });
    }
    if (tenant.status === 'Pending') {
        return res.status(403).json({ error: 'حسابك قيد المراجعة', code: 'ACCOUNT_PENDING' });
    }
    if (tenant.status === 'Rejected') {
        return res.status(403).json({ error: 'تم رفض حسابك', code: 'ACCOUNT_REJECTED' });
    }
    if (tenant.status === 'Suspended') {
        return res.status(403).json({ error: 'حسابك موقوف', code: 'ACCOUNT_SUSPENDED' });
    }
    next();
};

router.use(ensureTenant);

// ============================================
// Dashboard Stats
// ============================================
router.get('/dashboard', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        // Get tenant info
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const count = (sql, ...params) => db.prepare(sql).get(...params)?.count || 0;
        const scalar = (sql, ...params) => db.prepare(sql).get(...params)?.value || 0;

        const whatsappConversations = count(`
            SELECT COUNT(DISTINCT CASE WHEN direction = 'incoming' THEN sender ELSE recipient END) as count
            FROM messages
            WHERE tenant_id = ?
        `, tenantId);
        const messengerConversations = count(`
            SELECT COUNT(*) as count
            FROM fb_conversations
            WHERE tenant_id = ? AND is_active = 1
        `, tenantId);
        const whatsappMessagesToday = count(`
            SELECT COUNT(*) as count
            FROM messages
            WHERE tenant_id = ? AND date(created_at) = date('now', 'localtime')
        `, tenantId);
        const messengerMessagesToday = count(`
            SELECT COUNT(*) as count
            FROM fb_messages
            WHERE tenant_id = ? AND date(created_at) = date('now', 'localtime')
        `, tenantId);
        const whatsappSentToday = count(`
            SELECT COUNT(*) as count
            FROM messages
            WHERE tenant_id = ? AND direction = 'outgoing' AND date(created_at) = date('now', 'localtime')
        `, tenantId);
        const messengerSentToday = count(`
            SELECT COUNT(*) as count
            FROM fb_messages
            WHERE tenant_id = ? AND direction = 'outgoing' AND date(created_at) = date('now', 'localtime')
        `, tenantId);
        const whatsappReceivedToday = count(`
            SELECT COUNT(*) as count
            FROM messages
            WHERE tenant_id = ? AND direction = 'incoming' AND date(created_at) = date('now', 'localtime')
        `, tenantId);
        const messengerReceivedToday = count(`
            SELECT COUNT(*) as count
            FROM fb_messages
            WHERE tenant_id = ? AND direction = 'incoming' AND date(created_at) = date('now', 'localtime')
        `, tenantId);
        const whatsappUnread = count(`
            SELECT COUNT(*) as count
            FROM messages
            WHERE tenant_id = ? AND direction = 'incoming' AND status = 'received'
        `, tenantId);
        const messengerUnread = scalar(`
            SELECT COALESCE(SUM(unread_count), 0) as value
            FROM fb_conversations
            WHERE tenant_id = ? AND is_active = 1
        `, tenantId);
        const linkedFacebookPages = count(`
            SELECT COUNT(*) as count
            FROM tenant_pages
            WHERE tenant_id = ? AND is_active = 1
        `, tenantId);
        const facebookActionsWeek = count(`
            SELECT COUNT(*) as count
            FROM activity_logs
            WHERE tenant_id = ?
              AND event_type IN (
                  'fb_post_created',
                  'fb_post_edited',
                  'fb_post_deleted',
                  'fb_comment_replied',
                  'fb_comment_hidden',
                  'fb_comment_liked',
                  'fb_comment_unliked',
                  'fb_comment_deleted',
                  'page_linked',
                  'page_unlinked'
              )
              AND created_at >= datetime('now', '-7 days')
        `, tenantId);

        const stats = {
            totalConversations: whatsappConversations + messengerConversations,
            messagesToday: whatsappMessagesToday + messengerMessagesToday,
            sentToday: whatsappSentToday + messengerSentToday,
            receivedToday: whatsappReceivedToday + messengerReceivedToday,
            unreadCount: whatsappUnread + messengerUnread,
            templatesCount: count('SELECT COUNT(*) as count FROM templates WHERE tenant_id = ?', tenantId),
            whatsappConversations,
            whatsappMessagesToday,
            whatsappSentToday,
            whatsappReceivedToday,
            whatsappUnread,
            messengerConversations,
            messengerMessagesToday,
            messengerSentToday,
            messengerReceivedToday,
            messengerUnread,
            linkedFacebookPages,
            facebookActionsWeek,
        };

        // Get recent activity
        const recentActivity = db.prepare(`
            SELECT * FROM activity_logs 
            WHERE tenant_id = ? 
            ORDER BY created_at DESC 
            LIMIT 5
        `).all(tenantId);

        res.json({
            tenant: {
                id: tenant.id,
                name: tenant.name,
                phone: tenant.phone,
                status: tenant.status,
                quality: tenant.quality,
                tier: tenant.tier,
                credits: tenant.credits,
            },
            stats,
            recentActivity
        });
    } catch (error) {
        console.error('[TenantPortal] Dashboard error:', error);
        res.status(500).json({ error: 'فشل جلب البيانات' });
    }
});

// ============================================
// Billing Summary
// ============================================
router.get('/billing/summary', (req, res) => {
    try {
        const summary = getBillingSummary(req.user.tenant_id);
        res.json(summary);
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Billing summary error:', error);
        res.status(500).json({ error: 'فشل جلب بيانات الرصيد والفوترة' });
    }
});

router.get('/billing/ledger', (req, res) => {
    try {
        const ledger = getBillingLedger(req.user.tenant_id, {
            limit: req.query.limit || 10,
            offset: req.query.offset || 0,
            channel: req.query.channel || null,
            operation: req.query.operation || null,
        });
        res.json({ ledger });
    } catch (error) {
        console.error('[TenantPortal] Billing ledger error:', error);
        res.status(500).json({ error: 'فشل جلب سجل الرصيد' });
    }
});

router.get('/billing/invoices', (req, res) => {
    try {
        const invoices = getBillingInvoices(req.user.tenant_id, {
            limit: req.query.limit || 20,
            offset: req.query.offset || 0,
        });
        res.json({ invoices });
    } catch (error) {
        console.error('[TenantPortal] Billing invoices error:', error);
        res.status(500).json({ error: 'فشل جلب الفواتير' });
    }
});

// ============================================
// Conversations
// ============================================
router.get('/conversations', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

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
        `).all(tenantId, tenantId), 'last_message');

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
        const contactPhone = req.params.phone;

        const messages = enrichTemplateFallbackMessages(db.prepare(`
            SELECT * FROM messages 
            WHERE tenant_id = ? AND (sender = ? OR recipient = ?)
            ORDER BY created_at ASC
        `).all(tenantId, contactPhone, contactPhone));

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
// Contact Management (Tenant)
// ============================================
router.get('/contacts', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { search, label, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = ['c.tenant_id = ?'];
        let params = [tenantId];

        if (search) {
            where.push('(c.phone LIKE ? OR c.profile_name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (label) {
            where.push('c.label = ?');
            params.push(label);
        }

        const whereClause = `WHERE ${where.join(' AND ')}`;

        const contacts = db.prepare(`
            SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE
                    m.tenant_id = c.tenant_id AND (m.sender = c.phone OR m.recipient = c.phone)
                ) as message_count
            FROM contacts c
            ${whereClause}
            ORDER BY c.updated_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, parseInt(limit), offset);

        const total = db.prepare(`SELECT COUNT(*) as count FROM contacts c ${whereClause}`).get(...params);

        res.json({ contacts, total: total.count });
    } catch (error) {
        console.error('[TenantPortal] Contacts list error:', error);
        res.status(500).json({ error: 'فشل جلب جهات الاتصال' });
    }
});

router.put('/contacts/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { label, notes } = req.body;

        const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);
        if (!contact) {
            return res.status(404).json({ error: 'جهة الاتصال غير موجودة' });
        }

        db.prepare("UPDATE contacts SET label = COALESCE(?, label), notes = COALESCE(?, notes), updated_at = datetime('now', 'localtime') WHERE id = ?")
            .run(label, notes, req.params.id);

        const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        console.error('[TenantPortal] Contact update error:', error);
        res.status(500).json({ error: 'فشل تحديث جهة الاتصال' });
    }
});

// Create a new contact manually
router.post('/contacts', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { phone, profile_name, label, notes } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
        }

        // Format phone number (remove +, spaces, dashes — keep digits only)
        const formattedPhone = phone.replace(/[^0-9]/g, '').trim();

        if (formattedPhone.length < 7) {
            return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
        }

        // Check if contact already exists
        const existing = db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?')
            .get(tenantId, formattedPhone);

        if (existing) {
            return res.status(409).json({ error: 'جهة الاتصال موجودة بالفعل' });
        }

        const result = db.prepare(`
            INSERT INTO contacts (tenant_id, phone, profile_name, label, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).run(tenantId, formattedPhone, profile_name || null, label || null, notes || null);

        const newContact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json(newContact);
    } catch (error) {
        console.error('[TenantPortal] Contact create error:', error);
        res.status(500).json({ error: 'فشل إنشاء جهة الاتصال' });
    }
});

// Delete a contact
router.delete('/contacts/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);
        if (!contact) {
            return res.status(404).json({ error: 'جهة الاتصال غير موجودة' });
        }

        db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);

        res.json({ success: true, message: 'تم حذف جهة الاتصال' });
    } catch (error) {
        console.error('[TenantPortal] Contact delete error:', error);
        res.status(500).json({ error: 'فشل حذف جهة الاتصال' });
    }
});

// ============================================
// Conversation Window Status
// ============================================
router.get('/messages/window/:phone', (req, res) => {
    const tenantId = req.user.tenant_id;
    const phone = req.params.phone;
    const contact = db.prepare(
        'SELECT last_customer_message_at FROM contacts WHERE tenant_id = ? AND phone = ?'
    ).get(tenantId, phone);

    const lastMsg = contact?.last_customer_message_at ? new Date(contact.last_customer_message_at) : null;
    const windowMs = 24 * 60 * 60 * 1000;
    const isOpen = lastMsg && (Date.now() - lastMsg.getTime()) <= windowMs;

    res.json({
        is_open: isOpen,
        last_customer_message_at: lastMsg?.toISOString() || null,
        window_closes_at: lastMsg ? new Date(lastMsg.getTime() + windowMs).toISOString() : null,
    });
});

// ============================================
// Send Message
// ============================================
router.post('/messages/send', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { recipient, type, message, templateId } = req.body;
        const shortcut = parseTemplateShortcut(req.body.message);
        const templateName = req.body.templateName || req.body.template_name || req.body.template || shortcut?.name;
        const rawTemplateComponents = req.body.components
            ?? req.body.templateParams
            ?? req.body.template_params
            ?? req.body.params
            ?? shortcut?.params
            ?? [];
        const normalizedTemplateComponents = normalizeTemplateComponents(rawTemplateComponents);
        const effectiveType = (type === 'template' || templateId || templateName) ? 'template' : (type || 'text');

        if (!recipient) {
            return res.status(400).json({ error: 'رقم المستلم مطلوب' });
        }

        // Get tenant credentials
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = getAccessToken(tenantId);

        if (!phoneNumberId || !accessToken) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        if (tenant.status === 'Suspended') {
            if (file) fs.unlinkSync(file.path);
            return res.status(403).json({ error: 'حسابك معلّق ولا يمكنك إرسال الملفات. تواصل مع المدير.' });
        }

        // 24h conversation window enforcement (non-template messages only)
        if (effectiveType !== 'template') {
            const contact = db.prepare(
                'SELECT last_customer_message_at FROM contacts WHERE tenant_id = ? AND phone = ?'
            ).get(tenantId, recipient);

            const lastMsg = contact?.last_customer_message_at ? new Date(contact.last_customer_message_at) : null;
            const windowMs = 24 * 60 * 60 * 1000;

            if (!lastMsg || (Date.now() - lastMsg.getTime()) > windowMs) {
                return res.status(400).json({
                    error: 'نافذة المحادثة (24 ساعة) مغلقة. يمكنك فقط إرسال قوالب معتمدة.',
                    code: 'OUTSIDE_WINDOW',
                    window_closed_at: lastMsg ? new Date(lastMsg.getTime() + windowMs).toISOString() : null,
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
                ? db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?').get(templateId, tenantId)
                : db.prepare('SELECT * FROM templates WHERE name = ? AND tenant_id = ?').get(templateName, tenantId);

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

        console.log('[TenantPortal] Sending message:', JSON.stringify(payload, null, 2));

        billingReservation = reserveBilling({
            tenantId,
            operationKey: effectiveType === 'template' ? BILLING_OPERATIONS.WHATSAPP_TEMPLATE : BILLING_OPERATIONS.WHATSAPP_TEXT,
            quantity: 1,
            referenceType: 'message',
            metadata: { recipient, message_type: effectiveType },
        });

        const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

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
            status: response.ok ? 'sent' : 'failed',
            wamid: data.messages?.[0]?.id || null,
            error_message: data.error?.message || null,
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
            response.ok ? 'success' : 'error'
        );

        if (response.ok) {
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
            releaseBilling(billingReservation, data.error?.message || 'Meta send failed');
            res.status(response.status).json({ success: false, error: data.error?.message, data });
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
// Upload Media to Meta (Returns Media ID)
// ============================================
router.post('/media/upload-to-meta', mediaUpload.single('file'), async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ error: 'الملف مطلوب' });
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = getAccessToken(tenantId);

        if (!phoneNumberId || !accessToken) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const displayFilename = normalizeFilename(file.originalname, 'upload');
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.readFileSync(file.path), {
            filename: displayFilename,
            contentType: file.mimetype
        });

        const uploadUrl = `${META_API_BASE}/${phoneNumberId}/media`;
        const formBuffer = form.getBuffer();
        const formHeaders = form.getHeaders();

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...formHeaders
            },
            body: formBuffer
        });

        const uploadData = await uploadResponse.json();

        try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }

        if (!uploadResponse.ok) {
            console.error('[TenantPortal] Media Upload failed:', uploadResponse.status, uploadData);
            return res.status(400).json({
                error: 'فشل رفع الملف إلى WhatsApp',
                details: uploadData.error?.message || uploadData
            });
        }

        res.json({
            id: uploadData.id,
            filename: displayFilename,
            mime_type: file.mimetype,
        });
    } catch (error) {
        console.error('[TenantPortal] Media upload error:', error);
        if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
        res.status(500).json({ error: 'حدث خطأ أثناء رفع الملف' });
    }
});

// ============================================
// Send Document (PDF, DOC, XLS, etc.)
// ============================================
router.post('/messages/send-document', documentUpload.single('file'), async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { recipient, caption, filename } = req.body;
        const file = req.file;

        if (!recipient) {
            // Cleanup uploaded file
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'رقم المستلم مطلوب' });
        }

        if (!file) {
            return res.status(400).json({ error: 'الملف مطلوب' });
        }

        // Get tenant credentials
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = getAccessToken(tenantId);

        if (!phoneNumberId || !accessToken) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        if (tenant.status === 'Suspended') {
            if (file) fs.unlinkSync(file.path);
            return res.status(403).json({ error: 'حسابك معلّق ولا يمكنك إرسال الملفات. تواصل مع المدير.' });
        }

        // Format recipient (remove + prefix if present)
        const formattedRecipient = recipient.replace(/\+/g, '').trim();

        // 1. Upload document to Meta
        const displayFilename = normalizeFilename(filename || file.originalname);
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.readFileSync(file.path), {
            filename: displayFilename,
            contentType: file.mimetype
        });

        const uploadUrl = `${META_API_BASE}/${phoneNumberId}/media`;
        console.log(`[TenantPortal] Uploading document: ${displayFilename}`);

        // Convert form-data to buffer for compatibility with native fetch
        const formBuffer = form.getBuffer();
        const formHeaders = form.getHeaders();

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...formHeaders
            },
            body: formBuffer
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok || !uploadData.id) {
            console.error('[TenantPortal] Upload failed:', uploadResponse.status, uploadData);

            // Cleanup uploaded file
            try {
                fs.unlinkSync(file.path);
            } catch (e) {
                console.warn('[TenantPortal] Failed to cleanup temp file:', e);
            }

            return res.status(400).json({
                error: 'فشل رفع الملف إلى WhatsApp',
                details: uploadData.error?.message || uploadData
            });
        }

        const mediaId = uploadData.id;
        console.log(`[TenantPortal] Document uploaded. Media ID: ${mediaId}`);

        // Cleanup uploaded file
        try {
            fs.unlinkSync(file.path);
        } catch (e) {
            console.warn('[TenantPortal] Failed to cleanup temp file:', e);
        }

        // 2. Send message with Media ID
        const payload = {
            messaging_product: 'whatsapp',
            to: formattedRecipient,
            type: 'document',
            document: {
                id: mediaId,
                filename: displayFilename,
                caption: caption || ''
            }
        };

        console.log('[TenantPortal] Sending document:', JSON.stringify(payload, null, 2));

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_MEDIA,
            quantity: 1,
            referenceType: 'message',
            metadata: { recipient: formattedRecipient, message_type: 'document' },
        });

        const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[TenantPortal] Send document error:', data);
            releaseBilling(billingReservation, data.error?.message || 'Meta document send failed');
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إرسال الملف',
                data
            });
        }

        commitBilling(billingReservation, {
            referenceId: data.messages?.[0]?.id || null,
            description: 'خصم إرسال مستند WhatsApp',
        });

        // 3. Save to database
        // Store filename in content, caption can be appended if provided
        const displayContent = caption 
            ? `${displayFilename}\n\n${caption}` 
            : displayFilename;

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, media_id, media_mime_type)
            VALUES (?, 'outgoing', ?, ?, 'document', ?, 'sent', ?, ?, ?)
        `).run(
            tenantId,
            phoneNumberId,
            formattedRecipient,
            displayContent,
            data.messages?.[0]?.id || null,
            mediaId,
            file.mimetype
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'document_sent', 'إرسال مستند', 'success')
        `).run(tenantId, tenant.name);

        // Emit SSE events for real-time UI update
        eventBus.emitNewMessage({
            tenant_id: tenantId,
            direction: 'outgoing',
            sender: phoneNumberId,
            recipient: formattedRecipient,
            message_type: 'document',
            content: displayContent,
            wamid: data.messages?.[0]?.id,
            created_at: new Date().toISOString(),
        });
        eventBus.emitConversationUpdate(tenantId);

        res.json({
            success: true,
            message_id: data.messages?.[0]?.id,
            media_id: mediaId
        });

    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Document billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Send document error:', error);
        // Cleanup file if it exists
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) { }
        }
        res.status(500).json({ error: 'فشل إرسال الملف' });
    }
});

// ============================================
// Send Image/Media
// ============================================
router.post('/messages/send-image', mediaUpload.single('file'), async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { recipient, caption } = req.body;
        const file = req.file;

        if (!recipient) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'رقم المستلم مطلوب' });
        }

        if (!file) {
            return res.status(400).json({ error: 'الملف مطلوب' });
        }

        // Get tenant credentials
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = getAccessToken(tenantId);

        if (!phoneNumberId || !accessToken) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        if (tenant.status === 'Suspended') {
            if (file) fs.unlinkSync(file.path);
            return res.status(403).json({ error: 'حسابك معلّق ولا يمكنك إرسال الملفات. تواصل مع المدير.' });
        }

        const formattedRecipient = recipient.replace(/\+/g, '').trim();

        // Determine media type
        let mediaType = 'document';
        if (file.mimetype.startsWith('image/')) mediaType = 'image';
        else if (file.mimetype.startsWith('video/')) mediaType = 'video';
        else if (file.mimetype.startsWith('audio/')) mediaType = 'audio';

        // 1. Upload media to Meta
        const displayFilename = normalizeFilename(file.originalname, 'upload');
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        form.append('file', fs.readFileSync(file.path), {
            filename: displayFilename,
            contentType: file.mimetype
        });

        const uploadUrl = `${META_API_BASE}/${phoneNumberId}/media`;
        console.log(`[TenantPortal] Uploading ${mediaType}: ${displayFilename}`);

        // Convert form-data to buffer for compatibility with native fetch
        const formBuffer = form.getBuffer();
        const formHeaders = form.getHeaders();

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...formHeaders
            },
            body: formBuffer
        });

        const uploadData = await uploadResponse.json();

        // Cleanup temp file
        try { fs.unlinkSync(file.path); } catch (e) { console.warn('[TenantPortal] Cleanup:', e.message); }

        if (!uploadResponse.ok || !uploadData.id) {
            return res.status(400).json({
                error: 'فشل رفع الملف إلى WhatsApp',
                details: uploadData.error?.message || uploadData
            });
        }

        const mediaId = uploadData.id;

        // 2. Send message with Media ID
        const payload = {
            messaging_product: 'whatsapp',
            to: formattedRecipient,
            type: mediaType,
            [mediaType]: {
                id: mediaId,
                caption: caption || ''
            }
        };
        if (mediaType === 'document') {
            payload.document.filename = displayFilename;
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_MEDIA,
            quantity: 1,
            referenceType: 'message',
            metadata: { recipient: formattedRecipient, message_type: mediaType },
        });

        const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta media send failed');
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إرسال الملف',
                data
            });
        }

        commitBilling(billingReservation, {
            referenceId: data.messages?.[0]?.id || null,
            description: `خصم إرسال وسائط WhatsApp: ${mediaType}`,
        });

        // 3. Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid, media_id, media_mime_type)
            VALUES (?, 'outgoing', ?, ?, ?, ?, 'sent', ?, ?, ?)
        `).run(
            tenantId,
            phoneNumberId,
            formattedRecipient,
            mediaType,
            mediaType === 'document' ? (caption ? `${displayFilename}\n\n${caption}` : displayFilename) : (caption || `[${mediaType}]`),
            data.messages?.[0]?.id || null,
            mediaId,
            file.mimetype
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'media_sent', ?, 'success')
        `).run(tenantId, tenant.name, `إرسال ${mediaType === 'image' ? 'صورة' : mediaType}`);

        // Emit SSE events for real-time UI update
        eventBus.emitNewMessage({
            tenant_id: tenantId,
            direction: 'outgoing',
            sender: phoneNumberId,
            recipient: formattedRecipient,
            message_type: mediaType,
            content: mediaType === 'document' ? (caption ? `${displayFilename}\n\n${caption}` : displayFilename) : (caption || `[${mediaType}]`),
            wamid: data.messages?.[0]?.id,
            created_at: new Date().toISOString(),
        });
        eventBus.emitConversationUpdate(tenantId);

        res.json({
            success: true,
            message_id: data.messages?.[0]?.id,
            media_id: mediaId
        });

    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Media billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Send image error:', error);
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
        res.status(500).json({ error: 'فشل إرسال الملف' });
    }
});

// ============================================
// Media Download Proxy (for tenant images)
// ============================================
router.get('/media/:mediaId/download', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { mediaId } = req.params;

        // Use getAccessToken to properly decrypt tenant access tokens
        const accessToken = getAccessToken(tenantId);
        if (!accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        // Get media URL from Meta
        const urlResponse = await fetch(`${META_API_BASE}/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        const urlData = await urlResponse.json();

        if (!urlResponse.ok || !urlData.url) {
            return res.status(urlResponse.status).json({ error: 'فشل جلب رابط الوسائط' });
        }

        // Download the actual media
        const mediaResponse = await fetch(urlData.url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (!mediaResponse.ok) {
            return res.status(mediaResponse.status).json({ error: 'فشل تحميل الوسائط' });
        }

        // Set content type and pipe the response
        res.setHeader('Content-Type', urlData.mime_type || 'application/octet-stream');
        const arrayBuffer = await mediaResponse.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (error) {
        console.error('[TenantPortal] Media download error:', error);
        res.status(500).json({ error: 'فشل تحميل الوسائط' });
    }
});

// ============================================
// Send Interactive Message
// ============================================
router.post('/messages/send-interactive', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { recipient, interactive_type, body_text, header_text, footer_text, buttons, sections, list_button_text } = req.body;

        if (!recipient || !interactive_type || !body_text) {
            return res.status(400).json({ error: 'المستلم ونوع الرسالة والنص مطلوبون' });
        }

        if (!['button', 'list'].includes(interactive_type)) {
            return res.status(400).json({ error: 'نوع الرسالة التفاعلية يجب أن يكون "button" أو "list"' });
        }

        // Validate buttons/sections based on type
        if (interactive_type === 'button' && (!buttons || !Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3)) {
            return res.status(400).json({ error: 'يجب تقديم 1-3 أزرار' });
        }
        if (interactive_type === 'list' && (!sections || !Array.isArray(sections) || sections.length === 0)) {
            return res.status(400).json({ error: 'يجب تقديم قسم واحد على الأقل' });
        }

        // Get tenant credentials
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
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

        console.log('[TenantPortal] Sending interactive:', JSON.stringify(payload, null, 2));

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

        const data = await response.json();

        if (response.ok) {
            commitBilling(billingReservation, {
                referenceId: data.messages?.[0]?.id || null,
                description: `خصم إرسال رسالة WhatsApp تفاعلية (${interactive_type})`,
            });
        } else {
            releaseBilling(billingReservation, data.error?.message || 'Meta interactive send failed');
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
            response.ok ? 'sent' : 'failed',
            data.messages?.[0]?.id || null,
            data.error?.message || null
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'interactive_sent', ?, ?)
        `).run(tenantId, tenant.name, `إرسال رسالة تفاعلية (${interactive_type})`, response.ok ? 'success' : 'error');

        if (response.ok) {
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
            res.status(response.status).json({ success: false, error: data.error?.message, data });
        }
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Interactive billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Send interactive error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة التفاعلية' });
    }
});

// ============================================
// Broadcast (Tenant) — Async with job tracking
// ============================================
router.post('/broadcast', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { recipients, template_name, template_language, template_params } = req.body;

        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'قائمة المستلمين مطلوبة' });
        }
        if (!template_name) {
            return res.status(400).json({ error: 'اسم القالب مطلوب' });
        }
        if (recipients.length > 100) {
            return res.status(400).json({ error: 'الحد الأقصى 100 مستلم للبث' });
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = getAccessToken(tenantId);

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        if (tenant.status === 'Suspended') {
            return res.status(403).json({ error: 'حسابك معلّق. تواصل مع المدير.' });
        }

        const template = db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND name = ?').get(tenantId, template_name);
        if (!template) {
            return res.status(400).json({ error: 'القالب غير موجود' });
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_BROADCAST_RECIPIENT,
            quantity: recipients.length,
            referenceType: 'broadcast',
            metadata: { template_name, recipient_count: recipients.length },
        });

        // Create broadcast job
        const jobResult = db.prepare(`
            INSERT INTO broadcast_jobs (tenant_id, status, template_name, template_language, total_recipients)
            VALUES (?, 'pending', ?, ?, ?)
        `).run(tenantId, template_name, template_language || 'ar', recipients.length);

        const jobId = jobResult.lastInsertRowid;

        // Respond immediately
        res.status(202).json({ job_id: jobId, status: 'pending', total: recipients.length });

        // Process in background
        setImmediate(() => processTenantBroadcastJob(jobId, {
            tenantId, recipients, template_name, template_language, template_params,
            variable_mapping: req.body.variable_mapping,
            phoneNumberId, accessToken, tenant, billingReservation,
        }));

    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Broadcast billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Broadcast error:', error);
        res.status(500).json({ error: 'فشل البث' });
    }
});

// Broadcast job statuses (Tenant)
router.get('/broadcast-jobs', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { limit = 20, offset = 0 } = req.query;
        const jobs = db.prepare(
            'SELECT * FROM broadcast_jobs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(tenantId, parseInt(limit), parseInt(offset));
        const total = db.prepare('SELECT COUNT(*) as count FROM broadcast_jobs WHERE tenant_id = ?').get(tenantId).count;
        res.json({ jobs, total });
    } catch (error) {
        console.error('[TenantPortal] Broadcast jobs fetch error:', error);
        res.status(500).json({ error: 'فشل جلب وظائف البث' });
    }
});

router.get('/broadcast-jobs/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);
        if (!job) {
            return res.status(404).json({ error: 'الوظيفة غير موجودة' });
        }
        res.json(job);
    } catch (error) {
        console.error('[TenantPortal] Broadcast job fetch error:', error);
        res.status(500).json({ error: 'فشل جلب وظيفة البث' });
    }
});

// Background tenant broadcast processor
async function processTenantBroadcastJob(jobId, params) {
    const { tenantId, recipients, template_name, template_language, template_params,
            variable_mapping, phoneNumberId, accessToken, tenant, billingReservation } = params;

    try {
        db.prepare("UPDATE broadcast_jobs SET status = 'running' WHERE id = ?").run(jobId);

        const results = [];
        let sent = 0, failed = 0;
        const batchSize = 5;
        const batchDelay = 200;
        const total = recipients.length;
        const templateRecord = db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND name = ?').get(tenantId, template_name);

        for (let i = 0; i < total; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);

            const batchPromises = batch.map(async (recipient) => {
                try {
                    const formattedRecipient = recipient.replace(/\+/g, '').trim();

                    const payload = {
                        messaging_product: 'whatsapp',
                        to: formattedRecipient,
                        type: 'template',
                        template: {
                            name: template_name,
                            language: { code: template_language || 'ar' },
                        },
                    };

                    const contact = Array.isArray(variable_mapping) && variable_mapping.length > 0
                        ? db.prepare(
                            'SELECT phone, profile_name, label, notes FROM contacts WHERE phone = ? AND tenant_id = ? LIMIT 1'
                        ).get(formattedRecipient, tenantId)
                        : null;
                    const components = buildTemplateComponentsFromMapping(variable_mapping, template_params, contact, formattedRecipient);
                    if (components.length > 0) {
                        payload.template.components = components;
                    }

                    const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(payload),
                    });

                    const data = await response.json();

                    if (response.ok) {
                        const messageId = data.messages?.[0]?.id;
                        const storedContent = buildRichTemplateContent(templateRecord, payload.template.components || [])
                            || `[قالب: ${template_name}]`;
                        db.prepare(`
                            INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
                            VALUES (?, 'outgoing', ?, ?, 'template', ?, 'sent', ?)
                        `).run(tenantId, phoneNumberId, formattedRecipient, storedContent, messageId);
                        return { recipient: formattedRecipient, status: 'sent', message_id: messageId };
                    } else {
                        return { recipient: formattedRecipient, status: 'failed', error: data.error?.message };
                    }
                } catch (err) {
                    return { recipient, status: 'failed', error: err.message };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            sent += batchResults.filter(r => r.status === 'sent').length;
            failed += batchResults.filter(r => r.status === 'failed').length;

            const progress = Math.round(((i + batch.length) / total) * 100);
            db.prepare(
                'UPDATE broadcast_jobs SET sent_count = ?, failed_count = ?, progress_pct = ? WHERE id = ?'
            ).run(sent, failed, progress, jobId);

            eventBus.broadcast(`tenant:${tenantId}`, 'broadcast:progress', { job_id: jobId, progress_pct: progress, sent_count: sent, failed_count: failed });

            if (i + batchSize < total) {
                await new Promise(r => setTimeout(r, batchDelay));
            }
        }

        if (sent > 0) {
            commitBilling(billingReservation, {
                quantity: sent,
                referenceId: String(jobId),
                description: `خصم بث WhatsApp: ${template_name} (${sent} مستلم)`,
            });
        } else {
            releaseBilling(billingReservation, 'No successful broadcast recipients');
        }

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'broadcast', ?, ?)
        `).run(tenantId, tenant.name,
            `بث ${template_name} إلى ${total} مستلم (${sent} نجاح، ${failed} فشل)`,
            failed === 0 ? 'success' : 'partial');

        db.prepare(`
            UPDATE broadcast_jobs SET status = 'completed', sent_count = ?, failed_count = ?,
                progress_pct = 100, results = ?, completed_at = datetime('now', 'localtime') WHERE id = ?
        `).run(sent, failed, JSON.stringify(results), jobId);

        eventBus.broadcast(`tenant:${tenantId}`, 'broadcast:complete', { job_id: jobId, sent, failed });

    } catch (error) {
        console.error('[TenantPortal] Broadcast job error:', error);
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Broadcast billing release error:', releaseError);
            }
        }
        db.prepare(`
            UPDATE broadcast_jobs SET status = 'failed', error = ?, completed_at = datetime('now', 'localtime') WHERE id = ?
        `).run(error.message, jobId);
        eventBus.broadcast(`tenant:${tenantId}`, 'broadcast:complete', { job_id: jobId, sent: 0, failed: 0, error: error.message });
    }
}

// ============================================
// Templates
// ============================================
router.get('/templates', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const templates = db.prepare(`
            SELECT * FROM templates WHERE tenant_id = ? ORDER BY created_at DESC
        `).all(tenantId);
        res.json(templates);
    } catch (error) {
        console.error('[TenantPortal] Templates list error:', error);
        res.status(500).json({ error: 'فشل جلب القوالب' });
    }
});

router.get('/templates/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const template = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);

        if (!template) {
            return res.status(404).json({ error: 'القالب غير موجود' });
        }
        res.json(template);
    } catch (error) {
        console.error('[TenantPortal] Template get error:', error);
        res.status(500).json({ error: 'فشل جلب القالب' });
    }
});

router.post('/templates', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { name, language, category, header_type, header_content, body, footer, buttons, variables } = req.body;

        if (!name || !body) {
            return res.status(400).json({ error: 'اسم القالب والمحتوى مطلوبان' });
        }

        const stmt = db.prepare(`
            INSERT INTO templates (tenant_id, name, language, category, header_type, header_content, body, footer, buttons, variables)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            tenantId,
            name,
            language || 'ar',
            category || 'UTILITY',
            header_type || 'none',
            header_content || null,
            body,
            footer || null,
            buttons ? JSON.stringify(buttons) : null,
            variables ? JSON.stringify(variables) : null
        );

        const newTemplate = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newTemplate);
    } catch (error) {
        console.error('[TenantPortal] Template create error:', error);
        res.status(500).json({ error: 'فشل إنشاء القالب' });
    }
});

router.put('/templates/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const templateId = req.params.id;

        // Check ownership
        const existing = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?')
            .get(templateId, tenantId);

        if (!existing) {
            return res.status(404).json({ error: 'القالب غير موجود' });
        }

        const { name, language, category, header_type, header_content, body, footer, buttons, variables } = req.body;

        db.prepare(`
            UPDATE templates SET
                name = COALESCE(?, name),
                language = COALESCE(?, language),
                category = COALESCE(?, category),
                header_type = COALESCE(?, header_type),
                header_content = ?,
                body = COALESCE(?, body),
                footer = ?,
                buttons = ?,
                variables = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ? AND tenant_id = ?
        `).run(
            name,
            language,
            category,
            header_type,
            header_content,
            body,
            footer,
            buttons ? JSON.stringify(buttons) : null,
            variables ? JSON.stringify(variables) : null,
            templateId,
            tenantId
        );

        const updatedTemplate = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
        res.json(updatedTemplate);
    } catch (error) {
        console.error('[TenantPortal] Template update error:', error);
        res.status(500).json({ error: 'فشل تحديث القالب' });
    }
});

router.delete('/templates/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const templateId = req.params.id;

        const existing = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?')
            .get(templateId, tenantId);

        if (!existing) {
            return res.status(404).json({ error: 'القالب غير موجود' });
        }

        db.prepare('DELETE FROM templates WHERE id = ? AND tenant_id = ?').run(templateId, tenantId);
        res.json({ message: 'تم حذف القالب بنجاح' });
    } catch (error) {
        console.error('[TenantPortal] Template delete error:', error);
        res.status(500).json({ error: 'فشل حذف القالب' });
    }
});

// Sync templates from Meta WhatsApp API
router.post('/templates/sync', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        // Get tenant credentials
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const accessToken = getAccessToken(tenantId);
        if (!accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة. تواصل مع المدير لإضافة Access Token.' });
        }

        // Get WABA ID - try multiple methods
        let wabaId = tenant.waba_id;

        if (!wabaId && tenant.phone_number_id) {
            try {
                // Method 1: Try to get WABA ID from phone number's whatsapp_business_account edge
                const wabaResponse = await fetch(
                    `${META_API_BASE}/${tenant.phone_number_id}/whatsapp_business_account`,
                    {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    }
                );
                const wabaData = await wabaResponse.json();

                if (!wabaData.error && wabaData.id) {
                    wabaId = wabaData.id;
                    // Save WABA ID for future use
                    db.prepare('UPDATE tenants SET waba_id = ? WHERE id = ?').run(wabaId, tenantId);
                } else if (wabaData.error) {
                    console.error('WABA lookup error:', wabaData.error);

                    // Method 2: Try debug_token to get app info
                    const debugResponse = await fetch(
                        `${META_API_BASE}/debug_token?input_token=${accessToken}`,
                        {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        }
                    );
                    const debugData = await debugResponse.json();

                    if (debugData.data?.granular_scopes) {
                        // Try to find WABA ID from scopes
                        const wabaScope = debugData.data.granular_scopes.find(s =>
                            s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging'
                        );
                        if (wabaScope?.target_ids?.length > 0) {
                            wabaId = wabaScope.target_ids[0];
                        }
                    }
                }
            } catch (err) {
                console.error('Error getting WABA ID:', err);
            }
        }

        if (!wabaId) {
            return res.status(400).json({
                error: 'لم يتم العثور على معرف حساب WhatsApp Business.',
                hint: 'تواصل مع المدير لإضافة WABA ID في إعدادات العميل.',
            });
        }

        // Fetch templates from Meta API with pagination
        let url = `${META_API_BASE}/${wabaId}/message_templates?limit=100&fields=name,language,status,category,components,quality_score,parameter_format`;
        let allMetaTemplates = [];

        while (url) {
            const resp = await fetch(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const data = await resp.json();

            if (data.error) {
                console.error('Templates API error:', data.error);
                return res.status(400).json({
                    error: 'فشل جلب القوالب من WhatsApp',
                    details: data.error.message
                });
            }

            allMetaTemplates.push(...(data.data || []));
            url = data.paging?.next || null;
        }

        let created = 0, updated = 0, unchanged = 0;

        for (const t of allMetaTemplates) {
            let headerType = 'none', headerContent = '', body = '', footer = '', buttons = null;

            for (const comp of (t.components || [])) {
                switch (comp.type) {
                    case 'HEADER':
                        headerType = (comp.format || 'text').toLowerCase();
                        if (headerType === 'text') {
                            headerContent = comp.text || '';
                        } else if (comp.example?.header_handle?.length) {
                            headerContent = comp.example.header_handle[0];
                        }
                        break;
                    case 'BODY': body = comp.text || ''; break;
                    case 'FOOTER': footer = comp.text || ''; break;
                    case 'BUTTONS': buttons = JSON.stringify(comp.buttons || []); break;
                }
            }

            const metaStatus = (t.status || '').toLowerCase();
            const qualityScore = t.quality_score?.score || 'UNKNOWN';
            const paramFormat = t.parameter_format || 'positional';

            const existing = db.prepare(
                'SELECT id, status, body FROM templates WHERE tenant_id = ? AND name = ? AND language = ?'
            ).get(tenantId, t.name, t.language);

            if (existing) {
                if (existing.status !== metaStatus || existing.body !== body) {
                    db.prepare(`UPDATE templates SET status=?, category=?, header_type=?, header_content=?,
                        body=?, footer=?, buttons=?, meta_template_id=?, quality_score=?, parameter_format=?,
                        updated_at=datetime('now', 'localtime') WHERE id=?`)
                        .run(metaStatus, t.category, headerType, headerContent, body, footer, buttons,
                            t.id, qualityScore, paramFormat, existing.id);
                    updated++;
                } else { unchanged++; }
            } else {
                db.prepare(`INSERT INTO templates (tenant_id, name, language, category, status,
                    header_type, header_content, body, footer, buttons, meta_template_id,
                    quality_score, parameter_format) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                    .run(tenantId, t.name, t.language, t.category, metaStatus, headerType,
                        headerContent, body, footer, buttons, t.id, qualityScore, paramFormat);
                created++;
            }
        }

        res.json({
            success: true,
            synced: allMetaTemplates.length,
            created,
            updated,
            unchanged,
            templates: db.prepare('SELECT * FROM templates WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId),
        });
    } catch (error) {
        console.error('[TenantPortal] Sync templates error:', error);
        res.status(500).json({ error: 'فشل مزامنة القوالب' });
    }
});

// Import template from Meta API
router.post('/templates/import', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { name, language, category, status, components } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'اسم القالب مطلوب' });
        }

        // Check if template already exists
        const existing = db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND name = ?')
            .get(tenantId, name);

        if (existing) {
            return res.status(409).json({ error: 'القالب موجود مسبقاً' });
        }

        // Parse components to extract body, header, footer
        let headerType = 'none';
        let headerContent = '';
        let body = '';
        let footer = '';
        let buttons = null;

        if (components) {
            for (const component of components) {
                if (component.type === 'HEADER') {
                    headerType = component.format?.toLowerCase() || 'text';
                    if (component.format === 'TEXT') {
                        headerContent = component.text || '';
                    } else if (component.example?.header_handle) {
                        headerContent = component.example.header_handle[0] || '';
                    }
                } else if (component.type === 'BODY') {
                    body = component.text || '';
                } else if (component.type === 'FOOTER') {
                    footer = component.text || '';
                } else if (component.type === 'BUTTONS') {
                    buttons = component.buttons;
                }
            }
        }

        const stmt = db.prepare(`
            INSERT INTO templates (tenant_id, name, language, category, header_type, header_content, body, footer, buttons, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            tenantId,
            name,
            language || 'ar',
            category || 'UTILITY',
            headerType,
            headerContent || null,
            body,
            footer || null,
            buttons ? JSON.stringify(buttons) : null,
            (status || 'approved').toLowerCase()
        );

        const newTemplate = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newTemplate);
    } catch (error) {
        console.error('[TenantPortal] Import template error:', error);
        res.status(500).json({ error: 'فشل استيراد القالب' });
    }
});

// Create template on Meta API directly (Tenant)
router.post('/templates/create-meta', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
        const accessToken = getAccessToken(tenantId);
        if (!accessToken || !tenant.waba_id) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة (يجب توفر Access Token و WABA ID)' });
        }

        const { name, language, category, components, parameter_format } = req.body;
        if (!name || !category || !components) {
            return res.status(400).json({ error: 'name, category, and components are required' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.waba_id}/message_templates`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    language: language || 'ar',
                    category: category || 'UTILITY',
                    parameter_format: parameter_format || 'positional',
                    components
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إنشاء القالب في Meta',
                details: data.error
            });
        }

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'template_created_meta', ?, 'success')
        `).run(tenantId, tenant.name, `إنشاء قالب في Meta: ${name}`);

        res.json({ success: true, data });
    } catch (error) {
        console.error('[TenantPortal] Create Meta template error:', error);
        res.status(500).json({ error: 'فشل إنشاء القالب في Meta' });
    }
});

// Delete template from Meta API (Tenant)
router.delete('/templates/delete-meta', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { name } = req.query;

        if (!name) return res.status(400).json({ error: 'اسم القالب مطلوب' });

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
        const accessToken = getAccessToken(tenantId);
        if (!accessToken || !tenant.waba_id) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.waba_id}/message_templates?name=${encodeURIComponent(name)}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل حذف القالب من Meta',
                details: data.error
            });
        }

        db.prepare('DELETE FROM templates WHERE tenant_id = ? AND name = ?').run(tenantId, name);

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'template_deleted_meta', ?, 'success')
        `).run(tenantId, tenant.name, `حذف قالب من Meta: ${name}`);

        res.json({ success: true });
    } catch (error) {
        console.error('[TenantPortal] Delete Meta template error:', error);
        res.status(500).json({ error: 'فشل حذف القالب من Meta' });
    }
});

// ============================================
// API Settings
// ============================================
router.get('/settings/api', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        let settings = db.prepare('SELECT * FROM tenant_api_settings WHERE tenant_id = ?').get(tenantId);

        // Create default settings if not exist
        if (!settings) {
            const apiKey = generateApiKey();
            const webhookSecret = crypto.randomBytes(16).toString('hex');

            db.prepare(`
                INSERT INTO tenant_api_settings (tenant_id, api_key, webhook_secret)
                VALUES (?, ?, ?)
            `).run(tenantId, apiKey, webhookSecret);

            settings = db.prepare('SELECT * FROM tenant_api_settings WHERE tenant_id = ?').get(tenantId);
        }

        res.json(settings);
    } catch (error) {
        console.error('[TenantPortal] API settings get error:', error);
        res.status(500).json({ error: 'فشل جلب إعدادات API' });
    }
});

router.put('/settings/api', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { webhook_url, callback_url, is_active } = req.body;

        // Ensure settings exist
        let settings = db.prepare('SELECT * FROM tenant_api_settings WHERE tenant_id = ?').get(tenantId);

        if (!settings) {
            const apiKey = generateApiKey();
            const webhookSecret = crypto.randomBytes(16).toString('hex');

            db.prepare(`
                INSERT INTO tenant_api_settings (tenant_id, api_key, webhook_secret, webhook_url, callback_url, is_active)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(tenantId, apiKey, webhookSecret, webhook_url || null, callback_url || null, is_active ?? 1);
        } else {
            db.prepare(`
                UPDATE tenant_api_settings SET
                    webhook_url = ?,
                    callback_url = ?,
                    is_active = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE tenant_id = ?
            `).run(webhook_url || null, callback_url || null, is_active ?? 1, tenantId);
        }

        const updatedSettings = db.prepare('SELECT * FROM tenant_api_settings WHERE tenant_id = ?').get(tenantId);
        res.json(updatedSettings);
    } catch (error) {
        console.error('[TenantPortal] API settings update error:', error);
        res.status(500).json({ error: 'فشل تحديث إعدادات API' });
    }
});

router.post('/settings/api/regenerate-key', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const newApiKey = generateApiKey();

        db.prepare(`
            UPDATE tenant_api_settings SET
                api_key = ?,
                updated_at = datetime('now', 'localtime')
            WHERE tenant_id = ?
        `).run(newApiKey, tenantId);

        res.json({ api_key: newApiKey, message: 'تم إنشاء مفتاح API جديد' });
    } catch (error) {
        console.error('[TenantPortal] API key regenerate error:', error);
        res.status(500).json({ error: 'فشل إنشاء مفتاح جديد' });
    }
});

// ============================================
// Profile / Account
// ============================================
router.get('/profile', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const tenant = db.prepare('SELECT id, name, phone, status, tier, credits, quality, created_at FROM tenants WHERE id = ?')
            .get(tenantId);

        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        res.json(tenant);
    } catch (error) {
        console.error('[TenantPortal] Profile error:', error);
        res.status(500).json({ error: 'فشل جلب البيانات' });
    }
});

// ============================================
// Business Profile (Tenant)
// ============================================
router.get('/business-profile', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        const accessToken = getAccessToken(tenantId);
        if (!tenant || !tenant.phone_number_id || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const fields = 'about,address,description,email,profile_picture_url,vertical,websites,messaging_product';
        const response = await fetch(
            `${META_API_BASE}/${tenant.phone_number_id}/whatsapp_business_profile?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب ملف النشاط التجاري',
                details: data.error
            });
        }

        const profile = data.data?.[0] || data;
        res.json(profile);
    } catch (error) {
        console.error('[TenantPortal] Business profile GET error:', error);
        res.status(500).json({ error: 'فشل جلب ملف النشاط التجاري' });
    }
});

router.put('/business-profile', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        const accessToken = getAccessToken(tenantId);
        if (!tenant || !tenant.phone_number_id || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const { about, address, description, email, vertical, websites, profile_picture_handle } = req.body;

        const updatePayload = { messaging_product: 'whatsapp' };
        if (about !== undefined) updatePayload.about = about;
        if (address !== undefined) updatePayload.address = address;
        if (description !== undefined) updatePayload.description = description;
        if (email !== undefined) updatePayload.email = email;
        if (vertical !== undefined) updatePayload.vertical = vertical;
        if (websites !== undefined) updatePayload.websites = Array.isArray(websites) ? websites : [websites];
        if (profile_picture_handle !== undefined) updatePayload.profile_picture_handle = profile_picture_handle;

        const response = await fetch(
            `${META_API_BASE}/${tenant.phone_number_id}/whatsapp_business_profile`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatePayload)
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل تحديث ملف النشاط التجاري',
                details: data.error
            });
        }

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'business_profile_updated', 'تم تحديث ملف النشاط التجاري', 'success')
        `).run(tenantId, tenant.name);

        res.json({ success: true, data });
    } catch (error) {
        console.error('[TenantPortal] Business profile PUT error:', error);
        res.status(500).json({ error: 'فشل تحديث ملف النشاط التجاري' });
    }
});

// ============================================
// Analytics (Tenant — scoped to own data)
// ============================================
router.get('/analytics/summary', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        const stats = {
            totalMessages: db.prepare('SELECT COUNT(*) as count FROM messages WHERE tenant_id = ?').get(tenantId)?.count || 0,
            sentMessages: db.prepare("SELECT COUNT(*) as count FROM messages WHERE tenant_id = ? AND direction = 'outgoing'").get(tenantId)?.count || 0,
            receivedMessages: db.prepare("SELECT COUNT(*) as count FROM messages WHERE tenant_id = ? AND direction = 'incoming'").get(tenantId)?.count || 0,
            failedMessages: db.prepare("SELECT COUNT(*) as count FROM messages WHERE tenant_id = ? AND status = 'failed'").get(tenantId)?.count || 0,

            // Daily breakdown (last 30 days)
            dailyBreakdown: db.prepare(`
                SELECT 
                    date(created_at) as date,
                    COUNT(*) as total,
                    SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as sent,
                    SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as received
                FROM messages
                WHERE tenant_id = ? AND created_at >= datetime('now', '-30 days')
                GROUP BY date(created_at)
                ORDER BY date DESC
            `).all(tenantId),

            // Message type distribution
            typeDistribution: db.prepare(`
                SELECT message_type, COUNT(*) as count
                FROM messages
                WHERE tenant_id = ?
                GROUP BY message_type
                ORDER BY count DESC
            `).all(tenantId),
        };

        res.json(stats);
    } catch (error) {
        console.error('[TenantPortal] Analytics summary error:', error);
        res.status(500).json({ error: 'فشل جلب الإحصائيات' });
    }
});

// ============================================
// QR Codes (Tenant)
// ============================================
router.get('/qr-codes', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        const accessToken = getAccessToken(tenantId);

        if (!tenant?.phone_number_id || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.phone_number_id}/message_qrdls`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب رموز QR', details: data.error
            });
        }

        res.json({ qr_codes: data.data || [], paging: data.paging || null });
    } catch (error) {
        console.error('[TenantPortal] QR list error:', error);
        res.status(500).json({ error: 'فشل جلب رموز QR' });
    }
});

router.post('/qr-codes', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { prefilled_message, generate_qr_image } = req.body;
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        const accessToken = getAccessToken(tenantId);

        if (!tenant?.phone_number_id || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }
        if (!prefilled_message) {
            return res.status(400).json({ error: 'نص الرسالة المعبأة مسبقاً مطلوب' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.phone_number_id}/message_qrdls`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prefilled_message, generate_qr_image: generate_qr_image || 'PNG' })
            }
        );
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إنشاء رمز QR', details: data.error
            });
        }

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'qr_code_created', 'إنشاء رمز QR جديد', 'success')
        `).run(tenantId, tenant.name);

        res.json({ success: true, data });
    } catch (error) {
        console.error('[TenantPortal] QR create error:', error);
        res.status(500).json({ error: 'فشل إنشاء رمز QR' });
    }
});

router.delete('/qr-codes/:qrCodeId', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { qrCodeId } = req.params;
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        const accessToken = getAccessToken(tenantId);

        if (!tenant?.phone_number_id || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.phone_number_id}/message_qrdls/${qrCodeId}`,
            { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل حذف رمز QR', details: data.error
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[TenantPortal] QR delete error:', error);
        res.status(500).json({ error: 'فشل حذف رمز QR' });
    }
});

// ============================================
// Conversions (Tenant)
// ============================================
router.get('/conversions/datasets', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const tenant = db.prepare('SELECT waba_id FROM tenants WHERE id = ?').get(tenantId);
        const accessToken = getAccessToken(tenantId);

        if (!tenant?.waba_id) {
            return res.status(400).json({ error: 'WABA ID غير متوفر لهذا العميل' });
        }
        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات اعتماد WhatsApp/Meta مفقودة' });
        }

        const response = await fetch(`${META_API_BASE}/${tenant.waba_id}/dataset`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب Datasets من Meta',
                details: data.error,
            });
        }

        res.json({
            waba_id: tenant.waba_id,
            datasets: Array.isArray(data.data) ? data.data : [data].filter(item => item?.id),
        });
    } catch (error) {
        console.error('[TenantPortal] Conversion datasets error:', error);
        res.status(500).json({ error: 'فشل جلب Datasets' });
    }
});

router.patch('/meta-settings', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { dataset_id } = req.body;
        const tenant = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        if (!('dataset_id' in req.body)) {
            return res.status(400).json({ error: 'dataset_id مطلوب' });
        }

        const normalizedDatasetId = dataset_id === null ? null : String(dataset_id || '').trim();
        db.prepare(`
            UPDATE tenants
            SET dataset_id = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(normalizedDatasetId || null, tenantId);

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'meta_settings_updated', 'تحديث Dataset ID لأحداث WhatsApp', 'success')
        `).run(tenantId, tenant.name);

        res.json({ success: true, dataset_id: normalizedDatasetId || null });
    } catch (error) {
        console.error('[TenantPortal] Meta settings update error:', error);
        res.status(500).json({ error: 'فشل تحديث إعدادات Meta' });
    }
});

router.get('/conversions/history', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const tenant = db.prepare('SELECT dataset_id, waba_id, access_token, access_token_encrypted FROM tenants WHERE id = ?').get(tenantId);
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const events = db.prepare(
            'SELECT * FROM conversion_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(tenantId, limit, offset);

        const total = db.prepare(
            'SELECT COUNT(*) as total FROM conversion_events WHERE tenant_id = ?'
        ).get(tenantId)?.total || 0;

        const stats = {
            totalEvents: total,
            sentEvents: db.prepare("SELECT COUNT(*) as count FROM conversion_events WHERE tenant_id = ? AND status = 'sent'").get(tenantId)?.count || 0,
            failedEvents: db.prepare("SELECT COUNT(*) as count FROM conversion_events WHERE tenant_id = ? AND status = 'failed'").get(tenantId)?.count || 0,
            localOnlyEvents: db.prepare("SELECT COUNT(*) as count FROM conversion_events WHERE tenant_id = ? AND status = 'local_only'").get(tenantId)?.count || 0,
            lastSuccessAt: db.prepare("SELECT MAX(created_at) as value FROM conversion_events WHERE tenant_id = ? AND status = 'sent'").get(tenantId)?.value || null,
            lastFailureAt: db.prepare("SELECT MAX(created_at) as value FROM conversion_events WHERE tenant_id = ? AND status = 'failed'").get(tenantId)?.value || null,
            eventBreakdown: db.prepare(
                'SELECT event_name, COUNT(*) as count FROM conversion_events WHERE tenant_id = ? GROUP BY event_name ORDER BY count DESC'
            ).all(tenantId),
        };
        const lastFailedEvent = db.prepare(`
            SELECT id, event_name, meta_response, created_at
            FROM conversion_events
            WHERE tenant_id = ? AND status = 'failed'
            ORDER BY created_at DESC
            LIMIT 1
        `).get(tenantId);
        const lastFailedMeta = lastFailedEvent?.meta_response ? (() => {
            try { return JSON.parse(lastFailedEvent.meta_response); } catch { return null; }
        })() : null;
        const lastFailedError = normalizeMetaError(lastFailedMeta);
        const lastSentEvent = db.prepare(`
            SELECT id, event_name, meta_response, created_at
            FROM conversion_events
            WHERE tenant_id = ? AND status = 'sent'
            ORDER BY created_at DESC
            LIMIT 1
        `).get(tenantId);
        const lastSentMeta = lastSentEvent?.meta_response ? (() => {
            try { return JSON.parse(lastSentEvent.meta_response); } catch { return null; }
        })() : null;

        res.json({
            events,
            total,
            limit,
            offset,
            stats,
            dataset_id: tenant?.dataset_id || null,
            waba_id: tenant?.waba_id || null,
            whatsapp_token_present: !!getAccessToken(tenantId),
            tenant_whatsapp_token_present: !!(tenant?.access_token || tenant?.access_token_encrypted),
            events_api_ready: !!tenant?.dataset_id && !!getAccessToken(tenantId),
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
                error_user_message: lastFailedError?.user_message || null,
                fbtrace_id: lastFailedError?.fbtrace_id || null,
                error_data: lastFailedError?.error_data || null,
            } : null,
        });
    } catch (error) {
        console.error('[TenantPortal] Conversions history error:', error);
        res.status(500).json({ error: 'فشل جلب سجل الأحداث' });
    }
});

router.post('/conversions/log-event', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { phone, event_name, wamid, custom_data, ctwa_clid } = req.body;

        if (!event_name) {
            return res.status(400).json({ error: 'اسم الحدث مطلوب' });
        }
        if (!SUPPORTED_WHATSAPP_BUSINESS_EVENTS.includes(event_name)) {
            return res.status(400).json({
                error: `نوع الحدث غير مدعوم في WhatsApp Business Messaging Events API: ${event_name}`,
                supported_events: SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
                permission_required: 'whatsapp_business_manage_events',
            });
        }

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const accessToken = getAccessToken(tenantId);
        if (!accessToken) {
            return res.status(400).json({
                error: 'بيانات اعتماد WhatsApp/Meta مفقودة',
                permission_required: 'whatsapp_business_manage_events',
            });
        }

        const datasetId = tenant.dataset_id;
        if (!datasetId) {
            db.prepare(`
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, ctwa_clid)
                VALUES (?, 'local', ?, ?, ?, ?, ?, 'local_only', ?)
            `).run(tenantId, event_name, new Date().toISOString(), phone || null, wamid || null, custom_data ? JSON.stringify(custom_data) : null, normalizeCtwaClid(ctwa_clid) || null);

            return res.json({
                success: true,
                sent_to_meta: false,
                status: 'local_only',
                permission_required: 'whatsapp_business_manage_events',
                note: 'الحدث تم حفظه محلياً فقط لأن Dataset ID غير مضاف للعميل.',
            });
        }

        const normalizedPhone = normalizePhone(phone);
        const storedAttribution = getLatestCtwaAttribution(db, tenantId, normalizedPhone);
        const resolvedCtwaClid = normalizeCtwaClid(ctwa_clid) || storedAttribution?.last_ctwa_clid || '';
        const normalizedCustomData = parseCustomData(custom_data);
        let formattedEvent;
        try {
            formattedEvent = buildWhatsAppBusinessEvent({
                eventName: event_name,
                wabaId: tenant.waba_id,
                ctwaClid: resolvedCtwaClid,
                customData: normalizedCustomData,
            });
        } catch (validationError) {
            const statusCode = validationError.statusCode || 400;
            const validationResponse = {
                error: {
                    message: validationError.message,
                    type: 'local_validation',
                    code: validationError.reason || 'invalid_whatsapp_business_event',
                    supported_events: validationError.supportedEvents || undefined,
                },
            };

            db.prepare(`
                INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response, ctwa_clid)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)
            `).run(
                tenantId,
                datasetId,
                event_name,
                new Date().toISOString(),
                phone || null,
                wamid || null,
                custom_data ? JSON.stringify(custom_data) : null,
                JSON.stringify(validationResponse),
                resolvedCtwaClid || null
            );

            return res.status(statusCode).json({
                error: validationError.message,
                details: validationResponse.error,
                permission_required: 'whatsapp_business_manage_events',
                dataset_id: datasetId,
                supported_events: validationError.supportedEvents || SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
            });
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.WHATSAPP_EVENT_CONVERSION,
            quantity: 1,
            referenceType: 'conversion_event',
            metadata: { dataset_id: datasetId, event_name },
        });

        const response = await fetch(`${META_API_BASE}/${datasetId}/events`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: [formattedEvent] })
        });

        const data = await response.json();
        const status = response.ok ? 'sent' : 'failed';

        db.prepare(`
            INSERT INTO conversion_events (tenant_id, dataset_id, event_name, event_time, phone, wamid, custom_data, status, meta_response, ctwa_clid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tenantId, datasetId, event_name, new Date().toISOString(), phone || null, wamid || null,
            custom_data ? JSON.stringify(custom_data) : null, status, JSON.stringify(data), resolvedCtwaClid || null);

        if (response.ok) {
            commitBilling(billingReservation, {
                referenceId: data.fbtrace_id || null,
                description: `خصم إرسال حدث WhatsApp Events API: ${event_name}`,
            });

            res.json({
                success: true,
                sent_to_meta: true,
                status: 'sent',
                dataset_id: datasetId,
                events_received: data.events_received,
                fbtrace_id: data.fbtrace_id,
                data,
            });
        } else {
            releaseBilling(billingReservation, data.error?.message || 'Meta conversion event failed');
            const metaError = normalizeMetaError(data);
            res.status(response.status).json({
                error: metaError?.message || data.error?.message || 'فشل إرسال الحدث',
                details: data.error,
                fbtrace_id: metaError?.fbtrace_id || null,
                permission_required: 'whatsapp_business_manage_events',
                dataset_id: datasetId,
            });
        }
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Conversion billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Log event error:', error);
        res.status(500).json({ error: 'فشل تسجيل الحدث' });
    }
});

// ============================================
// Mark message as read (Tenant)
// ============================================
router.post('/mark-read', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { message_id } = req.body;

        if (!message_id) {
            return res.status(400).json({ error: 'message_id is required' });
        }

        const tenant = db.prepare('SELECT phone_number_id, status FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }
        if (tenant.status === 'Suspended') {
            return res.status(403).json({ error: 'الحساب موقوف' });
        }

        const accessToken = getAccessToken(tenantId);

        if (!tenant.phone_number_id || !accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد غير مكتملة' });
        }

        const response = await fetch(`${META_API_BASE}/${tenant.phone_number_id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: message_id,
            }),
        });

        const data = await response.json();

        if (response.ok) {
            res.json({ success: true });
        } else {
            console.error('[TenantPortal] Mark read failed:', data.error);
            res.status(response.status).json({ success: false, error: data.error?.message || 'فشل تحديد كمقروء' });
        }
    } catch (error) {
        console.error('[TenantPortal] Mark read error:', error);
        res.status(500).json({ error: 'فشل تحديد الرسالة كمقروءة' });
    }
});

// ============================================
// UNIFIED INBOX — Tenant-scoped (WhatsApp + Messenger)
// ============================================

/**
 * GET /portal/unified/conversations
 * Returns both WhatsApp and Messenger conversations for this tenant
 */
router.get('/unified/conversations', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { channel: channelFilter } = req.query;

        const waConversations = [];
        if (!channelFilter || channelFilter === 'whatsapp') {
            const waQuery = `
                SELECT
                    'whatsapp' as channel,
                    t.contact as contact_id,
                    t.tenant_id,
                    tenants.name as tenant_name,
                    t.created_at as last_message_time,
                    t.content as last_message,
                    t.message_type as last_message_type,
                    c.profile_name as display_name,
                    c.profile_picture_url as avatar_url,
                    c.last_ctwa_clid,
                    c.last_ctwa_source_id,
                    c.last_ctwa_source_type,
                    c.last_ctwa_source_url,
                    c.last_ctwa_received_at,
                    (SELECT COUNT(*) FROM messages m2
                     WHERE m2.sender = t.contact
                     AND m2.direction = 'incoming'
                     AND m2.status = 'received'
                     AND m2.tenant_id = ?
                    ) as unread_count,
                    NULL as linked_page_id,
                    NULL as page_name
                FROM (
                    SELECT
                        id, content, created_at, message_type, tenant_id,
                        CASE WHEN direction = 'incoming' THEN sender ELSE recipient END as contact,
                        ROW_NUMBER() OVER (
                            PARTITION BY (
                                CASE WHEN direction = 'incoming' THEN sender ELSE recipient END
                            )
                            ORDER BY created_at DESC, id DESC
                        ) as rn
                    FROM messages
                    WHERE tenant_id = ?
                ) t
                LEFT JOIN contacts c ON c.phone = t.contact AND c.tenant_id = ?
                LEFT JOIN tenants ON tenants.id = t.tenant_id
                WHERE rn = 1
            `;
            waConversations.push(...enrichTemplateFallbackMessages(db.prepare(waQuery).all(tenantId, tenantId, tenantId), 'last_message'));
        }

        const fbConversations = [];
        if (!channelFilter || channelFilter === 'messenger') {
            const fbQuery = `
                SELECT
                    'messenger' as channel,
                    fc.user_psid as contact_id,
                    fc.tenant_id,
                    tenants.name as tenant_name,
                    CASE
                        WHEN fc.last_message_time GLOB '????-??-??T??:??:??*'
                            THEN datetime(substr(replace(fc.last_message_time, 'T', ' '), 1, 19), 'localtime')
                        ELSE fc.last_message_time
                    END AS last_message_time,
                    fc.last_message,
                    NULL as last_message_type,
                    fc.user_name as display_name,
                    fc.user_profile_pic as avatar_url,
                    fc.unread_count,
                    fc.linked_page_id,
                    tp.page_name,
                    fc.id as conversation_id,
                    fc.page_id
                FROM fb_conversations fc
                LEFT JOIN tenants ON tenants.id = fc.tenant_id
                LEFT JOIN tenant_pages tp ON tp.id = fc.linked_page_id
                WHERE fc.is_active = 1 AND fc.tenant_id = ?
                ORDER BY last_message_time DESC NULLS LAST
            `;
            fbConversations.push(...db.prepare(fbQuery).all(tenantId));
        }

        const unified = [...waConversations, ...fbConversations]
            .sort((a, b) => new Date(b.last_message_time) - new Date(a.last_message_time));

        res.json(unified);
    } catch (error) {
        console.error('[TenantPortal] Unified conversations error:', error);
        res.status(500).json({ error: 'فشل جلب المحادثات' });
    }
});

/**
 * GET /portal/unified/:channel/:id/messages
 * Fetch messages for a specific conversation (WhatsApp or Messenger)
 */
router.get('/unified/:channel/:id/messages', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { channel } = req.params;
        const contactId = decodeURIComponent(req.params.id);
        const { conversation_id } = req.query;

        if (channel === 'whatsapp') {
            const messages = enrichTemplateFallbackMessages(db.prepare(`
                SELECT * FROM messages
                WHERE (sender = ? OR recipient = ?) AND tenant_id = ?
                ORDER BY created_at ASC
            `).all(contactId, contactId, tenantId));

            // Mark as read
            db.prepare(`
                UPDATE messages SET status = 'read'
                WHERE sender = ? AND direction = 'incoming' AND status = 'received' AND tenant_id = ?
            `).run(contactId, tenantId);

            res.json(messages);
        } else if (channel === 'messenger') {
            if (!conversation_id) {
                return res.status(400).json({ error: 'conversation_id مطلوب' });
            }

            const conversationId = Number.parseInt(conversation_id, 10);
            if (!Number.isInteger(conversationId)) {
                return res.status(400).json({ error: 'conversation_id غير صالح' });
            }

            // Verify conversation belongs to this tenant
            const conv = db.prepare('SELECT id FROM fb_conversations WHERE id = ? AND tenant_id = ?')
                .get(conversationId, tenantId);
            if (!conv) {
                return res.status(404).json({ error: 'المحادثة غير موجودة' });
            }

            db.prepare(`
                UPDATE fb_messages SET is_read = 1
                WHERE conversation_id = ? AND tenant_id = ? AND direction = 'incoming' AND is_read = 0
            `).run(conversationId, tenantId);

            db.prepare(`
                UPDATE fb_conversations SET unread_count = 0, updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `).run(conversationId, tenantId);

            const messages = selectMessengerMessages(db, {
                conversationId,
                tenantId,
                unified: true,
            });

            res.json(messages);
        } else {
            res.status(400).json({ error: 'القناة غير صالحة' });
        }
    } catch (error) {
        console.error('[TenantPortal] Unified messages error:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل' });
    }
});

/**
 * POST /portal/unified/:channel/:id/send
 * Send a text message via WhatsApp or Messenger
 */
router.post('/unified/:channel/:id/send', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { channel } = req.params;
        const contactId = decodeURIComponent(req.params.id);
        const { message, linked_page_id } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'الرسالة مطلوبة' });
        }

        // Get tenant info
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }
        if (tenant.status === 'Suspended') {
            return res.status(403).json({ error: 'حسابك معلّق' });
        }

        if (channel === 'whatsapp') {
            const accessToken = getAccessToken(tenantId);
            const phoneNumberId = tenant.phone_number_id;

            if (!phoneNumberId || !accessToken) {
                return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
            }

            const formattedNumber = contactId.replace(/\+/g, '').trim();
            billingReservation = reserveBilling({
                tenantId,
                operationKey: BILLING_OPERATIONS.WHATSAPP_TEXT,
                quantity: 1,
                referenceType: 'message',
                metadata: { channel: 'whatsapp', recipient: formattedNumber },
            });

            const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: formattedNumber,
                    type: 'text',
                    text: { body: message.trim() },
                }),
            });

            const data = await response.json();

            if (response.ok) {
                const messageId = data.messages?.[0]?.id;
                commitBilling(billingReservation, {
                    referenceId: messageId,
                    description: 'خصم إرسال رسالة WhatsApp من صندوق الوارد',
                });

                db.prepare(`
                    INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
                    VALUES (?, 'outgoing', ?, ?, 'text', ?, 'sent', ?)
                `).run(tenantId, phoneNumberId, formattedNumber, message.trim(), messageId);

                eventBus.emitNewMessage({
                    tenant_id: tenantId,
                    tenant_name: tenant.name,
                    direction: 'outgoing',
                    sender: phoneNumberId,
                    recipient: formattedNumber,
                    content: message.trim(),
                    wamid: messageId,
                });
                eventBus.emitConversationUpdate(tenantId);

                res.json({ success: true, message_id: messageId });
            } else {
                releaseBilling(billingReservation, data.error?.message || 'Meta WhatsApp send failed');
                res.status(response.status).json({ error: data.error?.message || 'فشل إرسال الرسالة' });
            }
        } else if (channel === 'messenger') {
            if (!linked_page_id) {
                return res.status(400).json({ error: 'linked_page_id مطلوب' });
            }

            // Verify page belongs to this tenant
            const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND tenant_id = ? AND is_active = 1')
                .get(linked_page_id, tenantId);
            if (!page) {
                return res.status(404).json({ error: 'الصفحة غير موجودة' });
            }

            const accessToken = page.page_access_token_encrypted
                ? decryptIfEncrypted(page.page_access_token_encrypted)
                : null;
            if (!accessToken) {
                return res.status(400).json({ error: 'رمز الوصول غير متوفر' });
            }

            const conv = db.prepare(
                'SELECT * FROM fb_conversations WHERE user_psid = ? AND linked_page_id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1'
            ).get(contactId, linked_page_id, tenantId);

            billingReservation = reserveBilling({
                tenantId,
                operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
                quantity: 1,
                referenceType: 'messenger_message',
                metadata: { linked_page_id, conversation_id: conv?.id || null, user_psid: contactId },
            });

            const sendResponse = await fetch(`${META_API_BASE}/${page.page_id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: contactId },
                    messaging_type: 'RESPONSE',
                    message: { text: message.trim() },
                }),
            });

            const sendData = await sendResponse.json();

            if (sendResponse.ok) {
                const mid = sendData.message_id;
                commitBilling(billingReservation, {
                    referenceId: mid,
                    description: 'خصم رد Messenger من صندوق الوارد',
                });

                if (conv) {
                    const createdAt = normalizeMessengerTimestamp();
                    insertMessengerMessage(db, {
                        conversationId: conv.id,
                        tenantId,
                        mid,
                        direction: 'outgoing',
                        senderId: page.page_id,
                        senderName: page.page_name,
                        messageText: message.trim(),
                        createdAt,
                    });

                    db.prepare(`
                        UPDATE fb_conversations
                        SET last_message = ?, last_message_time = ?
                        WHERE id = ?
                    `).run(message.trim().substring(0, 100), createdAt, conv.id);

                    eventBus.broadcast(`tenant:${tenantId}`, 'fb_message:new', {
                        tenant_id: tenantId,
                        page_id: page.page_id,
                        conversation_id: conv.id,
                        direction: 'outgoing',
                    });
                }

                res.json({ success: true, message_id: mid });
            } else {
                releaseBilling(billingReservation, sendData.error?.message || 'Meta Messenger send failed');
                // Outside 24-hour messaging window
                if (sendData.error?.code === 10) {
                    res.status(403).json({
                        error: 'انتهت نافذة الـ 24 ساعة للرد. استخدم "رسالة خدمية" للتواصل خارج هذه النافذة.',
                        error_code: 'OUTSIDE_WINDOW',
                    });
                } else {
                    res.status(sendResponse.status).json({ error: sendData.error?.message || 'فشل إرسال الرسالة' });
                }
            }
        } else {
            res.status(400).json({ error: 'القناة غير صالحة' });
        }
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Unified billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Unified send error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة' });
    }
});

/**
 * POST /portal/unified/messenger/sync
 * Sync Messenger conversations for all tenant's linked pages
 */
router.post('/unified/messenger/sync', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        // Get all active pages for this tenant
        const pages = db.prepare('SELECT * FROM tenant_pages WHERE tenant_id = ? AND is_active = 1').all(tenantId);
        if (pages.length === 0) {
            return res.json({ success: true, synced_conversations: 0, synced_messages: 0, message: 'لا توجد صفحات مرتبطة' });
        }

        let totalConversations = 0;
        let totalMessages = 0;

        for (const page of pages) {
            const accessToken = page.page_access_token_encrypted
                ? decryptIfEncrypted(page.page_access_token_encrypted)
                : null;
            if (!accessToken) continue;

            try {
                const response = await fetch(
                    `${META_API_BASE}/${page.page_id}/conversations?fields=participants,messages.limit(10){message,from,created_time,mid,attachments},updated_time&limit=25`,
                    { headers: { 'Authorization': `Bearer ${accessToken}` } }
                );
                const data = await response.json();
                if (!response.ok || data.error) continue;

                for (const conv of (data.data || [])) {
                    const participants = conv.participants?.data || [];
                    const userParticipant = participants.find(p => p.id !== page.page_id);
                    if (!userParticipant) continue;

                    const userPsid = userParticipant.id;
                    let userName = userParticipant.name || null;
                    let userProfilePic = null;
                    try {
                        const profileRes = await fetch(
                            `${META_API_BASE}/${userPsid}?fields=name,first_name,last_name,profile_pic&access_token=${encodeURIComponent(accessToken)}`
                        );
                        const profileData = await profileRes.json();
                        if (profileRes.ok && !profileData.error) {
                            userName = profileData.name || [profileData.first_name, profileData.last_name].filter(Boolean).join(' ') || userName;
                            userProfilePic = profileData.profile_pic || null;
                        }
                    } catch (profileErr) {
                        console.warn(`[TenantPortal] Messenger profile fetch failed for ${userPsid}:`, profileErr.message);
                    }
                    const messages = conv.messages?.data || [];
                    const lastMsg = messages.length > 0
                        ? messages.reduce((a, b) => (getTimestampMs(a.created_time) > getTimestampMs(b.created_time) ? a : b))
                        : null;
                    const lastMsgText = lastMsg ? (lastMsg.message || '[مرفق]').substring(0, 100) : '';
                    const lastMsgTime = normalizeMessengerTimestamp(conv.updated_time || (lastMsg ? lastMsg.created_time : null));

                    let dbConv = db.prepare(
                        'SELECT * FROM fb_conversations WHERE linked_page_id = ? AND user_psid = ?'
                    ).get(page.id, userPsid);

                    if (!dbConv) {
                        db.prepare(`
                            INSERT INTO fb_conversations (tenant_id, linked_page_id, page_id, user_psid, user_name, user_profile_pic, last_message, last_message_time, unread_count)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                        `).run(tenantId, page.id, page.page_id, userPsid, userName, userProfilePic, lastMsgText, lastMsgTime);

                        dbConv = db.prepare(
                            'SELECT * FROM fb_conversations WHERE linked_page_id = ? AND user_psid = ?'
                        ).get(page.id, userPsid);
                        totalConversations++;
                    } else {
                        const existingTime = dbConv.last_message_time ? getTimestampMs(dbConv.last_message_time) : 0;
                        const newTime = getTimestampMs(lastMsgTime);
                        if (newTime > existingTime) {
                            db.prepare(`
                                UPDATE fb_conversations SET
                                    last_message = ?, last_message_time = ?,
                                    user_name = COALESCE(?, user_name),
                                    user_profile_pic = COALESCE(?, user_profile_pic),
                                    updated_at = datetime('now', 'localtime')
                                WHERE id = ?
                            `).run(lastMsgText, lastMsgTime, userName, userProfilePic, dbConv.id);
                        } else if (userName || userProfilePic) {
                            db.prepare(`
                                UPDATE fb_conversations SET
                                    user_name = COALESCE(?, user_name),
                                    user_profile_pic = COALESCE(?, user_profile_pic),
                                    updated_at = datetime('now', 'localtime')
                                WHERE id = ?
                            `).run(userName, userProfilePic, dbConv.id);
                        }
                    }

                    for (const msg of messages) {
                        const direction = msg.from?.id === page.page_id ? 'outgoing' : 'incoming';
                        const result = insertMessengerMessage(db, {
                            conversationId: dbConv.id,
                            tenantId,
                            mid: msg.mid,
                            direction,
                            senderId: msg.from?.id,
                            senderName: msg.from?.name,
                            messageText: msg.message || '',
                            attachmentType: msg.attachments?.data?.[0]?.type || null,
                            attachmentUrl: msg.attachments?.data?.[0]?.payload?.url || null,
                            createdAt: msg.created_time,
                        });
                        if (result.inserted) totalMessages++;
                    }
                }
            } catch (pageErr) {
                console.error(`[TenantPortal] Sync error for page ${page.page_id}:`, pageErr);
            }
        }

        res.json({
            success: true,
            synced_conversations: totalConversations,
            synced_messages: totalMessages,
        });
    } catch (error) {
        console.error('[TenantPortal] Messenger sync error:', error);
        res.status(500).json({ error: 'فشل مزامنة المحادثات' });
    }
});

// ============================================
// Tenant-scoped page credential resolver
// ============================================
const resolveTenantPage = (linkedPageId, tenantId) => {
    const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND tenant_id = ? AND is_active = 1')
        .get(linkedPageId, tenantId);
    if (!page) return { error: 'الصفحة غير موجودة أو غير مفعلة', status: 404 };
    const accessToken = page.page_access_token_encrypted
        ? decryptIfEncrypted(page.page_access_token_encrypted)
        : null;
    if (!accessToken) return { error: 'رمز الوصول غير متوفر أو غير صالح', status: 400 };
    return { page, accessToken };
};

// ============================================
// Component 1: Tenant Page Management
// ============================================
router.get('/pages', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const pages = db.prepare(`
            SELECT id, tenant_id, platform, page_id, page_name, page_category, page_picture_url,
                   is_active, subscribed_fields, webhook_subscribed, created_at, updated_at
            FROM tenant_pages
            WHERE tenant_id = ?
            ORDER BY created_at DESC
        `).all(tenantId);
        res.json(pages);
    } catch (error) {
        console.error('[TenantPortal] Pages list error:', error);
        res.status(500).json({ error: 'فشل جلب صفحات فيسبوك' });
    }
});

router.get('/pages/:id/subscription-status', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { page, accessToken, error, status } = resolveTenantPage(req.params.id, tenantId);
        if (error) return res.status(status).json({ error });

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
        console.error('[TenantPortal] Subscription status error:', error);
        res.status(500).json({ error: 'فشل جلب حالة الاشتراك' });
    }
});

// ============================================
// Component 2: Tenant Content Management (Posts & Comments)
// ============================================
const graphUrl = (path, params = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            search.set(key, String(value));
        }
    }
    return `${META_API_BASE}/${path}${search.toString() ? `?${search.toString()}` : ''}`;
};

const graphPostForm = async (path, accessToken, params = {}) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            body.set(key, String(value));
        }
    }

    return fetch(`${META_API_BASE}/${path}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
};

const buildNativeFileForm = (file, caption) => {
    const form = new globalThis.FormData();
    const buffer = fs.readFileSync(file.path);
    const blob = new Blob([buffer], { type: file.mimetype || 'application/octet-stream' });
    form.append('source', blob, file.originalname || 'photo.jpg');
    if (caption) form.append('caption', caption);
    return form;
};

const normalizeLimit = (value, fallback = 25, max = 100) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
};

const normalizeScheduledPublishTime = (value) => {
    if (!value) return null;
    if (Number.isFinite(Number(value))) return Math.floor(Number(value));

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        const error = new Error('وقت الجدولة غير صالح');
        error.status = 400;
        throw error;
    }

    return Math.floor(parsed.getTime() / 1000);
};

const POST_FIELDS = [
    'id',
    'message',
    'created_time',
    'full_picture',
    'permalink_url',
    'is_published',
    'scheduled_publish_time',
    'attachments{title,url,description,media,type}',
    'likes.limit(0).summary(true)',
    'comments.limit(0).summary(true)',
    'reactions.limit(0).summary(true)',
    'shares',
].join(',');

const COMMENT_FIELDS = [
    'id',
    'message',
    'created_time',
    'from{name,id,picture{url}}',
    'like_count',
    'can_like',
    'user_likes',
    'is_hidden',
    'attachment',
    'comment_count',
    'parent{id}',
    'comments.limit(0).summary(true)',
].join(',');

router.get('/fb-content/:linkedPageId/posts', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const { after } = req.query;
        const limit = normalizeLimit(req.query.limit, 25, 50);
        const url = graphUrl(`${page.page_id}/posts`, {
            fields: POST_FIELDS,
            limit,
            after,
        });

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error?.message || 'فشل جلب المنشورات', details: data.error });
        }

        res.json({ posts: data.data || [], paging: data.paging || null });
    } catch (error) {
        console.error('[TenantPortal] List posts error:', error);
        res.status(500).json({ error: 'فشل جلب المنشورات' });
    }
});

router.post('/fb-content/:linkedPageId/posts', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const { message, link, published, scheduled_publish_time } = req.body;
        if (!message && !link) {
            return res.status(400).json({ error: 'نص المنشور أو الرابط مطلوب' });
        }

        const body = {};
        if (message) body.message = message;
        if (link) body.link = link;
        if (published === false) {
            body.published = false;
            if (scheduled_publish_time) body.scheduled_publish_time = normalizeScheduledPublishTime(scheduled_publish_time);
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_CREATE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, type: 'post' },
        });

        const response = await graphPostForm(`${page.page_id}/feed`, accessToken, body);
        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta post create failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل إنشاء المنشور', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: data.id || null,
            description: `خصم إنشاء منشور Facebook على ${page.page_name || page.page_id}`,
        });

        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'fb_post_created', ?, 'success')
        `).run(tenantId, tenant?.name || '', `إنشاء منشور على صفحة ${page.page_name || page.page_id}`);

        res.status(201).json({ id: data.id });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Create post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.error('[TenantPortal] Create post error:', error);
        res.status(500).json({ error: 'فشل إنشاء المنشور' });
    }
});

router.post('/fb-content/:linkedPageId/posts/photo', simpleUpload.single('source'), async (req, res) => {
    let filePath = null;
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) {
            if (req.file) cleanupFile(req.file.path);
            return res.status(status).json({ error });
        }

        const isFileUpload = !!req.file;
        const { caption, url } = req.body;
        if (!isFileUpload && !url) {
            return res.status(400).json({ error: 'رابط الصورة أو ملف الصورة مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_PHOTO_POST_CREATE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, type: 'photo', source: isFileUpload ? 'file' : 'url' },
        });

        let apiResponse;
        if (isFileUpload) {
            filePath = req.file.path;
            const form = buildNativeFileForm(req.file, caption);

            apiResponse = await fetch(`${META_API_BASE}/${page.page_id}/photos`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: form,
            });
        } else {
            apiResponse = await graphPostForm(`${page.page_id}/photos`, accessToken, {
                url,
                caption: caption || undefined,
            });
        }

        const data = await apiResponse.json();

        if (!apiResponse.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta photo post failed');
            return res.status(apiResponse.status).json({ error: data.error?.message || 'فشل إنشاء منشور الصورة', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: data.post_id || data.id || null,
            description: `خصم نشر صورة Facebook على ${page.page_name || page.page_id}`,
        });

        res.status(201).json({ id: data.id, post_id: data.post_id || null });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Photo post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Photo post error:', error);
        res.status(500).json({ error: 'فشل إنشاء منشور الصورة' });
    } finally {
        if (filePath) cleanupFile(filePath);
    }
});

router.put('/fb-content/:linkedPageId/posts/:postId', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'نص المنشور مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_EDIT,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, post_id: postId },
        });

        const response = await fetch(`${META_API_BASE}/${postId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta post edit failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل تعديل المنشور', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: postId,
            description: `خصم تعديل منشور Facebook على ${page.page_name || page.page_id}`,
        });

        res.json({ success: true });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Edit post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Edit post error:', error);
        res.status(500).json({ error: 'فشل تعديل المنشور' });
    }
});

router.delete('/fb-content/:linkedPageId/posts/:postId', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_POST_DELETE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, post_id: postId },
        });

        const response = await fetch(`${META_API_BASE}/${postId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta post delete failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل حذف المنشور', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: postId,
            description: `خصم حذف منشور Facebook من ${page.page_name || page.page_id}`,
        });

        res.json({ success: true });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Delete post billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Delete post error:', error);
        res.status(500).json({ error: 'فشل حذف المنشور' });
    }
});

router.get('/fb-content/:linkedPageId/posts/:postId/comments', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, postId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const { after } = req.query;
        const limit = normalizeLimit(req.query.limit, 25, 100);
        const url = graphUrl(`${postId}/comments`, {
            fields: COMMENT_FIELDS,
            limit,
            after,
            filter: req.query.filter || 'toplevel',
            summary: true,
        });

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error?.message || 'فشل جلب التعليقات', details: data.error });
        }

        res.json({
            comments: data.data || [],
            paging: data.paging || null,
            summary: data.summary || null,
        });
    } catch (error) {
        console.error('[TenantPortal] List comments error:', error);
        res.status(500).json({ error: 'فشل جلب التعليقات' });
    }
});

router.get('/fb-content/:linkedPageId/comments/:commentId/replies', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, commentId } = req.params;
        const { accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const { after } = req.query;
        const limit = normalizeLimit(req.query.limit, 10, 50);
        const url = graphUrl(`${commentId}/comments`, {
            fields: COMMENT_FIELDS,
            limit,
            after,
            summary: true,
        });

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error?.message || 'فشل جلب الردود', details: data.error });
        }

        res.json({
            replies: data.data || [],
            paging: data.paging || null,
            summary: data.summary || null,
        });
    } catch (error) {
        console.error('[TenantPortal] List replies error:', error);
        res.status(500).json({ error: 'فشل جلب الردود' });
    }
});

router.post('/fb-content/:linkedPageId/comments/:commentId/reply', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'نص الرد مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_REPLY,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}/comments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta comment reply failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل إرسال الرد', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: data.id || null,
            description: `خصم رد على تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        res.status(201).json({ id: data.id, message: data.message });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Reply billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Reply error:', error);
        res.status(500).json({ error: 'فشل إرسال الرد' });
    }
});

router.post('/fb-content/:linkedPageId/comments/:commentId/hide', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const { is_hidden } = req.body;
        if (is_hidden === undefined) {
            return res.status(400).json({ error: 'is_hidden مطلوب' });
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_HIDE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId, is_hidden: !!is_hidden },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ is_hidden: !!is_hidden }),
        });
        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta comment hide failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل تحديث حالة التعليق', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم ${is_hidden ? 'إخفاء' : 'إظهار'} تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        res.json({ success: true, is_hidden: !!is_hidden });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Hide comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Hide comment error:', error);
        res.status(500).json({ error: 'فشل تحديث حالة التعليق' });
    }
});

router.post('/fb-content/:linkedPageId/comments/:commentId/like', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_LIKE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await graphPostForm(`${commentId}/likes`, accessToken);
        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta comment like failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل الإعجاب بالتعليق', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم إعجاب تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        res.json({ success: true, data });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Like comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Like comment error:', error);
        res.status(500).json({ error: 'فشل الإعجاب بالتعليق' });
    }
});

router.delete('/fb-content/:linkedPageId/comments/:commentId/like', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_UNLIKE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}/likes`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta comment unlike failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل إزالة الإعجاب', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم إزالة إعجاب تعليق Facebook في ${page.page_name || page.page_id}`,
        });

        res.json({ success: true, data });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Unlike comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Unlike comment error:', error);
        res.status(500).json({ error: 'فشل إزالة الإعجاب' });
    }
});

router.delete('/fb-content/:linkedPageId/comments/:commentId', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, commentId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.FACEBOOK_COMMENT_DELETE,
            quantity: 1,
            referenceType: 'facebook_content',
            metadata: { linked_page_id: linkedPageId, page_id: page.page_id, comment_id: commentId },
        });

        const response = await fetch(`${META_API_BASE}/${commentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            releaseBilling(billingReservation, data.error?.message || 'Meta comment delete failed');
            return res.status(response.status).json({ error: data.error?.message || 'فشل حذف التعليق', details: data.error });
        }

        commitBilling(billingReservation, {
            referenceId: commentId,
            description: `خصم حذف تعليق Facebook من ${page.page_name || page.page_id}`,
        });

        res.json({ success: true });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Delete comment billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Delete comment error:', error);
        res.status(500).json({ error: 'فشل حذف التعليق' });
    }
});

// ============================================
// Component 3: Tenant Automation Rules
// ============================================
router.get('/automation/rules', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { rule_type, channel, is_active } = req.query;

        let query = 'SELECT * FROM automation_rules WHERE tenant_id = ?';
        const params = [tenantId];

        if (rule_type) {
            query += ' AND rule_type = ?';
            params.push(rule_type);
        }
        if (channel) {
            query += ' AND channel = ?';
            params.push(channel);
        }
        if (is_active !== undefined) {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' ? 1 : 0);
        }

        query += ' ORDER BY priority ASC, id ASC';

        const rules = db.prepare(query).all(...params);
        res.json(rules);
    } catch (error) {
        console.error('[TenantPortal] List automation rules error:', error);
        res.status(500).json({ error: 'فشل جلب القواعد' });
    }
});

router.get('/automation/rules/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);

        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });
        res.json(rule);
    } catch (error) {
        console.error('[TenantPortal] Get rule error:', error);
        res.status(500).json({ error: 'فشل جلب القاعدة' });
    }
});

router.post('/automation/rules', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const {
            name, rule_type, channel, is_active, priority,
            match_type, match_pattern, match_case_sensitive,
            schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
            response_type, response_text,
            response_template_name, response_template_language,
            cooldown_seconds,
            target_post_id, target_page_id, response_action, dm_text, trigger_on,
            auto_like, auto_like_type,
        } = req.body;

        if (!name || !rule_type) {
            return res.status(400).json({ error: 'الاسم ونوع القاعدة مطلوبان' });
        }

        if (!['keyword', 'welcome', 'away', 'comment_reply'].includes(rule_type)) {
            return res.status(400).json({ error: 'نوع القاعدة غير صالح' });
        }

        if (rule_type === 'keyword' && (!match_type || !match_pattern)) {
            return res.status(400).json({ error: 'نمط المطابقة مطلوب لقواعد الكلمات المفتاحية' });
        }

        if (rule_type === 'away' && (!schedule_days || !schedule_start_time || !schedule_end_time)) {
            return res.status(400).json({ error: 'جدول المواعيد مطلوب لقواعد خارج الدوام' });
        }

        if (rule_type === 'comment_reply' && !response_text && !dm_text) {
            return res.status(400).json({ error: 'نص الرد أو نص الرسالة الخاصة مطلوب' });
        }

        if (response_type !== 'template' && !response_text && rule_type !== 'comment_reply') {
            return res.status(400).json({ error: 'نص الرد مطلوب' });
        }

        const result = db.prepare(`
            INSERT INTO automation_rules (
                tenant_id, name, rule_type, channel,
                is_active, priority,
                match_type, match_pattern, match_case_sensitive,
                schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
                response_type, response_text,
                response_template_name, response_template_language,
                cooldown_seconds,
                target_post_id, target_page_id, response_action, dm_text, trigger_on,
                auto_like, auto_like_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenantId,
            name,
            rule_type,
            channel || (rule_type === 'comment_reply' ? 'facebook' : 'all'),
            is_active !== undefined ? (is_active ? 1 : 0) : 1,
            priority || 100,
            match_type || null,
            match_pattern || null,
            match_case_sensitive ? 1 : 0,
            schedule_days ? (typeof schedule_days === 'string' ? schedule_days : JSON.stringify(schedule_days)) : null,
            schedule_start_time || null,
            schedule_end_time || null,
            schedule_timezone || 'Africa/Tripoli',
            response_type || 'text',
            response_text || null,
            response_template_name || null,
            response_template_language || 'ar',
            cooldown_seconds !== undefined ? cooldown_seconds : 300,
            target_post_id || null,
            target_page_id || null,
            response_action || 'comment',
            dm_text || null,
            trigger_on || 'comment',
            auto_like ? 1 : 0,
            auto_like_type || 'like',
        );

        const newRule = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newRule);
    } catch (error) {
        console.error('[TenantPortal] Create rule error:', error);
        res.status(500).json({ error: 'فشل إنشاء القاعدة' });
    }
});

router.put('/automation/rules/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const existing = db.prepare('SELECT * FROM automation_rules WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);
        if (!existing) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const {
            name, rule_type, channel, is_active, priority,
            match_type, match_pattern, match_case_sensitive,
            schedule_days, schedule_start_time, schedule_end_time, schedule_timezone,
            response_type, response_text,
            response_template_name, response_template_language,
            cooldown_seconds,
            target_post_id, target_page_id, response_action, dm_text, trigger_on,
            auto_like, auto_like_type,
        } = req.body;

        db.prepare(`
            UPDATE automation_rules SET
                name = ?,
                rule_type = ?,
                channel = ?,
                is_active = ?,
                priority = ?,
                match_type = ?,
                match_pattern = ?,
                match_case_sensitive = ?,
                schedule_days = ?,
                schedule_start_time = ?,
                schedule_end_time = ?,
                schedule_timezone = ?,
                response_type = ?,
                response_text = ?,
                response_template_name = ?,
                response_template_language = ?,
                cooldown_seconds = ?,
                target_post_id = ?,
                target_page_id = ?,
                response_action = ?,
                dm_text = ?,
                trigger_on = ?,
                auto_like = ?,
                auto_like_type = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ? AND tenant_id = ?
        `).run(
            name || existing.name,
            rule_type || existing.rule_type,
            channel || existing.channel,
            is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
            priority !== undefined ? priority : existing.priority,
            match_type !== undefined ? match_type : existing.match_type,
            match_pattern !== undefined ? match_pattern : existing.match_pattern,
            match_case_sensitive !== undefined ? (match_case_sensitive ? 1 : 0) : existing.match_case_sensitive,
            schedule_days !== undefined
                ? (typeof schedule_days === 'string' ? schedule_days : JSON.stringify(schedule_days))
                : existing.schedule_days,
            schedule_start_time !== undefined ? schedule_start_time : existing.schedule_start_time,
            schedule_end_time !== undefined ? schedule_end_time : existing.schedule_end_time,
            schedule_timezone !== undefined ? schedule_timezone : existing.schedule_timezone,
            response_type !== undefined ? response_type : existing.response_type,
            response_text !== undefined ? response_text : existing.response_text,
            response_template_name !== undefined ? response_template_name : existing.response_template_name,
            response_template_language !== undefined ? response_template_language : existing.response_template_language,
            cooldown_seconds !== undefined ? cooldown_seconds : existing.cooldown_seconds,
            target_post_id !== undefined ? (target_post_id || null) : existing.target_post_id,
            target_page_id !== undefined ? (target_page_id || null) : existing.target_page_id,
            response_action !== undefined ? response_action : existing.response_action,
            dm_text !== undefined ? (dm_text || null) : existing.dm_text,
            trigger_on !== undefined ? trigger_on : (existing.trigger_on || 'comment'),
            auto_like !== undefined ? (auto_like ? 1 : 0) : (existing.auto_like || 0),
            auto_like_type !== undefined ? auto_like_type : (existing.auto_like_type || 'like'),
            req.params.id,
            tenantId,
        );

        const updated = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        console.error('[TenantPortal] Update rule error:', error);
        res.status(500).json({ error: 'فشل تحديث القاعدة' });
    }
});

router.patch('/automation/rules/:id/toggle', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const newState = rule.is_active ? 0 : 1;
        db.prepare('UPDATE automation_rules SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?')
            .run(newState, req.params.id, tenantId);

        res.json({ id: rule.id, is_active: newState });
    } catch (error) {
        console.error('[TenantPortal] Toggle rule error:', error);
        res.status(500).json({ error: 'فشل تبديل حالة القاعدة' });
    }
});

router.delete('/automation/rules/:id', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        db.prepare('DELETE FROM automation_rules WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId);
        res.json({ success: true });
    } catch (error) {
        console.error('[TenantPortal] Delete rule error:', error);
        res.status(500).json({ error: 'فشل حذف القاعدة' });
    }
});

router.get('/automation/rules/:id/stats', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, tenantId);
        if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });

        const recentCooldowns = db.prepare(`
            SELECT contact_id, channel, last_triggered_at
            FROM automation_cooldowns
            WHERE rule_id = ?
            ORDER BY last_triggered_at DESC
            LIMIT 20
        `).all(req.params.id);

        res.json({
            rule_id: rule.id,
            trigger_count: rule.trigger_count,
            last_triggered_at: rule.last_triggered_at,
            recent_contacts: recentCooldowns,
        });
    } catch (error) {
        console.error('[TenantPortal] Rule stats error:', error);
        res.status(500).json({ error: 'فشل جلب الإحصائيات' });
    }
});

router.get('/automation/summary', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const total = db.prepare('SELECT COUNT(*) as count FROM automation_rules WHERE tenant_id = ?').get(tenantId).count;
        const active = db.prepare('SELECT COUNT(*) as count FROM automation_rules WHERE tenant_id = ? AND is_active = 1').get(tenantId).count;
        const keywords = db.prepare("SELECT COUNT(*) as count FROM automation_rules WHERE tenant_id = ? AND rule_type = 'keyword' AND is_active = 1").get(tenantId).count;
        const totalTriggers = db.prepare('SELECT COALESCE(SUM(trigger_count), 0) as count FROM automation_rules WHERE tenant_id = ?').get(tenantId).count;
        const weekTriggers = db.prepare(`
            SELECT COALESCE(SUM(trigger_count), 0) as count FROM automation_rules
            WHERE tenant_id = ? AND last_triggered_at >= datetime('now', '-7 days')
        `).get(tenantId).count;

        res.json({ total, active, keywords, weekTriggers, totalTriggers });
    } catch (error) {
        console.error('[TenantPortal] Automation summary error:', error);
        res.status(500).json({ error: 'فشل جلب الملخص' });
    }
});

// ============================================
// Component 4: Tenant Page Insights
// ============================================
const safeMetricValue = (insightsData, metricName, period = 'days_28') => {
    const metric = (insightsData || []).find(m => m.name === metricName);
    if (!metric || !metric.values || metric.values.length === 0) return null;
    const periodValue = metric.values.find(v => v.period === period) || metric.values[0];
    return periodValue?.value ?? null;
};

const metaErrorMessage = (data, fallback) => data?.error?.message || fallback;

const normalizeMetricNumber = (value) => {
    if (typeof value === 'number') return value;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + (Number(item) || 0), 0);
    return null;
};

const POST_ENGAGEMENT_FIELDS = [
    'id',
    'message',
    'created_time',
    'full_picture',
    'permalink_url',
    'likes.limit(0).summary(true)',
    'comments.limit(0).summary(true)',
    'reactions.limit(0).summary(true)',
    'shares',
].join(',');

const summaryCount = (edge) => Number(edge?.summary?.total_count || 0);

const extractPostEngagement = (post) => ({
    likes: summaryCount(post.likes),
    comments: summaryCount(post.comments),
    reactions: summaryCount(post.reactions),
    shares: Number(post.shares?.count || 0),
});

const fetchRecentPostEngagement = async (pageId, accessToken, days = 28) => {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const response = await fetch(
        `${META_API_BASE}/${pageId}/posts?fields=${encodeURIComponent(POST_ENGAGEMENT_FIELDS)}&limit=100&since=${since}&access_token=${accessToken}`
    );
    const data = await response.json();

    if (!response.ok) {
        return {
            totals: { likes: null, comments: null, reactions: null, shares: null, posts: 0 },
            error: metaErrorMessage(data, 'تعذر جلب تفاعل المنشورات من Meta'),
        };
    }

    const totals = (data.data || []).reduce((acc, post) => {
        const engagement = extractPostEngagement(post);
        acc.likes += engagement.likes;
        acc.comments += engagement.comments;
        acc.reactions += engagement.reactions;
        acc.shares += engagement.shares;
        acc.posts += 1;
        return acc;
    }, { likes: 0, comments: 0, reactions: 0, shares: 0, posts: 0 });

    return { totals, error: null };
};

router.get('/fb-insights/:linkedPageId/overview', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const metaResponse = await fetch(
            `${META_API_BASE}/${page.page_id}?fields=name,followers_count,fan_count,talking_about_count,picture.width(100).height(100)&access_token=${accessToken}`
        );
        const metaData = await metaResponse.json();

        if (!metaResponse.ok) {
            return res.status(metaResponse.status).json({ error: metaData.error?.message || 'فشل جلب بيانات الصفحة', details: metaData.error });
        }

        const insightsResponse = await fetch(
            `${META_API_BASE}/${page.page_id}/insights?metric=page_views_total,page_actions_post_reactions_total,page_video_views&period=days_28&access_token=${accessToken}`
        );
        const insightsData = await insightsResponse.json();
        const insightsError = insightsResponse.ok
            ? null
            : metaErrorMessage(insightsData, 'تعذر جلب بعض مؤشرات الصفحة من Meta');
        const insights = insightsResponse.ok ? (insightsData.data || []) : [];
        const recentEngagement = await fetchRecentPostEngagement(page.page_id, accessToken, 28);
        const insightReactions = safeMetricValue(insights, 'page_actions_post_reactions_total', 'days_28');

        res.json({
            page: {
                name: metaData.name || page.page_name,
                followers_count: metaData.followers_count ?? metaData.fan_count ?? 0,
                talking_about_count: metaData.talking_about_count ?? 0,
                picture: metaData.picture?.data?.url || page.page_picture_url || null,
            },
            metrics: {
                views_28d: safeMetricValue(insights, 'page_views_total', 'days_28'),
                reactions_28d: insightReactions ?? recentEngagement.totals.reactions,
                video_views_28d: safeMetricValue(insights, 'page_video_views', 'days_28'),
                post_likes_28d: recentEngagement.totals.likes,
                post_comments_28d: recentEngagement.totals.comments,
                post_shares_28d: recentEngagement.totals.shares,
                posts_count_28d: recentEngagement.totals.posts,
            },
            insights_error: insightsError || recentEngagement.error,
        });
    } catch (error) {
        console.error('[TenantPortal] Insights overview error:', error);
        res.status(500).json({ error: 'فشل جلب بيانات التحليلات' });
    }
});

router.get('/fb-insights/:linkedPageId/daily', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId } = req.params;
        const { since, until } = req.query;
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const untilDate = until || new Date().toISOString().split('T')[0];
        const sinceDate = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const response = await fetch(
            `${META_API_BASE}/${page.page_id}/insights?metric=page_views_total,page_actions_post_reactions_total,page_video_views&period=day&since=${sinceDate}&until=${untilDate}&access_token=${accessToken}`
        );
        const data = await response.json();

        if (!response.ok) {
            return res.json({
                daily: [],
                insights_error: metaErrorMessage(data, 'تعذر جلب البيانات اليومية من Meta'),
                details: data.error || null,
            });
        }

        const dailyMap = {};
        for (const metric of (data.data || [])) {
            for (const entry of (metric.values || [])) {
                const date = (entry.end_time || entry.value?.end_time || '').split('T')[0];
                if (!date) continue;
                if (!dailyMap[date]) dailyMap[date] = { date, views: 0, reactions: 0, video_views: 0 };
                const value = normalizeMetricNumber(entry.value);
                if (metric.name === 'page_views_total') dailyMap[date].views += value || 0;
                if (metric.name === 'page_actions_post_reactions_total') dailyMap[date].reactions += value || 0;
                if (metric.name === 'page_video_views') dailyMap[date].video_views += value || 0;
            }
        }

        const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
        res.json({ daily, insights_error: null });
    } catch (error) {
        console.error('[TenantPortal] Daily insights error:', error);
        res.status(500).json({ error: 'فشل جلب البيانات اليومية' });
    }
});

router.get('/fb-insights/:linkedPageId/posts', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 25, 25);
        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const postsResponse = await fetch(
            `${META_API_BASE}/${page.page_id}/posts?fields=${encodeURIComponent(POST_ENGAGEMENT_FIELDS)}&limit=${limit}&access_token=${accessToken}`
        );
        const postsData = await postsResponse.json();

        if (!postsResponse.ok) {
            return res.status(postsResponse.status).json({ error: postsData.error?.message || 'فشل جلب المنشورات', details: postsData.error });
        }

        const posts = postsData.data || [];
        const insightsLimit = Math.min(posts.length, 10);
        const postsWithInsights = await Promise.all(posts.map(async (post, i) => {
            const postEntry = {
                id: post.id,
                message: post.message || '',
                created_time: post.created_time || null,
                full_picture: post.full_picture || null,
                permalink_url: post.permalink_url || null,
                engagement: extractPostEngagement(post),
                insights: { clicks: null },
            };

            if (i < insightsLimit) {
                try {
                    const insightsResponse = await fetch(
                        `${META_API_BASE}/${post.id}/insights?metric=post_reactions_by_type_total,post_clicks&period=lifetime&access_token=${accessToken}`
                    );
                    const insightsData = await insightsResponse.json();

                    if (insightsResponse.ok && insightsData.data) {
                        const clicksMetric = insightsData.data.find(m => m.name === 'post_clicks');

                        let clicks = null;
                        if (clicksMetric?.values?.[0]?.value) clicks = clicksMetric.values[0].value;

                        postEntry.insights = { clicks };
                    } else {
                        postEntry.insights_error = metaErrorMessage(insightsData, 'تعذر جلب مؤشرات المنشور');
                    }
                } catch (e) {
                    postEntry.insights_error = e.message || 'تعذر جلب مؤشرات المنشور';
                }
            }

            return postEntry;
        }));

        res.json({ posts: postsWithInsights, paging: postsData.paging || null });
    } catch (error) {
        console.error('[TenantPortal] Post insights error:', error);
        res.status(500).json({ error: 'فشل جلب أداء المنشورات' });
    }
});

// ============================================
// Component 5: Tenant Utility Messages
// NOTE: As of Feb 10, 2026, Meta deprecated CONFIRMED_EVENT_UPDATE,
// POST_PURCHASE_UPDATE, and ACCOUNT_UPDATE tags.
// Only HUMAN_AGENT remains, which requires App Review approval.
// ============================================
const VALID_MESSAGE_TAGS = [
    'HUMAN_AGENT',              // Human agent response (7-day window) — requires App Review
];

router.get('/fb-messenger/message-tags', (req, res) => {
    res.json({
        tags: VALID_MESSAGE_TAGS.map(tag => ({
            value: tag,
            label: {
                'HUMAN_AGENT': 'رد وكيل بشري (يتطلب مراجعة التطبيق)',
            }[tag],
            description: {
                'HUMAN_AGENT': 'Send a response to a user within 7 days of their last message (requires App Review)',
            }[tag],
        })),
    });
});

router.post('/fb-messenger/:linkedPageId/conversations/:convId/utility-message', async (req, res) => {
    let billingReservation = null;
    try {
        const tenantId = req.user.tenant_id;
        const { linkedPageId, convId } = req.params;
        const { message, tag } = req.body;

        if (!message || !tag) {
            return res.status(400).json({ error: 'نص الرسالة ونوع العلامة مطلوبان' });
        }

        if (!VALID_MESSAGE_TAGS.includes(tag)) {
            return res.status(400).json({ error: `علامة غير صالحة: ${tag}`, valid_tags: VALID_MESSAGE_TAGS });
        }

        const { page, accessToken, error, status } = resolveTenantPage(linkedPageId, tenantId);
        if (error) return res.status(status).json({ error });

        const conv = db.prepare('SELECT * FROM fb_conversations WHERE id = ? AND linked_page_id = ? AND tenant_id = ?')
            .get(convId, linkedPageId, tenantId);
        if (!conv) {
            return res.status(404).json({ error: 'المحادثة غير موجودة' });
        }

        billingReservation = reserveBilling({
            tenantId,
            operationKey: BILLING_OPERATIONS.MESSENGER_UTILITY,
            quantity: 1,
            referenceType: 'messenger_message',
            metadata: { linked_page_id: linkedPageId, conversation_id: convId, user_psid: conv.user_psid, tag },
        });

        const sendResponse = await fetch(`${META_API_BASE}/${page.page_id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: conv.user_psid },
                messaging_type: 'MESSAGE_TAG',
                tag: tag,
                message: { text: message },
            }),
        });

        const sendData = await sendResponse.json();

        if (!sendResponse.ok || sendData.error) {
            releaseBilling(billingReservation, sendData.error?.message || 'Meta Messenger utility failed');
            return res.status(sendResponse.status || 400).json({
                error: sendData.error?.message || 'فشل إرسال الرسالة',
                details: sendData.error,
            });
        }

        const mid = sendData.message_id;
        commitBilling(billingReservation, {
            referenceId: mid,
            description: `خصم رسالة Messenger موسومة: ${tag}`,
        });

        const createdAt = normalizeMessengerTimestamp();
        insertMessengerMessage(db, {
            conversationId: conv.id,
            tenantId,
            mid,
            direction: 'outgoing',
            senderId: page.page_id,
            senderName: page.page_name,
            messageText: `[${tag}] ${message}`,
            createdAt,
        });

        db.prepare(`
            UPDATE fb_conversations SET last_message = ?, last_message_time = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(message.substring(0, 100), createdAt, conv.id);

        eventBus.broadcast(`tenant:${tenantId}`, 'fb_message:new', {
            tenant_id: tenantId,
            page_id: conv.page_id,
            conversation_id: conv.id,
            direction: 'outgoing',
            sender_id: page.page_id,
            sender_name: page.page_name,
            message: `[${tag}] ${message}`,
            tag,
        });

        res.status(201).json({ id: mid, conversation_id: conv.id, tag });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[TenantPortal] Utility billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[TenantPortal] Utility message error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة' });
    }
});

// ============================================
// Meta Config (exposes non-secret config to frontend)
// ============================================
router.get('/meta/config', (req, res) => {
    res.json({
        app_id: META_APP_ID,
        config_id: WA_EMBEDDED_SIGNUP_CONFIG_ID,
        api_version: META_API_VERSION,
        facebook_review_scopes: FACEBOOK_REVIEW_SCOPES,
        facebook_webhook_fields: FACEBOOK_WEBHOOK_FIELDS,
        facebook_oauth_available: !!(META_APP_ID && META_APP_SECRET && FACEBOOK_REDIRECT_URI),
        whatsapp_signup_available: !!(META_APP_ID && WA_EMBEDDED_SIGNUP_CONFIG_ID),
    });
});

// ============================================
// Facebook OAuth — Self-Service Page Linking
// ============================================
const oauthSessions = new Map();
const OAUTH_SESSION_TTL = 10 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of oauthSessions) {
        if (now - val.createdAt > OAUTH_SESSION_TTL) oauthSessions.delete(key);
    }
}, 60 * 1000);

router.get('/facebook/auth-url', (req, res) => {
    if (!META_APP_ID || !META_APP_SECRET || !FACEBOOK_REDIRECT_URI) {
        return res.status(400).json({ error: 'Facebook OAuth not configured' });
    }

    const tenantId = req.user.tenant_id;
    const state = crypto.randomBytes(16).toString('hex');

    oauthSessions.set(state, { tenantId, createdAt: Date.now() });

    const params = new URLSearchParams({
        client_id: META_APP_ID,
        redirect_uri: FACEBOOK_REDIRECT_URI,
        state,
        scope: FACEBOOK_REVIEW_SCOPES.join(','),
        response_type: 'code',
    });

    res.json({
        url: `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`,
        state,
    });
});

router.post('/facebook/connect', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { code, state } = req.body;

        if (!code || !state) {
            return res.status(400).json({ error: 'code and state are required' });
        }

        const session = oauthSessions.get(state);
        if (!session || session.tenantId !== tenantId) {
            return res.status(400).json({ error: 'Invalid or expired OAuth state' });
        }
        oauthSessions.delete(state);

        const tokenRes = await fetch(
            `${META_API_BASE}/oauth/access_token?${new URLSearchParams({
                client_id: META_APP_ID,
                redirect_uri: FACEBOOK_REDIRECT_URI,
                client_secret: META_APP_SECRET,
                code,
            })}`
        );
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            return res.status(400).json({ error: 'Token exchange failed', details: tokenData.error.message });
        }

        const llRes = await fetch(
            `${META_API_BASE}/oauth/access_token?${new URLSearchParams({
                grant_type: 'fb_exchange_token',
                client_id: META_APP_ID,
                client_secret: META_APP_SECRET,
                fb_exchange_token: tokenData.access_token,
            })}`
        );
        const llData = await llRes.json();
        if (llData.error) {
            return res.status(400).json({ error: 'Long-lived token exchange failed', details: llData.error.message });
        }

        let grantedScopes = [];
        let tokenStatus = 'unchecked';
        let tokenExpiresAt = null;
        let tokenAppId = null;
        let facebookUserProfile = null;
        try {
            const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
            const debugRes = await fetch(
                `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(llData.access_token)}&access_token=${encodeURIComponent(appAccessToken)}`
            );
            const debugData = await debugRes.json();
            const tokenData = debugData.data || {};
            grantedScopes = tokenData.scopes || [];
            tokenStatus = tokenData.is_valid === true ? 'valid' : 'invalid';
            tokenExpiresAt = tokenData.expires_at && tokenData.expires_at > 0
                ? new Date(tokenData.expires_at * 1000).toISOString()
                : null;
            tokenAppId = tokenData.app_id || null;
        } catch (e) {
            console.warn('[TenantPortal] Facebook token debug failed:', e.message);
        }

        try {
            const profileRes = await fetch(
                `${META_API_BASE}/me?fields=id,name,email,picture.width(100).height(100)&access_token=${encodeURIComponent(llData.access_token)}`
            );
            const profileData = await profileRes.json();
            if (profileData.error) {
                console.warn('[TenantPortal] Facebook profile fetch failed:', profileData.error.message);
            } else {
                facebookUserProfile = {
                    id: profileData.id || null,
                    name: profileData.name || null,
                    email: profileData.email || null,
                    picture_url: profileData.picture?.data?.url || null,
                };
            }
        } catch (e) {
            console.warn('[TenantPortal] Facebook profile fetch failed:', e.message);
        }

        db.prepare(`
            UPDATE tenants
            SET facebook_user_access_token_encrypted = ?,
                facebook_user_token_scopes = ?,
                facebook_user_token_updated_at = datetime('now', 'localtime'),
                facebook_user_token_status = ?,
                facebook_user_token_expires_at = ?,
                facebook_user_token_checked_at = datetime('now', 'localtime'),
                facebook_user_token_app_id = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(
            encrypt(llData.access_token),
            JSON.stringify(grantedScopes),
            tokenStatus,
            tokenExpiresAt,
            tokenAppId,
            tenantId
        );

        if (facebookUserProfile?.id) {
            db.prepare(`
                UPDATE tenants
                SET facebook_user_id = ?,
                    facebook_user_name = ?,
                    facebook_user_email = ?,
                    facebook_user_picture_url = ?,
                    facebook_user_profile_updated_at = datetime('now', 'localtime'),
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                facebookUserProfile.id,
                facebookUserProfile.name,
                facebookUserProfile.email,
                facebookUserProfile.picture_url,
                tenantId
            );
        }

        const pagesRes = await fetch(
            `${META_API_BASE}/me/accounts?fields=id,name,category,picture.width(100).height(100),access_token&access_token=${llData.access_token}`
        );
        const pagesData = await pagesRes.json();
        if (pagesData.error) {
            return res.status(400).json({ error: 'Failed to fetch pages', details: pagesData.error.message });
        }

        const pages = (pagesData.data || []).map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            picture_url: p.picture?.data?.url || null,
            access_token: p.access_token,
        }));

        const linkState = crypto.randomBytes(16).toString('hex');
        oauthSessions.set(linkState, { tenantId, longLivedToken: llData.access_token, createdAt: Date.now() });

        const missingScopes = FACEBOOK_REVIEW_SCOPES.filter(scope => !grantedScopes.includes(scope));

        res.json({
            pages,
            link_state: linkState,
            granted_scopes: grantedScopes,
            missing_scopes: missingScopes,
            facebook_user: facebookUserProfile,
        });
    } catch (error) {
        console.error('[TenantPortal] Facebook connect error:', error);
        res.status(500).json({ error: 'فشل ربط فيسبوك' });
    }
});

router.get('/facebook/diagnostics', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const tenant = db.prepare(`
            SELECT facebook_user_access_token_encrypted,
                   facebook_user_token_scopes,
                   facebook_user_token_updated_at,
                   facebook_user_id,
                   facebook_user_name,
                   facebook_user_email,
                   facebook_user_picture_url,
                   facebook_user_profile_updated_at
            FROM tenants
            WHERE id = ?
        `).get(tenantId);

        let grantedScopes = [];
        if (tenant?.facebook_user_token_scopes) {
            try {
                grantedScopes = JSON.parse(tenant.facebook_user_token_scopes);
            } catch {
                grantedScopes = [];
            }
        }

        const missingScopes = FACEBOOK_REVIEW_SCOPES.filter(scope => !grantedScopes.includes(scope));
        const pages = db.prepare(`
            SELECT id, page_id, page_name, page_category, page_picture_url,
                   is_active, subscribed_fields, webhook_subscribed,
                   token_status, token_expires_at, token_checked_at, updated_at
            FROM tenant_pages
            WHERE tenant_id = ?
            ORDER BY updated_at DESC
        `).all(tenantId).map(page => {
            let subscribedFields = [];
            try {
                subscribedFields = JSON.parse(page.subscribed_fields || '[]');
            } catch {
                subscribedFields = [];
            }

            return {
                ...page,
                subscribed_fields: subscribedFields,
                missing_webhook_fields: FACEBOOK_WEBHOOK_FIELDS.filter(field => !subscribedFields.includes(field)),
            };
        });

        res.json({
            requested_scopes: FACEBOOK_REVIEW_SCOPES,
            granted_scopes: grantedScopes,
            missing_scopes: missingScopes,
            facebook_user_token_present: !!tenant?.facebook_user_access_token_encrypted,
            facebook_user_token_updated_at: tenant?.facebook_user_token_updated_at || null,
            facebook_user_identity: {
                id: tenant?.facebook_user_id || null,
                name: tenant?.facebook_user_name || null,
                email: tenant?.facebook_user_email || null,
                picture_url: tenant?.facebook_user_picture_url || null,
                updated_at: tenant?.facebook_user_profile_updated_at || null,
                public_profile_ready: !!(tenant?.facebook_user_id && tenant?.facebook_user_name),
                email_granted: grantedScopes.includes('email'),
                email_ready: !!tenant?.facebook_user_email,
            },
            required_webhook_fields: FACEBOOK_WEBHOOK_FIELDS,
            pages,
        });
    } catch (error) {
        console.error('[TenantPortal] Facebook diagnostics error:', error);
        res.status(500).json({ error: 'فشل جلب تشخيص فيسبوك' });
    }
});

router.get('/meta-review/readiness', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const readiness = await buildMetaReviewReadiness(tenantId);
        res.json(readiness);
    } catch (error) {
        console.error('[TenantPortal] Meta review readiness error:', error);
        res.status(error.status || 500).json({ error: 'فشل جلب جاهزية مراجعة Meta' });
    }
});

router.get('/meta-review/snapshots', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        res.json({ snapshots: listMetaReviewSnapshots(tenantId, limit) });
    } catch (error) {
        console.error('[TenantPortal] Meta review snapshots error:', error);
        res.status(500).json({ error: 'فشل جلب لقطات جاهزية Meta' });
    }
});

router.post('/meta-review/snapshot', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const readiness = await buildMetaReviewReadiness(tenantId);
        const snapshot = saveMetaReviewSnapshot(tenantId, readiness);
        res.status(201).json({ snapshot, readiness });
    } catch (error) {
        console.error('[TenantPortal] Meta review snapshot error:', error);
        res.status(error.status || 500).json({ error: 'فشل حفظ لقطة جاهزية Meta' });
    }
});

router.post('/facebook/link-pages', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { link_state, page_ids } = req.body;

        if (!link_state || !page_ids || !Array.isArray(page_ids)) {
            return res.status(400).json({ error: 'link_state and page_ids are required' });
        }

        const session = oauthSessions.get(link_state);
        if (!session || session.tenantId !== tenantId) {
            return res.status(400).json({ error: 'Invalid or expired link state' });
        }
        oauthSessions.delete(link_state);

        const longLivedToken = session.longLivedToken;

        const pagesRes = await fetch(
            `${META_API_BASE}/me/accounts?fields=id,name,category,picture.width(100).height(100),access_token&access_token=${longLivedToken}`
        );
        const pagesData = await pagesRes.json();
        if (pagesData.error) {
            return res.status(400).json({ error: 'Failed to fetch pages', details: pagesData.error.message });
        }

        const allPages = pagesData.data || [];
        const selectedPages = allPages.filter(p => page_ids.includes(p.id));
        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
        const linked = [];

        for (const page of selectedPages) {
            const encryptedToken = encrypt(page.access_token);
            const pagePictureUrl = page.picture?.data?.url || null;
            let linkedPageDbId;
            let webhookSubscribed = false;
            let webhookError = null;

            const existing = db.prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND page_id = ?').get(tenantId, page.id);

            if (existing) {
                db.prepare("UPDATE tenant_pages SET page_access_token_encrypted = ?, page_name = ?, page_category = ?, page_picture_url = ?, is_active = 1, updated_at = datetime('now', 'localtime') WHERE id = ?")
                    .run(encryptedToken, page.name, page.category || null, pagePictureUrl, existing.id);
                linkedPageDbId = existing.id;
            } else {
                const result = db.prepare(`
                    INSERT INTO tenant_pages (tenant_id, platform, page_id, page_name, page_access_token_encrypted, page_category, page_picture_url, webhook_subscribed)
                    VALUES (?, 'facebook', ?, ?, ?, ?, ?, 0)
                `).run(tenantId, page.id, page.name, encryptedToken, page.category || null, pagePictureUrl);
                linkedPageDbId = result.lastInsertRowid;
            }

            if (META_APP_ID && META_APP_SECRET) {
                try {
                    const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
                    const debugRes = await fetch(
                        `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(page.access_token)}&access_token=${encodeURIComponent(appAccessToken)}`
                    );
                    const debugData = await debugRes.json();
                    const tokenData = debugData.data || {};
                    db.prepare(`
                        UPDATE tenant_pages
                        SET token_status = ?,
                            token_expires_at = ?,
                            token_checked_at = datetime('now', 'localtime'),
                            token_app_id = ?,
                            token_scopes = ?
                        WHERE id = ?
                    `).run(
                        tokenData.is_valid === true ? 'valid' : 'invalid',
                        tokenData.expires_at && tokenData.expires_at > 0 ? new Date(tokenData.expires_at * 1000).toISOString() : null,
                        tokenData.app_id || null,
                        JSON.stringify(tokenData.scopes || []),
                        linkedPageDbId
                    );
                } catch (e) {
                    console.warn('[TenantPortal] Page token debug failed for page', page.id, e.message);
                }
            }

            try {
                const subscribeResponse = await fetch(`${META_API_BASE}/${page.id}/subscribed_apps`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        access_token: page.access_token,
                        subscribed_fields: FACEBOOK_WEBHOOK_FIELDS.join(','),
                    }).toString(),
                });
                const subscribeData = await subscribeResponse.json();

                if (subscribeResponse.ok && subscribeData.success !== false) {
                    webhookSubscribed = true;
                    db.prepare(`
                        UPDATE tenant_pages
                        SET webhook_subscribed = 1,
                            subscribed_fields = ?,
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ?
                    `).run(JSON.stringify(FACEBOOK_WEBHOOK_FIELDS), linkedPageDbId);
                } else {
                    webhookError = subscribeData.error?.message || 'فشل اشتراك Webhook';
                    db.prepare("UPDATE tenant_pages SET webhook_subscribed = 0, updated_at = datetime('now', 'localtime') WHERE id = ?")
                        .run(linkedPageDbId);
                    console.warn('[TenantPortal] Webhook subscription failed for page', page.id, webhookError);
                }
            } catch (e) {
                webhookError = e.message;
                db.prepare("UPDATE tenant_pages SET webhook_subscribed = 0, updated_at = datetime('now', 'localtime') WHERE id = ?")
                    .run(linkedPageDbId);
                console.warn('[TenantPortal] Webhook subscription failed for page', page.id, e.message);
            }

            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'page_linked', ?, 'success')
            `).run(tenantId, tenant?.name, `ربط صفحة فيسبوك: ${page.name}`);

            linked.push({
                id: page.id,
                name: page.name,
                webhook_subscribed: webhookSubscribed,
                webhook_error: webhookError,
            });
        }

        res.json({ success: true, linked });
    } catch (error) {
        console.error('[TenantPortal] Facebook link-pages error:', error);
        res.status(500).json({ error: 'فشل ربط الصفحات' });
    }
});

router.delete('/facebook/disconnect/:linkedPageId', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const linkedPageId = req.params.linkedPageId;

        const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND tenant_id = ?').get(linkedPageId, tenantId);
        if (!page) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        const accessToken = decryptIfEncrypted(page.page_access_token_encrypted);
        if (accessToken) {
            try {
                await fetch(`${META_API_BASE}/${page.page_id}/subscribed_apps`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ access_token: accessToken }).toString(),
                });
            } catch (e) {
                console.warn('[TenantPortal] Webhook unsubscribe failed:', e.message);
            }
        }

        db.prepare('DELETE FROM tenant_pages WHERE id = ?').run(linkedPageId);

        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'page_unlinked', ?, 'success')
        `).run(tenantId, tenant?.name, `إلغاء ربط صفحة فيسبوك: ${page.page_name || page.page_id}`);

        res.json({ success: true });
    } catch (error) {
        console.error('[TenantPortal] Facebook disconnect error:', error);
        res.status(500).json({ error: 'فشل إلغاء ربط الصفحة' });
    }
});

// ============================================
// WhatsApp Embedded Signup
// ============================================
router.post('/whatsapp/connect', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { code, phone_number_id, waba_id, business_id } = req.body;

        if (!code || !phone_number_id || !waba_id) {
            return res.status(400).json({ error: 'code, phone_number_id, and waba_id are required' });
        }

        if (!META_APP_ID || !META_APP_SECRET) {
            return res.status(400).json({ error: 'Meta app not configured' });
        }

        const tokenRes = await fetch(
            `${META_API_BASE}/oauth/access_token?${new URLSearchParams({
                client_id: META_APP_ID,
                client_secret: META_APP_SECRET,
                code,
            })}`
        );
        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            return res.status(400).json({ error: 'Token exchange failed', details: tokenData.error.message });
        }

        const accessToken = tokenData.access_token;
        const encryptedToken = encrypt(accessToken);

        db.prepare(`
            UPDATE tenants SET 
                waba_id = ?, phone_number_id = ?, business_id = ?,
                access_token_encrypted = ?, access_token = NULL,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(waba_id, phone_number_id, business_id || null, encryptedToken, tenantId);

        try {
            await fetch(`${META_API_BASE}/${waba_id}/subscribed_apps`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
            });
        } catch (e) {
            console.warn('[TenantPortal] WABA webhook subscription failed:', e.message);
        }

        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'whatsapp_connected', ?, 'success')
        `).run(tenantId, tenant?.name, `ربط حساب WhatsApp: ${phone_number_id}`);

        res.json({ success: true, waba_id, phone_number_id });
    } catch (error) {
        console.error('[TenantPortal] WhatsApp connect error:', error);
        res.status(500).json({ error: 'فشل ربط واتساب' });
    }
});

export default router;
