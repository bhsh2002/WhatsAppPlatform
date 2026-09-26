import assert from 'node:assert/strict';
import test from 'node:test';

import {
    availableCentralPaymentMethods,
    centralInvoiceIsPaid,
    centralInvoicePaymentState,
} from '../src/pages/TenantPortal/paymentMethods.js';

test('only explicitly available central payment methods are shown', () => {
    assert.deepEqual(availableCentralPaymentMethods(['moamalat', 'cash']), ['moamalat', 'cash']);
    assert.deepEqual(availableCentralPaymentMethods(['cash']), ['cash']);
    assert.deepEqual(availableCentralPaymentMethods(['moamalat']), ['moamalat']);
    assert.deepEqual(availableCentralPaymentMethods([]), []);
});

test('older contexts without payment methods offer cash only', () => {
    assert.deepEqual(availableCentralPaymentMethods(undefined), ['cash']);
    assert.deepEqual(availableCentralPaymentMethods(null), ['cash']);
});

test('an existing invoice intent resumes its method and blocks choosing another', () => {
    const cash = { invoice_id: 'invoice-1', provider: 'cash', status: 'pending', checkout_url: null };
    const moamalat = {
        invoice_id: 'invoice-2', provider: 'moamalat', status: 'pending',
        checkout_url: 'https://payments.test/checkout/1',
    };
    const intents = [cash, moamalat];
    assert.equal(centralInvoicePaymentState(intents, 'invoice-1').kind, 'cash_pending');
    assert.equal(centralInvoicePaymentState(intents, 'invoice-2').kind, 'moamalat_resume');
    assert.equal(centralInvoicePaymentState(intents, 'invoice-3').kind, 'choose');
    assert.equal(centralInvoicePaymentState([
        { ...moamalat, status: 'failed' },
    ], 'invoice-2').kind, 'needs_review');
});

test('return from the provider waits for the matching central invoice to be paid', () => {
    const context = {
        managed_centrally: true,
        invoices: [
            { id: 'older-invoice', status: 'paid' },
            { id: 'current-invoice', status: 'open' },
        ],
    };
    assert.equal(centralInvoiceIsPaid(context, 'current-invoice'), false);
    assert.equal(centralInvoiceIsPaid(context, null), false);
    assert.equal(centralInvoiceIsPaid(context, 'older-invoice'), true);
    assert.equal(centralInvoiceIsPaid({ ...context, managed_centrally: false }, 'older-invoice'), false);
    assert.equal(centralInvoiceIsPaid({
        ...context,
        invoices: [{ id: 'current-invoice', status: 'paid' }],
    }, 'current-invoice'), true);
});
