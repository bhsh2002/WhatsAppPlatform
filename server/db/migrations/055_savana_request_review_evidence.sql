-- A local review decision records exactly which request was inspected. This
-- is not an authorization or a central operation/external execution ledger.
ALTER TABLE savana_service_requests ADD COLUMN reviewed_payload_hash TEXT;
ALTER TABLE savana_service_requests ADD COLUMN reviewed_by TEXT;
ALTER TABLE savana_service_requests ADD COLUMN reviewed_at TEXT;
