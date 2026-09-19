const SUPPORTED_WHATSAPP_BUSINESS_EVENTS = [
    'Purchase',
    'LeadSubmitted',
    'InitiateCheckout',
    'AddToCart',
    'ViewContent',
    'OrderCreated',
    'OrderShipped',
];

export { SUPPORTED_WHATSAPP_BUSINESS_EVENTS };

export function normalizePhone(value) {
    return value ? String(value).replace(/[^\d]/g, '') : '';
}

export function normalizeCtwaClid(value) {
    return value ? String(value).trim() : '';
}

export function parseCustomData(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function getLatestCtwaAttribution(db, tenantId, phone, phoneNumberId = null) {
    const normalizedPhone = normalizePhone(phone);
    if (!tenantId || !normalizedPhone) return null;

    const messagesAvailable = phoneNumberId && db.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'
    `).get();
    if (messagesAvailable) {
        const messageAttribution = db.prepare(`
            SELECT referral_ctwa_clid AS last_ctwa_clid,
                   referral_source_id AS last_ctwa_source_id,
                   referral_source_type AS last_ctwa_source_type,
                   referral_source_url AS last_ctwa_source_url,
                   created_at AS last_ctwa_received_at
            FROM messages
            WHERE tenant_id = ? AND sender = ? AND recipient = ?
              AND referral_ctwa_clid IS NOT NULL
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        `).get(tenantId, normalizedPhone, phoneNumberId);
        if (messageAttribution) return messageAttribution;
    }

    return db.prepare(`
        SELECT last_ctwa_clid, last_ctwa_source_id, last_ctwa_source_type,
               last_ctwa_source_url, last_ctwa_received_at
        FROM contacts
        WHERE tenant_id = ? AND phone = ? AND last_ctwa_clid IS NOT NULL
        LIMIT 1
    `).get(tenantId, normalizedPhone) || null;
}

export function buildWhatsAppBusinessEvent({ eventName, wabaId, ctwaClid, customData, eventTime }) {
    if (!SUPPORTED_WHATSAPP_BUSINESS_EVENTS.includes(eventName)) {
        throw Object.assign(new Error(`نوع الحدث غير مدعوم في WhatsApp Business Messaging Events API: ${eventName}`), {
            statusCode: 400,
            reason: 'unsupported_event_name',
            supportedEvents: SUPPORTED_WHATSAPP_BUSINESS_EVENTS,
        });
    }

    const normalizedWabaId = wabaId ? String(wabaId).trim() : '';
    if (!normalizedWabaId) {
        throw Object.assign(new Error('WABA ID مطلوب لإرسال WhatsApp Business Messaging Events API.'), {
            statusCode: 400,
            reason: 'missing_waba_id',
        });
    }

    const normalizedCtwaClid = normalizeCtwaClid(ctwaClid);
    if (!normalizedCtwaClid) {
        throw Object.assign(new Error('ctwa_clid مطلوب. يجب أن يأتي من referral داخل WhatsApp webhook عند دخول المستخدم من إعلان Click-to-WhatsApp.'), {
            statusCode: 400,
            reason: 'missing_ctwa_clid',
        });
    }

    const event = {
        event_name: eventName,
        event_time: eventTime || Math.floor(Date.now() / 1000),
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: {
            whatsapp_business_account_id: normalizedWabaId,
            ctwa_clid: normalizedCtwaClid,
        },
        data_processing_options: [],
    };

    const normalizedCustomData = parseCustomData(customData);
    if (Object.keys(normalizedCustomData).length > 0) {
        event.custom_data = normalizedCustomData;
    }

    return event;
}
