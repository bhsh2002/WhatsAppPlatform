import db from '../db/database.js';

export const BILLING_OPERATIONS = Object.freeze({
    WHATSAPP_TEXT: 'whatsapp.text',
    WHATSAPP_TEMPLATE: 'whatsapp.template',
    WHATSAPP_MEDIA: 'whatsapp.media',
    WHATSAPP_INTERACTIVE: 'whatsapp.interactive',
    WHATSAPP_BROADCAST_RECIPIENT: 'whatsapp.broadcast_recipient',
    WHATSAPP_CONTACT_VERIFICATION_TEMPLATE: 'whatsapp.contact_verification_template',
    MESSENGER_REPLY: 'messenger.reply',
    MESSENGER_UTILITY: 'messenger.utility',
    FACEBOOK_POST_CREATE: 'facebook.post_create',
    FACEBOOK_POST_EDIT: 'facebook.post_edit',
    FACEBOOK_POST_DELETE: 'facebook.post_delete',
    FACEBOOK_PHOTO_POST_CREATE: 'facebook.photo_post_create',
    FACEBOOK_COMMENT_REPLY: 'facebook.comment_reply',
    FACEBOOK_COMMENT_HIDE: 'facebook.comment_hide',
    FACEBOOK_COMMENT_LIKE: 'facebook.comment_like',
    FACEBOOK_COMMENT_UNLIKE: 'facebook.comment_unlike',
    FACEBOOK_COMMENT_DELETE: 'facebook.comment_delete',
    WHATSAPP_EVENT_CONVERSION: 'whatsapp.event_conversion',
});

export class BillingError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'BillingError';
        this.status = details.status || 402;
        this.code = details.code || 'INSUFFICIENT_BALANCE';
        this.details = details;
    }

    toResponse() {
        return {
            success: false,
            error: this.message,
            code: this.code,
            ...this.details,
        };
    }
}

const toInt = (value, fallback = 0) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const serializeJson = (value) => {
    if (value === undefined || value === null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({ unparseable: true });
    }
};

const nowSql = "datetime('now', 'localtime')";

function getLegacyPlanId() {
    const plan = db.prepare('SELECT id FROM billing_plans WHERE code = ?').get('legacy');
    return plan?.id || null;
}

function getTenant(tenantId) {
    return db.prepare('SELECT id, name, status, credits FROM tenants WHERE id = ?').get(tenantId);
}

function computeAvailable(account, reservedCredits = 0) {
    const planBalance = toInt(account?.plan_balance_credits);
    const walletBalance = toInt(account?.wallet_balance_credits);
    const creditLimit = toInt(account?.credit_limit_credits);
    const creditUsed = toInt(account?.credit_used_credits);
    const remainingCreditLimit = Math.max(creditLimit - creditUsed, 0);
    const grossAvailable = planBalance + walletBalance + remainingCreditLimit;

    return {
        plan_balance_credits: planBalance,
        wallet_balance_credits: walletBalance,
        credit_limit_credits: creditLimit,
        credit_used_credits: creditUsed,
        remaining_credit_limit_credits: remainingCreditLimit,
        gross_available_credits: grossAvailable,
        reserved_credits: Math.max(toInt(reservedCredits), 0),
        available_credits: Math.max(grossAvailable - Math.max(toInt(reservedCredits), 0), 0),
    };
}

function getReservedCredits(tenantId, excludeUsageEventId = null) {
    const params = [tenantId];
    let where = "tenant_id = ? AND status = 'reserved'";
    if (excludeUsageEventId) {
        where += ' AND id != ?';
        params.push(excludeUsageEventId);
    }
    const row = db.prepare(`SELECT COALESCE(SUM(total_credits), 0) AS total FROM billing_usage_events WHERE ${where}`).get(...params);
    return toInt(row?.total);
}

function syncTenantCredits(tenantId) {
    const account = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
    if (!account) return null;

    const availability = computeAvailable(account, getReservedCredits(tenantId));
    db.prepare(`UPDATE tenants SET credits = ?, updated_at = ${nowSql} WHERE id = ?`)
        .run(availability.available_credits, tenantId);
    return availability.available_credits;
}

