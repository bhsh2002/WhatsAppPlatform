-- Store Facebook user identity returned by public_profile/email during OAuth.
ALTER TABLE tenants ADD COLUMN facebook_user_id TEXT;
ALTER TABLE tenants ADD COLUMN facebook_user_name TEXT;
ALTER TABLE tenants ADD COLUMN facebook_user_email TEXT;
ALTER TABLE tenants ADD COLUMN facebook_user_picture_url TEXT;
ALTER TABLE tenants ADD COLUMN facebook_user_profile_updated_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_tenants_facebook_user_id ON tenants(facebook_user_id);
