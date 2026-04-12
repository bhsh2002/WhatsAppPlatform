-- ============================================
-- Migration 007: Contact Labels & Notes
-- ============================================
-- Adds label and notes fields for contact management.

ALTER TABLE contacts ADD COLUMN label TEXT;

ALTER TABLE contacts ADD COLUMN notes TEXT
