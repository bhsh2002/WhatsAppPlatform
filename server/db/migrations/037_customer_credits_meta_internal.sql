-- ============================================
-- Migration 037: Customer credits remain independent from Meta cost
-- ============================================

UPDATE billing_price_items
SET local_pricing_model = 'fixed',
    local_pricing_description = 'Customer is charged by local credits. Meta cost basis is internal admin-only reporting.',
    unit_price_credits = CASE
        WHEN COALESCE(unit_price_credits, 0) < 1 THEN 1
        ELSE unit_price_credits
    END,
    is_billable = 1,
    tenant_visible_usage = 1,
    pricing_note = 'Meta cost basis is internal only; customers are charged by credits.'
WHERE local_pricing_model = 'free_tracked';

UPDATE billing_usage_events
SET customer_charge_type = 'platform_fee'
WHERE customer_charge_type IN ('free_meta', 'free_tracked', 'not_charged')
  AND status = 'committed'
  AND (COALESCE(final_credits, 0) > 0 OR COALESCE(total_credits, 0) > 0);
