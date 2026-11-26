import assert from 'node:assert/strict';
import test from 'node:test';
import { observeWorkspaceEffect, readWorkspaceHolds, readWorkspaceLists, readWorkspaceOverview, readWorkspaceSetupIntent, releaseWorkspaceHold, retainWorkspaceHold, watchWorkspaceReadExpiry, workspaceAccessRequestIsValid, workspaceAppliedOverviewIsCurrent, workspaceBindingAuthorizationUrl, workspaceBindingContinuationIsCurrent, workspaceBindingContinuationUrl, workspaceCommandIsValid, workspaceOutcomeRefreshNeeded, workspaceOverviewIsValid, workspaceReadDeadline, workspaceReadResponseIsCurrent, workspaceReviewIsCurrent, workspaceServerHeld } from './connectionsDataRuntime.js';

const context = { verified: true, native_reference: 'server-native-and-center-partition', viewKey: 'current-view', valid_until: new Date(60_000).toISOString(),
    organizationLabel: 'متجر المدينة', actorLabel: 'سارة', connect: { enabled: false, code: 'connect_core', label: 'ربط الحساب' } };
const overview = () => ({ spec_version: '1.0', context: { ...context }, held: false,
    connection: { choices: { activities: [], purposes: [], providers: [], fields: [], people: [] }, selection: { activity: '', purpose: '', provider: '', fields: [], people: [] }, requests: [], held: false, busy: false },
    capabilities: { capabilities: [] }, sharedData: { records: [] }, commands: [], productEditor: { fields: [], units: [], priceChoices: [], mediaChoices: [] }, intents: [] });
