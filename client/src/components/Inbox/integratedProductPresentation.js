// Match the current exported decimal/currency format. This is display/readiness
// validation, never a grant or an inferred price/unit/currency conversion.
const DECIMAL_PRICE = /^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/;
const CURRENCY = /^[A-Z]{3}$/;

export const integratedProductPricing = product => {
  const price = product?.price;
  const currency = product?.currency;
  const valid = (typeof price === 'string' || typeof price === 'number')
    && DECIMAL_PRICE.test(String(price))
    && Number.isFinite(Number(price))
    && typeof currency === 'string' && CURRENCY.test(currency);
  return {
    ready: valid && product?.pricing_ready !== false,
    price: valid ? String(price) : null,
    currency: valid ? currency : null,
  };
};

export const integratedProductCanPrepareMessage = product => (
  integratedProductPricing(product).ready
  && product?.can_prepare_product_message === true
  && product?.is_active === true
);

export const integratedProductPreparationReason = (product, t) => {
  if (!integratedProductPricing(product).ready) return t('inbox.integratedProductPricingUnavailable');
  return product?.preparation_blockers?.[0]?.message || t('inbox.integratedProductPreparationUnavailable');
};

export const integratedProductMessage = (product, t) => {
  const pricing = integratedProductPricing(product);
  if (!integratedProductCanPrepareMessage(product)) return null;
  const parts = [product.name || product.sku || product.barcode || t('inbox.integratedProductFallback')];
  parts.push(t('inbox.integratedProductPrice', pricing));
  const quantity = product.quantity_available ?? product.quantity_on_hand;
  if (quantity !== null && quantity !== undefined && quantity !== '') {
    parts.push(t('inbox.integratedProductAvailable', { quantity }));
  }
  if (product.shelf_code) parts.push(t('inbox.integratedProductShelf', { shelf: product.shelf_code }));
  return parts.join(' — ');
};
