const finiteNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

export const centralInvoiceStatusLabel = status => ({
    open: 'بانتظار السداد', paid: 'مسددة', void: 'ملغاة', refunded: 'مستردة',
}[status] || status || 'غير محددة');

export const centralSubscriptionStatusLabel = status => ({
    active: 'نشط', trialing: 'تجريبي', pending_payment: 'بانتظار السداد',
    past_due: 'متأخر السداد', suspended: 'موقوف', cancelled: 'ملغى', expired: 'منتهٍ',
}[status] || status || 'غير محدد');

export const portalInvoiceColumnKey = (managedCentrally) => (
    managedCentrally ? 'common.amount' : 'common.credit'
);

export const presentPortalInvoices = ({
    managedCentrally,
    centralInvoices = [],
    legacyInvoices = [],
}) => (
    managedCentrally
        ? centralInvoices.map(invoice => ({
            ...invoice,
            invoice_number: invoice.number,
        }))
        : legacyInvoices
);

export const formatPortalInvoiceValue = (invoice, managedCentrally, locale) => {
    if (!managedCentrally) {
        return finiteNumber(invoice?.subtotal_credits).toLocaleString(locale);
    }

    const amount = finiteNumber(invoice?.total_minor) / 100;
    const currency = String(invoice?.currency || 'LYD').trim().toUpperCase();
    return `${amount.toLocaleString(locale, { maximumFractionDigits: 2 })} ${currency}`;
};