const storage = () => {
    const values = new Map();
    return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

const expiryClock = () => {
    let time = 1_000, sequence = 0;
    const tasks = new Map();
    return {
        now: () => time,
        schedule: (callback, delay) => { const id = ++sequence; tasks.set(id, { at: time + delay, callback }); return id; },
        cancel: id => tasks.delete(id),
        advance: elapsed => {
            const target = time + elapsed;
            while (true) {
                const next = [...tasks.entries()].filter(([, task]) => task.at <= target).sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
                if (!next) break;
                time = next[1].at; tasks.delete(next[0]); next[1].callback();
            }
            time = target;
        },
    };
};
const at = value => new Date(value).toISOString();

test('product reception action can be shown before a read purpose but needs its current opaque provider', () => {
    const current = overview();
    current.actions = [{ key: 'provider.products.prepare', label: 'تهيئة استقبال المنتجات', enabled: true,
        effect: 'read', provider: 'opaque-own-provider' }];
    assert.equal(workspaceOverviewIsValid(current, 1_000), true);
    for (const provider of [undefined, '', null, { accepted_scopes: ['*'] }]) {
        const changed = structuredClone(current);
        changed.actions[0].provider = provider;
        assert.equal(workspaceOverviewIsValid(changed, 1_000), false);
    }
    const done = structuredClone(current);
    done.actions[0] = { key: 'provider.products.prepare', label: 'استقبال المنتجات مهيأ', enabled: false,
        reason: 'تهيئة الاستقبال منفصلة عن طلب مشاركة القراءة.' };
    assert.equal(workspaceOverviewIsValid(done, 1_000), true);
});

test('a reconciled original intent requires current held context to be read once again before releasing its hold', () => {
    const fresh = overview(); fresh.held = true;
    const metadata = [{ key: 'original-attempt', state: 'completed' }];
    assert.equal(workspaceOutcomeRefreshNeeded(fresh, metadata), true);
    assert.equal(workspaceOutcomeRefreshNeeded({ ...fresh, held: false }, metadata), false);
    for (const intents of [[], [{ key: 'original-attempt', state: 'unknown' }], [{ state: 'completed' }], null]) {
        assert.equal(workspaceOutcomeRefreshNeeded(fresh, intents), false);
    }
    const local = storage(); retainWorkspaceHold(local, fresh.context.native_reference, 'original-attempt');
    assert.equal(releaseWorkspaceHold(local, fresh.context.native_reference, metadata[0], fresh, 1_000), false);
    const current = { ...fresh, held: false };
    assert.equal(releaseWorkspaceHold(local, 'different-partition', metadata[0], current, 1_000), false);
    assert.equal(releaseWorkspaceHold(local, fresh.context.native_reference, metadata[0], current, 1_000), true);
});

test('workspace read expiry clears at the earliest parent, list, detail or review deadline', () => {
    for (const [list, detail, review, expected] of [[30_000, 10_000, 20_000, 10_000], [8_000, 10_000, 20_000, 8_000],
        [30_000, 40_000, 5_000, 5_000], [90_000, 80_000, 70_000, 60_000]]) {
        const clock = expiryClock();
        const view = { context, recordsValidUntil: at(list), detail: { valid_until: at(detail) }, review: { valid_until: at(review) } };
        assert.equal(workspaceReadDeadline(view), expected);
        let visible = true, expired = 0;
        const stop = watchWorkspaceReadExpiry({ ...view, ...clock, onExpire: () => { visible = false; expired += 1; } });
        clock.advance(expected - clock.now() - 1);
        assert.equal(visible, true);
        clock.advance(1);
        assert.equal(visible, false); assert.equal(expired, 1);
        clock.advance(60_000);
        assert.equal(expired, 1);
        stop();
    }
    assert.equal(workspaceReadDeadline({ context, detail: { valid_until: 'invalid' } }), 0);
    let invalidated = 0;
    watchWorkspaceReadExpiry({ context, recordsValidUntil: 'invalid', onExpire: () => { invalidated += 1; } });
    assert.equal(invalidated, 1);
});

test('closing product details releases only its timer and cannot extend the remaining parent or list grant', () => {
    const clock = expiryClock();
    const currentContext = { ...context, valid_until: at(20_000) };
    let expired = 0;
    const onExpire = () => { expired += 1; };
    const stopDetail = watchWorkspaceReadExpiry({ context: currentContext, recordsValidUntil: at(30_000),
        detail: { valid_until: at(5_000) }, ...clock, onExpire });
    clock.advance(1_000);
    stopDetail();
    const stopRemaining = watchWorkspaceReadExpiry({ context: currentContext, recordsValidUntil: at(30_000), detail: null, ...clock, onExpire });
    clock.advance(3_000);
    assert.equal(expired, 0);
    clock.advance(14_999);
    assert.equal(expired, 0);
    clock.advance(1);
    assert.equal(expired, 1);
    stopRemaining();
});

test('late workspace responses cannot revive an expired or closed detail even with a later response expiry', () => {
    const clock = expiryClock();
    let revision = 7, visible = { label: 'Authorized detail' };
    const requestRevision = revision;
    const pending = { viewKey: context.viewKey, valid_until: at(40_000), record: { label: 'Late detail' } };
    const stop = watchWorkspaceReadExpiry({ context, recordsValidUntil: at(30_000), detail: { valid_until: at(10_000) }, ...clock,
        onExpire: () => { revision += 1; visible = null; } });
    clock.advance(9_000);
    const stillCurrent = workspaceReadResponseIsCurrent(pending, context, { now: clock.now(), requestRevision, currentRevision: revision });
    if (stillCurrent) visible = pending.record;
    assert.equal(stillCurrent, false); assert.equal(visible, null);
    assert.equal(workspaceReadResponseIsCurrent({ ...pending, valid_until: at(10_000) }, context,
        { now: clock.now(), requestRevision: revision, currentRevision: revision }), false);
    assert.equal(workspaceReadResponseIsCurrent({ ...pending, valid_until: at(60_001) }, context,
        { now: clock.now(), requestRevision: revision, currentRevision: revision }), false);
    const beforeClose = revision;
    revision += 1;
    assert.equal(workspaceReadResponseIsCurrent(pending, context, { now: clock.now(), requestRevision: beforeClose, currentRevision: revision }), false);
    assert.equal(workspaceReadResponseIsCurrent(pending, { ...context, viewKey: 'changed-activity' },
        { now: clock.now(), requestRevision: revision, currentRevision: revision }), false);
    stop();
});

test('detail to product editor transition retains the shorter read deadline until the copied data is removed', () => {
    const clock = expiryClock();
    const deadline = workspaceReadDeadline({ context, recordsValidUntil: at(30_000), detail: { valid_until: at(10_000) } });
    let revision = 3, editor = { valid_until: at(deadline), draft: { name: 'Authorized source value' } };
    const requestRevision = revision;
    // Closing the detail and even removing its list cannot renew the copied
    // source fields now visible in the editor under the same read grant.
    assert.equal(workspaceReadDeadline({ context, detail: null, recordsValidUntil: null, editor }), 10_000);
    const stop = watchWorkspaceReadExpiry({ context, detail: null, recordsValidUntil: null, editor, ...clock,
        onExpire: () => { revision += 1; editor = null; } });
    clock.advance(8_999);
    assert.equal(editor.draft.name, 'Authorized source value');
    clock.advance(1);
    assert.equal(editor, null);
    assert.equal(workspaceReadResponseIsCurrent({ viewKey: context.viewKey, valid_until: at(40_000) }, context,
        { now: clock.now(), requestRevision, currentRevision: revision }), false);
    stop();
});

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
    const fresh = overview(); fresh.context.connect = { enabled: true, code: 'native_binding_required', label: 'ربط هذا الحساب بالمؤسسة' };
    const nativeReference = fresh.context.native_reference;
    const result = await observeWorkspaceEffect({ intentKey: 'preissued-binding', isCurrent: () => true,
        dispatch: async () => ({ result: { authorization_url: 'https://center.example.test/owner/link?request=public-handle' } }),
        readIntent: async () => ({ intent: { state: 'completed' } }), readFresh: async () => fresh });
    const options = { intentKey: 'preissued-binding', currentOverview: fresh, now: 1_000 };
    assert.equal(workspaceBindingAuthorizationUrl(result, nativeReference, options), 'https://center.example.test/owner/link?request=public-handle');
    for (const invalid of [{ ...result, stale: true }, { ...result, error: new Error('lost response') },
        { ...result, result: null }, { ...result, intent: { state: 'unknown' } }, { ...result, intent: null },
        { ...result, overview: { context: { ...fresh.context, verified: false } } },
        { ...result, result: { authorization_url: 'javascript:alert(1)' } },
        { ...result, result: { authorization_url: 'https://center.example.test/?access_token=private' } }]) {
        assert.equal(workspaceBindingAuthorizationUrl(invalid, nativeReference, options), null);
    }
    assert.equal(workspaceBindingAuthorizationUrl(result, 'different-owner', options), null);
    assert.equal(workspaceBindingAuthorizationUrl(result, nativeReference, { ...options, intentKey: 'another-attempt' }), null);
    assert.equal(workspaceBindingAuthorizationUrl(result, nativeReference, { ...options, currentOverview: null }), null);
    assert.equal(workspaceBindingAuthorizationUrl(result, nativeReference, { ...options, currentOverview: structuredClone(fresh) }), null);
    assert.equal(workspaceBindingAuthorizationUrl(result, nativeReference, { ...options, now: 60_000 }), null);
});

