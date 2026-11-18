const recordedFields = page => {
    const stored = page?.subscribed_fields;
    if (Array.isArray(stored)) return stored;
    if (typeof stored !== 'string') return [];
    try { const parsed = JSON.parse(stored); return Array.isArray(parsed) ? parsed : []; }
    catch { return stored.split(',').map(value => value.trim()); }
};

export const facebookPageHasMessageEchoes = page => recordedFields(page).includes('message_echoes');

// This controls the existing explicit repair button only. A recorded field is
// neither a live provider check nor authority to execute a message operation.
export const facebookPageNeedsWebhookRepair = (page, liveSubscriptionMissing = false) => Boolean(
    (page?.is_active === true || page?.is_active === 1) && !['expired', 'invalid'].includes(page.token_status)
    && (!(page.webhook_subscribed === true || page.webhook_subscribed === 1) || !facebookPageHasMessageEchoes(page) || liveSubscriptionMissing === true)
);
