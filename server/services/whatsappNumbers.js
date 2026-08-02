import { decryptIfEncrypted } from './encryption.js';

const PHONE_HEADER = 'x-whatsapp-phone-number-id';

const normalizeIdentifier = value => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return normalized && normalized.length <= 256 && !/[\u0000-\u001f\u007f]/.test(normalized)
        ? normalized
        : null;
};

export const hasWhatsAppNumbersTable = database => !!database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'tenant_whatsapp_numbers'
`).get();

export const selectedWhatsAppPhoneNumberId = request => normalizeIdentifier(
    request?.headers?.[PHONE_HEADER]
    ?? request?.get?.(PHONE_HEADER)
    ?? request?.query?.phone_number_id
    ?? request?.body?.phone_number_id
);

const decryptNumberToken = (value, decryptToken) => {
    if (!value) return null;
    try {
        return (decryptToken || decryptIfEncrypted)(value) || null;
    } catch {
        return null;
    }
};

export const listTenantWhatsAppNumbers = (database, tenantId, { includeInactive = false } = {}) => {
    if (!hasWhatsAppNumbersTable(database)) {
        const legacy = database.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        if (!legacy?.phone_number_id) return [];
        return [{
            id: null,
            tenant_id: legacy.id,
            phone_number_id: legacy.phone_number_id,
            waba_id: legacy.waba_id || null,
            business_id: legacy.business_id || null,
            dataset_id: legacy.dataset_id || null,
            display_phone_number: null,
            verified_name: null,
            label: null,
            quality_rating: null,
            platform_status: null,
            is_default: 1,
            is_active: 1,
        }];
    }

    return database.prepare(`
        SELECT id, tenant_id, phone_number_id, waba_id, business_id, dataset_id,
               display_phone_number, verified_name, label, quality_rating,
               platform_status, is_default, is_active, created_at, updated_at
        FROM tenant_whatsapp_numbers
        WHERE tenant_id = ? ${includeInactive ? '' : 'AND is_active = 1'}
        ORDER BY is_default DESC, created_at ASC, id ASC
    `).all(tenantId);
};

/**
 * Resolve the selected (or default) number and its credential for a tenant.
 * Explicit selections are always tenant-owned; arbitrary credential overrides
 * can no longer redirect a tenant request through somebody else's number.
 */
export const resolveTenantWhatsAppContext = ({
    database,
    tenantId,
    request = null,
    phoneNumberId = null,
    accessTokenForTenant,
    decryptToken,
    requireActive = true,
    requireToken = true,
} = {}) => {
    const normalizedTenantId = Number(tenantId);
    if (!Number.isSafeInteger(normalizedTenantId) || normalizedTenantId <= 0) {
        return { error: 'جلسة المستأجر غير صالحة', status: 401, code: 'INVALID_TENANT' };
    }
    const tenant = database.prepare('SELECT * FROM tenants WHERE id = ?').get(normalizedTenantId);
    if (!tenant) return { error: 'العميل غير موجود', status: 404, code: 'TENANT_NOT_FOUND' };
    if (tenant.status === 'Suspended') {
        return { tenant, error: 'الحساب موقوف', status: 403, code: 'TENANT_SUSPENDED' };
    }

    const requestedId = normalizeIdentifier(phoneNumberId)
        || selectedWhatsAppPhoneNumberId(request);
    let number = null;
    if (hasWhatsAppNumbersTable(database)) {
        if (requestedId) {
            number = database.prepare(`
                SELECT * FROM tenant_whatsapp_numbers
                WHERE tenant_id = ? AND phone_number_id = ?
            `).get(normalizedTenantId, requestedId);
            if (!number) {
                return {
                    tenant,
                    error: 'رقم WhatsApp المحدد غير مرتبط بهذا الحساب',
                    status: 404,
                    code: 'WHATSAPP_NUMBER_NOT_FOUND',
                };
            }
        } else {
            number = database.prepare(`
                SELECT * FROM tenant_whatsapp_numbers
                WHERE tenant_id = ? AND is_active = 1
                ORDER BY is_default DESC, created_at ASC, id ASC
                LIMIT 1
            `).get(normalizedTenantId);
        }
        if (number && requireActive && !number.is_active) {
            return {
                tenant,
                number,
                error: 'رقم WhatsApp المحدد غير نشط',
                status: 409,
                code: 'WHATSAPP_NUMBER_INACTIVE',
            };
        }
    }

    if (!number && (!requestedId || requestedId === String(tenant.phone_number_id || ''))) {
        number = tenant.phone_number_id ? {
            id: null,
            tenant_id: normalizedTenantId,
            phone_number_id: tenant.phone_number_id,
            waba_id: tenant.waba_id,
            business_id: tenant.business_id,
            dataset_id: tenant.dataset_id,
            access_token_encrypted: tenant.access_token_encrypted,
            is_default: 1,
            is_active: 1,
        } : null;
    }
    if (!number) {
        return {
            tenant,
            error: requestedId
                ? 'رقم WhatsApp المحدد غير مرتبط بهذا الحساب'
                : 'لا يوجد رقم WhatsApp نشط مرتبط بالحساب',
            status: requestedId ? 404 : 400,
            code: requestedId ? 'WHATSAPP_NUMBER_NOT_FOUND' : 'WHATSAPP_NUMBER_REQUIRED',
        };
    }

    const accessToken = decryptNumberToken(number.access_token_encrypted, decryptToken)
        || (typeof accessTokenForTenant === 'function' ? accessTokenForTenant(normalizedTenantId) : null);
    if (!accessToken && requireToken) {
        return {
            tenant,
            number,
            error: 'رمز وصول WhatsApp غير متوفر للرقم المحدد',
            status: 400,
            code: 'WHATSAPP_TOKEN_REQUIRED',
        };
    }

    return {
        tenantId: normalizedTenantId,
        tenant,
        number,
        phoneNumberId: String(number.phone_number_id),
        wabaId: number.waba_id || tenant.waba_id || null,
        businessId: number.business_id || tenant.business_id || null,
        datasetId: number.dataset_id || tenant.dataset_id || null,
        accessToken: accessToken ? String(accessToken) : null,
    };
};

export const setDefaultTenantWhatsAppNumber = (database, tenantId, phoneNumberId) => {
    const number = database.prepare(`
        SELECT * FROM tenant_whatsapp_numbers
        WHERE tenant_id = ? AND phone_number_id = ? AND is_active = 1
    `).get(tenantId, phoneNumberId);
    if (!number) return null;

    database.transaction(() => {
        database.prepare(`
            UPDATE tenant_whatsapp_numbers
            SET is_default = 0, updated_at = datetime('now', 'localtime')
            WHERE tenant_id = ? AND is_default = 1
        `).run(tenantId);
        database.prepare(`
            UPDATE tenant_whatsapp_numbers
            SET is_default = 1, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(number.id);
        database.prepare(`
            UPDATE tenants
            SET phone_number_id = ?, waba_id = ?, business_id = ?, dataset_id = ?,
                access_token_encrypted = COALESCE(?, access_token_encrypted),
                access_token = CASE WHEN ? IS NOT NULL THEN NULL ELSE access_token END,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(
            number.phone_number_id,
            number.waba_id,
            number.business_id,
            number.dataset_id,
            number.access_token_encrypted,
            number.access_token_encrypted,
            tenantId,
        );
    })();
    return database.prepare(`
        SELECT id, tenant_id, phone_number_id, waba_id, business_id, dataset_id,
               display_phone_number, verified_name, label, quality_rating,
               platform_status, is_default, is_active, created_at, updated_at
        FROM tenant_whatsapp_numbers WHERE id = ?
    `).get(number.id);
};