export function ensureTenantBillingAccount(tenantId) {
    if (!tenantId) return null;

    const existing = db.prepare(`
        SELECT ba.*, p.code AS plan_code, p.name AS plan_name, p.monthly_price_lyd,
               p.monthly_included_credits, p.default_credit_limit
        FROM tenant_billing_accounts ba
        LEFT JOIN billing_plans p ON p.id = ba.plan_id
        WHERE ba.tenant_id = ?
    `).get(tenantId);

    if (existing) return existing;

    const tenant = getTenant(tenantId);
    if (!tenant) return null;

    const planId = getLegacyPlanId();
    const wallet = toInt(tenant.credits);

    const createAccount = db.transaction(() => {
        db.prepare(`
            INSERT INTO tenant_billing_accounts (
                tenant_id, plan_id, wallet_balance_credits, plan_balance_credits,
                credit_limit_credits, credit_used_credits, status
            ) VALUES (?, ?, ?, 0, 0, 0, ?)
        `).run(
            tenantId,
            planId,
            wallet,
            tenant.status === 'Suspended' ? 'suspended' : 'active'
        );

        if (wallet !== 0) {
            db.prepare(`
                INSERT INTO billing_ledger (
                    tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                    related_type, description, metadata_json
                ) VALUES (?, 'opening_balance', ?, ?, ?, 'tenant_migration', ?, ?)
            `).run(
                tenantId,
                wallet >= 0 ? 'credit' : 'debit',
                wallet,
                wallet,
                'ترحيل الرصيد الافتتاحي من tenants.credits',
                serializeJson({ source: 'tenants.credits', created_by_service: true })
            );
        }
    });

    createAccount();
    syncTenantCredits(tenantId);
    return ensureTenantBillingAccount(tenantId);
}

function getPriceItem(operationKey) {
    return db.prepare('SELECT * FROM billing_price_items WHERE operation_key = ?').get(operationKey);
}

export function quote({ tenantId, operationKey, quantity = 1 } = {}) {
    const normalizedQuantity = Math.max(toInt(quantity, 1), 1);
    const priceItem = getPriceItem(operationKey);
    const unitPrice = priceItem?.is_active && priceItem?.is_billable ? toInt(priceItem.unit_price_credits, 1) : 0;
    const totalCredits = unitPrice * normalizedQuantity;
    const account = tenantId ? ensureTenantBillingAccount(tenantId) : null;
    const reservedCredits = tenantId ? getReservedCredits(tenantId) : 0;
    const availability = account ? computeAvailable(account, reservedCredits) : null;

    return {
        tenant_id: tenantId || null,
        operation_key: operationKey,
        quantity: normalizedQuantity,
        price_item: priceItem || null,
        channel: priceItem?.channel || null,
        operation_type: priceItem?.operation_type || null,
        unit_price_credits: unitPrice,
        total_credits: totalCredits,
        billable: Boolean(priceItem?.is_active && priceItem?.is_billable && totalCredits > 0),
        availability,
    };
}

