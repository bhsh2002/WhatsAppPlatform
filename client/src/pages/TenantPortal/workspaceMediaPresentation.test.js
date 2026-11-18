import assert from 'node:assert/strict';
import test from 'node:test';
import { clearWorkspaceMediaStageHint, emptyWorkspaceMediaDraft, readWorkspaceMediaStageHint, saveWorkspaceMediaStageHint, workspaceMediaOptionsIsCurrent,
    workspaceMediaParameters, workspaceMediaReviewedParameters, workspaceMediaSameSelection, workspaceMediaStageIsConfirmed, workspaceMediaStagePayload } from './workspaceMediaPresentation.js';

const now = Date.parse('2026-11-18T12:00:00Z'), until = new Date(now + 30_000).toISOString();
const context = { verified: true, native_reference: 'native-current-owner', viewKey: 'current-context', valid_until: new Date(now + 300_000).toISOString() };
const descriptor = { activity: 'opaque/activity', provider: 'opaque/provider', capability: 'media.manage', selectionKey: 'a'.repeat(64) };
const asset = { value: 'opaque-asset', label: 'صورة المتجر.jpg', filename: 'صورة المتجر.jpg', mime_type: 'image/jpeg', byte_size: 400,
    source_revision: 1, state: 'staged', purpose: 'channel_content', evidence_reference: 'ترخيص الصورة 12', rights_valid_until: new Date(now + 86_400_000).toISOString(),
    available: true, actions: [{ value: 'media.asset.upload', available: true }, { value: 'media.asset.inspect', available: false }], reason: null };
const options = { capability: 'media.manage', checked_at: new Date(now).toISOString(), valid_until: until,
    accounts: [{ value: 'named-whatsapp-account', label: 'رقم مبيعات المتجر', available: true }], assets: [asset],
    actions: [{ value: 'media.asset.upload', label: 'رفع الملف إلى مكتبة واتساب' }, { value: 'media.asset.inspect', label: 'فحص ملف مرفوع' }],
    purposes: [{ value: 'channel_content', label: 'محتوى يملك النشاط حق استخدامه' }], can_stage: true, max_file_bytes: 1024 };
const draft = { ...emptyWorkspaceMediaDraft(), account_ref: 'named-whatsapp-account', asset_ref: asset.value, action: 'media.asset.upload',
    evidence_reference: 'ترخيص الصورة 12', rights_note: 'ترخيص فعلي موثق لاستخدام صورة المتجر على قناة واتساب',
    rights_recorded_at: new Date(now - 60_000).toISOString(), rights_valid_until: asset.rights_valid_until };
const file = { name: 'صورة المتجر.jpg', size: 400, type: 'image/jpeg' };

test('local file review binds current named account, actual rights record and bounded file without treating a checkbox as evidence', () => {
    const ready = { context, descriptor, options, draft, file, idempotencyKey: 'original-local-stage-key', now };
    const payload = workspaceMediaStagePayload(ready);
    assert.deepEqual(payload, { activity_ref: descriptor.activity, channel: 'whatsapp', account_ref: draft.account_ref, purpose: 'channel_content',
        evidence_reference: draft.evidence_reference, rights_note: draft.rights_note, rights_recorded_at: draft.rights_recorded_at,
        rights_valid_until: draft.rights_valid_until, idempotency_key: 'original-local-stage-key' });
    assert.equal(Object.hasOwn(payload, 'file'), false); assert.equal(Object.hasOwn(payload, 'actor_id'), false);
    for (const change of [ { file: { ...file, size: 1025 } }, { file: { ...file, size: 0 } }, { options: { ...options, can_stage: false } },
        { context: { ...context, verified: false } }, { now: now + 30_000 }, { draft: { ...draft, account_ref: 'unlisted-account' } },
        { draft: { ...draft, rights_note: '', confirmed: true } }, { draft: { ...draft, rights_recorded_at: new Date(now + 1).toISOString() } },
        { draft: { ...draft, rights_valid_until: new Date(now).toISOString() } } ]) assert.equal(workspaceMediaStagePayload({ ...ready, ...change }), null);
});

test('media options fail closed on stale context or malformed source revision; choices never establish authority', () => {
    assert.equal(workspaceMediaOptionsIsCurrent(options, context, now), true);
    assert.equal(workspaceMediaOptionsIsCurrent(options, { ...context, verified: false }, now), false);
    assert.equal(workspaceMediaOptionsIsCurrent(options, context, now + 30_000), false);
    assert.equal(workspaceMediaOptionsIsCurrent({ ...options, assets: [{ ...asset, source_revision: null }] }, context, now), false);
    assert.equal(workspaceMediaOptionsIsCurrent({ ...options, valid_until: new Date(now + 400_000).toISOString() }, context, now), false);
});

