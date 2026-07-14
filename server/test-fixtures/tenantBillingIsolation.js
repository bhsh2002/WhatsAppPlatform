import assert from 'node:assert/strict';
import db from '../db/database.js';
import tenantBillingRouter from '../routes/tenantBilling.js';

const findRouteHandlers = (method, routePath) => {
    const layer = tenantBillingRouter.stack.find(item => (
        item.route?.path === routePath && item.route.methods?.[method]
    ));
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = {
        body: {},
        headers: {},
        params: {},
        query: {},
        ...request,
    };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve({ req, res: this });
            return this;
        },
    };
    const handlers = findRouteHandlers(method, routePath);
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve({ req, res });
        try {
            Promise.resolve(handlers[index++](req, res, next)).catch(reject);
        } catch (handlerError) {
            reject(handlerError);
        }
    };
    next();
});

const insertTenant = db.prepare(`
    INSERT INTO tenants (name, phone, status)
    VALUES (?, ?, 'Active')
`);
const tenantA = Number(insertTenant.run('Billing tenant A', '+218910006001').lastInsertRowid);
const tenantB = Number(insertTenant.run('Billing tenant B', '+218910006002').lastInsertRowid);
const requestFor = (tenantId, values = {}) => ({
    user: { tenant_id: tenantId, role: 'user' },
    ...values,
});

// Summary creation initializes each tenant account through the production service.
assert.equal((await invokeRoute('get', '/summary', requestFor(tenantA))).res.statusCode, 200);
assert.equal((await invokeRoute('get', '/summary', requestFor(tenantB))).res.statusCode, 200);
db.prepare(`
    UPDATE tenant_billing_accounts
    SET wallet_balance_credits = ?, plan_balance_credits = ?, credit_limit_credits = ?
    WHERE tenant_id = ?
`).run(700, 70, 7, tenantA);
db.prepare(`
    UPDATE tenant_billing_accounts
    SET wallet_balance_credits = ?, plan_balance_credits = ?, credit_limit_credits = ?
    WHERE tenant_id = ?
`).run(300, 30, 3, tenantB);

const insertUsage = db.prepare(`
    INSERT INTO billing_usage_events (
        tenant_id, operation_key, channel, operation_type,
        quantity, unit_price_credits, total_credits, status,
        idempotency_key, committed_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, 'committed', ?, datetime('now', 'localtime'))
`);
insertUsage.run(tenantA, 'whatsapp.text', 'whatsapp', 'text', 7, 7, 'billing-a-usage');
insertUsage.run(tenantB, 'messenger.reply', 'messenger', 'reply', 13, 13, 'billing-b-usage');

const insertLedger = db.prepare(`
    INSERT INTO billing_ledger (
        tenant_id, entry_type, direction, credits_delta,
        balance_after_credits, description
    ) VALUES (?, 'usage_debit', 'debit', -1, ?, ?)
`);
const insertInvoice = db.prepare(`
    INSERT INTO billing_invoices (
        tenant_id, invoice_number, subtotal_credits, status, notes
    ) VALUES (?, ?, ?, 'issued', ?)
`);

db.transaction(() => {
    for (let index = 0; index < 105; index += 1) {
        insertLedger.run(tenantA, 700 - index, `Tenant A ledger ${index}`);
        insertInvoice.run(tenantA, `A-INV-${String(index).padStart(3, '0')}`, index, `Tenant A invoice ${index}`);
    }
    insertLedger.run(tenantB, 299, 'Tenant B ledger only');
    insertInvoice.run(tenantB, 'B-INV-ONLY', 13, 'Tenant B invoice only');
})();

const summaryA = await invokeRoute('get', '/summary', requestFor(tenantA));
assert.equal(summaryA.res.statusCode, 200);
assert.equal(summaryA.res.body.tenant_id, tenantA);
assert.equal(summaryA.res.body.account.wallet_balance_credits, 700);
assert.equal(summaryA.res.body.usage_month.length, 1);
assert.equal(summaryA.res.body.usage_month[0].credits, 7);
assert.equal(summaryA.res.body.last_invoice.tenant_id, tenantA);
assert.ok(summaryA.res.body.recent_ledger.every(entry => entry.tenant_id === tenantA));
assert.equal('profitability_month' in summaryA.res.body, false);
assert.equal('meta_cost_month' in summaryA.res.body, false);
assert.equal('platform_fee_usage_month' in summaryA.res.body, false);

const summaryB = await invokeRoute('get', '/summary', requestFor(tenantB));
assert.equal(summaryB.res.body.account.wallet_balance_credits, 300);
assert.equal(summaryB.res.body.usage_month[0].credits, 13);
assert.equal(summaryB.res.body.last_invoice.invoice_number, 'B-INV-ONLY');

const invalidPeriod = await invokeRoute('get', '/summary', requestFor(tenantA, {
    query: { period_start: '2026-08-01', period_end: '2026-07-01' },
}));
assert.equal(invalidPeriod.res.statusCode, 400);
assert.equal(invalidPeriod.res.body.code, 'INVALID_BILLING_PERIOD');

const boundedLedger = await invokeRoute('get', '/ledger', requestFor(tenantA, {
    query: { limit: '999' },
}));
assert.equal(boundedLedger.res.statusCode, 200);
assert.equal(boundedLedger.res.body.ledger.length, 100);
assert.ok(boundedLedger.res.body.ledger.every(entry => entry.tenant_id === tenantA));

const ledgerTail = await invokeRoute('get', '/ledger', requestFor(tenantA, {
    query: { limit: '10', offset: '100' },
}));
assert.equal(ledgerTail.res.body.ledger.length, 5);

const invalidFilter = await invokeRoute('get', '/ledger', requestFor(tenantA, {
    query: { operation: 'x'.repeat(65) },
}));
assert.equal(invalidFilter.res.statusCode, 400);
assert.equal(invalidFilter.res.body.code, 'INVALID_BILLING_QUERY');

const boundedInvoices = await invokeRoute('get', '/invoices', requestFor(tenantA, {
    query: { limit: '999' },
}));
assert.equal(boundedInvoices.res.statusCode, 200);
assert.equal(boundedInvoices.res.body.invoices.length, 100);
assert.ok(boundedInvoices.res.body.invoices.every(invoice => invoice.tenant_id === tenantA));

const invoiceTail = await invokeRoute('get', '/invoices', requestFor(tenantA, {
    query: { limit: '10', offset: '100' },
}));
assert.equal(invoiceTail.res.body.invoices.length, 5);

const tenantBLedger = await invokeRoute('get', '/ledger', requestFor(tenantB));
assert.deepEqual(tenantBLedger.res.body.ledger.map(entry => entry.description), ['Tenant B ledger only']);
const tenantBInvoices = await invokeRoute('get', '/invoices', requestFor(tenantB));
assert.deepEqual(tenantBInvoices.res.body.invoices.map(invoice => invoice.invoice_number), ['B-INV-ONLY']);

db.close();
console.log(JSON.stringify({
    summaryIsolation: true,
    internalMetricsHidden: true,
    ledgerIsolation: true,
    invoiceIsolation: true,
    boundedPagination: true,
    periodAndFilterValidation: true,
}));
