import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatPortalInvoiceValue,
    portalInvoiceColumnKey,
    presentPortalInvoices,
} from './billingInvoicePresentation.js';

test('central invoices retain money fields and expose the shared invoice number', () => {
    const invoices = presentPortalInvoices({
        managedCentrally: true,
        centralInvoices: [{
            id: 'invoice-1',
            number: 'SAV-2026-000001',
            total_minor: 8000,
            currency: 'LYD',
        }],
        legacyInvoices: [{ id: 'legacy-1', subtotal_credits: 25 }],
    });

    assert.deepEqual(invoices, [{
        id: 'invoice-1',
        number: 'SAV-2026-000001',
        invoice_number: 'SAV-2026-000001',
        total_minor: 8000,
        currency: 'LYD',
    }]);
    assert.equal('subtotal_credits' in invoices[0], false);
});

test('central invoice values convert minor units and include their currency', () => {
    assert.equal(
        formatPortalInvoiceValue({ total_minor: 8000, currency: 'lyd' }, true, 'en'),
        '80 LYD'
    );
    assert.equal(
        formatPortalInvoiceValue({ total_minor: 8050, currency: 'USD' }, true, 'en'),
        '80.5 USD'
    );
    assert.equal(portalInvoiceColumnKey(true), 'common.amount');
});

test('legacy invoice values remain credits without currency conversion', () => {
    const legacyInvoice = { id: 'legacy-1', subtotal_credits: 8000 };
    assert.deepEqual(presentPortalInvoices({
        managedCentrally: false,
        centralInvoices: [],
        legacyInvoices: [legacyInvoice],
    }), [legacyInvoice]);
    assert.equal(formatPortalInvoiceValue(legacyInvoice, false, 'en'), '8,000');
    assert.equal(portalInvoiceColumnKey(false), 'common.credit');
});
