export const getUnifiedConversationKey = (conv) => {
    if (!conv) return '';

    const contact = conv.contact_id || conv.contact || '';
    if (conv.channel === 'messenger') {
        return [
            'messenger',
            conv.conversation_id || 'no-conversation',
            conv.linked_page_id || 'no-page',
            contact,
        ].join(':');
    }

    if (conv.channel === 'sms') {
        return [
            'sms',
            conv.tenant_id || 'no-tenant',
            conv.sms_account_id || 'no-account',
            contact,
        ].join(':');
    }

    return ['whatsapp', conv.tenant_id || 'no-tenant', contact].join(':');
};

export const isSameUnifiedConversation = (a, b) => (
    getUnifiedConversationKey(a) === getUnifiedConversationKey(b)
);

export const getWhatsAppConversationKey = (chat) => {
    const contact = chat?.contact || chat?.contact_id || '';
    return `${chat?.tenant_id || 'no-tenant'}:${contact}`;
};

export const isSameWhatsAppConversation = (a, b) => (
    getWhatsAppConversationKey(a) === getWhatsAppConversationKey(b)
);
