import { BillingError, serializeJson, toInt } from './billingCore.js';
import {
    computeAvailable,
    ensureTenantBillingAccount,
    getReservedCredits,
    syncTenantCredits,
} from './billingAccount.js';
import { normalizeSqlDate } from './billingPeriod.js';

const nowSql = "datetime('now', 'localtime')";
const FINANCIAL_ACCOUNT_FIELDS = [
    'wallet_balance_credits',
    'plan_balance_credits',
    'credit_limit_credits',
    'credit_used_credits',
];

const invalid = (message, code, field = null) => {
    throw new BillingError(message, { status: 400, code, ...(field ? { field } : {}) });
};

const normalizeInteger = (value, field, { minimum = null } = {}) => {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || (minimum !== null && normalized < minimum)) {
        invalid('قيمة الرصيد غير صالحة', 'INVALID_BILLING_INTEGER', field);
    }
    return normalized;
};

const normalizeAmount = (value) => {
    const normalized = Number(value ?? 0);
    if (!Number.isFinite(normalized) || normalized < 0) {
        invalid('قيمة الدفعة المالية غير صالحة', 'INVALID_PAYMENT_AMOUNT', 'amount_lyd');
    }
    return normalized;
};

const normalizeOptionalId = (value, field) => {
    if (value === undefined || value === null || value === '') return null;
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        invalid('المعرف المرتبط غير صالح', 'INVALID_RELATED_ID', field);
    }
    return normalized;
};

const normalizeText = (value, field, maximum, fallback = null) => {
    if (value === undefined || value === null) return fallback;
    const normalized = String(value).trim();
    if (!normalized) return fallback;
    if (normalized.length > maximum) {
        invalid('النص المدخل أطول من الحد المسموح', 'BILLING_TEXT_TOO_LONG', field);
    }
    return normalized;
};

const accountAvailability = (db, tenantId) => {
    const account = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
    if (!account) return null;
    return computeAvailable(db, account, getReservedCredits(db, tenantId));
};

const summary = (dependencies, tenantId) => dependencies.getBillingSummary(tenantId);

