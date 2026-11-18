import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkspaceCapabilityGrantDraft, prepareWorkspaceCapabilityGrantReview, updateWorkspaceCapabilityGrantDraft, workspaceCapabilityGrantCanReview,
    workspaceCapabilityGrantChoicesChanged, workspaceCapabilityGrantDraftFromOptions, workspaceCapabilityGrantInput, workspaceCapabilityGrantOptionsIsCurrent, workspaceGrantExpiryInput } from './workspaceCapabilityGrantPresentation.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const context = { verified: true, viewKey: 'verified-current-view', valid_until: new Date(now + 300_000).toISOString() };
const descriptor = { activity: 'opaque-current-activity' };
const choice = (value, label, enabled = true) => ({ value, label, enabled });
const options = () => ({ viewKey: context.viewKey, valid_until: new Date(now + 60_000).toISOString(),
    choices: { people: [choice('opaque-person', 'سارة')], grants: [choice('opaque-current-grant', 'حساب المتجر · إدارة المنتجات')] },
    selection: { person: 'opaque-person', grant: 'opaque-current-grant' },
    editor: { fields: [choice('opaque-name', 'اسم المنتج'), choice('opaque-description', 'الوصف')],
        resources: [{ ...choice('opaque-current-resource', 'قهوة المتجر'), sourceAuthorityAvailable: true }, { ...choice('opaque-other-resource', 'منتج آخر'), sourceAuthorityAvailable: false }],
        actions: [choice('read', 'قراءة البيانات'), choice('request', 'تقديم طلب'), choice('execute', 'تنفيذ طلب معتمد')],
        policies: [choice('selected', 'الموارد المختارة فقط'), choice('new_only', 'موارد جديدة ينشئها هذا الشخص'), choice('activity', 'موارد النشاط المسموح بها')],
        currentSelection: { actions: ['read', 'request'], fields: ['opaque-name'], resources: ['opaque-current-resource'], resourcePolicy: 'selected', expiresAt: new Date(now + 3_600_000).toISOString(), assignSourceAuthority: false },
        currentSummary: [{ label: 'الشخص', value: 'سارة' }, { label: 'البيانات', value: 'اسم المنتج' }],
        sourceAuthority: { enabled: true, label: 'تعيين الحساب مرجعًا معتمدًا للموارد المختارة', reason: 'يتحقق المصدر من كل مورد قبل التعيين.', currentLabel: 'كتالوج المتجر' } } });
const ready = () => { const current = options(); return { context, descriptor, options: current, draft: workspaceCapabilityGrantDraftFromOptions(current), held: false, busy: false, now }; };

test('only current verified named grant choices qualify; role text or unknown/expired references never supply rights', () => {
    const current = ready();
    assert.equal(workspaceCapabilityGrantOptionsIsCurrent(current.options, context, now), true);
    assert.equal(workspaceCapabilityGrantCanReview(current), true);
    for (const change of [{ context: { ...context, verified: false, role: 'owner' } }, { context: { ...context, viewKey: 'new-context' } },
        { now: now + 60_000 }, { held: true }, { busy: true }, { descriptor: {} }, { draft: { ...current.draft, person: 'unlisted-person' } },
        { draft: { ...current.draft, grant: 'old-version-grant' } }, { draft: { ...current.draft, actions: ['grant-all'] } },
        { draft: { ...current.draft, fields: ['manual-field-id'] } }, { draft: { ...current.draft, resources: ['manual-resource-id'] } },
        { draft: { ...current.draft, expiresAt: '' } }, { draft: { ...current.draft, expiresAt: new Date(now).toISOString() } }]) {
        assert.equal(workspaceCapabilityGrantCanReview({ ...current, ...change }), false);
    }
    const malformed = options(); malformed.editor.actions.push(choice('admin', 'إدارة شاملة'));
    assert.equal(workspaceCapabilityGrantOptionsIsCurrent(malformed, context, now), false);
});

test('recorded rights are copied explicitly without inventing account, broad duration, action or source transfer defaults', () => {
    const current = options();
    const draft = workspaceCapabilityGrantDraftFromOptions(current);
    assert.deepEqual(draft.actions, ['read', 'request']); assert.deepEqual(draft.fields, ['opaque-name']);
    assert.notEqual(draft.actions, current.editor.currentSelection.actions); assert.equal(draft.assignSourceAuthority, false);
    assert.equal(new Date(draft.expiresAt).getTime(), Date.parse(current.editor.currentSelection.expiresAt));
    assert.equal(workspaceGrantExpiryInput('not-a-date'), '');
    assert.deepEqual(workspaceCapabilityGrantDraftFromOptions({ selection: { person: '', grant: '' }, editor: null }), emptyWorkspaceCapabilityGrantDraft());
    current.editor.currentSelection.expiresAt = '';
    assert.equal(workspaceCapabilityGrantDraftFromOptions(current).expiresAt, '');
    assert.equal(workspaceCapabilityGrantCanReview({ ...ready(), draft: workspaceCapabilityGrantDraftFromOptions(current) }), false);
});

