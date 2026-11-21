import { workspaceLabel, workspaceRecordsCanBrowse, workspaceReviewSummaryIsValid } from './connectionsDataPresentation.js';
import { sharedReadAuthorizationUrl } from './sharedReadSetupPresentation.js';
import { workspaceCommandResultActions } from './workspaceCommandPresentation.js';
import { WORKSPACE_BUSINESS_CAPABILITIES } from './workspaceBusinessPresentation.js';

const text = value => typeof value === 'string' && value.trim().length > 0;
const reference = value => text(value) && value.length <= 180_000;
const named = value => Boolean(workspaceLabel(value, null));
const optionalText = value => value === undefined || value === null || typeof value === 'string';
const availabilityStates = new Set(['available', 'review_available', 'implementation_missing', 'not_supported', 'configuration_required', 'subscription_required', 'permission_required', 'resource_scope_required', 'provider_selection_required', 'connection_required', 'connection_pending', 'connection_paused', 'connection_revoked', 'approval_required', 'consent_required', 'balance_required', 'quote_required', 'offline', 'authorization_stale', 'outcome_unknown', 'provider_unavailable']);
const availability = value => value === undefined || (availabilityStates.has(value?.state) && text(value.reason_code) && text(value.message)
    && text(value.next_action?.code) && named(value.next_action.label) && text(value.next_action.href));
const choice = value => reference(value?.value) && named(value.label) && typeof value.enabled === 'boolean';
const choices = values => Array.isArray(values) && values.every(choice) && new Set(values.map(value => value.value)).size === values.length;
const action = value => text(value?.key) && named(value.label) && typeof value.enabled === 'boolean'
    && optionalText(value.reason) && (value.intentKey === undefined || reference(value.intentKey))
    && availability(value.availability) && (value.effect === undefined || ['read', 'write'].includes(value.effect));
const actions = values => Array.isArray(values) && values.every(action);
const productFields = new Set(['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media']);
const terminal = new Set(['completed', 'failed']);
const storagePrefix = 'wa-connections-data:holds:v1:';

export const workspaceReadResponseIsCurrent = (value, context, { now = Date.now(), requestRevision, currentRevision } = {}) => Boolean(
    context?.verified === true && reference(context.viewKey) && requestRevision === currentRevision && value?.viewKey === context.viewKey
    && typeof value?.valid_until === 'string' && Date.parse(value.valid_until) > now
    && Date.parse(value.valid_until) <= Date.parse(context?.valid_until)
);

