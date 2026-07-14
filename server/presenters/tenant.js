const SENSITIVE_TENANT_FIELDS = new Set([
    'access_token',
    'access_token_encrypted',
    'webhook_secret',
    'facebook_user_access_token_encrypted',
]);

export function presentTenant(tenant) {
    if (!tenant) return tenant;

    return Object.fromEntries(
        Object.entries(tenant).filter(([key]) => !SENSITIVE_TENANT_FIELDS.has(key))
    );
}

export function presentTenants(tenants) {
    return tenants.map(presentTenant);
}
