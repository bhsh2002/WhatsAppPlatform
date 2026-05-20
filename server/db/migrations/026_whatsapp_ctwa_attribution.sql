-- ============================================
-- Migration 026: WhatsApp CTWA Attribution
-- ============================================
-- WhatsApp Business Messaging Events API requires ctwa_clid from the
-- WhatsApp message referral object. Store the latest click attribution
-- on contacts and keep the raw message-level attribution for diagnostics.

ALTER TABLE contacts ADD COLUMN last_ctwa_clid TEXT;
ALTER TABLE contacts ADD COLUMN last_ctwa_source_id TEXT;
ALTER TABLE contacts ADD COLUMN last_ctwa_source_type TEXT;
ALTER TABLE contacts ADD COLUMN last_ctwa_source_url TEXT;
ALTER TABLE contacts ADD COLUMN last_ctwa_received_at DATETIME;

ALTER TABLE messages ADD COLUMN referral_ctwa_clid TEXT;
ALTER TABLE messages ADD COLUMN referral_source_id TEXT;
ALTER TABLE messages ADD COLUMN referral_source_type TEXT;
ALTER TABLE messages ADD COLUMN referral_source_url TEXT;

ALTER TABLE conversion_events ADD COLUMN ctwa_clid TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_ctwa ON contacts(tenant_id, last_ctwa_clid);
CREATE INDEX IF NOT EXISTS idx_conversion_events_ctwa ON conversion_events(tenant_id, ctwa_clid);
