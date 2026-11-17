export const normalizeIntegrationPhone = value => String(value || '').replace(/\D/g, '');

export const integrationRequestRecipient = request => normalizeIntegrationPhone(
    request?.payload?.recipient?.phone_e164 || request?.payload?.customer_phone,
);

export const integrationRequestMatchesConversation = (request, conversation) => {
    const recipient = integrationRequestRecipient(request);
    return Boolean(
        recipient
        && conversation?.channel === 'whatsapp'
        && normalizeIntegrationPhone(conversation.contact_id) === recipient
    );
};

// Review approval is not permission to perform the external effect.
export const integrationRequestBlocksSend = (request, conversation) => Boolean(request) && !(
    request.status === 'approved'
    && request.execution_ready === true
    && integrationRequestMatchesConversation(request, conversation)
);