export function reserve({
    tenantId,
    operationKey,
    quantity = 1,
    referenceType = null,
    referenceId = null,
    idempotencyKey = null,
    metadata = null,
} = {}) {
    if (!tenantId) {
        return { skipped: true, operation_key: operationKey, quantity: toInt(quantity, 1), total_credits: 0 };
    }

    const existing = idempotencyKey
        ? db.prepare('SELECT * FROM billing_usage_events WHERE idempotency_key = ?').get(idempotencyKey)
        : null;

    if (existing) {
        return {
            ...existing,
            total_credits: toInt(existing.total_credits),
            quantity: toInt(existing.quantity),
            already_committed: existing.status === 'committed',
        };
    }

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account) {
            throw new BillingError('حساب العميل غير موجود', {
                status: 404,
                code: 'TENANT_NOT_FOUND',
                operation: operationKey,
            });
        }

        if (account.status !== 'active') {
            throw new BillingError('حساب الفوترة موقوف ولا يمكن تنفيذ العملية', {
                status: 402,
                code: 'BILLING_ACCOUNT_SUSPENDED',
                operation: operationKey,
            });
        }

        const currentQuote = quote({ tenantId, operationKey, quantity });
        if (!currentQuote.billable || currentQuote.total_credits <= 0) {
            return {
                skipped: true,
                tenant_id: tenantId,
                operation_key: operationKey,
                quantity: currentQuote.quantity,
                total_credits: 0,
                billable: false,
            };
        }

        const available = currentQuote.availability?.available_credits || 0;
        if (available < currentQuote.total_credits) {
            throw new BillingError('الرصيد غير كافٍ لتنفيذ العملية', {
                operation: operationKey,
                required_credits: currentQuote.total_credits,
                available_credits: available,
                credit_limit: currentQuote.availability?.credit_limit_credits || 0,
            });
        }

        const result = db.prepare(`
            INSERT INTO billing_usage_events (
                tenant_id, price_item_id, operation_key, channel, operation_type,
                quantity, unit_price_credits, total_credits, status,
                reference_type, reference_id, idempotency_key, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)
        `).run(
            tenantId,
            currentQuote.price_item.id,
            operationKey,
            currentQuote.price_item.channel,
            currentQuote.price_item.operation_type,
            currentQuote.quantity,
            currentQuote.unit_price_credits,
            currentQuote.total_credits,
            referenceType,
            referenceId,
            idempotencyKey,
            serializeJson(metadata)
        );

        syncTenantCredits(tenantId);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(result.lastInsertRowid);
    });

    return transaction();
}

function deductAccountBalances(account, credits) {
    let remaining = Math.max(toInt(credits), 0);
    let planBalance = toInt(account.plan_balance_credits);
    let walletBalance = toInt(account.wallet_balance_credits);
    let creditUsed = toInt(account.credit_used_credits);

    const planDebit = Math.min(planBalance, remaining);
    planBalance -= planDebit;
    remaining -= planDebit;

    const walletDebit = Math.min(walletBalance, remaining);
    walletBalance -= walletDebit;
    remaining -= walletDebit;

    if (remaining > 0) {
        creditUsed += remaining;
    }

    return {
        plan_balance_credits: planBalance,
        wallet_balance_credits: walletBalance,
        credit_used_credits: creditUsed,
    };
}

export function commit(reservation, options = {}) {
    if (!reservation || reservation.skipped) return { skipped: true };
    if (reservation.already_committed || reservation.status === 'committed') return reservation;

    const usageId = reservation.id;
    const transaction = db.transaction(() => {
        const usage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usageId);
        if (!usage) return null;
        if (usage.status === 'committed') return usage;
        if (usage.status !== 'reserved') return usage;

        const originalQuantity = toInt(usage.quantity, 1);
        const commitQuantity = options.quantity === undefined
            ? originalQuantity
            : Math.max(Math.min(toInt(options.quantity), originalQuantity), 0);

        if (commitQuantity === 0) {
            return release(usage, options.errorMessage || 'No successful billable operations');
        }

        const unitPrice = toInt(usage.unit_price_credits);
        const chargedCredits = commitQuantity * unitPrice;
        const account = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(usage.tenant_id);
        if (!account) {
            throw new BillingError('حساب الفوترة غير موجود عند اعتماد الخصم', {
                status: 500,
                code: 'BILLING_ACCOUNT_MISSING',
                operation: usage.operation_key,
            });
        }

        const balances = deductAccountBalances(account, chargedCredits);
        db.prepare(`
            UPDATE tenant_billing_accounts
            SET plan_balance_credits = ?,
                wallet_balance_credits = ?,
                credit_used_credits = ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(
            balances.plan_balance_credits,
            balances.wallet_balance_credits,
            balances.credit_used_credits,
            usage.tenant_id
        );

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(usage.tenant_id);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(usage.tenant_id, usage.id)).gross_available_credits;
        const metadata = {
            ...(usage.metadata_json ? JSON.parse(usage.metadata_json) : {}),
            reserved_quantity: originalQuantity,
            committed_quantity: commitQuantity,
            released_quantity: originalQuantity - commitQuantity,
        };

        db.prepare(`
            UPDATE billing_usage_events
            SET quantity = ?,
                total_credits = ?,
                status = 'committed',
                reference_id = COALESCE(?, reference_id),
                metadata_json = ?,
                committed_at = ${nowSql}
            WHERE id = ?
        `).run(
            commitQuantity,
            chargedCredits,
            options.referenceId || null,
            serializeJson(metadata),
            usage.id
        );

        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                related_type, related_id, description, metadata_json
            ) VALUES (?, 'usage_charge', 'debit', ?, ?, ?, ?, ?, ?)
        `).run(
            usage.tenant_id,
            -chargedCredits,
            balanceAfter,
            usage.reference_type || 'usage_event',
            String(usage.id),
            options.description || `خصم عملية: ${usage.operation_key}`,
            serializeJson({
                operation_key: usage.operation_key,
                channel: usage.channel,
                operation_type: usage.operation_type,
                reference_id: options.referenceId || usage.reference_id || null,
                quantity: commitQuantity,
                unit_price_credits: unitPrice,
            })
        );

        syncTenantCredits(usage.tenant_id);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    });

    return transaction();
}

