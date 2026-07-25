import express from 'express';
import fs from 'fs';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { csvUpload as upload, cleanupFile } from '../config/upload.js';
import { getFacebookUserAccessToken } from '../services/credentials.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import {
    createMetaInvoice,
    createMetaRate,
    createInvoice,
    getBillingSettings,
    getMetaCostSummary,
    getMetaReconciliation,
    getMetaUsage,
    getMetaUsageComparison,
    handleBillingError,
    listMetaInvoices,
    listMetaRates,
    listMetaUsageSnapshots,
    markMetaReconciliationReviewed,
    syncMetaReconciliationPeriod,
    syncMetaUsageSnapshot,
    updateBillingSettings,
    updateMetaRate,
    updateTenantBillingAccount,
    upsertMetaRate,
} from '../services/billing.js';

const router = express.Router();
const centralSubscriptionsEnabled = () => (
    String(process.env.SAVANA_SUBSCRIPTIONS_MODE || 'local').trim().toLowerCase() === 'central'
);

const centralManagedResponse = res => res.status(409).json({
    error: 'تدار الخطط والاشتراكات من نظام اشتراكات سافانا المركزي',
    code: 'central_subscription_managed',
});

const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1];
        if (char === '"' && quoted && next === '"') {
            value += '"';
            i += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            row.push(value.trim());
            value = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') i += 1;
            row.push(value.trim());
            if (row.some((cell) => cell !== '')) rows.push(row);
            row = [];
            value = '';
        } else {
            value += char;
        }
    }

    if (value || row.length) {
        row.push(value.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
    }

    if (rows.length === 0) return [];
    const headers = rows[0].map((header) => String(header || '').trim().toLowerCase().replace(/\s+/g, '_'));
    return rows.slice(1).map((cells) => headers.reduce((acc, header, index) => {
        acc[header] = cells[index] ?? '';
        return acc;
    }, {}));
};

const firstValue = (row, fields) => {
    for (const field of fields) {
        if (row[field] !== undefined && row[field] !== '') return row[field];
    }
    return '';
};

const normalizeRateRows = (rows, defaults = {}) => {
    const categoryColumns = ['marketing', 'utility', 'authentication', 'authentication_international', 'service'];
    const normalized = [];

    for (const row of rows) {
        const common = {
            country_calling_code: firstValue(row, ['country_calling_code', 'calling_code', 'country_code', 'prefix', 'dial_code']) || defaults.country_calling_code,
            market_name: firstValue(row, ['market_name', 'market', 'country', 'region']) || defaults.market_name,
            currency: firstValue(row, ['currency', 'currency_code']) || defaults.currency || 'USD',
            effective_from: firstValue(row, ['effective_from', 'effective_date', 'start_date']) || defaults.effective_from,
            effective_to: firstValue(row, ['effective_to', 'end_date']) || defaults.effective_to,
            volume_tier_min: firstValue(row, ['volume_tier_min', 'tier_min']) || defaults.volume_tier_min || 1,
            volume_tier_max: firstValue(row, ['volume_tier_max', 'tier_max']) || defaults.volume_tier_max,
            source: defaults.source || 'csv_import',
            notes: firstValue(row, ['notes', 'note']) || defaults.notes,
        };

        const explicitCategory = firstValue(row, ['category', 'message_category', 'product']);
        const explicitRate = firstValue(row, ['rate_amount', 'rate', 'price', 'cost', 'amount']);
        if (explicitCategory && explicitRate !== '') {
            normalized.push({ ...common, category: explicitCategory, rate_amount: explicitRate });
            continue;
        }

        for (const category of categoryColumns) {
            if (row[category] !== undefined && row[category] !== '') {
                normalized.push({ ...common, category, rate_amount: row[category] });
            }
        }
    }

    return normalized.filter((row) => row.country_calling_code && row.category && row.rate_amount !== '');
};