test('binding overview workflow refreshes current setup without requesting unavailable command or request lists', async () => {
    const source = overview();
    source.context.connect = { enabled: true, code: 'native_binding_required', label: 'ربط هذا الحساب بالمؤسسة' };
    source.connection.selection.activity = 'actual-selected-activity';
    let epoch = 1, applied = null;
    const operationEpoch = epoch, calls = [];
    const load = async includeLists => {
        const loadEpoch = ++epoch;
        const result = await readWorkspaceOverview({ includeLists, now: () => 1_000, isCurrent: () => epoch === loadEpoch,
            readOverview: async () => { calls.push('overview'); return structuredClone(source); },
            readRecords: async () => { calls.push('records'); throw new Error('Unavailable before binding'); },
            readCommands: async () => { calls.push('commands'); throw Object.assign(new Error('Binding required'), { status: 403 }); },
            readRequests: async () => { calls.push('requests'); throw Object.assign(new Error('Binding required'), { status: 403 }); } });
        if (result) applied = result;
        return result;
    };
    const observed = await observeWorkspaceEffect({ intentKey: 'original-binding', isCurrent: () => epoch === operationEpoch,
        dispatch: async () => { calls.push('submit'); return { result: { authorization_url: 'https://center.example.test/owner/link?request=original' } }; },
        readIntent: async key => { calls.push(`intent:${key}`); return { intent: { state: 'completed' } }; }, readFresh: () => load(false) });
    assert.deepEqual(calls, ['submit', 'intent:original-binding', 'overview']);
    assert.equal(workspaceAppliedOverviewIsCurrent(observed.overview, applied, source.context.native_reference, 1_000), true);
    assert.equal(workspaceBindingAuthorizationUrl(observed, source.context.native_reference, { intentKey: 'original-binding', currentOverview: applied, now: 1_000 }),
        'https://center.example.test/owner/link?request=original');
    // Generic refresh is gated by actual setup state too, rather than catching a 403.
    await load(true);
    assert.deepEqual(calls.slice(3), ['overview']);
});

