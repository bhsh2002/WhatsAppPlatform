import { workspaceLabel, workspaceReviewSummaryIsValid } from './connectionsDataPresentation.js';
import { workspaceBusinessPreviewIsCurrent } from './workspaceBusinessPresentation.js';

export const WORKSPACE_MEDIA_ACTIONS = Object.freeze(['media.asset.upload', 'media.asset.inspect']);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const named = value => Boolean(workspaceLabel(value, null));
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const current = (value, now) => date(value) && Date.parse(value) > now;
const keyValid = value => /^[A-Za-z0-9._:-]{8,128}$/.test(value || '');
const hintPrefix = 'wa-media-stage:v1:';
export const emptyWorkspaceMediaDraft = () => ({ account_ref: '', asset_ref: '', action: '', evidence_reference: '', rights_note: '', rights_recorded_at: '', rights_valid_until: '' });
export const workspaceMediaSameSelection = (before, after) => Boolean(before?.context?.verified && after?.context?.verified
    && before.context.native_reference === after.context.native_reference && before.context.viewKey === after.context.viewKey
    && /^[a-f0-9]{64}$/.test(before.descriptor?.selectionKey) && before.descriptor.selectionKey === after.descriptor?.selectionKey);
export const workspaceMediaAssetIsValid = asset => Boolean(text(asset?.value, 1024) && named(asset.label) && named(asset.filename)
    && text(asset.mime_type, 200) && Number.isSafeInteger(asset.byte_size) && asset.byte_size > 0
    && Number.isSafeInteger(asset.source_revision) && asset.source_revision > 0 && ['staged', 'uploading', 'uploaded', 'unknown', 'rejected'].includes(asset.state)
    && asset.purpose === 'channel_content' && date(asset.rights_valid_until) && typeof asset.available === 'boolean'
    && (asset.evidence_reference === undefined || text(asset.evidence_reference, 1000))
    && Array.isArray(asset.actions) && asset.actions.every(action => WORKSPACE_MEDIA_ACTIONS.includes(action?.value) && typeof action.available === 'boolean')
    && (asset.reason == null || typeof asset.reason === 'string'));
export const workspaceMediaOptionsIsCurrent = (options, context, now = Date.now()) => Boolean(context?.verified && current(context.valid_until, now)
    && options?.capability === 'media.manage' && date(options.checked_at) && Date.parse(options.checked_at) <= now && current(options.valid_until, now)
    && Date.parse(options.valid_until) <= Date.parse(context.valid_until)
    && Array.isArray(options.accounts) && options.accounts.every(row => text(row?.value, 1024) && named(row.label) && typeof row.available === 'boolean')
    && Array.isArray(options.assets) && options.assets.every(workspaceMediaAssetIsValid)
    && Array.isArray(options.actions) && options.actions.every(row => WORKSPACE_MEDIA_ACTIONS.includes(row?.value) && named(row.label))
    && Array.isArray(options.purposes) && options.purposes.every(row => row?.value === 'channel_content' && named(row.label))
    && typeof options.can_stage === 'boolean' && Number.isSafeInteger(options.max_file_bytes) && options.max_file_bytes > 0);
export const workspaceMediaParameters = ({ draft, options, context, now = Date.now() }) => {
    if (!workspaceMediaOptionsIsCurrent(options, context, now) || !WORKSPACE_MEDIA_ACTIONS.includes(draft?.action)
        || !options.accounts.some(row => row.value === draft.account_ref && row.available === true)) return null;
    const asset = options.assets.find(row => row.value === draft.asset_ref);
    if (!asset?.available || !text(asset.evidence_reference, 1000) || !asset.actions.some(row => row.value === draft.action && row.available === true)
        || (draft.action === 'media.asset.upload' && (!['staged', 'rejected'].includes(asset.state) || !current(asset.rights_valid_until, now)))
        || (draft.action === 'media.asset.inspect' && asset.state !== 'uploaded')) return null;
    return { channel: 'whatsapp', account_ref: draft.account_ref, asset_ref: asset.value, expected_revision: asset.source_revision,
        purpose: asset.purpose, evidence_reference: asset.evidence_reference };
};
export const workspaceMediaStagePayload = ({ context, descriptor, options, draft, file, idempotencyKey, now = Date.now() }) => {
    if (!workspaceMediaOptionsIsCurrent(options, context, now) || !text(descriptor?.activity, 16_384) || options.can_stage !== true
        || !options.accounts.some(row => row.value === draft.account_ref && row.available === true) || !keyValid(idempotencyKey)
        || !file || !named(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > options.max_file_bytes
        || !text(draft.evidence_reference, 1000) || !text(draft.rights_note, 2000) || draft.rights_note.trim().length < 20
        || !date(draft.rights_recorded_at) || Date.parse(draft.rights_recorded_at) > now || !current(draft.rights_valid_until, now)
        || Date.parse(draft.rights_recorded_at) >= Date.parse(draft.rights_valid_until)) return null;
    return Object.freeze({ activity_ref: descriptor.activity, channel: 'whatsapp', account_ref: draft.account_ref, purpose: 'channel_content',
        evidence_reference: draft.evidence_reference.trim(), rights_note: draft.rights_note.trim(), rights_recorded_at: new Date(draft.rights_recorded_at).toISOString(),
        rights_valid_until: new Date(draft.rights_valid_until).toISOString(), idempotency_key: idempotencyKey });
};
export const workspaceMediaStageIsConfirmed = (result, key) => Boolean(result?.operation_key === key && workspaceMediaAssetIsValid(result.asset));
export const workspaceMediaReviewedParameters = (action, preview, context, expected, now = Date.now()) => {
    if (!WORKSPACE_MEDIA_ACTIONS.includes(action) || !workspaceBusinessPreviewIsCurrent(preview, context, now)
        || preview.availability.state !== 'review_available' || preview.quote.within_budget !== true
        || !/^[a-f0-9]{64}$/.test(preview.resource_fingerprint) || !workspaceReviewSummaryIsValid(preview.summary)
        || !expected || Object.keys(preview.normalized_parameters).length !== Object.keys(expected).length
        || Object.keys(expected).some(key => preview.normalized_parameters[key] !== expected[key])) return null;
    return { ...preview.normalized_parameters, resource_fingerprint: preview.resource_fingerprint };
};
export const readWorkspaceMediaStageHint = (storage, nativeReference) => {
    if (!text(nativeReference, 2048)) return null;
    try { const value = JSON.parse(storage.getItem(hintPrefix + nativeReference));
        return value && Object.keys(value).length === 1 && keyValid(value.key) ? value.key : null;
    } catch { return null; }
};
export const saveWorkspaceMediaStageHint = (storage, nativeReference, key) => {
    if (!text(nativeReference, 2048) || !keyValid(key)) return false;
    try { storage.setItem(hintPrefix + nativeReference, JSON.stringify({ key })); return true; } catch { return false; }
};
export const clearWorkspaceMediaStageHint = (storage, nativeReference, key) => {
    if (readWorkspaceMediaStageHint(storage, nativeReference) !== key) return false;
    try { storage.removeItem(hintPrefix + nativeReference); return true; } catch { return false; }
};