router.get('/plans', (req, res) => {
    try {
        const plans = db.prepare(centralSubscriptionsEnabled() ? `
            SELECT *
            FROM billing_plans
            WHERE code LIKE 'savana_central_%'
            ORDER BY monthly_price_lyd ASC, id ASC
        ` : `
            SELECT *
            FROM billing_plans
            ORDER BY is_active DESC, monthly_price_lyd ASC, id ASC
        `).all();
        res.json({ plans, managed_centrally: centralSubscriptionsEnabled() });
    } catch (error) {
        console.error('[Billing] Plans fetch error:', error);
        res.status(500).json({ error: 'فشل جلب الباقات' });
    }
});

router.post('/plans', (req, res) => {
    if (centralSubscriptionsEnabled()) return centralManagedResponse(res);
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
    if (centralSubscriptionsEnabled()) return centralManagedResponse(res);
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
        const allowed = [
            'display_name_ar',
            'unit_price_credits',
            'local_pricing_model',
            'local_pricing_description',
            'meta_cost_basis',
            'tenant_visible_usage',
            'pricing_note',
            'is_billable',
            'is_active',
        ];
        const sets = [];
        const values = [];
        const existing = db.prepare('SELECT * FROM billing_price_items WHERE id = ?').get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'سعر العملية غير موجود' });
        const nextBillable = 'is_billable' in req.body ? Boolean(req.body.is_billable) : Boolean(existing.is_billable);
        const nextActive = 'is_active' in req.body ? Boolean(req.body.is_active) : Boolean(existing.is_active);
        if (
            'unit_price_credits' in req.body
            && nextBillable
            && nextActive
            && (parseInt(req.body.unit_price_credits, 10) || 0) < 1
        ) {
            req.body.unit_price_credits = 1;
        }
        if (
            !('unit_price_credits' in req.body)
            && nextBillable
            && nextActive
            && (parseInt(existing.unit_price_credits, 10) || 0) < 1
        ) {
            req.body.unit_price_credits = 1;
        }

        for (const field of allowed) {
            if (field in req.body) {
                sets.push(`${field} = ?`);
                if (['is_billable', 'is_active', 'tenant_visible_usage'].includes(field)) values.push(req.body[field] ? 1 : 0);
                else if (field === 'unit_price_credits') values.push(Math.max(parseInt(req.body[field], 10) || 0, 0));
                else if (field === 'local_pricing_model') {
                    const model = String(req.body[field] || 'fixed').trim().toLowerCase();
                    values.push(['fixed', 'meta_like', 'meta_cost_plus_credits'].includes(model) ? model : 'fixed');
                }
                else if (field === 'meta_cost_basis') {
                    const basis = String(req.body[field] || 'not_applicable').trim().toLowerCase();
                    values.push(['meta_billed', 'meta_free', 'platform_fee', 'not_applicable'].includes(basis) ? basis : 'not_applicable');
                }
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

router.post('/meta/rates/import', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'ملف CSV مطلوب' });
        }
        const text = fs.readFileSync(req.file.path, 'utf8');
        const rows = parseCsv(text);
        const rates = normalizeRateRows(rows, {
            currency: req.body.currency,
            effective_from: req.body.effective_from,
            source: req.body.source || 'csv_import',
        });

        if (rates.length === 0) {
            return res.status(400).json({
                error: 'لم يتم العثور على أسعار صالحة في CSV',
                expected_columns: [
                    'country_calling_code',
                    'market_name',
                    'currency',
                    'category + rate_amount',
                    'أو أعمدة marketing/utility/authentication/service',
                ],
            });
        }

        let created = 0;
        let updated = 0;
        const errors = [];

        for (const rate of rates) {
            try {
                const result = upsertMetaRate(rate);
                if (result.action === 'created') created += 1;
                else updated += 1;
            } catch (error) {
                errors.push({
                    country_calling_code: rate.country_calling_code,
                    category: rate.category,
                    error: error.message,
                });
            }
        }

        res.json({ imported: rates.length, created, updated, failed: errors.length, errors });
    } catch (error) {
        console.error('[Billing] Meta rates import error:', error);
        res.status(500).json({ error: 'فشل استيراد أسعار Meta' });
    } finally {
        cleanupFile(req.file?.path);
    }
});

