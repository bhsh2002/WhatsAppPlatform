// Local WA adapter readiness, using only the request types already accepted by
// SavanaIntegrationService. This is not the central capability contract or an
// authorization grant. Callers must supply facts verified on the server.
const SOURCE_PLATFORMS = new Set(['pos', 'catalog', 'sawemly']);

const REQUEST_CAPABILITIES = Object.freeze([
    { capability_id: 'wa_savana.notifications.send', request_kind: 'notification_request' },
    { capability_id: 'wa_savana.campaigns.send', request_kind: 'campaign_request' },
    { capability_id: 'wa_savana.content.publish', request_kind: 'content_publication' },
]);

const blocker = (code, message, action) => ({ code, message, action });
const verifiedBoolean = value => typeof value === 'boolean' ? value : null;

export const evaluateLocalIntegrationCapabilities = ({
    sourcePlatform,
    integrationEnabled,
    providerAvailable,
    subscriptionEntitled,
    connectionStatus,
    grantedScopes,
    canReview,
    scopeAuthorized,
    account,
    balance,
    consent,
} = {}) => {
    if (!SOURCE_PLATFORMS.has(sourcePlatform)) return [];
    const scopes = new Set(Array.isArray(grantedScopes) ? grantedScopes : []);
    const sharedReviewBlockers = [];
    if (integrationEnabled !== true) {
        sharedReviewBlockers.push(blocker(
            'integrations_disabled', 'الربط بين المنصات غير مفعّل حاليًا.', 'review_integration',
        ));
    }
    if (providerAvailable !== true) {
        sharedReviewBlockers.push(blocker(
            'provider_unavailable', 'الموفّر غير متاح حاليًا؛ يلزم التحقق من جاهزيته.', 'await_provider',
        ));
    }
    if (subscriptionEntitled !== true) {
        sharedReviewBlockers.push(subscriptionEntitled === false
            ? blocker('subscription_required', 'الاشتراك الحالي لا يشمل هذا الربط.', 'view_subscription')
            : blocker('subscription_unverified', 'لم يتم التحقق من أهلية الاشتراك.', 'refresh_status'));
    }
    if (connectionStatus !== 'active') {
        const pending = connectionStatus === 'pending_authorization';
        sharedReviewBlockers.push(blocker(
            pending ? 'connection_pending' : 'connection_inactive',
            pending ? 'الربط بانتظار الموافقة.' : 'الربط غير نشط؛ راجع حالته وتفويضه.',
            'review_connection',
        ));
    }
    if (canReview !== true) {
        sharedReviewBlockers.push(blocker(
            'review_permission_required', 'تحتاج صلاحية مراجعة الطلب ضمن هذا النطاق.', 'request_permission',
        ));
    }
    if (scopeAuthorized !== true) {
        sharedReviewBlockers.push(blocker(
            'context_scope_unverified', 'يلزم التحقق من تفويض النشاط والموارد لهذا الطلب.', 'review_data_scope',
        ));
    }

    return REQUEST_CAPABILITIES.map(descriptor => {
        const reviewBlockers = [...sharedReviewBlockers];
        if (!scopes.has(descriptor.capability_id)) {
            reviewBlockers.push(blocker(
                'connection_scope_required', 'تفويض الربط لا يشمل هذه القدرة.', 'review_connection',
            ));
        }
        const executionBlockers = [blocker(
            'adapter_execution_not_implemented',
            'المتاح حاليًا طلب مراجعة؛ تنفيذ الأثر عبر المنصات ينتظر اكتمال الربط التنفيذي والعقود.',
            'await_adapter',
        ), ...reviewBlockers];
        if (account?.ready !== true || account?.in_scope !== true || account?.selected !== true) {
            executionBlockers.push(blocker(
                'account_unverified', 'اختر حسابًا جاهزًا ومصرحًا له ضمن النشاط قبل التنفيذ.', 'select_account',
            ));
        }
        if (balance?.sufficient !== true) {
            executionBlockers.push(blocker(
                balance?.sufficient === false ? 'balance_insufficient' : 'cost_unverified',
                balance?.sufficient === false
                    ? 'الرصيد أو الحصة لا يكفيان للتنفيذ.'
                    : 'يلزم التحقق من التكلفة والرصيد والحدود قبل التنفيذ.',
                'review_balance',
            ));
        }
        if (consent?.confirmed !== true) {
            executionBlockers.push(blocker(
                'consent_unverified', 'يلزم اعتماد الغرض والمحتوى والوجهة؛ وجود هاتف لا يثبت الموافقة.', 'review_consent',
            ));
        }
        return {
            ...descriptor,
            source_platform: sourcePlatform,
            provider_platform: 'wa_savana',
            implementation: 'review_only',
            visible: true,
            can_view_requirements: true,
            can_prepare_request: canReview === true && scopeAuthorized === true,
            can_request_review: reviewBlockers.length === 0,
            can_execute: false,
            review_blockers: reviewBlockers,
            execution_blockers: executionBlockers,
            context_checks: {
                provider_available: verifiedBoolean(providerAvailable),
                subscription_entitled: verifiedBoolean(subscriptionEntitled),
                connection_active: connectionStatus ? connectionStatus === 'active' : null,
                review_permission: verifiedBoolean(canReview),
                scope_authorized: verifiedBoolean(scopeAuthorized),
                account_ready: verifiedBoolean(account?.ready),
                account_in_scope: verifiedBoolean(account?.in_scope),
                account_selected: verifiedBoolean(account?.selected),
                balance_sufficient: verifiedBoolean(balance?.sufficient),
                consent_confirmed: verifiedBoolean(consent?.confirmed),
            },
        };
    });
};
