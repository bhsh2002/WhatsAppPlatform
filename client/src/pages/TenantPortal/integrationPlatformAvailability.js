const CONNECTABLE_STATUSES = new Set([
    'rejected',
    'revoked',
    'error',
    'disconnected',
]);

export const integrationIsConnectable = integration => Boolean(
    integration?.available === true
    && (
        !integration.connection_id
        || CONNECTABLE_STATUSES.has(integration.status)
    )
);

export const integrationSubscriptionBadge = (entitled, ar) => {
    if (entitled === true) {
        return {
            label: ar ? 'اشتراك Wa Savana يشمل الربط' : 'Wa Savana subscription includes integration',
            color: 'success',
        };
    }
    if (entitled === false) {
        return {
            label: ar ? 'اشتراك Wa Savana لا يشمل الربط' : 'Wa Savana subscription does not include integration',
            color: 'warning',
        };
    }
    return {
        label: ar ? 'تعذر التحقق من الاشتراك' : 'Subscription status unavailable',
        color: 'default',
    };
};

export const resolveAvailablePlatform = (integrations, selectedPlatform) => {
    const available = (integrations || []).filter(
        integration => integration?.available === true && integration.platform_code
    );
    if (available.some(integration => integration.platform_code === selectedPlatform)) {
        return selectedPlatform;
    }
    return available[0]?.platform_code || null;
};

export const shouldRequestIntegrationCandidates = ({ binding, integration }) => (
    Boolean(binding?.bound) && integrationIsConnectable(integration)
);

export const integrationLoadIsCurrent = ({
    currentPlatform,
    currentRevision,
    requestedPlatform,
    revision,
}) => currentRevision === revision && currentPlatform === requestedPlatform;

export const integrationCandidatesForPlatform = (document, platformCode) => {
    if (!platformCode || document?.target_platform_code !== platformCode) return [];
    return (document.organizations || []).flatMap(organization => (
        (organization.candidates || []).map(target => ({
            source: organization.source_tenant,
            organization: organization.organization,
            target,
            key: `${organization.source_tenant.id}:${target.id}`,
        }))
    ));
};
