import assert from 'node:assert/strict';
import test from 'node:test';
import { observeWorkspaceEffect, readWorkspaceHolds, readWorkspaceLists, releaseWorkspaceHold, retainWorkspaceHold, workspaceAccessRequestIsValid, workspaceBindingAuthorizationUrl, workspaceCommandIsValid, workspaceOverviewIsValid, workspaceReviewIsCurrent, workspaceServerHeld } from './connectionsDataRuntime.js';

const context = { verified: true, native_reference: 'server-native-and-center-partition', viewKey: 'current-view', valid_until: new Date(60_000).toISOString(),
    organizationLabel: 'متجر المدينة', actorLabel: 'سارة', connect: { enabled: false, code: 'connect_core', label: 'ربط الحساب' } };
const overview = () => ({ spec_version: '1.0', context: { ...context }, held: false,
    connection: { choices: { activities: [], purposes: [], providers: [], fields: [], people: [] }, selection: { activity: '', purpose: '', provider: '', fields: [], people: [] }, requests: [], held: false, busy: false },
    capabilities: { capabilities: [] }, sharedData: { records: [] }, commands: [], productEditor: { fields: [], units: [], priceChoices: [], mediaChoices: [] }, intents: [] });
const storage = () => {
    const values = new Map();
    return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('workspace DTO requires verified named current context and explicit choice/action state', () => {
    const current = overview();
    assert.equal(workspaceOverviewIsValid(current, 1_000), true);
    for (const contextChange of [{ valid_until: 'invalid' }, { valid_until: new Date(1_000).toISOString() }, { actorLabel: 'a'.repeat(64) }, { native_reference: null }]) {
        assert.equal(workspaceOverviewIsValid({ ...current, context: { ...context, ...contextChange } }, 1_000), false);
    }
    assert.equal(workspaceOverviewIsValid({ ...current, connection: { ...current.connection, choices: { ...current.connection.choices, activities: [{ value: 'opaque', label: 'متجر' }] } } }, 1_000), false);
    assert.equal(workspaceOverviewIsValid({ ...current, sharedData: { records: [{ key: 'opaque-record', label: 'قهوة', sourceLabel: 'كتالوج', fields: [{ key: 'price', label: 'سعر', sourceLabel: 'كتالوج', displayValue: { hidden: 'raw-json' } }] }] } }, 1_000), false);
});

test('server review must bind the current view, bounded expiry, human summary and preissued intent reference', () => {
    const review = { key: 'encrypted-review-not-stored', intentKey: 'server-issued-safe-intent', viewKey: context.viewKey,
        canSubmit: true, valid_until: new Date(30_000).toISOString(), summary: [{ label: 'المصدر', value: 'كتالوج المدينة' }] };
    assert.equal(workspaceReviewIsCurrent(review, context, 1_000), true);
    for (const change of [{ viewKey: 'older-view' }, { intentKey: null }, { summary: [] }, { valid_until: new Date(90_000).toISOString() }, { valid_until: new Date(1_000).toISOString() }]) {
        assert.equal(workspaceReviewIsCurrent({ ...review, ...change }, context, 1_000), false);
    }
    assert.equal(workspaceReviewIsCurrent(review, { ...context, verified: false }, 1_000), false);
});

test('transport-loss metadata is partitioned and retains no review token or business payload', () => {
    const local = storage();
    assert.equal(retainWorkspaceHold(local, 'native-one-owner-one', 'intent-one'), true);
    assert.deepEqual(readWorkspaceHolds(local, 'native-one-owner-one').records, [{ key: 'intent-one', state: 'unknown' }]);
    assert.deepEqual(readWorkspaceHolds(local, 'native-two-owner-one').records, []);
    assert.equal(retainWorkspaceHold(local, 'native-two-owner-one', 'intent-two'), true);
    assert.equal(local.values.size, 2);
    assert.equal([...local.values.values()].some(raw => /payload|password|review|label|token/.test(raw)), false);
    assert.equal(readWorkspaceHolds(local, 'native-one-owner-one').records[0].key, 'intent-one');
});

test('unknown, missing metadata and still-held server states never release a local blocker', () => {
    const local = storage();
    retainWorkspaceHold(local, context.native_reference, 'intent-one');
    for (const state of ['unknown', 'inflight', 'prepared', undefined]) {
        assert.equal(releaseWorkspaceHold(local, context.native_reference, { key: 'intent-one', state }, overview(), 1_000), false);
    }
    const unresolved = { ...overview(), intents: [{ key: 'other-intent', state: 'unknown' }] };
    assert.equal(workspaceServerHeld(unresolved), true);
    assert.equal(releaseWorkspaceHold(local, context.native_reference, { key: 'intent-one', state: 'completed' }, unresolved, 1_000), false);
    assert.equal(releaseWorkspaceHold(local, context.native_reference, { key: 'intent-one', state: 'completed' }, { ...overview(), context: { ...context, native_reference: 'different-context' } }, 1_000), false);
    assert.equal(readWorkspaceHolds(local, context.native_reference).records.length, 1);
});

test('terminal metadata plus fresh unheld same-partition overview releases only that resolved intent', () => {
    const local = storage();
    retainWorkspaceHold(local, context.native_reference, 'intent-one');
    retainWorkspaceHold(local, context.native_reference, 'intent-two');
    retainWorkspaceHold(local, 'different-owner', 'other-owner-intent');
    assert.equal(releaseWorkspaceHold(local, context.native_reference, { key: 'intent-one', state: 'completed' }, overview(), 1_000), true);
    assert.deepEqual(readWorkspaceHolds(local, context.native_reference).records, [{ key: 'intent-two', state: 'unknown' }]);
    assert.equal(readWorkspaceHolds(local, 'different-owner').records.length, 1);
    assert.equal(releaseWorkspaceHold(local, context.native_reference, { key: 'intent-two', state: 'failed' }, overview(), 1_000), true);
    assert.deepEqual(readWorkspaceHolds(local, context.native_reference).records, []);
});

test('optional recovery storage reports unavailable or malformed hints without granting server authority', () => {
    const unavailable = { getItem: () => { throw new Error('unavailable'); } };
    assert.equal(readWorkspaceHolds(unavailable, context.native_reference).invalid, true);
    assert.equal(retainWorkspaceHold(unavailable, context.native_reference, 'intent-one'), false);
    const local = storage();
    retainWorkspaceHold(local, context.native_reference, 'intent-one');
    local.values.set([...local.values.keys()][0], '{broken');
    assert.equal(readWorkspaceHolds(local, context.native_reference).invalid, true);
    assert.equal(retainWorkspaceHold(local, context.native_reference, 'intent-two'), false);
});

test('pending and rejected connection revisions preserve separately supplied effective-policy summaries', () => {
    const request = { key: 'version-bound-request-ref', label: 'مشاركة منتجات المتجر', state: 'pending',
        proposedSummary: [{ label: 'الأشخاص المقترحون', value: 'سارة' }], effectiveSummary: [{ label: 'الأشخاص المعتمدون', value: 'فريق المتجر' }],
        effectiveStateLabel: 'التفويض السابق ما زال ساريًا', changedSinceEffective: true,
        actions: [{ key: 'approve', label: 'اعتماد الاقتراح الحالي', enabled: true, intentKey: 'preissued-approval-ref' }] };
    assert.equal(workspaceAccessRequestIsValid(request), true);
    assert.equal(workspaceAccessRequestIsValid({ ...request, state: 'rejected' }), true);
    assert.equal(request.effectiveSummary[0].value, 'فريق المتجر');
    assert.equal(workspaceAccessRequestIsValid({ ...request, proposedSummary: [] }), false);
    assert.equal(workspaceAccessRequestIsValid({ ...request, effectiveSummary: [{ label: 'معرف خاص', value: 'a'.repeat(64) }] }), false);
    assert.equal(workspaceAccessRequestIsValid({ ...request, actions: [{ ...request.actions[0], intentKey: { browser: true } }] }), false);
});

test('lost dispatch response plus metadata 404 observes fresh status once without repeating the effect', async () => {
    const calls = [];
    const result = await observeWorkspaceEffect({ intentKey: 'preissued-intent', isCurrent: () => true,
        dispatch: async () => { calls.push('dispatch'); throw new Error('response lost'); },
        readIntent: async key => { calls.push(`metadata:${key}`); throw Object.assign(new Error('not found yet'), { status: 404 }); },
        readFresh: async () => { calls.push('fresh'); return overview(); } });
    assert.deepEqual(calls, ['dispatch', 'metadata:preissued-intent', 'fresh']);
    assert.equal(result.error.message, 'response lost');
    assert.equal(result.intent, null);
    assert.equal(result.stale, false);
});

test('a permission or page-context change during dispatch cannot restore an earlier view', async () => {
    let current = true;
    const calls = [];
    const result = await observeWorkspaceEffect({ intentKey: 'preissued-intent', isCurrent: () => current,
        dispatch: async () => { calls.push('dispatch'); current = false; },
        readIntent: async () => { calls.push('metadata'); return { intent: { state: 'completed' } }; },
        readFresh: async () => { calls.push('fresh'); return overview(); } });
    assert.deepEqual(calls, ['dispatch']);
    assert.equal(result.stale, true);
    assert.equal(result.overview, null);
    assert.equal(result.result, null);
});

test('binding redirect uses only immediate success plus completed intent and same fresh verified owner', async () => {
    const fresh = overview(); const nativeReference = fresh.context.native_reference;
    const result = await observeWorkspaceEffect({ intentKey: 'preissued-binding', isCurrent: () => true,
        dispatch: async () => ({ result: { authorization_url: 'https://center.example.test/owner/link?request=public-handle' } }),
        readIntent: async () => ({ intent: { state: 'completed' } }), readFresh: async () => fresh });
    assert.equal(workspaceBindingAuthorizationUrl(result, nativeReference), 'https://center.example.test/owner/link?request=public-handle');
    for (const invalid of [{ ...result, stale: true }, { ...result, error: new Error('lost response') },
        { ...result, result: null }, { ...result, intent: { state: 'unknown' } }, { ...result, intent: null },
        { ...result, overview: { context: { ...fresh.context, verified: false } } },
        { ...result, result: { authorization_url: 'javascript:alert(1)' } },
        { ...result, result: { authorization_url: 'https://center.example.test/?access_token=private' } }]) {
        assert.equal(workspaceBindingAuthorizationUrl(invalid, nativeReference), null);
    }
    assert.equal(workspaceBindingAuthorizationUrl(result, 'different-owner'), null);
});

test('native command without a verified summary remains visible with server-disabled approval', () => {
    const row = { key: 'opaque-command', label: 'Message request', sourceLabel: 'Store messaging', state: 'pending_review', projection_state: 'not_required',
        summary: [], actions: [{ key: 'approve', label: 'Approve reviewed request', enabled: false, reason: 'A verified review summary is required.' }] };
    assert.equal(workspaceCommandIsValid(row), true);
    assert.equal(workspaceCommandIsValid({ ...row, summary: [{ label: 'raw ref', value: 'a'.repeat(64) }] }), false);
});

test('setup and native-only refresh never probe unavailable product reads while commands and requests still refresh', async () => {
    for (const browseAction of [undefined, { key: 'records.browse', label: 'تصفح المنتجات', enabled: false, effect: 'read', reason: 'يلزم تفويض قراءة' },
        { key: 'records.browse', label: 'المالك يستطيع القراءة', effect: 'read' }, { key: 'other.action', label: 'تصفح', enabled: true, effect: 'read' }]) {
        const calls = [];
        const result = await readWorkspaceLists({ sharedData: { records: [], browseAction }, verified: true,
            readRecords: async () => { calls.push('records'); throw new Error('Unauthorized read must not be attempted'); },
            readCommands: async () => { calls.push('commands'); return { commands: [{ state: 'pending_review' }] }; },
            readRequests: async () => { calls.push('requests'); return { requests: [{ state: 'pending' }] }; } });
        assert.deepEqual(calls, ['commands', 'requests']); assert.equal(result.recordDocument, null);
        assert.equal(result.commandDocument.commands[0].state, 'pending_review'); assert.equal(result.requestDocument.requests[0].state, 'pending');
    }
});

test('only explicit current product-read action enables refresh and a subsequent read denial remains an error', async () => {
    const sharedData = { browseAction: { key: 'records.browse', label: 'تصفح المنتجات', enabled: true, effect: 'read' } };
    const calls = [];
    const result = await readWorkspaceLists({ sharedData, verified: true, readRecords: async () => { calls.push('records'); return { records: ['current-record'] }; },
        readCommands: async () => ({ commands: [] }), readRequests: async () => ({ requests: [] }) });
    assert.deepEqual(calls, ['records']); assert.deepEqual(result.recordDocument.records, ['current-record']);
    await assert.rejects(readWorkspaceLists({ sharedData, verified: true,
        readRecords: async () => { throw Object.assign(new Error('permission withdrawn'), { status: 403 }); },
        readCommands: async () => ({ commands: [] }), readRequests: async () => ({ requests: [] }) }), { status: 403 });
    const disabled = await readWorkspaceLists({ sharedData, verified: false, readRecords: async () => { throw new Error('Unverified owner must not read'); },
        readCommands: async () => ({}), readRequests: async () => ({}) });
    assert.equal(disabled.recordDocument, null);
});
