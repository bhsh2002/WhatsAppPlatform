import db from '../db/database.js';

/**
 * Get access token from multiple sources with fallback:
 * 1. Specific tenant's access_token (if tenantId provided)
 * 2. DEFAULT_ACCESS_TOKEN env var
 * 3. First active tenant's access_token as last resort
 */
export const getAccessToken = (tenantId = null) => {
    // 1. Try specific tenant
    if (tenantId) {
        const tenant = db.prepare('SELECT access_token FROM tenants WHERE id = ?').get(tenantId);
        if (tenant?.access_token) return tenant.access_token;
    }

    // 2. Try env var
    if (process.env.DEFAULT_ACCESS_TOKEN) {
        return process.env.DEFAULT_ACCESS_TOKEN;
    }

    // 3. Fallback: first active tenant with an access token
    const fallback = db.prepare("SELECT access_token FROM tenants WHERE access_token IS NOT NULL AND access_token != '' AND status = 'Active' LIMIT 1").get();
    return fallback?.access_token || null;
};

/**
 * Get full tenant credentials (access_token + phone_number_id + waba_id)
 */
export const getTenantCredentials = (tenantId = null) => {
    let tenant = null;

    if (tenantId) {
        tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    }

    const accessToken = tenant?.access_token || getAccessToken();
    const phoneNumberId = tenant?.phone_number_id || process.env.DEFAULT_PHONE_NUMBER_ID;
    const wabaId = tenant?.waba_id || null;
    const businessId = tenant?.business_id || null;
    const datasetId = tenant?.dataset_id || null;

    return { tenant, accessToken, phoneNumberId, wabaId, businessId, datasetId };
};
