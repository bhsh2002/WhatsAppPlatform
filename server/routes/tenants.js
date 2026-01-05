import express from 'express';
import db from '../db/database.js';

const router = express.Router();

// Get all tenants
router.get('/', (req, res) => {
    try {
        const tenants = db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
        res.json(tenants);
    } catch (error) {
        console.error('Error fetching tenants:', error);
        res.status(500).json({ error: 'Failed to fetch tenants' });
    }
});

// Get single tenant
router.get('/:id', (req, res) => {
    try {
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        res.json(tenant);
    } catch (error) {
        console.error('Error fetching tenant:', error);
        res.status(500).json({ error: 'Failed to fetch tenant' });
    }
});

// Create tenant
router.post('/', (req, res) => {
    try {
        const { name, phone, status, tier, credits, quality, phone_number_id, access_token } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const stmt = db.prepare(`
      INSERT INTO tenants (name, phone, status, tier, credits, quality, phone_number_id, access_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const result = stmt.run(
            name,
            phone || null,
            status || 'Active',
            tier || '1K',
            credits || 0,
            quality || 'High',
            phone_number_id || null,
            access_token || null
        );

        const newTenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(result.lastInsertRowid);

        // Log activity
        db.prepare(`
      INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
      VALUES (?, ?, 'tenant_created', 'إضافة عميل جديد', 'success')
    `).run(newTenant.id, newTenant.name);

        res.status(201).json(newTenant);
    } catch (error) {
        console.error('Error creating tenant:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'Phone number already exists' });
        }
        res.status(500).json({ error: 'Failed to create tenant' });
    }
});

// Update tenant
router.put('/:id', (req, res) => {
    try {
        const { name, phone, status, tier, credits, quality, phone_number_id, access_token } = req.body;

        const existing = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        const stmt = db.prepare(`
      UPDATE tenants SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        status = COALESCE(?, status),
        tier = COALESCE(?, tier),
        credits = COALESCE(?, credits),
        quality = COALESCE(?, quality),
        phone_number_id = COALESCE(?, phone_number_id),
        access_token = COALESCE(?, access_token),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

        stmt.run(name, phone, status, tier, credits, quality, phone_number_id, access_token, req.params.id);

        const updatedTenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);

        // Log activity
        db.prepare(`
      INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
      VALUES (?, ?, 'tenant_updated', 'تحديث بيانات العميل', 'success')
    `).run(updatedTenant.id, updatedTenant.name);

        res.json(updatedTenant);
    } catch (error) {
        console.error('Error updating tenant:', error);
        res.status(500).json({ error: 'Failed to update tenant' });
    }
});

// Delete tenant
router.delete('/:id', (req, res) => {
    try {
        const existing = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // Log activity before deletion
        db.prepare(`
      INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
      VALUES (?, ?, 'tenant_deleted', 'حذف العميل', 'success')
    `).run(existing.id, existing.name);

        db.prepare('DELETE FROM tenants WHERE id = ?').run(req.params.id);

        res.json({ message: 'Tenant deleted successfully' });
    } catch (error) {
        console.error('Error deleting tenant:', error);
        res.status(500).json({ error: 'Failed to delete tenant' });
    }
});

// Get tenant's login account
router.get('/:id/account', (req, res) => {
    try {
        const tenantId = req.params.id;

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        const account = db.prepare('SELECT id, username, email, name, is_active, created_at, last_login FROM users WHERE tenant_id = ?')
            .get(tenantId);

        res.json({
            hasAccount: !!account,
            account: account || null
        });
    } catch (error) {
        console.error('Error fetching tenant account:', error);
        res.status(500).json({ error: 'Failed to fetch tenant account' });
    }
});

