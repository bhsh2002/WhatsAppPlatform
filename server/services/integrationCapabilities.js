// Local, advisory projection of facts verified on the server. This does not
// authorize an effect; the native handler must recheck its own current inputs.
const SOURCE_PLATFORMS = new Set(['pos', 'catalog', 'sawemly']);
export const LOCAL_REQUEST_CAPABILITIES = Object.freeze([
    Object.freeze({ capability_id: 'wa_savana.notifications.send', capability_code: 'messaging.send', review_capability_code: 'messaging.review', request_kind: 'notification_request' }),
    Object.freeze({ capability_id: 'wa_savana.campaigns.send', capability_code: 'campaigns.execute', review_capability_code: 'campaigns.review', request_kind: 'campaign_request' }),
    Object.freeze({ capability_id: 'wa_savana.content.publish', capability_code: 'content.publish', review_capability_code: 'content.review', request_kind: 'content_publication' }),
]);
const boolean = value => typeof value === 'boolean' ? value : null;
const destinations = Object.freeze({
    view_subscription: { path: '/portal/billing', section: 'subscription' },
    review_balance: { path: '/portal/billing', section: 'balance' },
});
const blocker = (code, message, action) => ({ code, message, action,
    destination: destinations[action] || { path: '/portal/integrations', section: action } });
const reason = (code, message, action) => blocker(code, message, action);
const MAX_READINESS_AGE_MS = 30_000;
const currentWindow = (facts, now) => {
    const checked = Date.parse(facts?.checked_at);
    const until = Date.parse(facts?.valid_until);
    return Number.isFinite(checked) && Number.isFinite(until) && checked <= now
        && checked < until && until > now && now - checked <= MAX_READINESS_AGE_MS;
};
const unverified = Object.freeze({
    deployment_ready: ['execution_runtime_unverified', 'تعذر تأكيد جاهزية خدمة التنفيذ؛ حدّث الحالة.', 'refresh_status'],
    actor_authorized: ['execution_permission_unverified', 'تعذر تأكيد صلاحية التنفيذ الحالية؛ حدّث الحالة.', 'refresh_status'],
    resource_authorized: ['resource_scope_unverified', 'تعذر تأكيد نطاق الموارد الحالي؛ حدّث السياق.', 'review_data_scope'],
    provider_selected: ['provider_selection_unverified', 'لم يُؤكّد حساب التنفيذ المختار بعد.', 'select_account'],
    provider_ready: ['provider_account_unverified', 'تعذر تأكيد جاهزية الحساب المختار حاليًا.', 'refresh_status'],
    content_ready: ['content_verification_unavailable', 'تعذر تأكيد صلاحية المحتوى الحالي.', 'review_content'],
    consent_confirmed: ['consent_unverified', 'لم تُؤكّد الموافقة الحالية على الغرض والوجهة.', 'review_consent'],
    outcome_clear: ['execution_outcome_unverified', 'تعذر التحقق من نتائج التنفيذ السابقة؛ أعد فحص النتائج.', 'review_results'],
    data_fresh: ['execution_data_unverified', 'تعذر تأكيد حداثة بيانات العملية من مصدرها.', 'refresh_status'],
});
const executionRequirements = Object.freeze([
    ['deployment_ready', 'execution_runtime_unavailable', 'خدمة التنفيذ ليست جاهزة حاليًا؛ راجع جاهزية الخدمة.', 'review_integration'],
    ['actor_authorized', 'execution_permission_required', 'تحتاج صلاحية تنفيذ هذه العملية ضمن النشاط الحالي.', 'request_permission'],
    ['resource_authorized', 'resource_scope_required', 'الموارد المختارة غير مؤكدة التفويض ضمن هذا النشاط.', 'review_data_scope'],
    ['channel_implemented', 'channel_selection_required', 'اختر قناة وحسابًا يدعمان هذه العملية فعليًا.', 'select_account'],
    ['provider_selected', 'provider_account_required', 'اختر حساب الخدمة الذي سينفّذ العملية.', 'select_account'],
    ['provider_ready', 'provider_account_unavailable', 'الحساب المختار غير جاهز لهذه العملية؛ راجع ربطه وحالته.', 'select_account'],
    ['content_ready', 'content_review_required', 'اختر محتوى صالحًا ومعتمدًا لهذه العملية.', 'review_content'],
    ['consent_confirmed', 'consent_unverified', 'يلزم اعتماد الغرض والمحتوى والوجهة؛ وجود هاتف لا يثبت الموافقة.', 'review_consent'],
    ['budget_sufficient', 'cost_unverified', 'يلزم تأكيد الرصيد أو الحصة والتكلفة الحالية.', 'review_balance'],
    ['outcome_clear', 'execution_outcome_unresolved', 'توجد عملية غير محسومة؛ راجع نتيجتها قبل إنشاء تنفيذ آخر.', 'review_results'],
    ['data_fresh', 'execution_data_unverified', 'حدّث بيانات العملية من مصدرها المعتمد قبل التنفيذ.', 'refresh_status'],
]);

