import assert from 'node:assert/strict';
import db from '../db/database.js';
import {
    applyMonthlyAllowance,
    BILLING_OPERATIONS,
    commit,
    ensureTenantBillingAccount,
    recordAdjustment,
    recordPayment,
    release,
    reserve,
} from '../services/billing.js';

const tenantId = Number(db.prepare(`
    INSERT INTO tenants (name, status, credits) VALUES ('Billing Test', 'Active', 100)
`).run().lastInsertRowid);

ensureTenantBillingAccount(tenantId);
db.prepare(`
    UPDATE tenant_billing_accounts
    SET plan_id = NULL, wallet_balance_credits = 100, plan_balance_credits = 0,
        credit_limit_credits = 0, credit_used_credits = 0, status = 'active'
    WHERE tenant_id = ?
`).run(tenantId);

const reserved = reserve({
    tenantId,
    operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
    quantity: 3,
    referenceType: 'integration_test',
    idempotencyKey: 'billing-lifecycle-commit',
});
assert.equal(reserved.status, 'reserved');
assert.equal(reserved.total_credits, 3);
assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = ?').get(tenantId).credits, 97);

const duplicate = reserve({
    tenantId,
    operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
    quantity: 3,
    idempotencyKey: 'billing-lifecycle-commit',
});
assert.equal(duplicate.id, reserved.id);

const conflictingTenantId = Number(db.prepare(`
    INSERT INTO tenants (name, status, credits) VALUES ('Other Billing Test', 'Active', 100)
`).run().lastInsertRowid);
assert.throws(
    () => reserve({
        tenantId: conflictingTenantId,
        operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
        quantity: 3,
        idempotencyKey: 'billing-lifecycle-commit',
    }),
    (error) => error?.status === 409 && error?.code === 'IDEMPOTENCY_KEY_CONFLICT'
);

const committed = commit(reserved, { referenceId: 'message-1' });
assert.equal(committed.status, 'committed');
assert.equal(reserve({
    tenantId,
    operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
    quantity: 3,
    idempotencyKey: 'billing-lifecycle-commit',
}).already_committed, true);
assert.equal(db.prepare('SELECT wallet_balance_credits FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId).wallet_balance_credits, 97);
assert.equal(db.prepare("SELECT credits_delta FROM billing_ledger WHERE entry_type = 'usage_charge'").get().credits_delta, -3);

const releasable = reserve({
    tenantId,
    operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
    quantity: 2,
    idempotencyKey: 'billing-lifecycle-release',
});
assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = ?').get(tenantId).credits, 95);
const released = release(releasable, 'integration test release');
assert.equal(released.status, 'released');
assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = ?').get(tenantId).credits, 97);
assert.equal(db.prepare('SELECT wallet_balance_credits FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId).wallet_balance_credits, 97);

const payment = recordPayment({
    tenantId,
    credits: 5,
    amountLyd: 0.5,
    reference: 'integration-payment',
});
assert.equal(payment.summary.balances.available_credits, 102);
const adjustment = recordAdjustment({
    tenantId,
    creditsDelta: -5,
    reason: 'integration adjustment',
});
assert.equal(adjustment.summary.balances.available_credits, 97);
assert.equal(applyMonthlyAllowance(tenantId).reason, 'no_plan');
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_ledger WHERE entry_type IN ('payment', 'manual_adjustment')").get().count, 2);

console.log(JSON.stringify({ committed: committed.status, released: released.status, balance: 97 }));
db.close();