router.get('/meta/settings', (req, res) => {
    try {
        res.json(getBillingSettings());
    } catch (error) {
        console.error('[Billing] Meta settings fetch error:', error);
        res.status(500).json({ error: 'فشل جلب إعدادات تكلفة Meta' });
    }
});

router.patch('/meta/settings', (req, res) => {
    try {
        res.json(updateBillingSettings(req.body || {}));
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta settings update error:', error);
        res.status(500).json({ error: 'فشل تحديث إعدادات تكلفة Meta' });
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
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta summary error:', error);
        res.status(500).json({ error: 'فشل جلب ملخص تكلفة Meta' });
    }
});

router.get('/meta/reconciliation', (req, res) => {
    try {
        res.json(getMetaReconciliation({
            tenantId: req.query.tenant_id,
            periodStart: req.query.period_start,
            periodEnd: req.query.period_end,
        }));
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta reconciliation fetch error:', error);
        res.status(500).json({ error: 'فشل جلب مطابقة تكلفة Meta' });
    }
});

router.post('/meta/reconciliation/sync', async (req, res) => {
    try {
        const result = await syncMetaReconciliationPeriod({
            tenantId: req.body.tenant_id,
            periodStart: req.body.period_start || req.body.start_date,
            periodEnd: req.body.period_end || req.body.end_date,
            granularity: req.body.granularity || 'MONTHLY',
            createdBy: req.user?.id || null,
        });
        res.status(201).json(result);
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta reconciliation sync error:', error);
        res.status(500).json({ error: 'فشل مزامنة مطابقة Meta' });
    }
});

router.post('/meta/reconciliation/:id/mark-reviewed', (req, res) => {
    try {
        res.json({
            period: markMetaReconciliationReviewed({
                id: req.params.id,
                reviewedBy: req.user?.id || null,
            }),
        });
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta reconciliation review error:', error);
        res.status(500).json({ error: 'فشل تعليم فترة Meta كمراجعة' });
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

router.get('/meta/usage/snapshots', (req, res) => {
    try {
        res.json({
            snapshots: listMetaUsageSnapshots({
                tenantId: req.query.tenant_id || null,
                limit: req.query.limit || 10,
                offset: req.query.offset || 0,
            }),
        });
    } catch (error) {
        console.error('[Billing] Meta usage snapshots fetch error:', error);
        res.status(500).json({ error: 'فشل جلب لقطات استهلاك Meta' });
    }
});

router.get('/meta/usage/comparison', (req, res) => {
    try {
        if (!req.query.tenant_id) {
            return res.status(400).json({ error: 'tenant_id مطلوب للمقارنة' });
        }
        res.json(getMetaUsageComparison({
            tenantId: req.query.tenant_id,
            periodStart: req.query.period_start || null,
            periodEnd: req.query.period_end || null,
        }));
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta usage comparison error:', error);
        res.status(500).json({ error: 'فشل مقارنة استهلاك Meta' });
    }
});

router.post('/meta/usage/sync', async (req, res) => {
    try {
        const snapshot = await syncMetaUsageSnapshot({
            tenantId: req.body.tenant_id,
            periodStart: req.body.period_start || req.body.start_date,
            periodEnd: req.body.period_end || req.body.end_date,
            granularity: req.body.granularity || 'MONTHLY',
            createdBy: req.user?.id || null,
        });
        res.status(201).json({ snapshot });
    } catch (error) {
        if (handleBillingError(res, error)) return;
        console.error('[Billing] Meta usage sync error:', error);
        res.status(500).json({ error: 'فشل مزامنة استهلاك Meta' });
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
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب فواتير Meta');
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
