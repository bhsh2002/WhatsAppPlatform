import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkspaceSelection, updateWorkspaceSelection, workspaceActionAvailable, workspaceAvailabilityLabel, workspaceChoiceAvailable, workspaceConnectionReviewCanSubmit, workspaceLabel, workspaceProductReceptionInput, workspaceSelectionCanReview, workspaceSelectionKey, workspaceSelectionSummary } from './connectionsDataPresentation.js';

const choice = (value, label, enabled = true) => ({ value, label, enabled });
const choices = {
    activities: [choice('activity-private', 'متجر المدينة')],
    purposes: [choice('purpose-private', 'تصفح المنتجات المشتركة')],
    providers: [choice('provider-private', 'كتالوج متجر المدينة')],
    fields: [choice('field-name', 'اسم المنتج'), choice('field-price', 'السعر المعتمد')],
    people: [choice('person-owner', 'سارة'), choice('person-team', 'فريق المتجر')],
};
const selection = { activity: 'activity-private', purpose: 'purpose-private', provider: 'provider-private',
    fields: ['field-name', 'field-price'], people: ['person-owner', 'person-team'] };
const ready = { selection, choices, verified: true, held: false, busy: false };

test('the owner can review only a complete current selection from supplied available choices', () => {
    assert.equal(workspaceSelectionCanReview(ready), true);
    assert.equal(workspaceSelectionCanReview({ ...ready, selection: emptyWorkspaceSelection() }), false);
    for (const field of ['activity', 'purpose', 'provider', 'fields', 'people']) {
        assert.equal(workspaceSelectionCanReview({ ...ready, selection: { ...selection, [field]: Array.isArray(selection[field]) ? [] : '' } }), false);
    }
    assert.equal(workspaceSelectionCanReview({ ...ready, selection: { ...selection, provider: 'unlisted-provider' } }), false);
    assert.equal(workspaceSelectionCanReview({ ...ready, selection: { ...selection, people: ['person-owner', 'person-owner'] } }), false);
    assert.equal(workspaceSelectionCanReview({ selection, choices }), false);
});

test('changing activity, purpose or provider clears dependent choices before another review', () => {
    const original = structuredClone(selection);
    assert.deepEqual(updateWorkspaceSelection(selection, 'activity', 'activity-other'), {
        activity: 'activity-other', purpose: '', provider: '', fields: [], people: [],
    });
    assert.deepEqual(updateWorkspaceSelection(selection, 'purpose', 'purpose-other'), {
        activity: selection.activity, purpose: 'purpose-other', provider: '', fields: [], people: [],
    });
    assert.deepEqual(updateWorkspaceSelection(selection, 'provider', 'provider-other'), {
        activity: selection.activity, purpose: selection.purpose, provider: 'provider-other', fields: [], people: [],
    });
    assert.deepEqual(selection, original);
});

test('lost context, unresolved outcomes and changed permission choices prevent resubmission', () => {
    assert.equal(workspaceSelectionCanReview({ ...ready, verified: false }), false);
    assert.equal(workspaceSelectionCanReview({ ...ready, held: true }), false);
    assert.equal(workspaceSelectionCanReview({ ...ready, busy: true }), false);
    const withdrawn = { ...choices, fields: [choice('field-name', 'اسم المنتج'), choice('field-price', 'السعر المعتمد', false)] };
    assert.equal(workspaceSelectionCanReview({ ...ready, choices: withdrawn }), false);
    const corrected = updateWorkspaceSelection(selection, 'fields', ['field-name']);
    assert.equal(workspaceSelectionCanReview({ ...ready, choices: withdrawn, selection: corrected }), true);
    assert.equal(workspaceSelectionCanReview({ ...ready, choices: { ...choices, people: [] } }), false);
});

test('review summaries show human names and never substitute private references for missing labels', () => {
    const summary = workspaceSelectionSummary(selection, choices);
    const serialized = JSON.stringify(summary);
    for (const value of ['متجر المدينة', 'تصفح المنتجات المشتركة', 'كتالوج متجر المدينة', 'السعر المعتمد', 'سارة']) assert.ok(serialized.includes(value));
    for (const value of [selection.activity, selection.purpose, selection.provider, ...selection.fields, ...selection.people]) assert.equal(serialized.includes(value), false);
    const unavailable = workspaceSelectionSummary({ ...selection, provider: 'unlisted-private-reference' }, choices);
    assert.equal(JSON.stringify(unavailable).includes('unlisted-private-reference'), false);
    assert.equal(unavailable[2].value, 'الاسم غير متاح');
});

test('technical labels and choices without explicit availability cannot become owner choices', () => {
    const uuid = '019a98f7-0000-7000-8000-000000000000';
    assert.equal(workspaceLabel(uuid, 'نشاط غير مسمى'), 'نشاط غير مسمى');
    assert.equal(workspaceLabel('a'.repeat(64), 'اسم غير متاح'), 'اسم غير متاح');
    assert.equal(workspaceChoiceAvailable(choice(uuid, undefined)), false);
    assert.equal(workspaceChoiceAvailable({ value: 'account', label: 'حساب المتجر' }), false);
    assert.equal(workspaceChoiceAvailable(choice(uuid, 'حساب المتجر')), true);
});

