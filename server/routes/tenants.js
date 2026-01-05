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

        const account = db.prepare('SELECT id, username, email, name, is_active, created_at, last_login FROM users WHERE tenant_id = ? AND role = ?')
            .get(tenantId, 'tenant');

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
    const bcrypt = await import('bcryptjs');

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
        const existingAccount = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND role = ?').get(tenantId, 'tenant');
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

        // Create user account
        const stmt = db.prepare(`
            INSERT INTO users (username, email, password_hash, name, role, tenant_id)
            VALUES (?, ?, ?, ?, 'tenant', ?)
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
    const bcrypt = await import('bcryptjs');

    try {
        const tenantId = req.params.id;
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        const account = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND role = ?').get(tenantId, 'tenant');
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

        const account = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND role = ?').get(tenantId, 'tenant');
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

export default router;