export const workspaceReadDeadline = ({ context, recordsValidUntil = null, detail = null, editor = null, review = null } = {}) => {
    if (context?.verified !== true) return null;
    const dates = [context.valid_until, ...(recordsValidUntil == null ? [] : [recordsValidUntil]),
        ...(detail == null ? [] : [detail.valid_until]), ...(editor == null ? [] : [editor.valid_until]),
        ...(review == null ? [] : [review.valid_until])];
    if (dates.some(value => typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) return 0;
    return Math.min(...dates.map(Date.parse));
};

export const watchWorkspaceReadExpiry = ({ onExpire, now = Date.now, schedule = setTimeout, cancel = clearTimeout, ...view }) => {
    const deadline = workspaceReadDeadline(view);
    let active = true, timer = null;
    const check = () => {
        if (!active || deadline === null) return;
        const remaining = deadline - now();
        if (remaining > 0) timer = schedule(check, Math.min(remaining, 2_147_483_647));
        else { active = false; timer = null; onExpire(); }
    };
    check();
    return () => { active = false; if (timer !== null) cancel(timer); };
};

export const workspaceSelectionIsValid = selection => Boolean(selection && ['activity', 'purpose', 'provider'].every(key => typeof selection[key] === 'string')
    && ['fields', 'people'].every(key => Array.isArray(selection[key]) && selection[key].every(reference) && new Set(selection[key]).size === selection[key].length));

export const workspaceRecordIsValid = record => Boolean(reference(record?.key) && named(record.label) && named(record.sourceLabel)
    && ['summary', 'stateLabel', 'freshnessLabel', 'freshnessDescription'].every(key => optionalText(record[key]))
    && (record.fields === undefined || (Array.isArray(record.fields) && record.fields.every(field => text(field?.key) && named(field.label)
        && typeof field.displayValue === 'string' && named(field.sourceLabel))))
    && (record.actions === undefined || actions(record.actions)));

export const workspaceAccessRequestIsValid = request => Boolean(reference(request?.key) && named(request.label)
    && ['pending', 'approved', 'rejected'].includes(request.state) && workspaceReviewSummaryIsValid(request.proposedSummary)
    && (request.effectiveSummary === null || workspaceReviewSummaryIsValid(request.effectiveSummary))
    && typeof request.changedSinceEffective === 'boolean' && optionalText(request.effectiveStateLabel) && optionalText(request.message)
    && actions(request.actions) && (request.grant == null || reference(request.grant))
    && ['removedFields', 'removedPeople'].every(key => request[key] === undefined || (Array.isArray(request[key]) && request[key].every(named)))
    && (request.selection == null || workspaceSelectionIsValid(request.selection)));

export const workspaceCommandIsValid = command => Boolean(reference(command?.key) && named(command.label) && named(command.sourceLabel)
    && text(command.state) && text(command.projection_state) && optionalText(command.message) && actions(command.actions)
    && (command.resultActions === undefined || (Array.isArray(command.resultActions) && workspaceCommandResultActions(command).length === command.resultActions.length))
    && (command.summary === undefined || (Array.isArray(command.summary) && command.summary.length === 0) || workspaceReviewSummaryIsValid(command.summary)));

export const workspaceProductEditorIsValid = editor => Boolean(editor && Array.isArray(editor.fields)
    && editor.fields.every(field => productFields.has(field?.key) && named(field.label) && typeof field.enabled === 'boolean'
        && (field.required === undefined || typeof field.required === 'boolean') && (field.clearable === undefined || typeof field.clearable === 'boolean'))
    && new Set(editor.fields.map(field => field.key)).size === editor.fields.length
    && ['units', 'priceChoices', 'mediaChoices'].every(key => choices(editor[key]))
    && (editor.sourceLabel == null || named(editor.sourceLabel)) && (editor.provider == null || reference(editor.provider)));

export const workspaceOverviewIsValid = (value, now = Date.now()) => {
    const context = value?.context;
    if (value?.spec_version !== '1.0' || typeof context?.verified !== 'boolean' || typeof value.held !== 'boolean') return false;
    if (!context.connect || typeof context.connect.enabled !== 'boolean' || !text(context.connect.code) || !named(context.connect.label)) return false;
    if (context.verified && (!reference(context.native_reference) || !reference(context.viewKey) || !named(context.organizationLabel)
        || !named(context.actorLabel) || typeof context.valid_until !== 'string' || Date.parse(context.valid_until) <= now
        || !Number.isFinite(Date.parse(context.valid_until)))) return false;
    const connection = value.connection;
    if ((value.actions !== undefined && !actions(value.actions)) || (connection?.requirements !== undefined
        && (!connection.requirements || typeof connection.requirements.fields !== 'boolean' || typeof connection.requirements.people !== 'boolean'))) return false;
    if (!connection || typeof connection.held !== 'boolean' || connection.busy !== false || !workspaceSelectionIsValid(connection.selection)
        || !Array.isArray(connection.requests) || !connection.requests.every(workspaceAccessRequestIsValid)
        || !['activities', 'purposes', 'providers', 'fields', 'people'].every(key => choices(connection.choices?.[key]))) return false;
    if (!Array.isArray(value.capabilities?.capabilities) || !value.capabilities.capabilities.every(capability => reference(capability?.key)
        && named(capability.label) && optionalText(capability.description) && optionalText(capability.stateLabel) && availability(capability.availability)
        && (capability.reasons === undefined || (Array.isArray(capability.reasons) && capability.reasons.every(reason => text(reason?.message))))
        && (capability.actions === undefined || actions(capability.actions)))) return false;
    if (!Array.isArray(value.sharedData?.records) || !value.sharedData.records.every(workspaceRecordIsValid)
        || (value.sharedData.browseAction != null && (!action(value.sharedData.browseAction)
            || value.sharedData.browseAction.key !== 'records.browse' || value.sharedData.browseAction.effect !== 'read'))
        || (value.sharedData.createAction != null && !action(value.sharedData.createAction))) return false;
    if (!Array.isArray(value.commands) || !value.commands.every(workspaceCommandIsValid)) return false;
    if (!workspaceProductEditorIsValid(value.productEditor)) return false;
    if (value.nativeEditor != null && (!reference(value.nativeEditor.activity) || !reference(value.nativeEditor.provider)
        || !text(value.nativeEditor.capability) || !['messaging.send', 'campaigns.execute', 'content.publish', 'messaging.review', 'campaigns.review', 'content.review'].includes(value.nativeEditor.action))) return false;
    if (value.businessEditor != null && (!reference(value.businessEditor.activity) || !reference(value.businessEditor.provider)
        || !WORKSPACE_BUSINESS_CAPABILITIES.includes(value.businessEditor.capability))) return false;
    if (value.mediaEditor != null && (!reference(value.mediaEditor.activity) || !reference(value.mediaEditor.provider)
        || value.mediaEditor.capability !== 'media.manage' || !/^[a-f0-9]{64}$/.test(value.mediaEditor.selectionKey))) return false;
    if (value.grantEditor != null && !reference(value.grantEditor.activity)) return false;
    return Array.isArray(value.intents) && value.intents.every(intent => reference(intent?.key) && text(intent.state) && optionalText(intent.message));
};

export const workspaceReviewIsCurrent = (review, context, now = Date.now()) => Boolean(context?.verified === true
    && reference(review?.key) && reference(review.intentKey) && review.canSubmit === true
    && review.viewKey === context.viewKey && workspaceReviewSummaryIsValid(review.summary)
    && optionalText(review.message) && optionalText(review.submitLabel)
    && ['removedFields', 'removedPeople'].every(key => review[key] === undefined || (Array.isArray(review[key]) && review[key].every(named)))
    && typeof review.valid_until === 'string' && Number.isFinite(Date.parse(review.valid_until))
    && Date.parse(review.valid_until) > now && Date.parse(review.valid_until) <= Date.parse(context.valid_until));

export const workspaceServerHeld = overview => Boolean(overview?.held || overview?.connection?.held
    || overview?.intents?.some(intent => !terminal.has(intent.state)));

const storageKey = nativeReference => reference(nativeReference) && nativeReference.length <= 2048
    ? `${storagePrefix}${encodeURIComponent(nativeReference)}` : null;

export const readWorkspaceHolds = (storage, nativeReference) => {
    const key = storageKey(nativeReference);
    if (!key) return { records: [], invalid: true };
    try {
        const raw = storage.getItem(key);
        if (raw === null) return { records: [], invalid: false };
        const records = JSON.parse(raw);
        if (!Array.isArray(records) || !records.every(record => record && Object.keys(record).every(field => ['key', 'state'].includes(field))
            && reference(record.key) && record.state === 'unknown') || new Set(records.map(record => record.key)).size !== records.length) return { records: [], invalid: true };
        return { records, invalid: false };
    } catch { return { records: [], invalid: true }; }
};

// This metadata can only block an effect. It contains no review token, payload,
// account labels, credentials or grants; other native/center partitions remain.
export const retainWorkspaceHold = (storage, nativeReference, intentKey) => {
    const key = storageKey(nativeReference);
    const current = readWorkspaceHolds(storage, nativeReference);
    if (!key || !reference(intentKey) || current.invalid) return false;
    const records = [...current.records.filter(record => record.key !== intentKey), { key: intentKey, state: 'unknown' }];
    try {
        const raw = JSON.stringify(records);
        storage.setItem(key, raw);
        return storage.getItem(key) === raw;
    } catch { return false; }
};

export const releaseWorkspaceHold = (storage, nativeReference, intent, freshOverview, now = Date.now()) => {
    if (!workspaceIntentResolved(intent, freshOverview, nativeReference, now)) return false;
    const key = storageKey(nativeReference);
    const current = readWorkspaceHolds(storage, nativeReference);
    if (!key || current.invalid) return false;
    try {
        const remaining = current.records.filter(record => record.key !== intent.key);
        if (remaining.length) storage.setItem(key, JSON.stringify(remaining));
        else storage.removeItem(key);
        return true;
    } catch { return false; }
};

export const workspaceIntentResolved = (intent, freshOverview, nativeReference, now = Date.now()) => Boolean(
    terminal.has(intent?.state) && reference(intent?.key) && workspaceOverviewIsValid(freshOverview, now)
    && freshOverview.context.native_reference === nativeReference && !workspaceServerHeld(freshOverview)
);

export const observeWorkspaceEffect = async ({ intentKey, dispatch, readIntent, readFresh, isCurrent }) => {
    let error = null, result = null;
    try { result = await dispatch(); } catch (effectError) { error = effectError; }
    if (!isCurrent()) return { stale: true, error, result: null, intent: null, overview: null };
    let intent = null;
    try {
        const result = await readIntent(intentKey);
        if (typeof result?.intent?.state === 'string') intent = { key: intentKey, state: result.intent.state };
    } catch { /* Missing/unknown metadata, including 404, cannot clear a hold. */ }
    if (!isCurrent()) return { stale: true, error, result: null, intent: null, overview: null };
    return { stale: false, error, result, intent, overview: await readFresh() };
};

export const readWorkspaceLists = async ({ sharedData, verified, readRecords, readCommands, readRequests }) => {
    const responses = await Promise.allSettled([
        workspaceRecordsCanBrowse(sharedData, verified) ? readRecords() : Promise.resolve(null), readCommands(), readRequests(),
    ]);
    for (const response of responses) if (response.status === 'rejected') throw response.reason;
    const [recordDocument, commandDocument, requestDocument] = responses.map(response => response.value);
    return { recordDocument, commandDocument, requestDocument };
};

// Only the immediate, successful binding operation can offer a redirect.
// Historical metadata and recovery hints never supply a URL or resend it.
export const workspaceBindingAuthorizationUrl = (observation, nativeReference) => {
    if (observation?.stale || observation?.error || observation?.intent?.state !== 'completed'
        || observation?.overview?.context.verified !== true || observation.overview.context.native_reference !== nativeReference) return null;
    return sharedReadAuthorizationUrl(observation.result?.result?.authorization_url ?? observation.result?.authorization_url);
};

export const workspaceClientError = (error, language = 'ar') => {
    const ar = language === 'ar';
    const message = error?.data?.error?.message;
    if (typeof message === 'string' && message.trim() && message.length <= 2000) return message;
    return ar ? 'تعذر تأكيد الحالة الحالية. أُخفيت التفاصيل السابقة؛ حدّث الحالة وافحص نتيجة الطلب قبل بدء إجراء جديد.'
        : 'The current state could not be confirmed. Previous details are hidden; refresh the status and check the request outcome before starting another action.';
};
