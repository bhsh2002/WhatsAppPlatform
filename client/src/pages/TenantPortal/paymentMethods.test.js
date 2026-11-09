import assert from 'node:assert/strict';
import test from 'node:test';

import {
    centralInvoiceCheckoutExpired,
    centralInvoiceIsPayable,
    centralInvoicePaymentState,
} from './paymentMethods.js';

const deadline = '2026-09-27T12:15:00Z';
const expiresAt = Date.parse(deadline);
const upgradeInvoice = {
    id: 'upgrade-invoice',
    status: 'open',
    checkout_expires_at: deadline,
};

test('only invoices with an elapsed checkout deadline expire', () => {
    assert.equal(centralInvoiceCheckoutExpired(upgradeInvoice, expiresAt - 1), false);
    assert.equal(centralInvoiceCheckoutExpired(upgradeInvoice, expiresAt), true);
    assert.equal(centralInvoiceCheckoutExpired({ checkout_expires_at: null }, expiresAt + 1), false);
    assert.equal(centralInvoiceCheckoutExpired({}, expiresAt + 1), false);
    assert.equal(centralInvoiceCheckoutExpired({ checkout_expires_at: 'invalid' }), true);
});

test('expired upgrade invoices never offer a stale Moamalat link or a new checkout', () => {
    const intent = {
        invoice_id: upgradeInvoice.id,
        provider: 'moamalat',
        status: 'pending',
        checkout_url: 'https://payment.example.test/checkout/old',
    };
    assert.equal(
        centralInvoicePaymentState([intent], upgradeInvoice.id, upgradeInvoice, expiresAt - 1).kind,
        'moamalat_resume',
    );
    assert.equal(
        centralInvoicePaymentState([intent], upgradeInvoice.id, upgradeInvoice, expiresAt).kind,
        'quote_expired',
    );
    assert.equal(
        centralInvoicePaymentState([{ ...intent, checkout_url: null }], upgradeInvoice.id, upgradeInvoice, expiresAt).kind,
        'quote_expired',
    );
    assert.equal(
        centralInvoicePaymentState([], upgradeInvoice.id, upgradeInvoice, expiresAt).kind,
        'quote_expired',
    );
});

test('ordinary invoices remain payable while expired cash quotes require renewal', () => {
    const ordinary = { id: 'ordinary-invoice', status: 'open', checkout_expires_at: null };
    assert.equal(centralInvoicePaymentState([], ordinary.id, ordinary, expiresAt + 1).kind, 'choose');
    assert.equal(centralInvoicePaymentState([{
        invoice_id: ordinary.id,
        provider: 'moamalat',
        status: 'pending',
        checkout_url: 'https://payment.example.test/checkout/current',
    }], ordinary.id, ordinary, expiresAt + 1).kind, 'moamalat_resume');
    assert.equal(centralInvoicePaymentState([{
        invoice_id: upgradeInvoice.id,
        provider: 'cash',
        status: 'pending',
    }], upgradeInvoice.id, upgradeInvoice, expiresAt + 1).kind, 'quote_expired');
});

test('cancelled parents and non-payable invoices never expose cached card or cash actions', () => {
    for (const invoice of [
        { status: 'paid' }, { status: 'void' }, { status: 'open', payable: false },
        ...['cancelled', 'expired', 'void'].map(subscription_status => ({ status: 'open', subscription_status })),
    ]) {
        assert.equal(centralInvoiceIsPayable(invoice), false);
        for (const provider of ['moamalat', 'cash']) {
            const intent = { invoice_id: 'closed', provider, status: 'pending', checkout_url: 'https://payment.test/stale' };
            const result = centralInvoicePaymentState([intent], 'closed', invoice);
            assert.equal(result.kind, 'unavailable');
            assert.equal(result.intent, null);
        }
    }
    assert.equal(centralInvoiceIsPayable(undefined), false);
    assert.equal(centralInvoiceIsPayable({ status: 'open', payable: true, subscription_status: 'pending_payment' }), true);
});