const safeOwnerAction = readiness => {
    const raw = readiness?.action_url;
    if (typeof raw !== 'string' || !raw || raw.length > 4096 || raw !== raw.trim()
        || /[\u0000-\u0020\u007f\\]/.test(raw) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|2e|2f|5c)/i.test(raw)
        || raw.split(/[?#]/)[0].split('/').some(part => part === '.' || part === '..')) return null;
    try {
        const relative = raw.startsWith('/') && !raw.startsWith('//');
        const url = new URL(raw, 'https://core-action.invalid');
        if (url.username || url.password || (!relative && (url.protocol !== 'https:' || !/^https:\/\//i.test(raw)))) return null;
        if (['/', '/workspace', '/capabilities', '/portal/integrations'].includes(url.pathname.replace(/\/$/, '') || '/')
            && !url.searchParams.get('action')) return null;
        if (relative) return raw;
        const allowed = Array.isArray(readiness.owner_action_allowlist) && readiness.owner_action_allowlist.some(entry => {
            if (typeof entry !== 'string' || /[\u0000-\u0020\u007f\\]/.test(entry) || /%(?:2f|2e|5c)/i.test(entry)
                || entry.split(/[?#]/)[0].split('/').some(part => part === '.' || part === '..')) return false;
            const boundary = new URL(entry);
            if (boundary.protocol !== 'https:' || boundary.username || boundary.password || boundary.search || boundary.hash) return false;
            const prefix = boundary.pathname.replace(/\/$/, '') || '/';
            return boundary.origin === url.origin && (prefix === '/' || url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
        });
        return allowed ? raw : null;
    } catch { return null; }
};
const handlerProof = (readiness, capabilityCode, action) => {
    if (!readiness || readiness.platform !== 'wa_savana' || readiness.capability_code !== capabilityCode
        || readiness.action !== action || readiness.handler_registered !== true) return {
        blocker: reason('handler_implementation_missing', 'لا يوجد تنفيذ موصول ومؤكد لهذا الإجراء بعد.', 'await_adapter'), state: 'implementation_missing' };
    if (!Array.isArray(readiness.supported_contract_versions) || !readiness.supported_contract_versions.includes('1.0')
        || readiness.supported_contract_versions.some(value => typeof value !== 'string')) return {
        blocker: reason('handler_contract_unsupported', 'عقد الخدمة الحالي لا يدعم هذا الإجراء بعد.', 'review_integration'), state: 'not_supported' };
    const href = safeOwnerAction(readiness);
    if (readiness.configured !== true || !href || typeof readiness.reason !== 'string' || !readiness.reason
        || typeof readiness.next_action !== 'string' || !readiness.next_action) return {
        blocker: reason('owner_action_configuration_required', 'يلزم إكمال إعداد الخدمة ومسار الإجراء الفعلي.', 'review_integration'), state: 'configuration_required' };
    return { href };
};
const availabilityState = code => {
    if (/implementation_missing|not_implemented|actions_unavailable/.test(code)) return 'implementation_missing';
    if (/contract_unsupported/.test(code)) return 'not_supported';
    if (/configuration|integrations_disabled|runtime_unavailable|capability_policy_unverified/.test(code)) return 'configuration_required';
    if (code === 'subscription_required') return 'subscription_required';
    if (/discovery_unavailable|verification_unavailable|readiness_unavailable/.test(code)) return 'offline';
    if (code === 'connection_pending') return 'connection_pending';
    if (code === 'connection_paused') return 'connection_paused';
    if (code === 'connection_revoked') return 'connection_revoked';
    if (/connection_inactive|organization_unbound|native_account_binding/.test(code)) return 'connection_required';
    if (/outcome|receipt_required|command_identity/.test(code)) return 'outcome_unknown';
    if (code === 'cost_unverified') return 'quote_required';
    if (/unverified|expired|version_changed|data_stale/.test(code)) return 'authorization_stale';
    if (/permission_required/.test(code)) return 'permission_required';
    if (/scope_required|field_authority|source_required/.test(code)) return 'resource_scope_required';
    if (/selection_required|account_required/.test(code)) return 'provider_selection_required';
    if (/consent|purpose_required/.test(code)) return 'consent_required';
    if (/balance_insufficient/.test(code)) return 'balance_required';
    if (/cost_unverified/.test(code)) return 'quote_required';
    if (/approval|content_review/.test(code)) return 'approval_required';
    if (/provider|channel|source_handler/.test(code)) return 'provider_unavailable';
    return 'configuration_required';
};
const canonicalAvailability = (blockers, proof, review = false) => {
    const first = proof.blocker || blockers[0];
    return first ? { state: proof.state || availabilityState(first.code), reason_code: first.code, message: first.message,
        next_action: { code: first.action, label: 'متابعة الخطوة المطلوبة', href: first.destination.path } }
        : { state: review ? 'review_available' : 'available', reason_code: review ? 'review_available' : 'available',
            message: review ? 'يمكن طلب المراجعة لهذا الإجراء ضمن الصلاحيات الحالية.' : 'الإجراء متاح بعد التحقق من متطلباته الحالية.',
            next_action: { code: review ? 'request_review' : 'execute', label: review ? 'طلب المراجعة' : 'فتح الإجراء', href: proof.href } };
};

export const evaluateLocalIntegrationCapabilities = ({
    sourcePlatform, integrationEnabled, providerAvailable, subscriptionEntitled,
    connectionStatus, grantedScopes, canReview, scopeAuthorized, account, balance, consent,
    platformDiscovery, subscription, capabilityFacts, executionReadiness, reviewReadiness, now = Date.now(),
} = {}) => {
    if (!SOURCE_PLATFORMS.has(sourcePlatform)) return [];
    const scopes = new Set(Array.isArray(grantedScopes) ? grantedScopes : []);
    const common = [];
    if (integrationEnabled !== true) common.push(reason('integrations_disabled', 'الربط بين المنصات غير مفعّل حاليًا.', 'review_integration'));
    let discovered = boolean(providerAvailable);
    if (platformDiscovery) {
        discovered = platformDiscovery.verified === true && platformDiscovery.error !== true ? boolean(platformDiscovery.available) : null;
        if (platformDiscovery.error === true) common.push(reason('platform_discovery_unavailable', 'تعذر التحقق من الخدمة المتصلة؛ أعد فحص الحالة.', 'refresh_status'));
        else if (discovered === false) common.push(reason('provider_not_offered', 'هذه الخدمة غير متاحة للربط في البيئة الحالية.', 'await_provider'));
        else if (discovered !== true) common.push(reason('platform_discovery_unverified', 'لم تُؤكّد جاهزية الخدمة المتصلة بعد.', 'refresh_status'));
    } else if (discovered !== true) common.push(reason('provider_unavailable', 'الموفّر غير متاح حاليًا؛ يلزم التحقق من جاهزيته.', 'await_provider'));
    let entitled = boolean(subscriptionEntitled);
    if (subscription) {
        entitled = null;
        const expiry = Date.parse(subscription.expires_at);
        if (subscription.error === true) common.push(reason('subscription_verification_unavailable', 'تعذر التحقق من الاشتراك الحالي؛ لم يُعتبر الاشتراك مفقودًا.', 'refresh_status'));
        else if (subscription.bound === false) common.push(reason('organization_unbound', 'اربط الحساب بالمؤسسة المقصودة للتحقق من باقتها.', 'review_connection'));
        else if (Number.isFinite(expiry) && expiry <= now) common.push(reason('subscription_expired', 'انتهت صلاحية التحقق من الاشتراك؛ حدّث حالته قبل المتابعة.', 'refresh_status'));
        else if (subscription.verified !== true || !Number.isFinite(expiry)) common.push(reason('subscription_unverified', 'لم يتم التحقق من أهلية الاشتراك.', 'refresh_status'));
        else entitled = boolean(subscription.entitled);
    }
    if (!subscription || (subscription.error !== true && subscription.bound !== false
        && subscription.verified === true && Date.parse(subscription.expires_at) > now)) {
        if (entitled !== true) common.push(entitled === false
            ? reason('subscription_required', 'الاشتراك الحالي لا يشمل هذا الربط.', 'view_subscription')
            : reason('subscription_unverified', 'لم يتم التحقق من أهلية الاشتراك.', 'refresh_status'));
    }
    if (connectionStatus !== 'active') common.push(reason(connectionStatus === 'pending_authorization' ? 'connection_pending'
        : connectionStatus === 'paused' ? 'connection_paused' : connectionStatus === 'revoked' ? 'connection_revoked' : 'connection_inactive',
        connectionStatus === 'pending_authorization' ? 'الربط بانتظار الموافقة.' : 'الربط غير نشط؛ راجع حالته وتفويضه.', 'review_connection'));

    return LOCAL_REQUEST_CAPABILITIES.map(descriptor => {
        const facts = capabilityFacts?.[descriptor.capability_id];
        const live = currentWindow(facts, now);
        const reviewAllowed = facts ? (live ? boolean(facts.review_authorized) : null) : boolean(canReview);
        const resourceAllowed = facts ? (live ? boolean(facts.resource_authorized) : null) : boolean(scopeAuthorized);
        const shared = [...common];
        if (!scopes.has(descriptor.capability_id)) shared.push(reason('connection_scope_required', 'تفويض الربط لا يشمل هذه القدرة.', 'review_connection'));
        const reviewBlockers = [...common];
        if (reviewAllowed !== true) reviewBlockers.push(reason('review_permission_required', 'تحتاج صلاحية طلب المراجعة ضمن هذا النطاق.', 'request_permission'));
        if (resourceAllowed !== true) reviewBlockers.push(reason('context_scope_unverified', 'يلزم التحقق من تفويض النشاط والموارد لهذا الطلب.', 'review_data_scope'));
        if (!scopes.has(descriptor.capability_id)) reviewBlockers.push(reason('connection_scope_required', 'تفويض الربط لا يشمل هذه القدرة.', 'review_connection'));
        const implementation = facts?.handler_registered === true ? 'implemented' : 'review_only';
        const executionBlockers = [];
        if (facts?.lookup_failed === true || facts?.handler_registry_error === true) executionBlockers.push(reason('execution_readiness_unavailable', 'تعذر التحقق من جاهزية التنفيذ الحالية؛ أعد فحص الحالة.', 'refresh_status'));
        else if (facts?.handler_registered !== true) executionBlockers.push(reason('adapter_execution_not_implemented', 'تنفيذ هذه العملية غير موصول بخدمة مؤهلة حاليًا.', 'await_adapter'));
        else if (facts.handler_qualified !== true) executionBlockers.push(reason('adapter_execution_unqualified', 'القناة المختارة لم تُؤكّد جاهزيتها لهذه العملية.', 'select_account'));
        executionBlockers.push(...(facts ? shared : reviewBlockers));
        if (facts) {
            if (!live) executionBlockers.push(reason('execution_readiness_expired', 'انتهى أو تعذر تأكيد فحص الجاهزية الحالي؛ حدّث الحالة.', 'refresh_status'));
            for (const [check, code, message, action] of executionRequirements) {
                if (boolean(facts[check]) == null && unverified[check]) { executionBlockers.push(reason(...unverified[check])); continue; }
                if (facts[check] !== true) executionBlockers.push(reason(
                    check === 'budget_sufficient' && facts[check] === false ? 'balance_insufficient' : code,
                    check === 'budget_sufficient' && facts[check] === false ? 'الرصيد أو الحصة لا يكفيان للتنفيذ.' : message, action));
            }
            if (descriptor.request_kind !== 'content_publication' && facts.recipient_ready !== true) executionBlockers.push(reason('recipient_selection_required', 'اختر وجهة أو مستلمين صالحين ومصرحًا لهم لهذه العملية.', 'select_recipient'));
        } else {
            if (account?.ready !== true || account?.in_scope !== true || account?.selected !== true) executionBlockers.push(reason('account_unverified', 'اختر حسابًا جاهزًا ومصرحًا له ضمن النشاط قبل التنفيذ.', 'select_account'));
            if (balance?.sufficient !== true) executionBlockers.push(reason(balance?.sufficient === false ? 'balance_insufficient' : 'cost_unverified', balance?.sufficient === false ? 'الرصيد أو الحصة لا يكفيان للتنفيذ.' : 'يلزم التحقق من التكلفة والرصيد والحدود قبل التنفيذ.', 'review_balance'));
            if (consent?.confirmed !== true) executionBlockers.push(reason('consent_unverified', 'يلزم اعتماد الغرض والمحتوى والوجهة؛ وجود هاتف لا يثبت الموافقة.', 'review_consent'));
        }
        const executionProof = handlerProof(facts?.execution_readiness || executionReadiness?.[descriptor.capability_id], descriptor.capability_code, 'execute');
        const reviewProof = handlerProof(facts?.review_readiness || reviewReadiness?.[descriptor.capability_id], descriptor.capability_code, 'request_review');
        const executionAvailability = canonicalAvailability(executionBlockers, executionProof);
        const reviewAvailability = canonicalAvailability(reviewBlockers, reviewProof, true);
        return { ...descriptor, source_platform: sourcePlatform, provider_platform: 'wa_savana', implementation,
            availability: executionAvailability.state === 'available' ? executionAvailability
                : reviewAvailability.state === 'review_available' ? reviewAvailability : executionAvailability,
            execution_availability: executionAvailability, review_availability: reviewAvailability,
            visible: true, can_view_requirements: true,
            can_prepare_request: reviewAllowed === true && resourceAllowed === true,
            can_request_review: reviewAvailability.state === 'review_available', can_execute: executionAvailability.state === 'available',
            review_blockers: reviewBlockers, execution_blockers: executionBlockers,
            channel: typeof facts?.channel === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(facts.channel) ? facts.channel : null,
            checked_at: live ? facts.checked_at : null, valid_until: live ? new Date(Math.min(Date.parse(facts.valid_until), Date.parse(facts.checked_at) + MAX_READINESS_AGE_MS)).toISOString() : null,
            context_checks: { provider_available: discovered, subscription_entitled: entitled,
                connection_active: connectionStatus ? connectionStatus === 'active' : null,
                review_permission: reviewAllowed, scope_authorized: resourceAllowed,
                account_ready: boolean(facts ? (live ? facts.provider_ready : null) : account?.ready),
                account_in_scope: boolean(facts ? (live ? facts.resource_authorized : null) : account?.in_scope),
                account_selected: boolean(facts ? (live ? facts.provider_selected : null) : account?.selected),
                balance_sufficient: boolean(facts ? (live ? facts.budget_sufficient : null) : balance?.sufficient),
                consent_confirmed: boolean(facts ? (live ? facts.consent_confirmed : null) : consent?.confirmed),
                handler_registered: boolean(facts?.handler_registered), handler_qualified: boolean(facts?.handler_qualified),
                readiness_current: facts ? live : null },
        };
    });
};

export const SCOPED_CAPABILITY_CODES = Object.freeze(['products.read', 'products.write', 'media.manage', 'customers.manage', 'owner.operations']);
const SCOPED_CAPABILITIES = new Set(SCOPED_CAPABILITY_CODES);
const scopedChecks = Object.freeze({
    handler_registered: ['adapter_execution_not_implemented', 'لا توجد خدمة تنفيذ موصولة لهذا الإجراء حاليًا.', 'await_adapter'],
    handler_qualified: ['adapter_execution_unqualified', 'لم تُؤكّد أهلية الخدمة لهذا الإجراء والموارد المختارة.', 'review_integration'],
    deployment_ready: ['execution_runtime_unavailable', 'خدمة هذا الإجراء غير جاهزة حاليًا.', 'review_integration'],
    actor_authorized: ['execution_permission_required', 'يلزم تفويض الإجراء الحالي لهذا المستخدم.', 'request_permission'],
    resource_authorized: ['resource_scope_required', 'يلزم تأكيد نطاق النشاط والموارد المختارة.', 'review_data_scope'],
    native_account_bound: ['native_account_binding_required', 'اربط حساب المنصة بالنشاط المقصود.', 'review_connection'],
    consumer_selected: ['consumer_selection_required', 'اختر الحساب الذي سيقرأ البيانات لهذا الغرض.', 'select_account'],
    scope_granted: ['scoped_permission_required', 'يلزم تفويض صريح لهذا الإجراء والنطاق.', 'request_permission'],
    field_permissions_verified: ['field_permission_required', 'حدّد الحقول المسموح بها لهذا الغرض.', 'review_data_scope'],
    field_authority_verified: ['field_authority_unverified', 'يلزم تأكيد المصدر المعتمد للحقول المطلوب تغييرها.', 'review_data_scope'],
    source_authorized: ['authoritative_source_required', 'التطبيق الفعلي يتطلب تفويض المصدر المعتمد الحالي.', 'review_data_scope'],
    source_handler_ready: ['source_handler_unavailable', 'تعذر تأكيد خدمة المصدر المختصة بهذا الإجراء.', 'review_integration'],
    expected_version_current: ['resource_version_changed', 'تغيّرت نسخة المورد؛ حدّث البيانات وراجع التغييرات.', 'refresh_status'],
    idempotency_valid: ['operation_reference_required', 'يلزم مرجع ثابت ومتطابق للعملية قبل إرسالها.', 'review_results'],
    approved_payload_current: ['exact_approval_required', 'يلزم اعتماد النسخة والمحتوى نفسيهما قبل التطبيق.', 'review_consent'],
    provider_selected: ['provider_account_required', 'اختر حساب الخدمة المطلوب لهذا الإجراء.', 'select_account'],
    provider_ready: ['provider_account_unavailable', 'الحساب المختار غير جاهز لهذا الإجراء.', 'select_account'],
    content_ready: ['content_review_required', 'راجع صيغة المحتوى وحجمه والحقول المطلوبة.', 'review_content'],
    purpose_confirmed: ['purpose_required', 'حدّد الغرض المسموح لاستخدام هذه البيانات.', 'review_consent'],
    consent_confirmed: ['consent_required', 'يلزم تأكيد الموافقة المناسبة لهذا الإجراء.', 'review_consent'],
    budget_sufficient: ['balance_insufficient', 'الرصيد أو الحصة لا يكفيان لهذا الإجراء.', 'review_balance'],
    outcome_clear: ['execution_outcome_unresolved', 'توجد نتيجة غير محسومة؛ راجعها دون تكرار التنفيذ.', 'review_results'],
    receipt_correlated: ['provider_receipt_required', 'يلزم إيصال حقيقي مطابق من الموفّر لحسم النتيجة.', 'review_results'],
    command_identity_verified: ['command_identity_unverified', 'يلزم تطابق مرجع الأمر الأصلي قبل حسم نتيجته.', 'review_results'],
    data_fresh: ['execution_data_stale', 'حدّث البيانات من المصدر المعتمد قبل هذا الإجراء.', 'refresh_status'],
    subscription_entitled: ['subscription_required', 'الاشتراك الحالي لا يشمل هذا الإجراء.', 'view_subscription'],
});

// required_checks and effect come only from the server's actual action registry.
// Request/review and source apply remain distinct actions with distinct checks.
export const projectScopedCapabilityActions = ({ capability_code, actions, now = Date.now() } = {}) => {
    if (!SCOPED_CAPABILITIES.has(capability_code)) throw new TypeError('Unknown scoped capability');
    if (!Array.isArray(actions) || actions.length > 40) throw new TypeError('Explicit server action registry required');
    const seen = new Set();
    return { capability_code, visible: true, can_view_requirements: true,
        ...(actions.length ? {} : { availability: canonicalAvailability([], handlerProof(null, capability_code, 'execute')) }),
        blockers: actions.length ? [] : [reason('capability_actions_unavailable', 'تعذر تأكيد إجراءات هذه القدرة حاليًا؛ راجع جاهزيتها.', 'review_integration')],
        actions: actions.map(action => {
            if (!action || typeof action.action !== 'string' || !/^[a-z][a-z0-9_.]{0,63}$/.test(action.action)
                || seen.has(action.action)) throw new TypeError('Invalid scoped action identity');
            seen.add(action.action);
            const facts = action.facts || {};
            const required = [...new Set(['handler_registered', 'handler_qualified', 'deployment_ready', 'actor_authorized',
                ...(Array.isArray(action.required_checks) ? action.required_checks : [])])];
            const policyValid = ['read', 'write'].includes(action.effect) && Array.isArray(action.required_checks)
                && (action.readiness_action === undefined || ['execute', 'request_review'].includes(action.readiness_action))
                && required.every(check => Object.hasOwn(scopedChecks, check));
            const live = currentWindow(facts, now);
            const blockers = [];
            if (facts.lookup_failed === true || facts.handler_registry_error === true) blockers.push(reason('execution_readiness_unavailable', 'تعذر تأكيد الجاهزية الحالية لهذا الإجراء.', 'refresh_status'));
            if (!policyValid) blockers.push(reason('capability_policy_unverified', 'تعذر تأكيد متطلبات هذا الإجراء؛ أعد فحص الخدمة.', 'refresh_status'));
            if (!live) blockers.push(reason('execution_readiness_expired', 'حدّث فحص الجاهزية قبل متابعة هذا الإجراء.', 'refresh_status'));
            for (const check of required) {
                if (!Object.hasOwn(scopedChecks, check)) continue;
                if (check === 'subscription_entitled') {
                    if (facts.subscription?.error === true) blockers.push(reason('subscription_verification_unavailable', 'تعذر التحقق من الاشتراك الحالي.', 'refresh_status'));
                    else if (Date.parse(facts.subscription?.expires_at) <= now) blockers.push(reason('subscription_expired', 'انتهت صلاحية التحقق من الاشتراك؛ حدّث حالته.', 'refresh_status'));
                    else if (facts.subscription?.verified !== true || !(Date.parse(facts.subscription?.expires_at) > now)
                        || boolean(facts[check]) == null || boolean(facts.subscription?.entitled) == null) blockers.push(reason('subscription_unverified', 'لم تُؤكّد أهلية الاشتراك الحالي لهذا الإجراء.', 'refresh_status'));
                    else if (facts[check] !== true || facts.subscription.entitled !== true) blockers.push(reason(...scopedChecks[check]));
                    continue;
                }
                if (facts[check] === true) continue;
                if (boolean(facts[check]) == null) blockers.push(reason(
                    check === 'subscription_entitled' ? 'subscription_unverified' : `${check}_unverified`,
                    'لم يُؤكّد أحد متطلبات هذا الإجراء حاليًا؛ حدّث حالته دون تغيير التفويض.', 'refresh_status'));
                else blockers.push(reason(...scopedChecks[check]));
            }
            const review = action.readiness_action === 'request_review';
            const proof = handlerProof(facts.handler_readiness, capability_code, review ? 'request_review' : 'execute');
            const availability = canonicalAvailability(blockers, proof, review);
            return { action: action.action, effect: action.effect, visible: true, availability,
                can_execute: ['available', 'review_available'].includes(availability.state),
                blockers, context_checks: Object.fromEntries(required.filter(check => Object.hasOwn(scopedChecks, check))
                    .map(check => [check, live ? boolean(facts[check]) : null])),
                checked_at: live ? facts.checked_at : null,
                valid_until: live ? new Date(Math.min(Date.parse(facts.valid_until), Date.parse(facts.checked_at) + MAX_READINESS_AGE_MS)).toISOString() : null,
                freshness: ['current', 'stale', 'unknown', 'clock_ahead'].includes(facts.freshness) ? facts.freshness : 'unknown',
            };
        }),
    };
};