export function release(reservation, errorMessage = null) {
    if (!reservation || reservation.skipped) return { skipped: true };
    if (reservation.status === 'committed') return reservation;

    const usageId = reservation.id;
    const transaction = db.transaction(() => {
        const usage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usageId);
        if (!usage) return null;
        if (usage.status !== 'reserved') return usage;

        db.prepare(`
            UPDATE billing_usage_events
            SET status = 'released',
                error_message = ?,
                released_at = ${nowSql}
            WHERE id = ?
        `).run(errorMessage || null, usage.id);

        syncTenantCredits(usage.tenant_id);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    });

    return transaction();
}

export function recordPayment({ tenantId, credits, amountLyd = 0, method = 'manual', reference = null, note = null, createdBy = null, invoiceId = null }) {
    const normalizedCredits = Math.max(toInt(credits), 0);
    if (!tenantId || normalizedCredits <= 0) {
        throw new BillingError('قيمة الرصيد المضاف غير صالحة', { status: 400, code: 'INVALID_PAYMENT_CREDITS' });
    }

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }

        const payment = db.prepare(`
            INSERT INTO billing_payments (tenant_id, invoice_id, amount_lyd, credits, method, reference, note, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tenantId, invoiceId || null, Number(amountLyd) || 0, normalizedCredits, method, reference, note, createdBy);

        db.prepare(`
            UPDATE tenant_billing_accounts
            SET wallet_balance_credits = wallet_balance_credits + ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(normalizedCredits, tenantId);

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(tenantId)).gross_available_credits;

        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, amount_lyd,
                balance_after_credits, related_type, related_id, description, metadata_json, created_by
            ) VALUES (?, 'payment', 'credit', ?, ?, ?, 'billing_payment', ?, ?, ?, ?)
        `).run(
            tenantId,
            normalizedCredits,
            Number(amountLyd) || 0,
            balanceAfter,
            String(payment.lastInsertRowid),
            note || `إضافة رصيد ${normalizedCredits}`,
            serializeJson({ method, reference }),
            createdBy
        );

        syncTenantCredits(tenantId);
        return {
            payment: db.prepare('SELECT * FROM billing_payments WHERE id = ?').get(payment.lastInsertRowid),
            summary: getBillingSummary(tenantId),
        };
    });

    return transaction();
}

export function recordAdjustment({ tenantId, creditsDelta, reason, createdBy = null }) {
    const delta = toInt(creditsDelta);
    if (!tenantId || delta === 0) {
        throw new BillingError('قيمة التعديل غير صالحة', { status: 400, code: 'INVALID_ADJUSTMENT_CREDITS' });
    }
    if (!String(reason || '').trim()) {
        throw new BillingError('سبب التعديل مطلوب', { status: 400, code: 'ADJUSTMENT_REASON_REQUIRED' });
    }

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }

        db.prepare(`
            UPDATE tenant_billing_accounts
            SET wallet_balance_credits = wallet_balance_credits + ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(delta, tenantId);

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(tenantId)).gross_available_credits;

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
            reason,
            serializeJson({ reason }),
            createdBy
        );

        syncTenantCredits(tenantId);
        return {
            ledger: db.prepare('SELECT * FROM billing_ledger WHERE id = ?').get(ledger.lastInsertRowid),
            summary: getBillingSummary(tenantId),
        };
    });

    return transaction();
}

