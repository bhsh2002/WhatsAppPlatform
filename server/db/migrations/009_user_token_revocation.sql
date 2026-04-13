-- ============================================
-- Migration 009: User-level token revocation
-- ============================================
-- Adds a column to track when all tokens for a user were revoked.
-- Tokens issued before this timestamp should be considered invalid.

ALTER TABLE users ADD COLUMN tokens_revoked_at DATETIME DEFAULT NULL;

-- Create index for faster revocation lookups
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user_expires ON revoked_tokens(user_id, expires_at);