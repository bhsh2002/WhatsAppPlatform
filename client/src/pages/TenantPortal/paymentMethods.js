const SUPPORTED_METHODS = ['moamalat', 'cash'];

export const availableCentralPaymentMethods = (methods) => {
    if (!Array.isArray(methods)) return ['cash'];
    return SUPPORTED_METHODS.filter(method => methods.includes(method));
};

export const centralInvoiceCheckoutExpired = (invoice, now = Date.now()) => {
    const deadline = invoice?.checkout_expires_at;
    if (deadline === null || deadline === undefined || deadline === '') return false;
    const expiresAt = Date.parse(deadline);
    return !Number.isFinite(expiresAt) || expiresAt <= now;
};

export const centralInvoicePaymentState = (paymentIntents, invoiceId, invoice, now = Date.now()) => {
    const intent = Array.isArray(paymentIntents)
        ? paymentIntents.find(item => item?.invoice_id === invoiceId)
        : null;
    if (!intent) return {
        kind: centralInvoiceCheckoutExpired(invoice, now) ? 'quote_expired' : 'choose',
        intent: null,
    };
    if (!['pending', 'processing'].includes(intent.status)) {
        return { kind: 'needs_review', intent };
    }
    if (intent.provider === 'cash') return { kind: 'cash_pending', intent };
    if (intent.provider === 'moamalat') {
        if (centralInvoiceCheckoutExpired(invoice, now)) {
            return { kind: 'quote_expired', intent };
        }
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