test('changing person/account or resource policy discards dependent rights and explicit source-assignment intent', () => {
    const current = { ...ready().draft, assignSourceAuthority: true };
    assert.deepEqual(updateWorkspaceCapabilityGrantDraft(current, 'person', 'new-named-person'), { ...emptyWorkspaceCapabilityGrantDraft(), person: 'new-named-person' });
    assert.deepEqual(updateWorkspaceCapabilityGrantDraft(current, 'grant', 'new-grant'), { ...emptyWorkspaceCapabilityGrantDraft(), person: current.person, grant: 'new-grant' });
    assert.deepEqual(updateWorkspaceCapabilityGrantDraft(current, 'resourcePolicy', 'new_only').resources, []);
    assert.equal(updateWorkspaceCapabilityGrantDraft(current, 'resourcePolicy', 'new_only').assignSourceAuthority, false);
    assert.equal(updateWorkspaceCapabilityGrantDraft(current, 'resources', ['opaque-current-resource']).assignSourceAuthority, false);
    assert.equal(updateWorkspaceCapabilityGrantDraft(current, 'actions', ['read']).assignSourceAuthority, false);
});

test('explicit empty action/field/resource arrays prepare withdrawal without reselecting former or all rights', () => {
    const current = ready();
    const draft = { ...current.draft, actions: [], fields: [], resources: [], assignSourceAuthority: false };
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, draft }), true);
    const input = workspaceCapabilityGrantInput({ ...current, draft });
    assert.deepEqual(input.actions, []); assert.deepEqual(input.fields, []); assert.deepEqual(input.resources, []);
    assert.equal(input.resourcePolicy, 'selected'); assert.equal(input.assignSourceAuthority, false);
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, draft: { ...draft, actions: ['read'] } }), false);
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, draft: { ...draft, assignSourceAuthority: true } }), false);
    assert.deepEqual(Object.keys(input), ['activity', 'grant', 'person', 'actions', 'fields', 'resources', 'resourcePolicy', 'expiresAt', 'assignSourceAuthority']);
});

test('source authority requires every explicitly selected current resource to be eligible; ordinary rights remain independent', () => {
    const current = ready();
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, draft: { ...current.draft, assignSourceAuthority: true } }), true);
    const mixed = { ...current.draft, resources: ['opaque-current-resource', 'opaque-other-resource'] };
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, draft: mixed }), true);
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, draft: { ...mixed, assignSourceAuthority: true } }), false);
    const disabled = options(); disabled.editor.sourceAuthority.enabled = false;
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, options: disabled, draft: { ...current.draft, assignSourceAuthority: true } }), false);
    const unknown = options(); delete unknown.editor.resources[0].sourceAuthorityAvailable;
    assert.equal(workspaceCapabilityGrantOptionsIsCurrent(unknown, context, now), false);
    assert.equal(workspaceCapabilityGrantCanReview({ ...current, draft: { ...current.draft, resourcePolicy: 'activity', resources: [], assignSourceAuthority: true } }), false);
});

test('fresh-before-review detects withdrawn choices/current version and never submits a new review for stale form intent', async () => {
    const current = ready(), input = workspaceCapabilityGrantInput(current), calls = [];
    const withdrawn = options(); withdrawn.editor.fields[0].enabled = false;
    const result = await prepareWorkspaceCapabilityGrantReview({ input, context, now: () => now, isCurrent: () => true,
        readFresh: async () => { calls.push('fresh'); return withdrawn; }, requestReview: async () => { calls.push('review'); } });
    assert.deepEqual(calls, ['fresh']); assert.equal(result.changed, true);
    const nextVersion = options(); nextVersion.selection.grant = 'reissued-new-version'; nextVersion.choices.grants[0].value = 'reissued-new-version';
    assert.equal((await prepareWorkspaceCapabilityGrantReview({ input, context, now: () => now, isCurrent: () => true, readFresh: async () => nextVersion, requestReview: async () => { throw new Error('must-not-submit'); } })).changed, true);
    let fresh = true;
    const stale = await prepareWorkspaceCapabilityGrantReview({ input, context, now: () => now, isCurrent: () => fresh,
        readFresh: async () => { fresh = false; return options(); }, requestReview: async () => { throw new Error('must-not-submit'); } });
    assert.deepEqual(stale, { stale: true });
});

test('fresh compatible options submit the exact immutable intent once; lost reply never retries or changes the payload', async () => {
    const input = workspaceCapabilityGrantInput(ready()), calls = [];
    const result = await prepareWorkspaceCapabilityGrantReview({ input, context, now: () => now, isCurrent: () => true,
        readFresh: async () => { calls.push('fresh'); return options(); }, requestReview: async body => { calls.push(body); return { review: { key: 'sealed-review' } }; } });
    assert.deepEqual(calls, ['fresh', input]); assert.equal(result.result.review.key, 'sealed-review');
    let dispatched = 0;
    await assert.rejects(prepareWorkspaceCapabilityGrantReview({ input, context, now: () => now, isCurrent: () => true,
        readFresh: async () => options(), requestReview: async () => { dispatched += 1; throw new Error('transport loss'); } }), /transport loss/);
    assert.equal(dispatched, 1);
});

test('only exact pre-review stale-choice409 codes preserve a draft; auth and uncertain outcomes never gain that treatment', () => {
    for (const code of ['workspace_grant_choice_changed', 'workspace_choice_changed']) assert.equal(workspaceCapabilityGrantChoicesChanged({ status: 409, data: { error: { code } } }), true);
    for (const error of [{ status: 403, data: { error: { code: 'workspace_grant_choice_changed' } } },
        { status: 403, data: { error: { code: 'session_changed' } } }, { status: 409, data: { error: { code: 'workspace_unresolved_intent' } } },
        { status: 404 }, { status: 503 }, new Error('transport lost')]) assert.equal(Boolean(workspaceCapabilityGrantChoicesChanged(error)), false);
});
