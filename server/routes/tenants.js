import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';

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
        const { name, phone, status, tier, credits, quality, phone_number_id, access_token, waba_id, business_id, dataset_id } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const stmt = db.prepare(`
      INSERT INTO tenants (name, phone, status, tier, credits, quality, phone_number_id, access_token, waba_id, business_id, dataset_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const result = stmt.run(
            name,
            phone || null,
            status || 'Active',
            tier || '1K',
            credits || 0,
            quality || 'High',
            phone_number_id || null,
            access_token || null,
            waba_id || null,
            business_id || null,
            dataset_id || null
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
        const { name, phone, status, tier, credits, quality, phone_number_id, access_token, waba_id, business_id, dataset_id } = req.body;

        const existing = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // Build dynamic UPDATE — only include fields present in the request body.
        // This allows clearing fields by sending null explicitly,
        // while absent fields remain unchanged.
        const clearableFields = ['name', 'phone', 'status', 'tier', 'credits', 'quality',
            'phone_number_id', 'access_token', 'waba_id', 'business_id', 'dataset_id'];
        
        const setClauses = [];
        const values = [];
        
        for (const field of clearableFields) {
            if (field in req.body) {
                setClauses.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        }
        
        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        setClauses.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.params.id);
        
        db.prepare(`UPDATE tenants SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

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
                            // Save for future use
                            db.prepare('UPDATE tenants SET waba_id = ? WHERE id = ?').run(wabaId, tenantId);
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
                hint: 'يجب إضافة WABA ID للعميل من إعدادات Meta Business'
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
            (status || 'approved').toLowerCase()
        );

        const newTemplate = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newTemplate);
    } catch (error) {
        console.error('Error importing template:', error);
        res.status(500).json({ error: 'فشل استيراد القالب' });
    }
});

// ============================================
// Create template on Meta API directly
// ============================================
router.post('/:id/templates/create-meta', async (req, res) => {
    try {
        const tenantId = req.params.id;
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
        if (!tenant.access_token || !tenant.waba_id) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة (يجب توفر Access Token و WABA ID)' });
        }

        const { name, language, category, components } = req.body;
        if (!name || !category || !components) {
            return res.status(400).json({ error: 'name, category, and components are required' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.waba_id}/message_templates`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tenant.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    language: language || 'ar',
                    category: category || 'UTILITY',
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

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'template_created_meta', ?, 'success')
        `).run(tenantId, tenant.name, `إنشاء قالب في Meta: ${name}`);

        res.json({ success: true, data });
    } catch (error) {
        console.error('Error creating Meta template:', error);
        res.status(500).json({ error: 'فشل إنشاء القالب في Meta' });
    }
});

// ============================================
// Delete template from Meta API
// ============================================
router.delete('/:id/templates/delete-meta', async (req, res) => {
    try {
        const tenantId = req.params.id;
        const { name } = req.query;

        if (!name) return res.status(400).json({ error: 'اسم القالب مطلوب' });

        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
        if (!tenant.access_token || !tenant.waba_id) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.waba_id}/message_templates?name=${encodeURIComponent(name)}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${tenant.access_token}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل حذف القالب من Meta',
                details: data.error
            });
        }

        // Also delete from local DB
        db.prepare('DELETE FROM templates WHERE tenant_id = ? AND name = ?').run(tenantId, name);

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'template_deleted_meta', ?, 'success')
        `).run(tenantId, tenant.name, `حذف قالب من Meta: ${name}`);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting Meta template:', error);
        res.status(500).json({ error: 'فشل حذف القالب من Meta' });
    }
});

// ============================================
// Subscribe app to WABA webhooks
// ============================================
router.post('/:id/subscribe-webhook', async (req, res) => {
    try {
        const tenantId = req.params.id;
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
        if (!tenant.access_token || !tenant.waba_id) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.waba_id}/subscribed_apps`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tenant.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل اشتراك Webhook',
                details: data.error
            });
        }

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'webhook_subscribed', 'تم اشتراك التطبيق في webhooks', 'success')
        `).run(tenantId, tenant.name);

        res.json({ success: true, data });
    } catch (error) {
        console.error('Error subscribing webhook:', error);
        res.status(500).json({ error: 'فشل اشتراك Webhook' });
    }
});

// ============================================
// Get webhook subscriptions
// ============================================
router.get('/:id/webhook-subscriptions', async (req, res) => {
    try {
        const tenantId = req.params.id;
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
        if (!tenant.access_token || !tenant.waba_id) {
            return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${tenant.waba_id}/subscribed_apps`,
            {
                headers: { 'Authorization': `Bearer ${tenant.access_token}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب اشتراكات Webhook',
                details: data.error
            });
        }

        res.json({
            subscriptions: data.data || [],
        });
    } catch (error) {
        console.error('Error getting webhook subscriptions:', error);
        res.status(500).json({ error: 'فشل جلب اشتراكات Webhook' });
    }
});

export default router;


