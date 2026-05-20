import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { getFacebookUserAccessToken } from '../services/credentials.js';
import {
    createMetaInvoice,
    createMetaRate,
    createInvoice,
    getMetaCostSummary,
    getMetaUsage,
    handleBillingError,
    listMetaInvoices,
    listMetaRates,
    updateMetaRate,
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

router.get('/meta/rates', (req, res) => {
    try {
        res.json({
            rates: listMetaRates({
                category: req.query.category,
                currency: req.query.currency,
                activeOnly: req.query.active_only === '1' || req.query.active_only === 'true',
            }),
        });
    } catch (error) {
        console.error('[Billing] Meta rates fetch error:', error);
        res.status(500).json({ error: 'فشل جلب أسعار Meta' });
    }
});

router.post('/meta/rates', (req, res) => {
    try {
        const rate = createMetaRate(req.body);
        res.status(201).json({ rate });
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta rate create error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'سعر Meta لهذه الدولة والفئة والعملة موجود مسبقا لنفس تاريخ السريان' });
        }
        res.status(500).json({ error: 'فشل إنشاء سعر Meta' });
    }
});

router.patch('/meta/rates/:id', (req, res) => {
    try {
        res.json({ rate: updateMetaRate(req.params.id, req.body) });
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta rate update error:', error);
        res.status(500).json({ error: 'فشل تحديث سعر Meta' });
    }
});

router.get('/meta/summary', (req, res) => {
    try {
        res.json(getMetaCostSummary({
            tenantId: req.query.tenant_id || null,
            periodStart: req.query.period_start || null,
            periodEnd: req.query.period_end || null,
        }));
    } catch (error) {
        console.error('[Billing] Meta summary error:', error);
        res.status(500).json({ error: 'فشل جلب ملخص تكلفة Meta' });
    }
});

router.get('/meta/usage', (req, res) => {
    try {
        res.json({
            usage: getMetaUsage({
                tenantId: req.query.tenant_id || null,
                status: req.query.status || null,
                limit: req.query.limit || 100,
                offset: req.query.offset || 0,
            }),
        });
    } catch (error) {
        console.error('[Billing] Meta usage error:', error);
        res.status(500).json({ error: 'فشل جلب استخدام Meta' });
    }
});

router.get('/meta/invoices', (req, res) => {
    try {
        res.json({
            invoices: listMetaInvoices({
                tenantId: req.query.tenant_id || null,
                limit: req.query.limit || 50,
                offset: req.query.offset || 0,
            }),
        });
    } catch (error) {
        console.error('[Billing] Meta invoices fetch error:', error);
        res.status(500).json({ error: 'فشل جلب فواتير Meta' });
    }
});

router.post('/meta/invoices', (req, res) => {
    try {
        const invoice = createMetaInvoice({
            tenantId: req.body.tenant_id || null,
            businessId: req.body.business_id || null,
            wabaId: req.body.waba_id || null,
            invoiceNumber: req.body.invoice_number || null,
            periodStart: req.body.period_start || null,
            periodEnd: req.body.period_end || null,
            currency: req.body.currency || 'USD',
            subtotalAmount: req.body.subtotal_amount || 0,
            taxAmount: req.body.tax_amount || 0,
            totalAmount: req.body.total_amount,
            status: req.body.status || 'received',
            invoiceUrl: req.body.invoice_url || null,
            notes: req.body.notes || null,
            metadata: req.body.metadata || null,
            createdBy: req.user?.id || null,
        });
        res.status(201).json({ invoice });
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta invoice create error:', error);
        res.status(500).json({ error: 'فشل تسجيل فاتورة Meta' });
    }
});

router.post('/meta/invoices/sync', async (req, res) => {
    try {
        const tenantId = req.body.tenant_id || req.query.tenant_id;
        const tenant = tenantId
            ? db.prepare('SELECT id, business_id, waba_id FROM tenants WHERE id = ?').get(tenantId)
            : null;
        const businessId = req.body.business_id || tenant?.business_id;
        const startDate = req.body.start_date || req.query.start_date;
        const endDate = req.body.end_date || req.query.end_date;

        if (!tenantId || !businessId || !startDate || !endDate) {
            return res.status(400).json({
                error: 'tenant_id و business_id و start_date و end_date مطلوبة لمزامنة فواتير Meta',
            });
        }

        const accessToken = getFacebookUserAccessToken(tenantId);
        if (!accessToken) {
            return res.status(400).json({
                error: 'Facebook user token مطلوب لمزامنة فواتير Meta',
                permission_required: 'business_management',
            });
        }

        const url = `${META_API_BASE}/${businessId}/business_invoices?${new URLSearchParams({
            start_date: startDate,
            end_date: endDate,
            access_token: accessToken,
        }).toString()}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب فواتير Meta',
                details: data.error || data,
            });
        }

        const invoices = [];
        for (const item of data.data || []) {
            const invoice = createMetaInvoice({
                tenantId,
                businessId,
                wabaId: tenant?.waba_id || null,
                invoiceNumber: item.invoice_id || item.id || item.invoice_number || null,
                periodStart: item.start_date || item.period_start || startDate,
                periodEnd: item.end_date || item.period_end || endDate,
                currency: item.currency || item.invoice_currency || 'USD',
                subtotalAmount: item.amount_due || item.subtotal || item.total_amount || 0,
                taxAmount: item.tax_amount || 0,
                totalAmount: item.total_amount || item.amount_due || 0,
                status: item.status || 'synced',
                invoiceUrl: item.download_uri || item.invoice_uri || item.uri || null,
                notes: 'تمت المزامنة من Meta Business Invoices API',
                metadata: item,
                createdBy: req.user?.id || null,
            });
            invoices.push(invoice);
        }

        res.json({ synced: invoices.length, invoices, raw: data });
    } catch (error) {
        console.error('[Billing] Meta invoice sync error:', error);
        res.status(500).json({ error: 'فشل مزامنة فواتير Meta' });
    }
});

export default router;
