-- Store the Facebook user token granted during Page OAuth separately from
-- the WhatsApp access token used for Cloud API messaging.
ALTER TABLE tenants ADD COLUMN facebook_user_access_token_encrypted TEXT;
ALTER TABLE tenants ADD COLUMN facebook_user_token_scopes TEXT;
ALTER TABLE tenants ADD COLUMN facebook_user_token_updated_at DATETIME;
