const text = value => typeof value === 'string' && value.trim().length > 0;
const opaqueReference = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^[0-9a-f]{64}$/i.test(value);

// These are presentation props, not a transport contract or a grant. The
// authenticated workspace adapter supplies labels and permitted choices.
export const workspaceLabel = (value, fallback) => text(value) && !opaqueReference(value.trim())
    ? value.trim() : fallback;

export const workspaceChoiceAvailable = option => Boolean(option && text(option.value)
    && workspaceLabel(option.label, null) && option.enabled === true);

export const emptyWorkspaceSelection = () => ({ activity: '', purpose: '', provider: '', fields: [], people: [] });

export const updateWorkspaceSelection = (selection, name, value) => {
    const next = { ...emptyWorkspaceSelection(), ...selection };
    if (name === 'activity') return { ...emptyWorkspaceSelection(), activity: value };
    if (name === 'purpose') return { ...next, purpose: value, provider: '', fields: [], people: [] };
    if (name === 'provider') return { ...next, provider: value, fields: [], people: [] };
    if (name === 'fields' || name === 'people') return { ...next, [name]: [...new Set(value)] };
    return next;
};

const availableSelection = (options, value) => Array.isArray(options)
    && options.some(option => option.value === value && workspaceChoiceAvailable(option));
const availableSelections = (options, values, required = true) => Array.isArray(values) && (!required || values.length > 0)
    && new Set(values).size === values.length && values.every(value => availableSelection(options, value));

export const workspaceSelectionCanReview = ({ selection, choices, requirements, verified = false, held = true, busy = false } = {}) => Boolean(
    verified === true && held === false && busy === false && selection && choices
    && availableSelection(choices.activities, selection.activity)
    && availableSelection(choices.purposes, selection.purpose)
    && availableSelection(choices.providers, selection.provider)
    && availableSelections(choices.fields, selection.fields, requirements?.fields !== false)
    && availableSelections(choices.people, selection.people, requirements?.people !== false)
);

export const workspaceSelectionSummary = (selection, choices, language = 'ar') => {
    const ar = language === 'ar';
    const name = (options, value) => workspaceLabel(options?.find(option => option.value === value)?.label,
        ar ? 'الاسم غير متاح' : 'Name unavailable');
    return [
        { label: ar ? 'النشاط' : 'Activity', value: name(choices?.activities, selection?.activity) },
        { label: ar ? 'الغرض' : 'Purpose', value: name(choices?.purposes, selection?.purpose) },
        { label: ar ? 'الحساب المزوّد' : 'Provider account', value: name(choices?.providers, selection?.provider) },
        { label: ar ? 'البيانات المختارة' : 'Selected data', value: (selection?.fields || []).map(value => name(choices?.fields, value)).join(ar ? '، ' : ', ') },
        { label: ar ? 'الأشخاص المختارون' : 'Selected people', value: (selection?.people || []).map(value => name(choices?.people, value)).join(ar ? '، ' : ', ') },
    ];
};

export const workspaceSelectionKey = selection => JSON.stringify([selection?.activity, selection?.purpose, selection?.provider,
    [...(selection?.fields || [])].sort(), [...(selection?.people || [])].sort()]);

export const workspaceReviewSummaryIsValid = summary => Array.isArray(summary) && summary.length > 0
    && summary.every(row => workspaceLabel(row?.label, null) && workspaceLabel(row?.value, null));

export const workspaceConnectionReviewCanSubmit = ({ review, viewKey, now = Date.now(), ...context }) => Boolean(
    workspaceSelectionCanReview(context) && text(review?.key) && review.canSubmit === true
    && text(viewKey) && review.viewKey === viewKey
    && typeof review.valid_until === 'string' && Date.parse(review.valid_until) > now
    && review.selectionKey === workspaceSelectionKey(context.selection) && workspaceReviewSummaryIsValid(review.summary)
);

export const workspaceActionAvailable = (action, { verified = false, held = true, busy = false } = {}) => Boolean(
    action?.enabled === true && text(action.key) && workspaceLabel(action.label, null)
    && verified === true && (held === false || action.effect === 'read') && busy === false
);

// Product reception setup targets the account named by the current server
// action. It needs no read-sharing selection, fields, people or browser scopes.
export const workspaceProductReceptionInput = (action, state = {}) => (
    action?.key === 'provider.products.prepare' && state.held === false
    && workspaceActionAvailable(action, state) && text(action.provider) && action.provider.length <= 180_000
        ? { provider: action.provider } : null
);

export const workspaceRecordsCanBrowse = (sharedData, verified = false) => sharedData?.browseAction?.key === 'records.browse'
    && sharedData.browseAction.effect === 'read'
    && workspaceActionAvailable(sharedData.browseAction, { verified, held: false, busy: false });

const availabilityLabels = {
    available: ['متاح للتنفيذ', 'Available to execute'], review_available: ['متاح لطلب المراجعة', 'Available to request review'],
    implementation_missing: ['التنفيذ غير متوفر بعد', 'Implementation not available yet'], not_supported: ['غير مدعوم', 'Not supported'],
    configuration_required: ['يلزم إكمال الإعداد', 'Setup required'], subscription_required: ['يلزم اشتراك مناسب', 'Subscription required'],
    permission_required: ['يلزم تفويض', 'Permission required'], resource_scope_required: ['يلزم اختيار نطاق العمل', 'Work scope required'],
    provider_selection_required: ['يلزم اختيار الحساب المزوّد', 'Provider account selection required'], connection_required: ['يلزم ربط الحساب', 'Connection required'],
    connection_pending: ['الربط قيد التحقق', 'Connection pending'], connection_paused: ['الربط متوقف مؤقتًا', 'Connection paused'],
    connection_revoked: ['سُحب الربط', 'Connection revoked'], approval_required: ['يلزم اعتماد الطلب', 'Approval required'],
    consent_required: ['يلزم دليل الموافقة', 'Consent evidence required'], balance_required: ['يلزم رصيد كافٍ', 'Balance required'],
    quote_required: ['يلزم عرض تكلفة حالي', 'Current quote required'], offline: ['المصدر غير متصل', 'Source offline'],
    authorization_stale: ['يلزم تجديد التحقق من الصلاحية', 'Authorization needs rechecking'], outcome_unknown: ['النتيجة قيد التحقق', 'Outcome awaiting confirmation'],
    provider_unavailable: ['المزوّد غير متاح', 'Provider unavailable'],
};

// Canonical server vocabulary only. A presentation label never enables an action.
export const workspaceAvailabilityLabel = (state, language = 'ar') => availabilityLabels[state]?.[language === 'ar' ? 0 : 1]
    || (language === 'ar' ? 'لم تُتحقق الحالة' : 'State unverified');
