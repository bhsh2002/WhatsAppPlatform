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
    const platforms = (integrations || []).filter(integration => integration?.platform_code);
    // Selecting a platform displays its requirements; it does not execute a capability.
    if (['pos', 'catalog', 'sawemly'].includes(selectedPlatform)) {
        return selectedPlatform;
    }
    return platforms.find(integration => integration.available === true)?.platform_code
        || platforms[0]?.platform_code || 'pos';
};

export const integrationCandidateIsSelectable = (candidate, integration) => Boolean(
    candidate?.target?.connectable === true
    || (
        integration?.status === 'error'
        && integration.remote_external_tenant_id
        && candidate?.target?.external_tenant_id === integration.remote_external_tenant_id
    )
);

export const integrationRequirements = ({ integration, bound }, language = 'ar') => {
    const ar = language === 'ar';
    const reasons = [];
    const add = (code, arabic, english) => reasons.push({ code, message: ar ? arabic : english });
    if (integration?.available !== true) add('platform_unavailable',
        'المنصة غير مفعّلة في هذه البيئة. اطلب من المسؤول التحقق من جاهزية الربط؛ شراء اشتراك وحده لا يفعّلها.',
        'The platform is not enabled here. Ask the administrator to check integration readiness; a subscription alone does not enable it.');
    if (bound === false) add('organization_unbound',
        'اربط حساب Wa Savana بالمؤسسة المقصودة أولًا.',
        'Link Wa Savana to the intended organization first.');
    else if (bound !== true) add('organization_binding_unknown',
        'لم يتم التحقق من ربط المؤسسة بعد. أعد التحقق قبل إنشاء طلب ربط.',
        'The organization binding has not been verified. Check again before creating a connection request.');
    if (integration?.subscription_entitled === false) add('subscription_required',
        'الاشتراك الحالي لا يشمل هذا الربط. راجع الباقة مع المسؤول بعد التحقق من دعم القدرة.',
        'The current subscription does not include this integration. Review the plan with your administrator after checking capability support.');
    if (integration?.subscription_entitled == null) add('subscription_unknown',
        'تعذر التحقق من الاشتراك. حدّث الحالة أو تواصل مع المسؤول.',
        'Subscription eligibility is unknown. Refresh the status or contact your administrator.');
    if (integration?.status === 'pending_authorization') add('approval_pending',
        'بانتظار موافقة الحساب الآخر. راجع الطلب الحالي دون إنشاء طلب مكرر.',
        'Waiting for the other account to approve. Review the existing request.');
    else if (!integration?.connection_id) add('connection_required',
        'اختر المؤسسة والحساب الهدف ثم أرسل طلب الربط.',
        'Choose the organization and target account, then request a connection.');
    else if (integration?.status !== 'active') add('connection_inactive',
        'الربط غير جاهز للمزامنة. حدّث حالته وراجع الإيقاف أو سحب التفويض أو تعثر الخدمة.',
        'The connection is not ready to synchronize. Refresh its status and review pauses, revoked access or service issues.');
    return reasons;
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
