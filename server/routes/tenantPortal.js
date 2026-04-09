import express from 'express';
import db, { generateApiKey } from '../db/database.js';
import crypto from 'crypto';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for document uploads
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const documentUpload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم. يُسمح فقط بالمستندات (PDF, DOC, XLS, PPT)'));
        }
    }
});

const META_API_VERSION = 'v22.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Middleware to ensure user is a tenant (has tenant_id)
const ensureTenant = (req, res, next) => {
    if (!req.user || !req.user.tenant_id) {
        return res.status(403).json({ error: 'صلاحية الوصول مقتصرة على العملاء فقط' });
    }
    next();
};

// Apply tenant middleware to all routes
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

        // Get message stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString();

        const stats = {
            totalConversations: db.prepare(`
                SELECT COUNT(DISTINCT CASE WHEN direction = 'incoming' THEN sender ELSE recipient END) as count 
                FROM messages WHERE tenant_id = ?
            `).get(tenantId)?.count || 0,

            messagesToday: db.prepare(`
                SELECT COUNT(*) as count FROM messages 
                WHERE tenant_id = ? AND created_at >= ?
            `).get(tenantId, todayStr)?.count || 0,

            sentToday: db.prepare(`
                SELECT COUNT(*) as count FROM messages 
                WHERE tenant_id = ? AND direction = 'outgoing' AND created_at >= ?
            `).get(tenantId, todayStr)?.count || 0,

            receivedToday: db.prepare(`
                SELECT COUNT(*) as count FROM messages 
                WHERE tenant_id = ? AND direction = 'incoming' AND created_at >= ?
            `).get(tenantId, todayStr)?.count || 0,

            templatesCount: db.prepare(`
                SELECT COUNT(*) as count FROM templates WHERE tenant_id = ?
            `).get(tenantId)?.count || 0,

            unreadCount: db.prepare(`
                SELECT COUNT(*) as count FROM messages 
                WHERE tenant_id = ? AND direction = 'incoming' AND status = 'received'
            `).get(tenantId)?.count || 0,
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
// Conversations
// ============================================
router.get('/conversations', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        const conversations = db.prepare(`
            SELECT 
                t.contact,
                t.created_at as last_interaction,
                t.content as last_message,
                t.message_type as last_message_type,
                c.profile_name,
                c.profile_picture_url,
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
            LEFT JOIN contacts c ON c.phone = t.contact
            WHERE rn = 1
            ORDER BY last_interaction DESC
        `).all(tenantId, tenantId);

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

        const messages = db.prepare(`
            SELECT * FROM messages 
            WHERE tenant_id = ? AND (sender = ? OR recipient = ?)
            ORDER BY created_at ASC
        `).all(tenantId, contactPhone, contactPhone);

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
// Send Message
// ============================================
router.post('/messages/send', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { recipient, type, message, templateId, components } = req.body;

        if (!recipient) {
            return res.status(400).json({ error: 'رقم المستلم مطلوب' });
        }

        // Get tenant credentials
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const phoneNumberId = tenant.phone_number_id;
        const accessToken = tenant.access_token;

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        let payload = {
            messaging_product: 'whatsapp',
            to: recipient,
        };

        if (type === 'template' && templateId) {
            // Get template from database
            const template = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?').get(templateId, tenantId);
            if (!template) {
                return res.status(404).json({ error: 'القالب غير موجود' });
            }

            payload.type = 'template';
            payload.template = {
                name: template.name,
                language: { code: template.language || 'ar' },
            };

            // Add components if provided (from user input)
            if (components && Array.isArray(components) && components.length > 0) {
                payload.template.components = components;
            } else if (template.variables) {
                // Fallback to stored variables if no input provided (legacy/auto messages)
                try {
                    const variables = JSON.parse(template.variables);
                    if (variables.body && variables.body.length > 0) {
                        payload.template.components = [{
                            type: 'body',
                            parameters: variables.body.map(v => ({ type: 'text', text: v }))
                        }];
                    }
                } catch (e) { }
            }
        } else {
            payload.type = 'text';
            payload.text = { body: message };
        }

        console.log('[TenantPortal] Sending message:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        const substituteVariables = (text, params) => {
            if (!text || !params) return text;
            let result = text;
            params.forEach((param, index) => {
                const val = typeof param === 'string' ? param : param.text;
                result = result.replaceAll(`{{${index + 1}}}`, val || '');
            });
            return result;
        };

        let storedContent = message;
        if (type === 'template' && templateId) {
            try {
                // Get template from database again if needed, or use already fetched 'template'
                // We already fetched 'template' above at line 213

                const template = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?').get(templateId, tenantId);

                if (template) {
                    let bodyParams = [];

                    // Try to get params from input components first
                    if (components && Array.isArray(components)) {
                        const bodyComp = components.find(c => c.type === 'body' || c.type === 'BODY');
                        if (bodyComp && bodyComp.parameters) {
                            bodyParams = bodyComp.parameters;
                        }
                    }

                    // Fallback to stored variables only if no input params found
                    if (bodyParams.length === 0 && template.variables) {
                        try {
                            const variables = JSON.parse(template.variables);
                            if (variables.body) bodyParams = variables.body;
                        } catch (e) { }
                    }

                    const richContent = {
                        header: template.header_content ? {
                            type: template.header_type,
                            text: template.header_content
                        } : null,
                        body: substituteVariables(template.body, bodyParams),
                        footer: template.footer,
                        buttons: template.buttons ? JSON.parse(template.buttons) : null
                    };
                    storedContent = JSON.stringify(richContent);
                }
            } catch (e) {
                console.error('Failed to construct rich template content:', e);
                storedContent = `[قالب: ${templateId}]`;
            }
        }

        // Save message to database
        const messageRecord = {
            tenant_id: tenantId,
            direction: 'outgoing',
            recipient: recipient,
            message_type: type || 'text',
            content: storedContent,
            status: response.ok ? 'sent' : 'failed',
            wamid: data.messages?.[0]?.id || null,
            error_message: data.error?.message || null,
        };

        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            messageRecord.tenant_id,
            messageRecord.direction,
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
            type === 'template' ? 'template_sent' : 'message_sent',
            type === 'template' ? 'إرسال قالب' : 'إرسال رسالة نصية',
            response.ok ? 'success' : 'error'
        );

        if (response.ok) {
            res.json({ success: true, message_id: data.messages?.[0]?.id, data });
        } else {
            res.status(response.status).json({ success: false, error: data.error?.message, data });
        }
    } catch (error) {
        console.error('[TenantPortal] Send message error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة' });
    }
});