export function recordPayment(db, dependencies, {
    tenantId,
    credits,
    amountLyd = 0,
    method = 'manual',
    reference = null,
    note = null,
    createdBy = null,
    invoiceId = null,
} = {}) {
    const normalizedCredits = Number(credits);
    if (!tenantId || !Number.isInteger(normalizedCredits) || normalizedCredits <= 0) {
        throw new BillingError('قيمة الرصيد المضاف غير صالحة', { status: 400, code: 'INVALID_PAYMENT_CREDITS' });
    }
    const normalizedAmount = normalizeAmount(amountLyd);
    const normalizedInvoiceId = normalizeOptionalId(invoiceId, 'invoice_id');
    const normalizedMethod = normalizeText(method, 'method', 64, 'manual');
    const normalizedReference = normalizeText(reference, 'reference', 255);
    const normalizedNote = normalizeText(note, 'note', 2000);

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(db, tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }

        if (normalizedInvoiceId) {
            const invoice = db.prepare('SELECT tenant_id FROM billing_invoices WHERE id = ?').get(normalizedInvoiceId);
            if (!invoice) {
                throw new BillingError('الفاتورة غير موجودة', { status: 404, code: 'INVOICE_NOT_FOUND' });
            }
            if (String(invoice.tenant_id) !== String(tenantId)) {
                throw new BillingError('الفاتورة لا تخص حساب العميل', {
                    status: 409,
                    code: 'INVOICE_TENANT_MISMATCH',
                });
            }
        }

        const payment = db.prepare(`
            INSERT INTO billing_payments (tenant_id, invoice_id, amount_lyd, credits, method, reference, note, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenantId,
            normalizedInvoiceId,
            normalizedAmount,
            normalizedCredits,
            normalizedMethod,
            normalizedReference,
            normalizedNote,
            createdBy
        );

        db.prepare(`
            UPDATE tenant_billing_accounts
            SET wallet_balance_credits = wallet_balance_credits + ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(normalizedCredits, tenantId);

        const balanceAfter = accountAvailability(db, tenantId).gross_available_credits;
        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, amount_lyd,
                balance_after_credits, related_type, related_id, description, metadata_json, created_by
            ) VALUES (?, 'payment', 'credit', ?, ?, ?, 'billing_payment', ?, ?, ?, ?)
        `).run(
            tenantId,
            normalizedCredits,
            normalizedAmount,
            balanceAfter,
            String(payment.lastInsertRowid),
            normalizedNote || `إضافة رصيد ${normalizedCredits}`,
            serializeJson({ method: normalizedMethod, reference: normalizedReference }),
            createdBy
        );

        syncTenantCredits(db, tenantId);
        return {
            payment: db.prepare('SELECT * FROM billing_payments WHERE id = ?').get(payment.lastInsertRowid),
            summary: summary(dependencies, tenantId),
        };
    });

    return transaction();
}

export function recordAdjustment(db, dependencies, {
    tenantId,
    creditsDelta,
    reason,
    createdBy = null,
} = {}) {
    const delta = Number(creditsDelta);
    if (!tenantId || !Number.isInteger(delta) || delta === 0) {
        throw new BillingError('قيمة التعديل غير صالحة', { status: 400, code: 'INVALID_ADJUSTMENT_CREDITS' });
    }
    const normalizedReason = normalizeText(reason, 'reason', 2000);
    if (!normalizedReason) {
        throw new BillingError('سبب التعديل مطلوب', { status: 400, code: 'ADJUSTMENT_REASON_REQUIRED' });
    }

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(db, tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }

        db.prepare(`
            UPDATE tenant_billing_accounts
            SET wallet_balance_credits = wallet_balance_credits + ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(delta, tenantId);

        const balanceAfter = accountAvailability(db, tenantId).gross_available_credits;
        const ledger = db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                related_type, description, metadata_json, created_by
            ) VALUES (?, 'manual_adjustment', ?, ?, ?, 'admin_adjustment', ?, ?, ?)
        `).run(
            tenantId,
            delta >= 0 ? 'credit' : 'debit',
            delta,
            balanceAfter,
            normalizedReason,
            serializeJson({ reason: normalizedReason }),
            createdBy
        );

        syncTenantCredits(db, tenantId);
        return {
            ledger: db.prepare('SELECT * FROM billing_ledger WHERE id = ?').get(ledger.lastInsertRowid),
            summary: summary(dependencies, tenantId),
        };
    });

    return transaction();
}

export function applyMonthlyAllowance(db, dependencies, tenantId) {
    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(db, tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }
        if (!account.plan_id) return { applied: false, reason: 'no_plan', summary: summary(dependencies, tenantId) };

        const plan = db.prepare('SELECT * FROM billing_plans WHERE id = ?').get(account.plan_id);
        if (!plan || !plan.is_active) return { applied: false, reason: 'inactive_plan', summary: summary(dependencies, tenantId) };
        if (plan.code === 'legacy') return { applied: false, reason: 'legacy_plan', summary: summary(dependencies, tenantId) };

        if (account.billing_cycle_end) {
            const expired = db.prepare(`
                SELECT CASE WHEN datetime(?) <= datetime('now', 'localtime') THEN 1 ELSE 0 END AS expired
            `).get(account.billing_cycle_end)?.expired;
            if (!expired) {
                return {
                    applied: false,
                    reason: 'cycle_not_due',
                    billing_cycle_start: account.billing_cycle_start || null,
                    billing_cycle_end: account.billing_cycle_end || null,
                    summary: summary(dependencies, tenantId),
                };
            }
        }

        const beforeAvailability = accountAvailability(db, tenantId);
        const previousPlanBalance = toInt(account.plan_balance_credits);
        const included = Math.max(toInt(plan.monthly_included_credits), 0);
        db.prepare(`
            UPDATE tenant_billing_accounts
            SET plan_balance_credits = ?,
                credit_limit_credits = ?,
                credit_used_credits = 0,
                billing_cycle_start = ${nowSql},
                billing_cycle_end = datetime('now', '+1 month', 'localtime'),
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(included, Math.max(toInt(plan.default_credit_limit), 0), tenantId);

        const afterAvailability = accountAvailability(db, tenantId);
        const balanceAfter = afterAvailability.gross_available_credits;
        const creditsDelta = afterAvailability.raw_gross_available_credits - beforeAvailability.raw_gross_available_credits;
        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                related_type, related_id, description, metadata_json
            ) VALUES (?, 'monthly_allowance', ?, ?, ?, 'billing_plan', ?, ?, ?)
        `).run(
            tenantId,
            creditsDelta >= 0 ? 'credit' : 'debit',
            creditsDelta,
            balanceAfter,
            String(plan.id),
            `تجديد رصيد الباقة الشهرية: ${plan.name}`,
            serializeJson({
                plan_code: plan.code,
                previous_plan_balance_credits: previousPlanBalance,
                monthly_included_credits: included,
                credit_limit: Math.max(toInt(plan.default_credit_limit), 0),
            })
        );

        syncTenantCredits(db, tenantId);
        return { applied: true, summary: summary(dependencies, tenantId) };
    });

    return transaction();
}

export function updateTenantBillingAccount(db, dependencies, tenantId, data = {}) {
    const account = ensureTenantBillingAccount(db, tenantId);
    if (!account) {
        throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    }

    let nextPlanId = account.plan_id;
    if (Object.prototype.hasOwnProperty.call(data, 'plan_id')) {
        nextPlanId = data.plan_id === null || data.plan_id === ''
            ? null
            : normalizeOptionalId(data.plan_id, 'plan_id');
    }
    const planChanged = Object.prototype.hasOwnProperty.call(data, 'plan_id')
        && String(nextPlanId || '') !== String(account.plan_id || '');
    const nextPlan = nextPlanId ? db.prepare('SELECT * FROM billing_plans WHERE id = ?').get(nextPlanId) : null;
    if (nextPlanId && !nextPlan) {
        throw new BillingError('باقة الفوترة غير موجودة', { status: 404, code: 'BILLING_PLAN_NOT_FOUND' });
    }

    const fields = [];
    const values = [];
    const allowed = {
        plan_id: () => nextPlanId,
        wallet_balance_credits: (value) => normalizeInteger(value, 'wallet_balance_credits'),
        plan_balance_credits: (value) => normalizeInteger(value, 'plan_balance_credits'),
        credit_limit_credits: (value) => normalizeInteger(value, 'credit_limit_credits', { minimum: 0 }),
        credit_used_credits: (value) => normalizeInteger(value, 'credit_used_credits', { minimum: 0 }),
        status: (value) => {
            if (!['active', 'suspended', 'closed'].includes(value)) {
                invalid('حالة حساب الفوترة غير صالحة', 'INVALID_BILLING_ACCOUNT_STATUS', 'status');
            }
            return value;
        },
        billing_cycle_start: (value) => normalizeSqlDate(db, value) || account.billing_cycle_start,
        billing_cycle_end: (value) => normalizeSqlDate(db, value),
    };

    for (const [key, normalizer] of Object.entries(allowed)) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            fields.push(`${key} = ?`);
            values.push(normalizer(data[key]));
        }
    }

    if (planChanged && nextPlan) {
        if (!Object.prototype.hasOwnProperty.call(data, 'plan_balance_credits')) {
            fields.push('plan_balance_credits = ?');
            values.push(Math.max(toInt(nextPlan.monthly_included_credits), 0));
        }
        if (!Object.prototype.hasOwnProperty.call(data, 'credit_limit_credits')) {
            fields.push('credit_limit_credits = ?');
            values.push(Math.max(toInt(nextPlan.default_credit_limit), 0));
        }
        if (!Object.prototype.hasOwnProperty.call(data, 'credit_used_credits')) {
            fields.push('credit_used_credits = ?');
            values.push(0);
        }
        fields.push(`billing_cycle_start = ${nowSql}`);
        if (nextPlan.code === 'legacy') {
            fields.push('billing_cycle_end = ?');
            values.push(null);
        } else {
            fields.push("billing_cycle_end = datetime('now', '+1 month', 'localtime')");
        }
    } else if (planChanged) {
        if (!Object.prototype.hasOwnProperty.call(data, 'plan_balance_credits')) {
            fields.push('plan_balance_credits = ?');
            values.push(0);
        }
        fields.push('billing_cycle_end = ?');
        values.push(null);
    }

    if (fields.length === 0) return summary(dependencies, tenantId);

    const beforeAvailability = accountAvailability(db, tenantId);
    fields.push(`updated_at = ${nowSql}`);
    values.push(tenantId);

    const transaction = db.transaction(() => {
        db.prepare(`UPDATE tenant_billing_accounts SET ${fields.join(', ')} WHERE tenant_id = ?`).run(...values);

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
        const afterAvailability = computeAvailable(db, updatedAccount, getReservedCredits(db, tenantId));
        const financialChange = planChanged || FINANCIAL_ACCOUNT_FIELDS.some((field) => (
            Object.prototype.hasOwnProperty.call(data, field)
        ));
        if (financialChange) {
            const creditsDelta = afterAvailability.raw_gross_available_credits - beforeAvailability.raw_gross_available_credits;
            db.prepare(`
                INSERT INTO billing_ledger (
                    tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                    related_type, related_id, description, metadata_json
                ) VALUES (?, ?, ?, ?, ?, 'billing_account', ?, ?, ?)
            `).run(
                tenantId,
                planChanged ? 'plan_change' : 'account_adjustment',
                creditsDelta >= 0 ? 'credit' : 'debit',
                creditsDelta,
                afterAvailability.gross_available_credits,
                nextPlan ? String(nextPlan.id) : null,
                planChanged
                    ? (nextPlan ? `تطبيق باقة: ${nextPlan.name}` : 'إزالة باقة العميل')
                    : 'تحديث إداري مباشر لأرصدة حساب الفوترة',
                serializeJson({
                    previous_plan_id: account.plan_id || null,
                    new_plan_id: nextPlanId || null,
                    before: {
                        wallet_balance_credits: toInt(account.wallet_balance_credits),
                        plan_balance_credits: toInt(account.plan_balance_credits),
                        credit_limit_credits: toInt(account.credit_limit_credits),
                        credit_used_credits: toInt(account.credit_used_credits),
                    },
                    after: {
                        wallet_balance_credits: toInt(updatedAccount.wallet_balance_credits),
                        plan_balance_credits: toInt(updatedAccount.plan_balance_credits),
                        credit_limit_credits: toInt(updatedAccount.credit_limit_credits),
                        credit_used_credits: toInt(updatedAccount.credit_used_credits),
                    },
                })
            );
        }

        syncTenantCredits(db, tenantId);
        return summary(dependencies, tenantId);
    });

    return transaction();
}
