-- ============================================
-- Migration 006: Conversation Window Tracking
-- ============================================
-- Tracks the last customer message timestamp for 24h window enforcement.

ALTER TABLE contacts ADD COLUMN last_customer_message_at DATETIME
