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

export default router;