// Create login account for tenant
router.post('/:id/create-account', async (req, res) => {
    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default;

    try {
        const tenantId = req.params.id;
        const { username, password, email } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        // Check if tenant exists
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        // Check if tenant already has an account
        const existingAccount = db.prepare('SELECT * FROM users WHERE tenant_id = ?').get(tenantId);
        if (existingAccount) {
            return res.status(400).json({ error: 'هذا العميل لديه حساب بالفعل' });
        }

        // Check if username exists
        const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existingUser) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Create user account (use 'user' role with tenant_id to identify as tenant)
        const stmt = db.prepare(`
            INSERT INTO users (username, email, password_hash, name, role, tenant_id)
            VALUES (?, ?, ?, ?, 'user', ?)
        `);

        const result = stmt.run(username, email || null, password_hash, tenant.name, tenantId);

        const newUser = db.prepare('SELECT id, username, email, name, role, tenant_id, created_at FROM users WHERE id = ?')
            .get(result.lastInsertRowid);

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'account_created', 'تم إنشاء حساب دخول للعميل', 'success')
        `).run(tenantId, tenant.name);

        res.status(201).json({
            message: 'تم إنشاء حساب الدخول بنجاح',
            user: newUser
        });
    } catch (error) {
        console.error('Error creating tenant account:', error);
        res.status(500).json({ error: 'فشل إنشاء الحساب' });
    }
});

// Update tenant account password
router.put('/:id/account/password', async (req, res) => {
    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default;

    try {
        const tenantId = req.params.id;
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        const account = db.prepare('SELECT * FROM users WHERE tenant_id = ?').get(tenantId);
        if (!account) {
            return res.status(404).json({ error: 'حساب العميل غير موجود' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(password_hash, account.id);

        res.json({ message: 'تم تحديث كلمة المرور بنجاح' });
    } catch (error) {
        console.error('Error updating tenant password:', error);
        res.status(500).json({ error: 'فشل تحديث كلمة المرور' });
    }
});

// Toggle tenant account status
router.put('/:id/account/toggle', (req, res) => {
    try {
        const tenantId = req.params.id;

        const account = db.prepare('SELECT * FROM users WHERE tenant_id = ?').get(tenantId);
        if (!account) {
            return res.status(404).json({ error: 'حساب العميل غير موجود' });
        }

        const newStatus = account.is_active ? 0 : 1;
        db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(newStatus, account.id);

        res.json({
            message: newStatus ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب',
            is_active: newStatus
        });
    } catch (error) {
        console.error('Error toggling tenant account:', error);
        res.status(500).json({ error: 'فشل تغيير حالة الحساب' });
    }
});

// ============================================
// Admin Template Management
// ============================================

const META_API_VERSION = 'v22.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Get templates for a tenant
router.get('/:id/templates', (req, res) => {
    try {
        const tenantId = req.params.id;
        const templates = db.prepare(`
            SELECT * FROM templates WHERE tenant_id = ? ORDER BY created_at DESC
        `).all(tenantId);
        res.json(templates);
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// Create template for a tenant
router.post('/:id/templates', (req, res) => {
    try {
        const tenantId = req.params.id;
        const { name, language, category, header_type, header_content, body, footer, buttons, variables } = req.body;

        if (!name || !body) {
            return res.status(400).json({ error: 'اسم القالب والمحتوى مطلوبان' });
        }

        const stmt = db.prepare(`
            INSERT INTO templates (tenant_id, name, language, category, header_type, header_content, body, footer, buttons, variables, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
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
        console.error('Error creating template:', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

// Update template
router.put('/:id/templates/:templateId', (req, res) => {
    try {
        const { id: tenantId, templateId } = req.params;
        const { name, language, category, header_type, header_content, body, footer, buttons, variables } = req.body;

        // Check ownership
        const existing = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?')
            .get(templateId, tenantId);

        if (!existing) {
            return res.status(404).json({ error: 'القالب غير موجود' });
        }

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
        console.error('Error updating template:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

// Delete template
router.delete('/:id/templates/:templateId', (req, res) => {
    try {
        const { id: tenantId, templateId } = req.params;

        const existing = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?')
            .get(templateId, tenantId);

        if (!existing) {
            return res.status(404).json({ error: 'القالب غير موجود' });
        }

        db.prepare('DELETE FROM templates WHERE id = ? AND tenant_id = ?').run(templateId, tenantId);
        res.json({ message: 'تم حذف القالب بنجاح' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// Sync templates from Meta WhatsApp API
router.post('/:id/templates/sync', async (req, res) => {
    try {
        const tenantId = req.params.id;

        // Get tenant credentials
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        if (!tenant.access_token) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة. يجب إضافة Access Token للعميل.' });
        }

        // We need WABA ID to fetch templates - try to get it from phone_number_id first
        // Usually the WABA ID can be derived or needs to be stored in tenant record
        // For now, we'll try to use the account info endpoint

        // First, get the WABA ID using the phone number
        let wabaId;
        if (tenant.phone_number_id) {
            try {
                const phoneResponse = await fetch(
                    `${META_API_BASE}/${tenant.phone_number_id}?fields=verified_name,display_phone_number,id`,
                    {
                        headers: { 'Authorization': `Bearer ${tenant.access_token}` }
                    }
                );
                const phoneData = await phoneResponse.json();

                if (phoneData.error) {
                    console.error('Phone API error:', phoneData.error);
                    return res.status(400).json({
                        error: 'فشل الاتصال بـ WhatsApp API',
                        details: phoneData.error.message
                    });
                }

                // Try to get templates using the /whatsapp_business_account endpoint
                const accountResponse = await fetch(
                    `${META_API_BASE}/${tenant.phone_number_id}?fields=owner`,
                    {
                        headers: { 'Authorization': `Bearer ${tenant.access_token}` }
                    }
                );
                const accountData = await accountResponse.json();
                wabaId = accountData.owner?.id || accountData.owner;
            } catch (err) {
                console.error('Error getting phone info:', err);
            }
        }

        // If we still don't have WABA ID, try business account endpoint
        if (!wabaId && tenant.waba_id) {
            wabaId = tenant.waba_id;
        }

        if (!wabaId) {
            // Try alternative method - get from debug token
            return res.status(400).json({
                error: 'لم يتم العثور على معرف حساب WhatsApp Business. يجب إضافة WABA ID للعميل.',
                hint: 'يمكنك الحصول على WABA ID من إعدادات Meta Business'
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
        console.error('Error syncing templates:', error);
        res.status(500).json({ error: 'فشل مزامنة القوالب' });
    }
});

// Import template from Meta API
router.post('/:id/templates/import', (req, res) => {
    try {
        const tenantId = req.params.id;
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
            status || 'approved'
        );

        const newTemplate = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newTemplate);
    } catch (error) {
        console.error('Error importing template:', error);
        res.status(500).json({ error: 'فشل استيراد القالب' });
    }
});

export default router;


