// Current product-snapshot v1 decimal and currency formats. This validates
// representation only; it does not establish price-list/unit authority.
const DECIMAL_PRICE = /^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/;

export const sharedPriceIsValid = price => (
    ['string', 'number'].includes(typeof price)
    && DECIMAL_PRICE.test(String(price))
    && Number.isFinite(Number(price))
);

export const sharedCurrencyIsValid = currency => (
    typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)
);

export const sharedPricingIsValid = product => (
    sharedPriceIsValid(product?.price) && sharedCurrencyIsValid(product?.currency)
);