export function applyMonthlyAllowance(tenantId) {
    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account?.plan_id) return { applied: false, reason: 'no_plan' };

        const plan = db.prepare('SELECT * FROM billing_plans WHERE id = ?').get(account.plan_id);
        if (!plan || !plan.is_active) return { applied: false, reason: 'inactive_plan' };

        const currentMonth = db.prepare("SELECT strftime('%Y-%m', datetime('now', 'localtime')) AS month").get().month;
        const cycleMonth = account.billing_cycle_start
            ? db.prepare("SELECT strftime('%Y-%m', ?) AS month").get(account.billing_cycle_start).month
            : null;

        if (cycleMonth === currentMonth) {
            return { applied: false, reason: 'already_current_cycle' };
        }

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
        `).run(included, toInt(plan.default_credit_limit), tenantId);

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(tenantId)).gross_available_credits;

        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                related_type, related_id, description, metadata_json
            ) VALUES (?, 'monthly_allowance', 'credit', ?, ?, 'billing_plan', ?, ?, ?)
        `).run(
            tenantId,
            included,
            balanceAfter,
            String(plan.id),
            `تجديد رصيد الباقة الشهرية: ${plan.name}`,
            serializeJson({ plan_code: plan.code, credit_limit: toInt(plan.default_credit_limit) })
        );

        syncTenantCredits(tenantId);
        return { applied: true, summary: getBillingSummary(tenantId) };
    });

    return transaction();
}

export function updateTenantBillingAccount(tenantId, data = {}) {
    const account = ensureTenantBillingAccount(tenantId);
    if (!account) {
        throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    }

    const fields = [];
    const values = [];
    const allowed = {
        plan_id: (v) => (v === null || v === '' ? null : toInt(v)),
        wallet_balance_credits: (v) => toInt(v),
        plan_balance_credits: (v) => toInt(v),
        credit_limit_credits: (v) => Math.max(toInt(v), 0),
        credit_used_credits: (v) => Math.max(toInt(v), 0),
        status: (v) => ['active', 'suspended', 'closed'].includes(v) ? v : account.status,
        billing_cycle_start: (v) => v || account.billing_cycle_start,
        billing_cycle_end: (v) => v || null,
    };

    for (const [key, normalizer] of Object.entries(allowed)) {
        if (key in data) {
            fields.push(`${key} = ?`);
            values.push(normalizer(data[key]));
        }
    }

    if (fields.length === 0) return getBillingSummary(tenantId);

    fields.push(`updated_at = ${nowSql}`);
    values.push(tenantId);

    db.prepare(`UPDATE tenant_billing_accounts SET ${fields.join(', ')} WHERE tenant_id = ?`).run(...values);
    syncTenantCredits(tenantId);
    return getBillingSummary(tenantId);
}

