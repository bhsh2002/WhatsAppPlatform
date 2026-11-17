const states = new Set(['disconnected', 'authorizing', 'connected', 'unknown', 'expired', 'revoked', 'failed']);
const fields = new Set(['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media', 'is_visible']);
const text = value => typeof value === 'string' && value.length > 0;
const nullableText = value => value === null || text(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
const list = (value, test) => Array.isArray(value) && value.every(test) && new Set(value).size === value.length;
const booleans = (object, keys) => object && keys.every(key => typeof object[key] === 'boolean');

export const ownerStatusIsValid = value => Boolean(value && typeof value.enabled === 'boolean'
    && (value.enabled ? /^[0-9a-f]{64}$/.test(value.native_reference) : value.native_reference === undefined || value.native_reference === null || /^[0-9a-f]{64}$/.test(value.native_reference))
    && value.read_only === true && value.execution_ready === false && value.pricing_use_allowed === false
    && states.has(value.session?.state) && nullableText(value.session.actor_id) && nullableText(value.session.organization_id)
    && (value.session.expires_at === null || timestamp(value.session.expires_at))
    && (value.session.state !== 'connected' || (text(value.session.actor_id) && text(value.session.organization_id) && timestamp(value.session.expires_at)))
    && booleans(value.actions, ['login', 'disconnect', 'overview'])
    && Number.isSafeInteger(value.intents?.unknown_count) && value.intents.unknown_count >= 0
    && Number.isSafeInteger(value.intents.inflight_count) && value.intents.inflight_count >= 0
    && typeof value.intents.mutations_blocked === 'boolean');

export const ownerMutationsHeld = value => !ownerStatusIsValid(value) || value.intents.mutations_blocked
    || value.intents.unknown_count > 0 || value.intents.inflight_count > 0;
export const ownerCanLogin = value => ownerStatusIsValid(value) && value.enabled && !ownerMutationsHeld(value) && value.actions.login;
export const ownerCanDisconnect = value => ownerStatusIsValid(value) && value.enabled && !ownerMutationsHeld(value) && value.actions.disconnect;
export const ownerCanOverview = (value, now = Date.now()) => ownerStatusIsValid(value) && value.enabled
    && value.actions.overview && value.session.state === 'connected' && Date.parse(value.session.expires_at) > now;

export const ownerScopeIsValid = (scope, organization) => Boolean(scope && scope.organization_id === organization && text(scope.activity_id)
    && nullableText(scope.branch_id) && nullableText(scope.warehouse_id) && (scope.warehouse_id === null || text(scope.branch_id)));
export const ownerScopeKey = scope => JSON.stringify([scope.organization_id, scope.activity_id, scope.branch_id, scope.warehouse_id]);
const sameScope = (a, b) => ownerScopeKey(a) === ownerScopeKey(b);
const proposalIsValid = (kind, value) => Boolean(value && (kind === 'consumer_registration'
    ? text(value.enrollment_id) && positive(value.enrollment_version) && text(value.installation_label)
    : text(value.source_installation_id) && text(value.consumer_installation_id)
        && list(value.fields, field => fields.has(field)) && value.fields.length > 0
        && list(value.reader_account_ids, text) && value.reader_account_ids.length > 0 && timestamp(value.expires_at)));
const effectiveIsValid = (kind, value) => Boolean(value && (kind === 'consumer_registration'
    ? text(value.installation_id) && text(value.enrollment_id)
    : text(value.read_grant_id) && positive(value.revision) && text(value.source_installation_id) && text(value.consumer_installation_id)
        && list(value.fields, field => fields.has(field)) && list(value.reader_account_ids, text) && timestamp(value.expires_at))
    && (value.active === undefined || typeof value.active === 'boolean'));

export const ownerOverviewIsValid = (value, now = Date.now()) => {
    if (!ownerCanOverview(value, now) || !value.context || value.context.actor_id !== value.session.actor_id
        || value.context.organization_id !== value.session.organization_id || !timestamp(value.context.checked_at)
        || !timestamp(value.context.valid_until) || Date.parse(value.context.valid_until) <= now
        || Date.parse(value.context.checked_at) >= Date.parse(value.context.valid_until)) return false;
    const organization = value.context.organization_id;
    const scoped = item => ownerScopeIsValid(item?.scope, organization);
    const options = value.options;
    if (!booleans(value.actions, ['create_scope', 'authorize_scope'])) return false;
    if (!options || !Array.isArray(options.scopes) || !options.scopes.every(item => scoped(item) && text(item.label)
        && booleans(item.actions, ['request_consumer_registration', 'request_read_sharing', 'approve_consumer_registration', 'approve_read_sharing', 'review', 'revoke_read_grant']))) return false;
    if (!Array.isArray(options.enrollments) || !options.enrollments.every(item => text(item.enrollment_id)
        && positive(item.version) && item.platform === 'wa_savana' && item.organization_id === organization)) return false;
    if (!Array.isArray(options.consumer_installations) || !options.consumer_installations.every(item => scoped(item)
        && text(item.installation_id) && text(item.enrollment_id) && text(item.label) && item.platform === 'wa_savana')) return false;
    if (!Array.isArray(options.source_installations) || !options.source_installations.every(item => scoped(item)
        && text(item.installation_id) && text(item.enrollment_id) && text(item.label) && item.platform === 'catalog'
        && list(item.fields, field => fields.has(field)))) return false;
    if (!Array.isArray(options.readers) || !options.readers.every(item => text(item.account_id) && text(item.display_name))) return false;
    if (!Array.isArray(value.requests) || !value.requests.every(item => scoped(item) && text(item.request_id)
        && ['consumer_registration', 'read_sharing'].includes(item.kind) && proposalIsValid(item.kind, item.proposal)
        && positive(item.version) && ['pending', 'approved', 'rejected'].includes(item.state)
        && text(item.requested_by) && nullableText(item.reviewed_by) && (item.reason === null || typeof item.reason === 'string')
        && timestamp(item.updated_at) && booleans(item.actions, ['edit', 'approve', 'reject'])
        && (item.effective_version === null ? item.effective_resource === null
            : positive(item.effective_version) && item.effective_version <= item.version && effectiveIsValid(item.kind, item.effective_resource)))) return false;
    if (!Array.isArray(value.scope_authorizations) || !value.scope_authorizations.every(item => scoped(item) && text(item.actor_id)
        && list(item.actions, text) && positive(item.version) && (item.expires_at === null || timestamp(item.expires_at))
        && (item.native_editable === undefined || typeof item.native_editable === 'boolean'))) return false;
    return Array.isArray(value.read_grants) && value.read_grants.every(item => scoped(item) && text(item.read_grant_id)
        && text(item.source_installation_id) && text(item.consumer_installation_id) && positive(item.revision)
        && typeof item.active === 'boolean' && typeof item.expired === 'boolean' && timestamp(item.expires_at)
        && list(item.fields, field => fields.has(field)) && list(item.reader_account_ids, text));
};

export const ownerChoicesForScope = (overview, scope) => {
    if (!ownerOverviewIsValid(overview) || !scope || !overview.options.scopes.some(option => sameScope(option.scope, scope))) return null;
    return { consumers: overview.options.consumer_installations.filter(item => sameScope(item.scope, scope)),
        sources: overview.options.source_installations.filter(item => sameScope(item.scope, scope)),
        requests: overview.requests.filter(item => sameScope(item.scope, scope)),
        grants: overview.read_grants.filter(item => sameScope(item.scope, scope)) };
};

export const ownerSessionLabel = (state, language = 'ar') => ({
    disconnected: language === 'ar' ? 'جلسة مراجعة المركز غير مرتبطة' : 'Center review session disconnected',
    authorizing: language === 'ar' ? 'بانتظار تأكيد جلسة المراجعة' : 'Review session awaiting confirmation',
    connected: language === 'ar' ? 'جلسة المراجعة مرتبطة؛ الصلاحيات منفصلة' : 'Review session connected; permissions remain separate',
    unknown: language === 'ar' ? 'حالة جلسة المراجعة غير مؤكدة' : 'Review session state unverified',
    expired: language === 'ar' ? 'انتهت جلسة مراجعة المركز' : 'Center review session expired',
    revoked: language === 'ar' ? 'سُحبت جلسة مراجعة المركز' : 'Center review session revoked',
    failed: language === 'ar' ? 'تعذر تأكيد جلسة مراجعة المركز' : 'Center review session could not be confirmed',
}[state] || (language === 'ar' ? 'لم تُتحقق جلسة المراجعة' : 'Review session unverified'));

export const ownerSetupError = (error, language = 'ar') => {
    const ar = language === 'ar';
    if ([401, 403].includes(error?.status)) return ar ? 'لم تُتحقق الجلسة أو صلاحيتها الحالية لهذا النشاط. أُخفيت التفاصيل السابقة؛ أعد التحقق أو سجّل الدخول بالحساب المرتبط بهويتك.' : 'The current session or activity permission could not be verified. Prior details are hidden; check again or sign in using the account linked to your identity.';
    if (error?.status === 422) return ar ? 'لم تكتمل بيانات الدخول المطلوبة. أعد إدخالها؛ لم تُحفظ كلمة المرور أو رمز التحقق.' : 'The required sign-in details were not accepted. Enter them again; the password and verification code were not retained.';
    return ar ? 'تعذر تأكيد الحالة الحالية. لا تعني المحاولة موافقة أو منحة؛ استخدم التحقق من الحالة قبل المتابعة.' : 'The current state could not be confirmed. An attempt is not approval or a grant; check the status before continuing.';
};