test('capability actions require explicit current availability; a title or subscription text adds no permission', () => {
    const action = { key: 'create-private', label: 'إضافة منتج', enabled: true };
    assert.equal(workspaceActionAvailable(action, { verified: true, held: false }), true);
    assert.equal(workspaceActionAvailable({ ...action, enabled: undefined }, { verified: true, held: false }), false);
    assert.equal(workspaceActionAvailable({ ...action, label: 'الاشتراك يشمل الإضافة', enabled: false }, { verified: true, held: false }), false);
    assert.equal(workspaceActionAvailable(action, { verified: false, held: false }), false);
    assert.equal(workspaceActionAvailable(action, { verified: true, held: true }), false);
    assert.equal(workspaceActionAvailable({ ...action, effect: 'read' }, { verified: true, held: true }), true);
    assert.equal(workspaceActionAvailable({ ...action, effect: 'read', enabled: false }, { verified: true, held: true }), false);
});

test('product reception uses the server-owned account without a read-sharing selection or browser scopes', () => {
    const action = { key: 'provider.products.prepare', provider: 'opaque-own-provider', label: 'تهيئة استقبال المنتجات', enabled: true,
        scopes: ['*'], activity_id: 'injected', read_grant: true };
    const state = { verified: true, held: false, busy: false, selection: emptyWorkspaceSelection() };
    assert.deepEqual(workspaceProductReceptionInput(action, state), { provider: 'opaque-own-provider' });
    assert.equal(workspaceProductReceptionInput({ ...action, provider: undefined }, state), null);
    assert.equal(workspaceProductReceptionInput({ ...action, key: 'provider.prepare' }, state), null);
    for (const blocked of [{ held: true }, { busy: true }, { verified: false }]) {
        assert.equal(workspaceProductReceptionInput({ ...action, effect: 'read' }, { ...state, ...blocked }), null);
    }
    const done = { ...action, label: 'استقبال المنتجات مهيأ', enabled: false,
        reason: 'اطلب مشاركة القراءة بصورة مستقلة.' };
    assert.equal(workspaceProductReceptionInput(done, state), null);
    assert.equal(workspaceProductReceptionInput({ ...action, enabled: undefined }, state), null);
});

test('canonical review availability is distinct from execution and unknown vocabulary stays unverified', () => {
    assert.equal(workspaceAvailabilityLabel('available', 'en'), 'Available to execute');
    assert.equal(workspaceAvailabilityLabel('review_available', 'en'), 'Available to request review');
    assert.equal(workspaceAvailabilityLabel('subscription_required', 'en'), 'Subscription required');
    assert.equal(workspaceAvailabilityLabel('invented-ready', 'en'), 'State unverified');
    assert.equal(workspaceActionAvailable({ key: 'execute', label: 'Execute', availability: { state: 'available' } }, { verified: true, held: false }), false);
});

test('an immutable review cannot be submitted with a newer selection or missing human summary', () => {
    const context = { ...ready, viewKey: 'current-view', now: 1_000 };
    const review = { key: 'opaque-server-review', canSubmit: true, viewKey: 'current-view', valid_until: new Date(60_000).toISOString(), selectionKey: workspaceSelectionKey(selection), summary: workspaceSelectionSummary(selection, choices) };
    assert.equal(workspaceConnectionReviewCanSubmit({ ...context, review }), true);
    assert.equal(workspaceConnectionReviewCanSubmit({ ...context, review, selection: { ...selection, fields: ['field-name'] } }), false);
    assert.equal(workspaceConnectionReviewCanSubmit({ ...context, review: { ...review, summary: [] } }), false);
    assert.equal(workspaceConnectionReviewCanSubmit({ ...context, review: { ...review, canSubmit: false } }), false);
    assert.equal(workspaceConnectionReviewCanSubmit({ ...context, review, held: true }), false);
    assert.equal(workspaceConnectionReviewCanSubmit({ ...context, review, viewKey: 'another-view' }), false);
    assert.equal(workspaceConnectionReviewCanSubmit({ ...context, review, now: 60_000 }), false);
});

test('only explicit server requirements can allow registration without sharing fields or granting people access', () => {
    const registration = { ...selection, fields: [], people: [] };
    const current = { ...ready, selection: registration, choices: { ...choices, fields: [], people: [] } };
    assert.equal(workspaceSelectionCanReview(current), false);
    assert.equal(workspaceSelectionCanReview({ ...current, requirements: { fields: false, people: false } }), true);
    assert.equal(workspaceSelectionCanReview({ ...current, requirements: { fields: false, people: true } }), false);
    assert.equal(workspaceSelectionCanReview({ ...current, requirements: { fields: false, people: false }, selection: { ...registration, people: ['unlisted-person'] } }), false);
    assert.equal(workspaceSelectionCanReview({ ...current, requirements: { fields: false, people: false }, held: true }), false);
});
