-- ============================================
-- Migration 010: Encrypt sensitive data at rest
-- ============================================
-- Adds columns for encrypted access tokens and hashed API keys.
-- 
-- IMPORTANT: After running this migration, you must:
-- 1. Set CRYPTO_KEY environment variable
-- 2. Run a script to encrypt existing access tokens
-- 3. Run a script to hash existing API keys

-- Add encrypted access token column
ALTER TABLE tenants ADD COLUMN access_token_encrypted TEXT;

-- Add hashed API key column
ALTER TABLE tenant_api_settings ADD COLUMN api_key_hash TEXT;

-- Create index for hashed API key lookups
CREATE INDEX IF NOT EXISTS idx_tenant_api_settings_key_hash ON tenant_api_settings(api_key_hash);