test('unknown or uploading asset cannot create another upload even if accidental availability flags are true', () => {
    const ready = { context, options, draft, now };
    const parameters = workspaceMediaParameters(ready);
    assert.equal(parameters.expected_revision, 1); assert.equal(parameters.evidence_reference, asset.evidence_reference);
    for (const state of ['unknown', 'uploading', 'uploaded']) assert.equal(workspaceMediaParameters({ ...ready, options: { ...options, assets: [{ ...asset, state }] } }), null);
    assert.equal(workspaceMediaParameters({ ...ready, options: { ...options, assets: [{ ...asset, evidence_reference: undefined }] } }), null);
    const uploaded = { ...asset, source_revision: 3, state: 'uploaded', actions: [{ value: 'media.asset.inspect', available: true }] };
    assert.equal(workspaceMediaParameters({ ...ready, options: { ...options, assets: [uploaded] }, draft: { ...draft, action: 'media.asset.inspect' } }).expected_revision, 3);
    assert.equal(workspaceMediaParameters({ ...ready, options: { ...options, assets: [{ ...uploaded, state: 'unknown' }] }, draft: { ...draft, action: 'media.asset.inspect' } }), null);
});

test('preview must exactly match selected asset revision and rights before a sealed Core review can be requested', () => {
    const expected = workspaceMediaParameters({ context, options, draft, now });
    const preview = { checked_at: new Date(now).toISOString(), valid_until: until, normalized_parameters: expected, resource_fingerprint: 'b'.repeat(64),
        quote: { total_credits: 0, within_budget: true, currency_label: 'رصيد' }, availability: { state: 'review_available', message: 'راجع الملف والحق' },
        summary: [{ label: 'الملف', value: asset.filename }, { label: 'الحق', value: asset.evidence_reference }] };
    assert.deepEqual(workspaceMediaReviewedParameters(draft.action, preview, context, expected, now), { ...expected, resource_fingerprint: 'b'.repeat(64) });
    for (const change of [{ resource_fingerprint: null }, { quote: { ...preview.quote, within_budget: false } }, { summary: [] },
        { normalized_parameters: { ...expected, expected_revision: 2 } }, { normalized_parameters: { ...expected, provider_id: 'manual-provider-id' } }]) {
        assert.equal(workspaceMediaReviewedParameters(draft.action, { ...preview, ...change }, context, expected, now), null);
    }
});

test('file-picker refresh uses server selection fingerprint and exact owner/window while replacing random opaque references', () => {
    const before = { context, descriptor };
    assert.equal(workspaceMediaSameSelection(before, { context: { ...context }, descriptor: { ...descriptor, activity: 'reissued/activity', provider: 'reissued/provider' } }), true);
    for (const after of [{ context: { ...context, native_reference: 'another-owner' }, descriptor }, { context: { ...context, viewKey: 'new-window' }, descriptor },
        { context, descriptor: { ...descriptor, selectionKey: 'c'.repeat(64) } }, { context, descriptor: { ...descriptor, selectionKey: null } }]) assert.equal(workspaceMediaSameSelection(before, after), false);
});

test('lost staging ACK retains only the original key by owner; missing lookup never confirms or clears it', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    saveWorkspaceMediaStageHint(storage, context.native_reference, 'original-local-stage-key');
    saveWorkspaceMediaStageHint(storage, 'different-owner', 'other-owner-stage-key');
    assert.deepEqual([...values.values()].map(JSON.parse), [{ key: 'original-local-stage-key' }, { key: 'other-owner-stage-key' }]);
    assert.equal(workspaceMediaStageIsConfirmed({ status: 404 }, 'original-local-stage-key'), false);
    assert.equal(readWorkspaceMediaStageHint(storage, context.native_reference), 'original-local-stage-key');
    assert.equal(workspaceMediaStageIsConfirmed({ operation_key: 'different-key', asset }, 'original-local-stage-key'), false);
    assert.equal(workspaceMediaStageIsConfirmed({ operation_key: 'original-local-stage-key', asset }, 'original-local-stage-key'), true);
    clearWorkspaceMediaStageHint(storage, context.native_reference, 'original-local-stage-key');
    assert.equal(readWorkspaceMediaStageHint(storage, 'different-owner'), 'other-owner-stage-key');
    assert.equal(saveWorkspaceMediaStageHint(null, context.native_reference, 'original-local-stage-key'), false);
});
