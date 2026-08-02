export const WHATSAPP_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function getWhatsAppConversationWindow(
    database,
    tenantId,
    recipient,
    nowMs = Date.now(),
    phoneNumberId = null,
) {
    if (!tenantId) {
        return {
            isOpen: true,
            lastCustomerMessageAt: null,
            closesAt: null,
        };
    }
    const windowTableExists = phoneNumberId && database.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type = 'table' AND name = 'tenant_whatsapp_contact_windows'
    `).get();
    const contact = windowTableExists
        ? database.prepare(`
            SELECT last_customer_message_at
            FROM tenant_whatsapp_contact_windows
            WHERE tenant_id = ? AND phone_number_id = ? AND contact_phone = ?
        `).get(tenantId, phoneNumberId, recipient)
        : database.prepare(`
            SELECT last_customer_message_at
            FROM contacts
            WHERE tenant_id = ? AND phone = ?
        `).get(tenantId, recipient);
    const timestamp = Date.parse(contact?.last_customer_message_at || '');
    if (!Number.isFinite(timestamp)) {
        return {
            isOpen: false,
            lastCustomerMessageAt: null,
            closesAt: null,
        };
    }
    const elapsed = nowMs - timestamp;
    return {
        isOpen: elapsed >= 0 && elapsed <= WHATSAPP_CONVERSATION_WINDOW_MS,
        lastCustomerMessageAt: new Date(timestamp).toISOString(),
        closesAt: new Date(timestamp + WHATSAPP_CONVERSATION_WINDOW_MS).toISOString(),
    };
}
