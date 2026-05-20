import express from 'express';
import db from '../db/database.js';
import {
    createInvoice,
    handleBillingError,
    updateTenantBillingAccount,
} from '../services/billing.js';

const router = express.Router();

router.get('/plans', (req, res) => {
    try {
        const plans = db.prepare(`
            SELECT *
            FROM billing_plans
            ORDER BY is_active DESC, monthly_price_lyd ASC, id ASC
        `).all();
        res.json({ plans });
    } catch (error) {
        console.error('[Billing] Plans fetch error:', error);
        res.status(500).json({ error: 'فشل جلب الباقات' });
    }
});

router.post('/plans', (req, res) => {
    try {
        const {
            code,
            name,
            description = null,
            monthly_price_lyd = 0,
            monthly_included_credits = 0,
            default_credit_limit = 0,
            is_active = 1,
        } = req.body;

        if (!code || !name) {
            return res.status(400).json({ error: 'كود الباقة واسمها مطلوبان' });
        }

        const result = db.prepare(`
            INSERT INTO billing_plans (
                code, name, description, monthly_price_lyd,
                monthly_included_credits, default_credit_limit, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(code).trim(),
            String(name).trim(),
            description,
            Number(monthly_price_lyd) || 0,
            parseInt(monthly_included_credits, 10) || 0,
            parseInt(default_credit_limit, 10) || 0,
            is_active ? 1 : 0
        );

        res.status(201).json({
            plan: db.prepare('SELECT * FROM billing_plans WHERE id = ?').get(result.lastInsertRowid),
        });
    } catch (error) {
        console.error('[Billing] Plan create error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'كود الباقة مستخدم مسبقا' });
        }
        res.status(500).json({ error: 'فشل إنشاء الباقة' });
    }
});

router.patch('/plans/:id', (req, res) => {
    try {
        const allowed = [
            'code',
            'name',
            'description',
            'monthly_price_lyd',
            'monthly_included_credits',
            'default_credit_limit',
            'is_active',
        ];

        const sets = [];
        const values = [];
        for (const field of allowed) {
            if (field in req.body) {
                sets.push(`${field} = ?`);
                if (field === 'is_active') values.push(req.body[field] ? 1 : 0);
                else if (['monthly_price_lyd'].includes(field)) values.push(Number(req.body[field]) || 0);
                else if (['monthly_included_credits', 'default_credit_limit'].includes(field)) values.push(parseInt(req.body[field], 10) || 0);
                else values.push(req.body[field]);
            }
        }

        if (sets.length === 0) {
            return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
        }

        sets.push("updated_at = datetime('now', 'localtime')");
        values.push(req.params.id);

        db.prepare(`UPDATE billing_plans SET ${sets.join(', ')} WHERE id = ?`).run(...values);
        res.json({ plan: db.prepare('SELECT * FROM billing_plans WHERE id = ?').get(req.params.id) });
    } catch (error) {
        console.error('[Billing] Plan update error:', error);
        res.status(500).json({ error: 'فشل تحديث الباقة' });
    }
});

router.get('/prices', (req, res) => {
    try {
        const prices = db.prepare(`
            SELECT *
            FROM billing_price_items
            ORDER BY channel, operation_type, id
        `).all();
        res.json({ prices });
    } catch (error) {
        console.error('[Billing] Prices fetch error:', error);
        res.status(500).json({ error: 'فشل جلب كتالوج الأسعار' });
    }
});

router.patch('/prices/:id', (req, res) => {
    try {
        const allowed = ['display_name_ar', 'unit_price_credits', 'is_billable', 'is_active'];
        const sets = [];
        const values = [];

        for (const field of allowed) {
            if (field in req.body) {
                sets.push(`${field} = ?`);
                if (['is_billable', 'is_active'].includes(field)) values.push(req.body[field] ? 1 : 0);
                else if (field === 'unit_price_credits') values.push(Math.max(parseInt(req.body[field], 10) || 0, 0));
                else values.push(req.body[field]);
            }
        }

        if (sets.length === 0) {
            return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
        }

        sets.push("updated_at = datetime('now', 'localtime')");
        values.push(req.params.id);

        db.prepare(`UPDATE billing_price_items SET ${sets.join(', ')} WHERE id = ?`).run(...values);
        res.json({ price: db.prepare('SELECT * FROM billing_price_items WHERE id = ?').get(req.params.id) });
    } catch (error) {
        console.error('[Billing] Price update error:', error);
        res.status(500).json({ error: 'فشل تحديث سعر العملية' });
    }
});

router.patch('/tenants/:id/account', (req, res) => {
    try {
        const summary = updateTenantBillingAccount(req.params.id, req.body);
        res.json({ success: true, summary });
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Account update error:', error);
        res.status(500).json({ error: 'فشل تحديث حساب الفوترة' });
    }
});

router.post('/tenants/:id/invoices', (req, res) => {
    try {
        const invoice = createInvoice({
            tenantId: req.params.id,
            periodStart: req.body.period_start,
            periodEnd: req.body.period_end,
            dueDate: req.body.due_date,
            notes: req.body.notes,
            createdBy: req.user?.id || null,
        });
        res.status(201).json({ invoice });
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Invoice create error:', error);
        res.status(500).json({ error: 'فشل إنشاء الفاتورة' });
    }
});

export default router;
