export const selectCentralPlanPrice = (plan) => {
    const prices = Array.isArray(plan?.prices) ? plan.prices : [];
    return prices.find(price => price.active && price.billing_period === 'monthly')
        || prices.find(price => price.active)
        || null;
};

export const currentCentralOffer = (context) => {
    if (!context?.managed_centrally) return null;
    if (context.current_offer?.name) return context.current_offer;

    const bundle = context.current_bundle
        || context.bundles?.find(item => item.is_current);
    if (bundle) {
        return {
            kind: 'bundle',
            id: bundle.id,
            name: bundle.name,
            amount_minor: bundle.amount_minor,
            currency: bundle.currency,
            billing_period: bundle.billing_period,
            price_available: bundle.price_available,
        };
    }

    const plan = context.active_plan || context.current_plan;
    if (!plan) return null;
    const price = selectCentralPlanPrice(plan);
    return {
        kind: 'plan',
        id: plan.id,
        name: plan.name,
        amount_minor: price?.amount_minor,
        currency: price?.currency,
        billing_period: price?.billing_period,
    };
};

export const centralPlanOfferState = (plan, context) => {
    const currentOffer = context?.current_offer;
    const bundleIsCurrent = currentOffer?.kind === 'bundle'
        || Boolean(context?.current_bundle);
    const planIsCurrent = currentOffer?.kind === 'plan'
        ? currentOffer.id === plan?.id
        : Boolean(plan?.is_current);
    if (planIsCurrent) return bundleIsCurrent ? 'included' : 'current';
    if (plan?.is_subscribed) return 'included';
    if (plan?.checkout_state === 'pending') return 'pending';
    return 'available';
};

export const formatCentralQuoteAmount = (minorValue, currencyValue, locale = 'ar') => {
    if (minorValue == null) return null;
    const amountMinor = Number(minorValue);
    const currency = String(currencyValue || '').trim().toUpperCase();
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !currency) return null;
    const amount = (amountMinor / 100).toLocaleString(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
    return `${amount} ${currency}`;
};

export const isCentralCheckoutQuote = (quote) => Boolean(
    quote
    && typeof quote.currency === 'string'
    && quote.currency.trim()
    && ['monthly', 'yearly'].includes(quote.billing_period)
    && Number.isSafeInteger(quote.period_days)
    && quote.period_days === (quote.billing_period === 'monthly' ? 30 : 365)
    && typeof quote.payment_required === 'boolean'
    && typeof quote.period_starts_after_payment === 'boolean'
    && [
        quote.base_amount_minor,
        quote.upgrade_credit_minor,
        quote.subtotal_minor,
        quote.discount_minor,
        quote.tax_minor,
        quote.total_minor,
    ].every(value => Number.isSafeInteger(value) && value >= 0)
);

export const centralCheckoutQuotesMatch = (first, second) => (
    isCentralCheckoutQuote(first)
    && isCentralCheckoutQuote(second)
    && [
        'currency',
        'billing_period',
        'period_days',
        'base_amount_minor',
        'upgrade_credit_minor',
        'subtotal_minor',
        'discount_minor',
        'tax_minor',
        'total_minor',
        'payment_required',
        'period_starts_after_payment',
    ].every(field => first[field] === second[field])
);

export const formatCentralOfferPrice = (offer, locale = 'ar') => {
    if (offer?.price_available === false) return null;
    const base = formatCentralQuoteAmount(offer?.amount_minor, offer?.currency, locale);
    if (!base) return null;
    const period = offer.billing_period === 'monthly'
        ? ' / شهر'
        : offer.billing_period === 'yearly' ? ' / سنة' : '';
    return `${base}${period}`;
};
