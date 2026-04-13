import db from '../db/database.js';
import { decrypt, decryptIfEncrypted, isEncrypted } from './encryption.js';

/**
 * Get access token from multiple sources with fallback:
 * 1. Specific tenant's access_token (if tenantId provided)
 * 2. DEFAULT_ACCESS_TOKEN env var
 * 3. First active tenant's access_token as last resort
 */
export const getAccessToken = (tenantId = null) => {
    // 1. Try specific tenant
    if (tenantId) {
        const tenant = db.prepare('SELECT access_token, access_token_encrypted FROM tenants WHERE id = ?').get(tenantId);
        if (tenant) {
            // Prefer encrypted token if available
            if (tenant.access_token_encrypted) {
                const decrypted = decrypt(tenant.access_token_encrypted);
                if (decrypted) return decrypted;
            }
            // Fall back to plaintext for migration compatibility
            if (tenant.access_token) {
                return tenant.access_token;
            }
        }
    }

    // 2. Try env var
    if (process.env.DEFAULT_ACCESS_TOKEN) {
        return process.env.DEFAULT_ACCESS_TOKEN;
    }

    // 3. Fallback: first active tenant with an access token
    const fallback = db.prepare("SELECT access_token, access_token_encrypted FROM tenants WHERE status = 'Active' AND (access_token IS NOT NULL OR access_token_encrypted IS NOT NULL) LIMIT 1").get();
    if (fallback) {
        if (fallback.access_token_encrypted) {
            const decrypted = decrypt(fallback.access_token_encrypted);
            if (decrypted) return decrypted;
        }
        return fallback.access_token || null;
    }
    return null;
};

/**
 * Get full tenant credentials (access_token + phone_number_id + waba_id)
 */
export const getTenantCredentials = (tenantId = null) => {
    let tenant = null;

    if (tenantId) {
        tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    }

    let accessToken = process.env.DEFAULT_ACCESS_TOKEN;
    
    if (tenant) {
        // Prefer encrypted token
        if (tenant.access_token_encrypted) {
            const decrypted = decrypt(tenant.access_token_encrypted);
            if (decrypted) accessToken = decrypted;
        } else if (tenant.access_token) {
            accessToken = tenant.access_token;
        }
    }

    const phoneNumberId = tenant?.phone_number_id || process.env.DEFAULT_PHONE_NUMBER_ID;
    const wabaId = tenant?.waba_id || null;
    const businessId = tenant?.business_id || null;
    const datasetId = tenant?.dataset_id || null;

    return { tenant, accessToken, phoneNumberId, wabaId, businessId, datasetId };
};

/**
 * Resolve credentials for a request — handles both explicit credentials and tenant-based lookup.
 * Used by admin message routes that accept optional phone_number_id/access_token overrides.
 *
 * @param {object} options
 * @param {string} options.tenantId - Optional tenant ID to look up
 * @param {string} options.phoneNumberIdOverride - Optional explicit phone number ID
 * @param {string} options.accessTokenOverride - Optional explicit access token
 * @returns {{ tenant, phoneNumberId, accessToken, isSuspended }}
 */
export const resolveCredentials = ({ tenantId, phoneNumberIdOverride, accessTokenOverride } = {}) => {
    let phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
    let accessToken = process.env.DEFAULT_ACCESS_TOKEN;
    let tenant = null;

    if (tenantId) {
        tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (tenant) {
            if (tenant.status === 'Suspended') {
                return { tenant, phoneNumberId: null, accessToken: null, isSuspended: true };
            }
            phoneNumberId = tenant.phone_number_id || phoneNumberId;
            // Prefer encrypted token
            if (tenant.access_token_encrypted) {
                const decrypted = decrypt(tenant.access_token_encrypted);
                if (decrypted) accessToken = decrypted;
            } else if (tenant.access_token) {
                accessToken = tenant.access_token;
            }
        }
    }

    // Allow overrides from request body (for admin console testing)
    phoneNumberId = phoneNumberIdOverride || phoneNumberId;
    accessToken = accessTokenOverride || accessToken;

    return { tenant, phoneNumberId, accessToken, isSuspended: false };
};
