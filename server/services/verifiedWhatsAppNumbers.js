import { hasWhatsAppNumbersTable, listTenantWhatsAppNumbers, setDefaultTenantWhatsAppNumber } from './whatsappNumbers.js';

// Internal native persistence command. Callers must obtain phones/token from
// actual Meta authority; no HTTP route accepts this server object from a browser.
// Both legacy embedded signup and guided named selection use the same SQL rules.
export const persistVerifiedWhatsAppNumbers = ({ database, tenantId, phones, selectedPhoneId, wabaId,
    businessId = null, encryptedToken, makeDefault = false, verifyCurrent }) => {
    if (typeof verifyCurrent !== 'function') throw new TypeError('Current native owner verification is required');
    const fail = code => { const error = new Error(code); error.code = code; error.status = 409; throw error; };
    if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !Array.isArray(phones) || !phones.length || phones.length > 1000
        || new Set(phones.map(row => String(row.id))).size !== phones.length
        || !phones.some(row => String(row.id) === selectedPhoneId) || typeof encryptedToken !== 'string' || !encryptedToken) fail('WHATSAPP_VERIFIED_CONTEXT_INVALID');
    return database.transaction(() => {
        if (verifyCurrent() !== true) fail('WHATSAPP_CONTEXT_CHANGED');
        const tenant = database.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId);
        if (!tenant || tenant.status === 'Suspended') fail('WHATSAPP_CONTEXT_CHANGED');
        // A legacy tenant may still own a number without a registry row. The
        // presence of the newer table must never silently reassign that number.
        const legacyForeign = database.prepare(`SELECT id FROM tenants
            WHERE phone_number_id IN (${phones.map(() => '?').join(',')}) AND id<>? LIMIT 1`)
            .get(...phones.map(row => String(row.id)), tenantId);
        if (legacyForeign) fail('WHATSAPP_NUMBER_ALREADY_ASSIGNED');
        if (hasWhatsAppNumbersTable(database)) {
            const foreign = database.prepare(`SELECT tenant_id FROM tenant_whatsapp_numbers
                WHERE phone_number_id IN (${phones.map(() => '?').join(',')}) AND tenant_id<>? LIMIT 1`)
                .get(...phones.map(row => String(row.id)), tenantId);
            if (foreign) fail('WHATSAPP_NUMBER_ALREADY_ASSIGNED');
            const upsert = database.prepare(`INSERT INTO tenant_whatsapp_numbers
                (tenant_id,phone_number_id,waba_id,business_id,display_phone_number,verified_name,quality_rating,
                    platform_status,access_token_encrypted,is_default,is_active) VALUES(?,?,?,?,?,?,?,?,?,0,1)
                ON CONFLICT(tenant_id,phone_number_id) DO UPDATE SET waba_id=excluded.waba_id,
                    business_id=COALESCE(excluded.business_id,tenant_whatsapp_numbers.business_id),
                    display_phone_number=COALESCE(excluded.display_phone_number,tenant_whatsapp_numbers.display_phone_number),
                    verified_name=COALESCE(excluded.verified_name,tenant_whatsapp_numbers.verified_name),
                    quality_rating=COALESCE(excluded.quality_rating,tenant_whatsapp_numbers.quality_rating),
                    platform_status=COALESCE(excluded.platform_status,tenant_whatsapp_numbers.platform_status),
                    access_token_encrypted=excluded.access_token_encrypted,is_active=1,updated_at=datetime('now','localtime')`);
            for (const phone of phones) upsert.run(tenantId, String(phone.id), wabaId, businessId,
                phone.display_phone_number || null, phone.verified_name || null, phone.quality_rating || null,
                phone.status || phone.name_status || null, encryptedToken);
            const currentDefault = listTenantWhatsAppNumbers(database, tenantId).find(row => row.is_default);
            if (!currentDefault || makeDefault) setDefaultTenantWhatsAppNumber(database, tenantId, selectedPhoneId);
        } else {
            database.prepare(`UPDATE tenants SET waba_id=?,phone_number_id=?,business_id=?,access_token_encrypted=?,
                access_token=NULL,updated_at=datetime('now','localtime') WHERE id=?`)
                .run(wabaId, selectedPhoneId, businessId, encryptedToken, tenantId);
        }
        if (verifyCurrent() !== true) fail('WHATSAPP_CONTEXT_CHANGED');
        return { importedCount: hasWhatsAppNumbersTable(database) ? phones.length : 1 };
    }).immediate();
};