export function getLedger(tenantId, { limit = 50, offset = 0, channel = null, operation = null } = {}) {
    const clauses = ['bl.tenant_id = ?'];
    const params = [tenantId];

    if (channel || operation) {
        clauses.push(`EXISTS (
            SELECT 1 FROM billing_usage_events bue
            WHERE bue.id = CAST(bl.related_id AS INTEGER)
              AND bl.related_type IN ('usage_event', 'message', 'broadcast', 'facebook_content', 'conversion_event')
              ${channel ? 'AND bue.channel = ?' : ''}
              ${operation ? 'AND bue.operation_key = ?' : ''}
        )`);
        if (channel) params.push(channel);
        if (operation) params.push(operation);
    }

    params.push(Math.max(toInt(limit, 50), 1), Math.max(toInt(offset), 0));

    return db.prepare(`
        SELECT bl.*
        FROM billing_ledger bl
        WHERE ${clauses.join(' AND ')}
        ORDER BY bl.created_at DESC, bl.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}

export function getInvoices(tenantId, { limit = 20, offset = 0 } = {}) {
    return db.prepare(`
        SELECT *
        FROM billing_invoices
        WHERE tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(tenantId, Math.max(toInt(limit, 20), 1), Math.max(toInt(offset), 0));
}

export function createInvoice({ tenantId, periodStart = null, periodEnd = null, dueDate = null, notes = null, createdBy = null } = {}) {
    if (!tenantId) {
        throw new BillingError('العميل مطلوب لإنشاء الفاتورة', { status: 400, code: 'TENANT_REQUIRED' });
    }

    const transaction = db.transaction(() => {
        ensureTenantBillingAccount(tenantId);
        const periodClause = [];
        const params = [tenantId];

        if (periodStart) {
            periodClause.push('created_at >= ?');
            params.push(periodStart);
        }
        if (periodEnd) {
            periodClause.push('created_at <= ?');
            params.push(periodEnd);
        }

        const usageWhere = periodClause.length ? `AND ${periodClause.join(' AND ')}` : '';
        const usage = db.prepare(`
            SELECT COALESCE(SUM(total_credits), 0) AS credits
            FROM billing_usage_events
            WHERE tenant_id = ?
              AND status = 'committed'
              ${usageWhere}
        `).get(...params);

        const invoiceNumber = `INV-${tenantId}-${Date.now()}`;
        const credits = toInt(usage?.credits);
        const invoice = db.prepare(`
            INSERT INTO billing_invoices (
                tenant_id, invoice_number, period_start, period_end,
                subtotal_credits, subtotal_lyd, status, due_date, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, 0, 'issued', ?, ?, ?)
        `).run(tenantId, invoiceNumber, periodStart, periodEnd, credits, dueDate, notes, createdBy);

        return db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoice.lastInsertRowid);
    });

    return transaction();
}

export function getBillingSummary(tenantId) {
    const account = ensureTenantBillingAccount(tenantId);
    if (!account) return null;

    const fullAccount = db.prepare(`
        SELECT ba.*, p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
               p.monthly_price_lyd, p.monthly_included_credits, p.default_credit_limit
        FROM tenant_billing_accounts ba
        LEFT JOIN billing_plans p ON p.id = ba.plan_id
        WHERE ba.tenant_id = ?
    `).get(tenantId);

    const reservedCredits = getReservedCredits(tenantId);
    const availability = computeAvailable(fullAccount, reservedCredits);

    const usageByChannel = db.prepare(`
        SELECT channel, COALESCE(SUM(total_credits), 0) AS credits, COALESCE(SUM(quantity), 0) AS quantity
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND committed_at >= datetime('now', 'start of month', 'localtime')
        GROUP BY channel
        ORDER BY channel
    `).all(tenantId);

    const lastPayment = db.prepare(`
        SELECT *
        FROM billing_payments
        WHERE tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(tenantId) || null;

    const lastInvoice = db.prepare(`
        SELECT *
        FROM billing_invoices
        WHERE tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(tenantId) || null;

    const recentLedger = getLedger(tenantId, { limit: 10 });

    return {
        tenant_id: tenantId,
        account: fullAccount,
        plan: fullAccount?.plan_id ? {
            id: fullAccount.plan_id,
            code: fullAccount.plan_code,
            name: fullAccount.plan_name,
            description: fullAccount.plan_description,
            monthly_price_lyd: fullAccount.monthly_price_lyd,
            monthly_included_credits: fullAccount.monthly_included_credits,
            default_credit_limit: fullAccount.default_credit_limit,
        } : null,
        balances: availability,
        usage_month: usageByChannel,
        last_payment: lastPayment,
        last_invoice: lastInvoice,
        recent_ledger: recentLedger,
    };
}

export function handleBillingError(res, error) {
    if (error instanceof BillingError) {
        return res.status(error.status).json(error.toResponse());
    }
    return null;
}