// ============================================
// Send Document (PDF, DOC, XLS, etc.)
// ============================================
router.post('/messages/send-document', documentUpload.single('file'), async (req, res) => {
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
        const accessToken = tenant.access_token;

if (!phoneNumberId || !accessToken) {
            if (file) fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        // Verify file exists and has content
        const fileStats = fs.statSync(file.path);
        console.log(`[TenantPortal] File stats:`, {
            path: file.path,
            size: fileStats.size,
            exists: fs.existsSync(file.path)
        });

        if (fileStats.size === 0) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'الملف فارغ' });
        }

        // Format recipient (remove + prefix if present)
        const formattedRecipient = recipient.replace(/\+/g, '').trim();

        // 1. Upload document to Meta
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', file.mimetype);
        
        // For Arabic filenames, use a safe ASCII filename
        const safeFilename = file.originalname.replace(/[^\x00-\x7F]/g, '') || `document_${Date.now()}.pdf`;
        
        // Create read stream and append to form
        const fileStream = fs.createReadStream(file.path);
        form.append('file', fileStream, safeFilename);

        console.log(`[TenantPortal] Uploading document for tenant ${tenantId}`);
        console.log(`[TenantPortal] File: ${safeFilename}, MIME: ${file.mimetype}, Size: ${fileStats.size}`);

        const uploadUrl = `${META_API_BASE}/${phoneNumberId}/media`;
        console.log(`[TenantPortal] Uploading to: ${uploadUrl}`);

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...form.getHeaders()
            },
            body: form
        });

        const uploadData = await uploadResponse.json();
        
        if (!uploadResponse.ok) {
            console.error('[TenantPortal] Meta upload error:', JSON.stringify(uploadData, null, 2));
        }

        // Cleanup uploaded file
        try {
            fs.unlinkSync(file.path);
        } catch (e) {
            console.warn('[TenantPortal] Failed to cleanup temp file:', e);
        }

        if (!uploadResponse.ok || !uploadData.id) {
            console.error('[TenantPortal] Meta upload error:', uploadData);
            return res.status(400).json({ 
                error: 'فشل رفع الملف إلى WhatsApp', 
                details: uploadData.error?.message || uploadData 
            });
        }

        const mediaId = uploadData.id;
        console.log(`[TenantPortal] Document uploaded. Media ID: ${mediaId}`);

        // 2. Send message with Media ID
        const payload = {
            messaging_product: 'whatsapp',
            to: formattedRecipient,
            type: 'document',
            document: {
                id: mediaId,
                filename: filename || file.originalname,
                caption: caption || ''
            }
        };

        console.log('[TenantPortal] Sending document:', JSON.stringify(payload, null, 2));

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
            return res.status(response.status).json({ 
                error: data.error?.message || 'فشل إرسال الملف', 
                data 
            });
        }

        // 3. Save to database
        db.prepare(`
            INSERT INTO messages (tenant_id, direction, recipient, message_type, content, status, wamid, media_url)
            VALUES (?, 'outgoing', ?, 'document', ?, 'sent', ?, ?)
        `).run(
            tenantId,
            formattedRecipient,
            caption || file.originalname,
            data.messages?.[0]?.id || null,
            mediaId
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'document_sent', 'إرسال مستند', 'success')
        `).run(tenantId, tenant.name);

        res.json({ 
            success: true, 
            message_id: data.messages?.[0]?.id,
            media_id: mediaId 
        });

    } catch (error) {
        console.error('[TenantPortal] Send document error:', error);
        // Cleanup file if it exists
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) {}
        }
        res.status(500).json({ error: 'فشل إرسال الملف' });
    }
});

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
                updated_at = CURRENT_TIMESTAMP
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

        if (!tenant.access_token) {
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
                        headers: { 'Authorization': `Bearer ${tenant.access_token}` }
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
                        `${META_API_BASE}/debug_token?input_token=${tenant.access_token}`,
                        {
                            headers: { 'Authorization': `Bearer ${tenant.access_token}` }
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

        // Fetch templates from Meta API
        const templatesResponse = await fetch(
            `${META_API_BASE}/${wabaId}/message_templates?limit=100`,
            {
                headers: { 'Authorization': `Bearer ${tenant.access_token}` }
            }
        );

        const templatesData = await templatesResponse.json();

        if (templatesData.error) {
            console.error('Templates API error:', templatesData.error);
            return res.status(400).json({
                error: 'فشل جلب القوالب من WhatsApp',
                details: templatesData.error.message
            });
        }

        const templates = (templatesData.data || []).map(t => ({
            id: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            components: t.components
        }));

        res.json({
            success: true,
            templates,
            count: templates.length
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
                    updated_at = CURRENT_TIMESTAMP
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
                updated_at = CURRENT_TIMESTAMP
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

export default router;