test('connected overview workflow preserves list denial and rejects a superseded current identity', async () => {
    const source = overview(); source.context.connect.code = 'connected'; source.connection.selection.activity = 'current-activity';
    const calls = [];
    await assert.rejects(readWorkspaceOverview({ includeLists: true, now: () => 1_000, isCurrent: () => true,
        readOverview: async () => { calls.push('overview'); return source; },
        readRecords: async () => { throw new Error('No product grant'); },
        readCommands: async activity => { calls.push(`commands:${activity}`); throw Object.assign(new Error('permission withdrawn'), { status: 403 }); },
        readRequests: async activity => { calls.push(`requests:${activity}`); return {}; } }), { status: 403 });
    assert.deepEqual(calls, ['overview', 'commands:current-activity', 'requests:current-activity']);
    let current = true;
    const result = await readWorkspaceOverview({ includeLists: true, now: () => 1_000, isCurrent: () => current,
        readOverview: async () => { current = false; return source; }, readCommands: async () => { throw new Error('Stale view must not read lists'); } });
    assert.equal(result, null);
});

test('binding continuation accepts only fresh same-attempt current-view authorization and never metadata URL authority', () => {
    const fresh = overview(); fresh.context.connect = { enabled: true, code: 'native_binding_required', label: 'ربط هذا الحساب بالمؤسسة' };
    const key = 'original-binding', nativeReference = fresh.context.native_reference;
    const options = { currentOverview: fresh, nativeReference, now: 1_000 };
    const value = { viewKey: fresh.context.viewKey, valid_until: at(30_000), native_reference: nativeReference,
        intent: { key, state: 'completed' }, binding_status: 'pending', authorization_url: 'https://center.example.test/owner/link?request=original' };
    assert.equal(workspaceBindingContinuationUrl(value, key, fresh, options), value.authorization_url);
    for (const status of ['approved', 'rejected', 'expired']) {
        const terminal = { ...value, binding_status: status, authorization_url: null };
        assert.equal(workspaceBindingContinuationIsCurrent(terminal, key, fresh, options), true);
        assert.equal(workspaceBindingContinuationUrl(terminal, key, fresh, options), null);
    }
    for (const changed of [{ viewKey: 'different-view' }, { native_reference: 'different-owner' }, { valid_until: at(1_000) }, { valid_until: at(60_001) },
        { intent: { key: 'another-attempt', state: 'completed' } }, { intent: { key, state: 'unknown' } }, { intent: { key, state: 'completed', result: {} } },
        { binding_status: 'invented' }, { binding_status: 'approved' }, { authorization_url: 'javascript:alert(1)' },
        { authorization_url: 'https://center.example.test/?access_token=private' }, { historical_url: value.authorization_url }]) {
        assert.equal(workspaceBindingContinuationUrl({ ...value, ...changed }, key, fresh, options), null);
        assert.equal(workspaceBindingContinuationIsCurrent({ ...value, ...changed }, key, fresh, options), false);
    }
    assert.equal(workspaceBindingContinuationUrl(value, key, fresh, { ...options, currentOverview: null }), null);
    assert.equal(workspaceBindingContinuationUrl(value, key, fresh, { ...options, currentOverview: structuredClone(fresh) }), null);
    assert.equal(workspaceBindingContinuationUrl(value, key, fresh, { ...options, now: 60_000 }), null);
    const bound = { ...fresh, context: { ...fresh.context, connect: { ...fresh.context.connect, code: 'connected' } } };
    assert.equal(workspaceBindingContinuationUrl(value, key, bound, { ...options, currentOverview: bound }), null);
    assert.equal(workspaceBindingContinuationIsCurrent({ ...value, authorization_url: null }, key, bound, { ...options, currentOverview: bound }), true);
    assert.equal(workspaceBindingContinuationUrl({ intent: { key, state: 'completed', result: { authorization_url: value.authorization_url } } }, key, fresh, options), null);
});

