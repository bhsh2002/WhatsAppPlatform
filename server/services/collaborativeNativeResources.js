import crypto from 'node:crypto';
import { listTenantWhatsAppNumbers } from './whatsappNumbers.js';
import { nativeCommandJson, NativeCommandProtocolError } from './nativeCommandProtocol.js';

const fingerprint = value => crypto.createHash('sha256').update(nativeCommandJson(value)).digest('hex');
const fail = code => { throw new NativeCommandProtocolError(code, 422); };
const idFrom = (ref, prefix) => {
    const value = typeof ref === 'string' && ref.startsWith(prefix) ? Number(ref.slice(prefix.length)) : null;
    if (!Number.isSafeInteger(value) || value <= 0 || ref !== `${prefix}${value}`) fail('native_resource_selection_invalid');
    return value;
};

export const listCollaborativeAccounts = (database, tenantId, channel) => {
    if (channel === 'sms') return database.prepare(`SELECT id, name, enabled, status FROM sms_gateway_accounts
        WHERE tenant_id = ? ORDER BY is_default DESC, id`).all(tenantId).map(row => ({
        value: `sms_account:${row.id}`, label: row.name || 'حساب SMS', channel,
        available: row.enabled === 1 && row.status === 'active', reason_code: row.enabled === 1 && row.status === 'active' ? null : 'provider_unavailable',
    }));
    if (channel === 'whatsapp') return listTenantWhatsAppNumbers(database, tenantId, { includeInactive: true }).map(row => ({
        value: row.id == null ? 'whatsapp_legacy' : `whatsapp_number:${row.id}`,
        label: row.label || row.verified_name || row.display_phone_number || 'رقم WhatsApp', channel,
        available: row.is_active === 1, reason_code: row.is_active === 1 ? null : 'connection_inactive',
    }));
    if (['messenger', 'facebook'].includes(channel)) return database.prepare(`SELECT id, page_name, is_active
        FROM tenant_pages WHERE tenant_id = ? ORDER BY id`).all(tenantId).map(row => ({
        value: `facebook_page:${row.id}`, label: row.page_name || 'صفحة Facebook', channel,
        available: row.is_active === 1, reason_code: row.is_active === 1 ? null : 'connection_inactive',
    }));
    fail('native_channel_unsupported');
};

export const resolveCollaborativeAccount = (database, tenantId, channel, accountRef) => {
    let row; let identity; let ready;
    if (channel === 'sms') {
        row = database.prepare(`SELECT id, tenant_id, name, enabled, status, base_url,
            management_mode, gateway_assignment_id,credential_fingerprint FROM sms_gateway_accounts WHERE id = ? AND tenant_id = ?`)
            .get(idFrom(accountRef, 'sms_account:'), tenantId);
        if (row) { identity = { id: row.id, tenantId, baseUrl: row.base_url,
            managementMode: row.management_mode, assignment: row.gateway_assignment_id }; ready = row.enabled === 1 && row.status === 'active'; }
    } else if (channel === 'whatsapp') {
        row = listTenantWhatsAppNumbers(database, tenantId, { includeInactive: true }).find(number =>
            (number.id == null ? 'whatsapp_legacy' : `whatsapp_number:${number.id}`) === accountRef);
        if (row) { identity = { tenantId, id: row.id, phoneNumberId: row.phone_number_id, wabaId: row.waba_id }; ready = row.is_active === 1; }
    } else if (['messenger', 'facebook'].includes(channel)) {
        row = database.prepare('SELECT id, tenant_id, page_id, page_name, is_active FROM tenant_pages WHERE id = ? AND tenant_id = ?')
            .get(idFrom(accountRef, 'facebook_page:'), tenantId);
        if (row) { identity = { tenantId, id: row.id, pageId: row.page_id }; ready = row.is_active === 1; }
    } else fail('native_channel_unsupported');
    if (!row) fail('native_account_not_owned');
    return { ref: accountRef, channel, row, ready, fingerprint: fingerprint(identity),
        providerFingerprint: fingerprint({ identity, credentialFingerprint: channel === 'sms' ? row.credential_fingerprint : null }),
        label: row.name || row.label || row.verified_name || row.page_name || 'الحساب المحدد' };
};

export const resolveCollaborativeRecipient = (database, tenantId, account, recipientRef) => {
    let row; let value; let label;
    if (account.channel === 'messenger') {
        row = database.prepare(`SELECT id, tenant_id, linked_page_id, user_psid, user_name
            FROM fb_conversations WHERE id = ? AND tenant_id = ? AND linked_page_id = ? AND is_active = 1`)
            .get(idFrom(recipientRef, 'native_conversation:'), tenantId, account.row.id);
        if (row) { value = row.user_psid; label = row.user_name || 'محادثة Messenger'; }
    } else if (['sms', 'whatsapp'].includes(account.channel)) {
        row = database.prepare('SELECT id, tenant_id, phone, profile_name FROM contacts WHERE id = ? AND tenant_id = ?')
            .get(idFrom(recipientRef, 'native_contact:'), tenantId);
        if (row) {
            value = String(row.phone || '').replace(/\+/g, '').replace(/\s/g, '');
            if (!/^\d{5,20}$/.test(value)) fail('native_contact_phone_invalid');
            label = `${row.profile_name || 'جهة اتصال'} •••${value.slice(-4)}`;
        }
    } else fail('native_recipient_channel_unsupported');
    if (!row || !value) fail('native_recipient_not_owned');
    return { ref: recipientRef, row, value, label,
        fingerprint: fingerprint({ tenantId, account: account.ref, recordId: row.id, channel: account.channel, recipient: value }) };
};

export const listCollaborativeRecipients = (database, tenantId, account, options = 100) => {
    const { limit = 100, q = '', cursor = null } = typeof options === 'number' ? { limit: options } : options;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101 || typeof q !== 'string' || q.length > 100) fail('native_recipient_search_invalid');
    const prefix = account.channel === 'messenger' ? 'native_conversation:' : 'native_contact:';
    const after = cursor == null ? 0 : idFrom(cursor, prefix);
    const search = `%${q.trim()}%`;
    const refs = account.channel === 'messenger'
        ? database.prepare(`SELECT id FROM fb_conversations WHERE tenant_id = ? AND linked_page_id = ?
            AND is_active = 1 AND id > ? AND (? = '' OR user_name LIKE ?) ORDER BY id LIMIT ?`)
            .all(tenantId, account.row.id, after, q.trim(), search, limit).map(row => `native_conversation:${row.id}`)
        : database.prepare(`SELECT id FROM contacts WHERE tenant_id = ? AND id > ?
            AND (? = '' OR profile_name LIKE ? OR phone LIKE ?) ORDER BY id LIMIT ?`)
            .all(tenantId, after, q.trim(), search, search, limit).map(row => `native_contact:${row.id}`);
    return refs.flatMap(ref => {
        try { const recipient = resolveCollaborativeRecipient(database, tenantId, account, ref); return [{ value: ref, label: recipient.label }]; }
        catch { return []; }
    });
};
