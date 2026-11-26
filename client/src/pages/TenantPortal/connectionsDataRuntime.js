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
    && (value.provider === undefined || reference(value.provider))
    && (value.key !== 'provider.products.prepare' || value.enabled === false || reference(value.provider))
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

export const workspaceOutcomeRefreshNeeded = (overview, intents) => workspaceServerHeld(overview)
    && Array.isArray(intents) && intents.some(intent => reference(intent?.key) && terminal.has(intent.state));

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

// This is the actual Controller load workflow. Setup identity is readable before
// the native account binding exists; command/request lists still require it.
export const readWorkspaceOverview = async ({ includeLists = false, readOverview, readRecords, readCommands, readRequests, isCurrent, now = Date.now }) => {
    let result = await readOverview();
    if (!isCurrent()) return null;
    const invalid = () => new Error('Unverified connections workspace response');
    if (!workspaceOverviewIsValid(result, now())) throw invalid();
    if (!workspaceRecordsCanBrowse(result.sharedData, result.context.verified)) result = { ...result, sharedData: { ...result.sharedData, records: [] } };
    if (includeLists && result.context.verified && result.context.connect.code === 'connected' && result.connection.selection.activity) {
        const activity = result.connection.selection.activity;
        const { recordDocument, commandDocument, requestDocument } = await readWorkspaceLists({ sharedData: result.sharedData, verified: true,
            readRecords: () => readRecords(activity), readCommands: () => readCommands(activity), readRequests: () => readRequests(activity) });
        if (!isCurrent()) return null;
        const current = value => workspaceReadResponseIsCurrent(value, result.context, { now: now() });
        if ((recordDocument !== null && (!current(recordDocument) || !Array.isArray(recordDocument.records) || !recordDocument.records.every(workspaceRecordIsValid)))
            || !current(commandDocument) || !Array.isArray(commandDocument.commands) || !commandDocument.commands.every(workspaceCommandIsValid)
            || !current(requestDocument) || !Array.isArray(requestDocument.requests) || !requestDocument.requests.every(workspaceAccessRequestIsValid)) throw invalid();
        result = { ...result, sharedData: { ...result.sharedData, ...(recordDocument || { records: [] }) }, commands: commandDocument.commands,
            connection: { ...result.connection, requests: requestDocument.requests } };
        if (!workspaceOverviewIsValid(result, now())) throw invalid();
    }
    return result;
};

export const workspaceAppliedOverviewIsCurrent = (fresh, applied, nativeReference, now = Date.now()) => Boolean(
    fresh === applied && workspaceOverviewIsValid(fresh, now) && fresh.context.verified === true && fresh.context.native_reference === nativeReference
);

// Historical generic intent metadata and recovery hints never supply a URL.
// Immediate submission and fresh same-attempt authorization have separate gates.
export const workspaceBindingAuthorizationUrl = (observation, nativeReference, { intentKey, currentOverview, now = Date.now() } = {}) => {
    if (observation?.stale || observation?.error || !reference(intentKey) || observation?.intent?.key !== intentKey || observation.intent.state !== 'completed'
        || !workspaceAppliedOverviewIsCurrent(observation.overview, currentOverview, nativeReference, now)
        || observation.overview.context.connect.code !== 'native_binding_required') return null;
    return sharedReadAuthorizationUrl(observation.result?.result?.authorization_url ?? observation.result?.authorization_url);
};

export const workspaceBindingContinuationIsCurrent = (value, intentKey, fresh, { currentOverview, nativeReference, now = Date.now() } = {}) => {
    const exact = (document, keys) => Boolean(document && typeof document === 'object' && !Array.isArray(document)
        && Object.keys(document).length === keys.length && keys.every(key => Object.hasOwn(document, key)));
    if (!workspaceAppliedOverviewIsCurrent(fresh, currentOverview, nativeReference, now) || !reference(intentKey)
        || !exact(value, ['viewKey', 'valid_until', 'native_reference', 'intent', 'binding_status', 'authorization_url'])
        || value.viewKey !== fresh.context.viewKey || value.native_reference !== nativeReference
        || !workspaceReadResponseIsCurrent(value, fresh.context, { now })
        || !exact(value.intent, ['key', 'state']) || value.intent.key !== intentKey || value.intent.state !== 'completed'
        || !['pending', 'approved', 'rejected', 'expired'].includes(value.binding_status)) return false;
    if (value.authorization_url === null) return true;
    return value.binding_status === 'pending' && fresh.context.connect.code === 'native_binding_required'
        && sharedReadAuthorizationUrl(value.authorization_url) !== null;
};

export const workspaceBindingContinuationUrl = (value, intentKey, fresh, options) => workspaceBindingContinuationIsCurrent(value, intentKey, fresh, options)
    && value.binding_status === 'pending' ? sharedReadAuthorizationUrl(value.authorization_url) : null;

// Only the authenticated original-operation discriminator permits a state-only
// lookup for a nonbinding setup effect. Missing/unresolved binding is not one.
export const readWorkspaceSetupIntent = async ({ intentKey, readBindingAuthorization, readIntent, isCurrent }) => {
    const stale = () => ({ stale: true, authorization: null, intent: null });
    if (!isCurrent()) return stale();
    try {
        const authorization = await readBindingAuthorization(intentKey);
        return isCurrent() ? { stale: false, authorization, intent: null } : stale();
    } catch (error) {
        if (!isCurrent()) return stale();
        if (error?.status !== 422 || error?.data?.error?.code !== 'workspace_binding_authorization_not_applicable') throw error;
        const metadata = await readIntent(intentKey);
        if (!isCurrent()) return stale();
        if (metadata?.intent?.key !== intentKey || typeof metadata.intent.state !== 'string') throw new Error('Unverified original workspace intent');
        return { stale: false, authorization: null, intent: terminal.has(metadata.intent.state) ? { key: intentKey, state: metadata.intent.state } : null };
    }
};

export const workspaceClientError = (error, language = 'ar') => {
    const ar = language === 'ar';
    const message = error?.data?.error?.message;
    if (typeof message === 'string' && message.trim() && message.length <= 2000) return message;
    return ar ? 'تعذر تأكيد الحالة الحالية. أُخفيت التفاصيل السابقة؛ حدّث الحالة وافحص نتيجة الطلب قبل بدء إجراء جديد.'
        : 'The current state could not be confirmed. Previous details are hidden; refresh the status and check the request outcome before starting another action.';
};
