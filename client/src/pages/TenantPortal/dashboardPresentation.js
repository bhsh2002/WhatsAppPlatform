const safeCount = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
};

const creditColor = credits => {
    const number = Number(credits);
    if (!Number.isFinite(number)) return 'info';
    if (number > 100) return 'success';
    if (number >= 10) return 'warning';
    return 'error';
};

/**
 * Keeps the dashboard focused on six useful destinations. SMS replaces the
 * template shortcut only for tenants that actually have an SMS account.
 */
export const buildTenantDashboardCards = ({
    stats = {},
    credits,
    formattedCycleEnd,
    cycleCaption,
    cycleColor = 'info',
}) => {
    const unreadCount = safeCount(stats.unreadCount);
    const hasSmsAccount = safeCount(stats.smsAccounts) > 0;

    const channelCard = hasSmsAccount
        ? {
            id: 'sms-today',
            titleKey: 'dashboard.smsToday',
            value: safeCount(stats.smsMessagesToday),
            icon: 'sms',
            color: safeCount(stats.smsFailedToday) > 0 ? 'error' : 'info',
            descriptionKey: 'dashboard.smsActivity',
            descriptionValues: {
                sent: safeCount(stats.smsSentToday),
                pending: safeCount(stats.smsPendingToday),
                received: safeCount(stats.smsReceivedToday),
                failed: safeCount(stats.smsFailedToday),
            },
            actionKey: 'dashboard.viewSmsStats',
            to: '/portal/inbox?channel=sms&period=today',
        }
        : {
            id: 'templates',
            titleKey: 'dashboard.templates',
            value: safeCount(stats.templatesCount),
            icon: 'templates',
            color: 'secondary',
            descriptionKey: 'dashboard.manageTemplates',
            actionKey: 'dashboard.openDetails',
            to: '/portal/templates',
        };

    return [
        {
            id: 'unread',
            titleKey: 'dashboard.unreadMessages',
            value: unreadCount,
            icon: 'unread',
            color: unreadCount > 0 ? 'warning' : 'success',
            descriptionKey: 'dashboard.openConversations',
            actionKey: 'dashboard.openDetails',
            to: '/portal/inbox?unread=1',
        },
        {
            id: 'messages-today',
            titleKey: 'dashboard.messagesToday',
            value: safeCount(stats.messagesToday),
            icon: 'messages',
            color: 'primary',
            descriptionKey: 'dashboard.sentReceived',
            descriptionValues: {
                sent: safeCount(stats.sentToday),
                received: safeCount(stats.receivedToday),
                pending: safeCount(stats.smsPendingToday),
                failed: safeCount(stats.smsFailedToday),
            },
            actionKey: 'dashboard.viewMessages',
            to: '/portal/inbox?period=today',
        },
        {
            id: 'conversations',
            titleKey: 'dashboard.totalConversations',
            value: safeCount(stats.totalConversations),
            icon: 'conversations',
            color: 'info',
            descriptionKey: 'dashboard.allChannels',
            actionKey: 'dashboard.openDetails',
            to: '/portal/inbox',
        },
        channelCard,
        {
            id: 'credits',
            titleKey: 'dashboard.remainingCredits',
            value: credits ?? '—',
            icon: 'credits',
            color: creditColor(credits),
            descriptionKey: 'dashboard.messageCredits',
            actionKey: 'dashboard.viewBillingDetails',
            to: '/portal/billing',
        },
        {
            id: 'subscription',
            titleKey: 'dashboard.subscriptionEnds',
            value: formattedCycleEnd,
            icon: 'subscription',
            color: cycleColor,
            description: cycleCaption,
            actionKey: 'dashboard.manageSubscription',
            to: '/portal/billing',
        },
    ];
};

export const dashboardSafeCount = safeCount;
