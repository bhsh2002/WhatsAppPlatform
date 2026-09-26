const SUPPORTED_METHODS = ['moamalat', 'cash'];

export const availableCentralPaymentMethods = (methods) => {
    if (!Array.isArray(methods)) return ['cash'];
    return SUPPORTED_METHODS.filter(method => methods.includes(method));
};

export const centralInvoicePaymentState = (paymentIntents, invoiceId) => {
    const intent = Array.isArray(paymentIntents)
        ? paymentIntents.find(item => item?.invoice_id === invoiceId)
        : null;
    if (!intent) return { kind: 'choose', intent: null };
    if (!['pending', 'processing'].includes(intent.status)) {
        return { kind: 'needs_review', intent };
    }
    if (intent.provider === 'cash') return { kind: 'cash_pending', intent };
    if (intent.provider === 'moamalat') {
        return { kind: intent.checkout_url ? 'moamalat_resume' : 'moamalat_pending', intent };
    }
    return { kind: 'needs_review', intent };
};

export const centralInvoiceIsPaid = (context, invoiceId) => Boolean(
    invoiceId
    && context?.managed_centrally
    && Array.isArray(context.invoices)
    && context.invoices.some(invoice => invoice.id === invoiceId && invoice.status === 'paid')
);