test('prebinding nonbinding activity recovery resolves the same lost-ACK attempt from state only without another submit', async () => {
    const local = storage(), key = 'original-activity-create', calls = [], source = overview();
    source.context.connect = { enabled: true, code: 'native_binding_required', label: 'ربط هذا الحساب بالمؤسسة' };
    source.connection.selection.activity = 'actual-created-activity';
    retainWorkspaceHold(local, context.native_reference, key);
    const readFresh = () => readWorkspaceOverview({ includeLists: true, now: () => 1_000, isCurrent: () => true,
        readOverview: async () => { calls.push('overview'); return source; },
        readCommands: async () => { throw new Error('No prebinding command reads'); }, readRequests: async () => { throw new Error('No prebinding request reads'); } });
    const observed = await observeWorkspaceEffect({ intentKey: key, isCurrent: () => true,
        dispatch: async () => { calls.push('submit-activity'); throw new Error('ACK lost after accepted activity creation'); },
        readIntent: async value => { calls.push(`initial-state:${value}`); throw Object.assign(new Error('Not observed yet'), { status: 404 }); }, readFresh });
    assert.equal(observed.intent, null);
    const recovered = await readWorkspaceSetupIntent({ intentKey: key, isCurrent: () => true,
        readBindingAuthorization: async value => { calls.push(`binding:${value}`); throw { status: 422, data: { error: { code: 'workspace_binding_authorization_not_applicable' } } }; },
        readIntent: async value => { calls.push(`state:${value}`); return { intent: { key: value, state: 'completed', authorization_url: 'https://untrusted.invalid/historical' } }; } });
    assert.deepEqual(recovered, { stale: false, authorization: null, intent: { key, state: 'completed' } });
    assert.equal(releaseWorkspaceHold(local, context.native_reference, recovered.intent, observed.overview, 1_000), true);
    assert.deepEqual(readWorkspaceHolds(local, context.native_reference).records, []);
    assert.deepEqual(calls, ['submit-activity', `initial-state:${key}`, 'overview', `binding:${key}`, `state:${key}`]);
});

test('prebinding recovery never treats pending binding, generic 422, 409 or 404 as nonbinding operation proof', async () => {
    let genericReads = 0;
    const readIntent = async () => { genericReads += 1; return { intent: { key: 'same-attempt', state: 'completed' } }; };
    const pending = { intent: { key: 'same-attempt', state: 'completed' }, binding_status: 'pending' };
    assert.deepEqual(await readWorkspaceSetupIntent({ intentKey: 'same-attempt', isCurrent: () => true, readIntent,
        readBindingAuthorization: async () => pending }), { stale: false, authorization: pending, intent: null });
    for (const error of [{ status: 422 }, { status: 422, code: 'workspace_binding_authorization_not_applicable' },
        { status: 422, data: { error: { code: 'workspace_request_invalid' } } },
        ...[404, 409, 403].map(status => ({ status, data: { error: { code: 'workspace_binding_authorization_not_applicable' } } }))]) {
        await assert.rejects(readWorkspaceSetupIntent({ intentKey: 'same-attempt', isCurrent: () => true, readIntent,
            readBindingAuthorization: async () => { throw error; } }), value => value === error);
    }
    assert.equal(genericReads, 0);
});

test('prebinding nonbinding recovery rejects foreign intent state and drops results when the current identity changes', async () => {
    const notApplicable = { status: 422, data: { error: { code: 'workspace_binding_authorization_not_applicable' } } };
    const readBindingAuthorization = async () => { throw notApplicable; };
    await assert.rejects(readWorkspaceSetupIntent({ intentKey: 'original-activity', isCurrent: () => true, readBindingAuthorization,
        readIntent: async () => ({ intent: { key: 'another-attempt', state: 'completed' } }) }), /Unverified original/);
    const unknown = await readWorkspaceSetupIntent({ intentKey: 'original-activity', isCurrent: () => true, readBindingAuthorization,
        readIntent: async () => ({ intent: { key: 'original-activity', state: 'unknown' } }) });
    assert.deepEqual(unknown, { stale: false, authorization: null, intent: null });
    let current = true, genericReads = 0;
    const beforeState = await readWorkspaceSetupIntent({ intentKey: 'original-activity', isCurrent: () => current,
        readBindingAuthorization: async () => { current = false; throw notApplicable; }, readIntent: async () => { genericReads += 1; } });
    assert.deepEqual(beforeState, { stale: true, authorization: null, intent: null }); assert.equal(genericReads, 0);
    current = true;
    const afterState = await readWorkspaceSetupIntent({ intentKey: 'original-activity', isCurrent: () => current, readBindingAuthorization,
        readIntent: async () => { current = false; return { intent: { key: 'original-activity', state: 'completed' } }; } });
    assert.deepEqual(afterState, { stale: true, authorization: null, intent: null });
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
