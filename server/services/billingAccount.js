import { serializeJson, toInt } from './billingCore.js';

const nowSql = "datetime('now', 'localtime')";

const getAccount = (db, tenantId) => db.prepare(`
    SELECT ba.*, p.code AS plan_code, p.name AS plan_name, p.monthly_price_lyd,
           p.monthly_included_credits, p.default_credit_limit
    FROM tenant_billing_accounts ba
    LEFT JOIN billing_plans p ON p.id = ba.plan_id
    WHERE ba.tenant_id = ?
`).get(tenantId) || null;

const getPlanCode = (db, account) => {
    if (!account?.plan_id) return null;
    if (account.plan_code) return account.plan_code;
    return db.prepare('SELECT code FROM billing_plans WHERE id = ?').get(account.plan_id)?.code || null;
};

export function getBillingCycleState(db, account) {
    const hasPlan = !!account?.plan_id;
    const cycleStart = account?.billing_cycle_start || null;
    const cycleEnd = account?.billing_cycle_end || null;
    const legacyPlan = hasPlan && getPlanCode(db, account) === 'legacy';

    if (!hasPlan || legacyPlan) {
        return {
            billing_cycle_active: true,
            billing_cycle_blocked: false,
            billing_cycle_expired: false,
            billing_cycle_block_reason: null,
            billing_cycle_start: cycleStart,
            billing_cycle_end: cycleEnd,
        };
    }

    if (!cycleEnd) {
        return {
            billing_cycle_active: false,
            billing_cycle_blocked: true,
            billing_cycle_expired: true,
            billing_cycle_block_reason: 'missing_cycle_end',
            billing_cycle_start: cycleStart,
            billing_cycle_end: null,
        };
    }

    const active = db.prepare(`
        SELECT CASE WHEN datetime(?) > datetime('now', 'localtime') THEN 1 ELSE 0 END AS active
    `).get(cycleEnd)?.active === 1;

    return {
        billing_cycle_active: active,
        billing_cycle_blocked: !active,
        billing_cycle_expired: !active,
        billing_cycle_block_reason: active ? null : 'cycle_expired',
        billing_cycle_start: cycleStart,
        billing_cycle_end: cycleEnd,
    };
}

export function computeAvailable(db, account, reservedCredits = 0) {
    const cycleState = getBillingCycleState(db, account);
    const planBalance = toInt(account?.plan_balance_credits);
    const walletBalance = toInt(account?.wallet_balance_credits);
    const creditLimit = toInt(account?.credit_limit_credits);
    const creditUsed = toInt(account?.credit_used_credits);
    const rawRemainingCreditLimit = Math.max(creditLimit - creditUsed, 0);
    const rawGrossAvailable = planBalance + walletBalance + rawRemainingCreditLimit;
    const effectiveGrossAvailable = cycleState.billing_cycle_blocked ? 0 : rawGrossAvailable;
    const effectiveReservedCredits = Math.max(toInt(reservedCredits), 0);

    return {
        plan_balance_credits: planBalance,
        wallet_balance_credits: walletBalance,
        credit_limit_credits: creditLimit,
        credit_used_credits: creditUsed,
        remaining_credit_limit_credits: cycleState.billing_cycle_blocked ? 0 : rawRemainingCreditLimit,
        raw_remaining_credit_limit_credits: rawRemainingCreditLimit,
        gross_available_credits: effectiveGrossAvailable,
        raw_gross_available_credits: rawGrossAvailable,
        reserved_credits: effectiveReservedCredits,
        available_credits: Math.max(effectiveGrossAvailable - effectiveReservedCredits, 0),
        ...cycleState,
    };
}

export function getReservedCredits(db, tenantId, excludeUsageEventId = null) {
    const params = [tenantId];
    let where = "tenant_id = ? AND status = 'reserved'";
    if (excludeUsageEventId) {
        where += ' AND id != ?';
        params.push(excludeUsageEventId);
    }
    const row = db.prepare(`SELECT COALESCE(SUM(total_credits), 0) AS total FROM billing_usage_events WHERE ${where}`)
        .get(...params);
    return toInt(row?.total);
}

export function syncTenantCredits(db, tenantId) {
    const account = getAccount(db, tenantId);
    if (!account) return null;

    const availability = computeAvailable(db, account, getReservedCredits(db, tenantId));
    db.prepare(`UPDATE tenants SET credits = ?, updated_at = ${nowSql} WHERE id = ?`)
        .run(availability.available_credits, tenantId);
    return availability.available_credits;
}

export function ensureTenantBillingAccount(db, tenantId) {
    if (!tenantId) return null;

    const existing = getAccount(db, tenantId);
    if (existing) return existing;

    const tenant = db.prepare('SELECT id, name, status, credits FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) return null;

    const planId = db.prepare('SELECT id FROM billing_plans WHERE code = ?').get('legacy')?.id || null;
    const wallet = toInt(tenant.credits);

    const createAccount = db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO tenant_billing_accounts (
                tenant_id, plan_id, wallet_balance_credits, plan_balance_credits,
                credit_limit_credits, credit_used_credits, status
            ) VALUES (?, ?, ?, 0, 0, 0, ?)
            ON CONFLICT(tenant_id) DO NOTHING
        `).run(
            tenantId,
            planId,
            wallet,
            tenant.status === 'Suspended' ? 'suspended' : 'active'
        );

        if (result.changes === 1 && wallet !== 0) {
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
    syncTenantCredits(db, tenantId);
    return getAccount(db, tenantId);
}
