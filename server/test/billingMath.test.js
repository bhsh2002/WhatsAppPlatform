import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCustomerCreditsFromMetaCost, deductAccountBalances } from '../services/billingMath.js';

test('Meta cost conversion applies exchange rate and margin then rounds credits up', () => {
    assert.deepEqual(calculateCustomerCreditsFromMetaCost(2.5, {
        meta_cost_exchange_rate_to_lyd: 5,
        meta_cost_margin_percent: 20,
        credit_value_lyd: 0.5,
    }), {
        credits: 30,
        meta_cost_lyd: 12.5,
        customer_charge_lyd: 15,
        credit_value_lyd: 0.5,
        exchange_rate_to_lyd: 5,
        margin_percent: 20,
    });

    assert.equal(calculateCustomerCreditsFromMetaCost(0.01, {
        meta_cost_exchange_rate_to_lyd: 1,
        credit_value_lyd: 1,
    }).credits, 1);
    assert.equal(calculateCustomerCreditsFromMetaCost(-50).credits, 0);
});

test('billing deductions consume plan, wallet, then credit limit usage', () => {
    const account = { plan_balance_credits: 10, wallet_balance_credits: 5, credit_used_credits: 2 };
    assert.deepEqual(deductAccountBalances(account, 3), {
        plan_balance_credits: 7,
        wallet_balance_credits: 5,
        credit_used_credits: 2,
    });
    assert.deepEqual(deductAccountBalances(account, 13), {
        plan_balance_credits: 0,
        wallet_balance_credits: 2,
        credit_used_credits: 2,
    });
    assert.deepEqual(deductAccountBalances(account, 20), {
        plan_balance_credits: 0,
        wallet_balance_credits: 0,
        credit_used_credits: 7,
    });
});
