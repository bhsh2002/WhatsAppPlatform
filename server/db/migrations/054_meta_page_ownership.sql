-- A Meta Page can deliver a single webhook envelope with no tenant hint. Keep
-- ownership globally unambiguous so it can never be projected into an
-- arbitrary tenant. The migration deliberately fails closed if historical
-- ownership is ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_pages_page_id_global
    ON tenant_pages(page_id);
