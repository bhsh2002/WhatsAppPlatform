import { toInt } from './billingCore.js';
import {
    computeAvailable,
    ensureTenantBillingAccount,
    getReservedCredits,
} from './billingAccount.js';
import { getLedger } from './billingHistory.js';
import { normalizeBillingPeriod } from './billingPeriod.js';
import { getBillingSettings } from './billingSettings.js';

const chargedCreditsSql = `
    CASE
        WHEN COALESCE(final_credits, 0) > 0 THEN final_credits
        ELSE COALESCE(total_credits, 0)
    END
`;

export function getBillingSummary(db, tenantId, {
    includeInternal = true,
    periodStart = null,
    periodEnd = null,
} = {}) {
    const account = ensureTenantBillingAccount(db, tenantId);
    if (!account) return null;

    const fullAccount = db.prepare(`
        SELECT ba.*, p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
               p.monthly_price_lyd, p.monthly_included_credits, p.default_credit_limit
        FROM tenant_billing_accounts ba
        LEFT JOIN billing_plans p ON p.id = ba.plan_id
        WHERE ba.tenant_id = ?
    `).get(tenantId);

    const reservedCredits = getReservedCredits(db, tenantId);
    const availability = computeAvailable(db, fullAccount, reservedCredits);
    const period = normalizeBillingPeriod(db, { periodStart, periodEnd });

    const usageByChannel = db.prepare(`
        SELECT channel,
               operation_type,
               COALESCE(SUM(${chargedCreditsSql}), 0) AS credits,
               COALESCE(SUM(quantity), 0) AS quantity
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND committed_at >= ?
          AND committed_at <= ?
          AND (${chargedCreditsSql}) > 0
        GROUP BY channel, operation_type
        ORDER BY channel, operation_type
    `).all(tenantId, period.start, period.end);

    const platformFeeUsageByChannel = includeInternal ? db.prepare(`
        SELECT channel,
               COALESCE(SUM(${chargedCreditsSql}), 0) AS credits,
               COALESCE(SUM(quantity), 0) AS quantity
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND committed_at >= ?
          AND committed_at <= ?
          AND (${chargedCreditsSql}) > 0
          AND customer_charge_type IN ('platform_fee', 'paid')
        GROUP BY channel
        ORDER BY channel
    `).all(tenantId, period.start, period.end) : [];

    const metaFreeCostUsageByChannel = includeInternal ? db.prepare(`
        SELECT channel,
               operation_type,
               COALESCE(SUM(quantity), 0) AS quantity,
               COALESCE(SUM(${chargedCreditsSql}), 0) AS credits
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND tenant_visible_usage != 0
          AND committed_at >= ?
          AND committed_at <= ?
          AND (${chargedCreditsSql}) > 0
          AND COALESCE(meta_final_amount, 0) = 0
          AND COALESCE(meta_charge_status, 'not_applicable') IN ('not_charged', 'not_applicable', 'final')
        GROUP BY channel, operation_type
        ORDER BY channel, operation_type
    `).all(tenantId, period.start, period.end) : [];

    const metaCostPeriod = includeInternal ? db.prepare(`
        SELECT meta_charge_currency AS currency,
               COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
               COALESCE(SUM(meta_final_amount), 0) AS final_amount,
               SUM(CASE WHEN meta_charge_status = 'rate_missing' THEN 1 ELSE 0 END) AS rate_missing_count
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND channel = 'whatsapp'
          AND committed_at >= ?
          AND committed_at <= ?
        GROUP BY meta_charge_currency
        ORDER BY final_amount DESC, estimated_amount DESC
    `).all(tenantId, period.start, period.end) : [];

    const billingSettings = getBillingSettings(db).settings;
    const creditValueLyd = Number(billingSettings.credit_value_lyd) || 0.1;
    const customerUsageCredits = usageByChannel.reduce((sum, row) => sum + toInt(row.credits), 0);
    const customerUsageValueLyd = customerUsageCredits * creditValueLyd;
    const customerPaidLydPeriod = includeInternal ? Number(db.prepare(`
        SELECT COALESCE(SUM(amount_lyd), 0) AS total
        FROM billing_payments
        WHERE tenant_id = ?
          AND created_at >= ?
          AND created_at <= ?
    `).get(tenantId, period.start, period.end)?.total) || 0 : 0;
    const metaCostLydPeriod = metaCostPeriod.reduce((sum, row) => {
        const currency = row.currency || 'USD';
        const amount = Number(row.final_amount) || 0;
        if (currency === 'LYD') return sum + amount;
        return sum + (amount * (Number(billingSettings.meta_cost_exchange_rate_to_lyd) || 1));
    }, 0);
    const profitabilityPeriod = includeInternal ? {
        customer_usage_credits: customerUsageCredits,
        customer_usage_value_lyd: customerUsageValueLyd,
        customer_paid_lyd: customerPaidLydPeriod,
        meta_cost_lyd: metaCostLydPeriod,
        gross_margin_lyd: customerUsageValueLyd - metaCostLydPeriod,
        credit_value_lyd: creditValueLyd,
    } : null;

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

    const recentLedger = getLedger(db, tenantId, { limit: 10 });
    const result = {
        tenant_id: tenantId,
        period,
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
        usage_period: usageByChannel,
        paid_usage_month: usageByChannel,
        paid_usage_period: usageByChannel,
        last_payment: lastPayment,
        last_invoice: lastInvoice,
        recent_ledger: recentLedger,
    };

    if (includeInternal) {
        result.platform_fee_usage_month = platformFeeUsageByChannel;
        result.platform_fee_usage_period = platformFeeUsageByChannel;
        result.meta_free_cost_usage_month = metaFreeCostUsageByChannel;
        result.meta_free_cost_usage_period = metaFreeCostUsageByChannel;
        result.meta_cost_month = metaCostPeriod;
        result.meta_cost_period = metaCostPeriod;
        result.profitability_month = profitabilityPeriod;
        result.profitability_period = profitabilityPeriod;
    }

    return result;
}
