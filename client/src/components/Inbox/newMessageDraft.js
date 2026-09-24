const normalizeDigits = value => String(value ?? '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

export const normalizeMessageRecipient = value => normalizeDigits(value)
    .trim()
    .replace(/[\s()+-]/g, '');

export const availableSmsAccounts = accounts => (Array.isArray(accounts) ? accounts : [])
    .filter(account => account?.enabled && account?.status === 'active');

export const resolveSmsAccountId = (accounts, selectedAccountId = '') => {
    const available = availableSmsAccounts(accounts);
    const selected = available.find(
        account => String(account.id) === String(selectedAccountId),
    );
    if (selected) return String(selected.id);

    const tenantDefault = available.find(account => account.is_default);
    if (tenantDefault) return String(tenantDefault.id);
    return available.length === 1 ? String(available[0].id) : '';
};

export const findMatchingConversation = (conversations, candidate) => {
    if (!candidate || !['whatsapp', 'sms'].includes(candidate.channel)) return null;
    const recipient = normalizeMessageRecipient(candidate.contact_id || candidate.contact);

    return (Array.isArray(conversations) ? conversations : []).find(conversation => {
        if (conversation?.channel !== candidate.channel) return false;
        if (normalizeMessageRecipient(conversation.contact_id || conversation.contact) !== recipient) {
            return false;
        }
        if (candidate.channel === 'sms') {
            return String(conversation.sms_account_id || '')
                === String(candidate.sms_account_id || '');
        }
        return true;
    }) || null;
};

export const validateNewMessageDraft = ({
    channel,
    recipient,
    smsAccountId,
}, smsAccounts = []) => {
    const errors = {};
    const normalizedRecipient = normalizeMessageRecipient(recipient);

    if (!['whatsapp', 'sms'].includes(channel)) {
        errors.channel = 'invalid_channel';
    }
    if (!/^\d{5,20}$/.test(normalizedRecipient)) {
        errors.recipient = 'invalid_recipient';
    }
    if (channel === 'sms') {
        const account = availableSmsAccounts(smsAccounts)
            .find(item => String(item.id) === String(smsAccountId));
        if (!account) errors.smsAccountId = 'invalid_sms_account';
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors,
        normalizedRecipient,
    };
};

export const buildNewMessageDraft = ({
    channel,
    recipient,
    message = '',
    smsAccountId,
}, smsAccounts = []) => {
    const validation = validateNewMessageDraft({
        channel,
        recipient,
        smsAccountId,
    }, smsAccounts);
    if (!validation.valid) return { ...validation, conversation: null, message: '' };

    const account = channel === 'sms'
        ? availableSmsAccounts(smsAccounts)
            .find(item => String(item.id) === String(smsAccountId))
        : null;

    return {
        ...validation,
        conversation: {
            channel,
            contact_id: validation.normalizedRecipient,
            display_name: validation.normalizedRecipient,
            avatar_url: null,
            ...(account ? {
                sms_account_id: account.id,
                sms_account_name: account.name,
            } : {}),
        },
        message: String(message || '').slice(0, 4096),
    };
};
