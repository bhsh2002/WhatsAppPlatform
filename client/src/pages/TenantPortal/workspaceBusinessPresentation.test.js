import assert from 'node:assert/strict';
import test from 'node:test';
import { clearWorkspaceBusinessField, emptyWorkspaceBusinessDraft, updateWorkspaceBusinessDraft,
    workspaceBusinessOptionsIsCurrent, workspaceBusinessPageDraft, workspaceBusinessParameters, workspaceBusinessReviewedParameters } from './workspaceBusinessPresentation.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const option = (value, label, extra = {}) => ({ value, label, available: true, ...extra });
const expiry = new Date(now + 30_000).toISOString();
const options = { checked_at: new Date(now).toISOString(), valid_until: expiry, capability: 'customers.manage',
    accounts: [option('named-account', 'جهات اتصال المتجر')], contacts: [option('named-contact', 'سارة', { source_revision: 7 })], contacts_next_cursor: null,
    actions: ['contacts.create', 'contacts.change', 'contacts.remove', 'contacts.read'].map(value => option(value, 'عملية جهة الاتصال',
        { required_fields: [], availability: { state: 'review_available', message: 'متاح للمراجعة' } })),
    purposes: [{ value: 'customer_service', label: 'خدمة العميل' }], editable_fields: ['phone', 'profile_name', 'label', 'notes'],
    consent_evidence: [option('consent:019a98f7-0000-7000-8000-000000000000', 'موافقة استخدام بيانات السجل', { channel: 'native', account_ref: 'named-account',
        recipient_ref: 'named-contact', purpose: 'customer_service', source_label: 'سجل خدمة العميل', version: 2, revoked: false, expired: false, valid_until: expiry })],
    consent_management: { can_record: false, can_revoke: false } };
const draft = { ...emptyWorkspaceBusinessDraft(), action: 'contacts.change', account_ref: 'named-account', contact_ref: 'named-contact',
    purpose: 'customer_service', consent_ref: options.consent_evidence[0].value, evidence_reference: 'طلب خدمة العميل 25', label: 'عميل دائم', changedFields: ['label'] };
const input = { capability: 'customers.manage', draft, options, now };

test('typed customer change uses only current named contact revision and permitted intentional fields', () => {
    assert.equal(workspaceBusinessOptionsIsCurrent(options, 'customers.manage', now), true);
    const parameters = workspaceBusinessParameters({ ...input, draft: { ...draft, expected_revision: 999, organization_id: 'browser-org' } });
    assert.deepEqual(parameters, { channel: 'native', account_ref: 'named-account', purpose: 'customer_service', evidence_reference: 'طلب خدمة العميل 25',
        contact_ref: 'named-contact', consent_ref: options.consent_evidence[0].value, expected_revision: 7, label: 'عميل دائم' });
    assert.equal(parameters.organization_id, undefined);
    assert.equal(workspaceBusinessParameters({ ...input, draft: { ...draft, contact_ref: 'manual-private-id' } }), null);
});

test('explicit clearing is distinct from omitted and blank contact fields', () => {
    assert.equal(workspaceBusinessParameters({ ...input, draft: { ...draft, label: '' } }), null);
    const cleared = clearWorkspaceBusinessField(draft, 'label', true);
    assert.equal(workspaceBusinessParameters({ ...input, draft: cleared }).label, null);
    assert.equal(Object.hasOwn(workspaceBusinessParameters(input), 'notes'), false);
    assert.equal(workspaceBusinessParameters({ ...input, options: { ...options, editable_fields: ['notes'] } }), null);
    assert.equal(workspaceBusinessParameters({ ...input, draft: { ...draft, changedFields: ['phone'] } }), null);
});

test('contact creation normalizes ordinary phone digits without copying contact/version/consent authority', () => {
    const create = { ...emptyWorkspaceBusinessDraft(), action: 'contacts.create', account_ref: 'named-account', purpose: 'customer_service', evidence_reference: 'سجل عميل جديد',
        phone: '+٢١٨ (٩١) ١٢٣-٤٥٦٧', profile_name: 'سارة' };
    const parameters = workspaceBusinessParameters({ ...input, draft: create });
    assert.equal(parameters.phone, '218911234567'); assert.equal(parameters.profile_name, 'سارة');
    for (const field of ['contact_ref', 'consent_ref', 'expected_revision', 'notes']) assert.equal(Object.hasOwn(parameters, field), false);
    assert.equal(workspaceBusinessParameters({ ...input, draft: { ...create, phone: 'not a phone 1234567' } }), null);
    assert.equal(workspaceBusinessParameters({ ...input, options: { ...options, editable_fields: [] }, draft: create }), null);
});

test('revoked, expired, other-contact and other-purpose evidence never qualifies a customer data request', () => {
    for (const change of [{ revoked: true }, { expired: true }, { recipient_ref: 'other-contact' }, { purpose: 'correction' },
        { account_ref: 'other-account' }, { valid_until: new Date(now).toISOString() }, { available: false }]) {
        assert.equal(workspaceBusinessParameters({ ...input, options: { ...options, consent_evidence: [{ ...options.consent_evidence[0], ...change }] } }), null);
    }
    assert.equal(workspaceBusinessParameters({ ...input, draft: { ...draft, consent_ref: 'checkbox-confirmed' } }), null);
});

test('changed target/search clears earlier review inputs and evidence without inventing a recipient or source version', () => {
    const changed = updateWorkspaceBusinessDraft(draft, 'contact_ref', 'new-named-contact');
    assert.equal(changed.consent_ref, ''); assert.equal(changed.evidence_reference, ''); assert.deepEqual(changed.changedFields, []);
    const page = workspaceBusinessPageDraft(draft);
    assert.equal(page.contact_ref, ''); assert.equal(page.consent_ref, ''); assert.deepEqual(page.changedFields, []);
    assert.equal(workspaceBusinessParameters({ ...input, draft: page }), null);
    assert.equal(updateWorkspaceBusinessDraft(draft, 'actor_id', 'invented'), draft);
});

test('measurement and owner-operation forms use current source action/account/purpose choices only', () => {
    for (const [capability, action] of [['measurement.read', 'measurement.summary'], ['measurement.export', 'measurement.export'], ['owner.operations', 'owner.operation_status']]) {
        const current = { ...options, capability, contacts: [], consent_evidence: [], editable_fields: [],
            accounts: [option('named-native-data', 'بيانات النشاط')], actions: [option(action, 'عرض بيانات النشاط', { required_fields: [], availability: { state: 'review_available', message: 'متاح للمراجعة' } })],
            operations: [option('named-operation', 'طلب المتجر اليوم')] };
        const values = { ...emptyWorkspaceBusinessDraft(), action, account_ref: 'named-native-data', purpose: 'customer_service', evidence_reference: 'متابعة النشاط', command_ref: 'named-operation' };
        const parameters = workspaceBusinessParameters({ capability, draft: values, options: current, now });
        assert.equal(parameters.channel, 'native'); assert.equal(parameters.account_ref, 'named-native-data');
        assert.equal(Object.hasOwn(parameters, 'command_ref'), capability === 'owner.operations');
        assert.equal(Object.hasOwn(parameters, 'expected_revision'), false);
        assert.equal(workspaceBusinessParameters({ capability, draft: values, options: { ...current, actions: [] }, now }), null);
    }
});

test('only current source-verified preview fields can enter a sealed native action review', () => {
    const context = { valid_until: new Date(now + 300_000).toISOString() };
    const preview = { checked_at: new Date(now).toISOString(), valid_until: expiry, normalized_parameters: workspaceBusinessParameters(input),
        resource_fingerprint: 'a'.repeat(64), quote: { total_credits: 0, within_budget: true, currency_label: 'عملية محلية' },
        availability: { state: 'review_available', message: 'راجع الطلب' }, summary: [{ label: 'جهة الاتصال', value: 'سارة' }] };
    assert.equal(workspaceBusinessReviewedParameters('customers.manage', 'contacts.change', preview, context, now).resource_fingerprint, 'a'.repeat(64));
    for (const change of [{ resource_fingerprint: null }, { availability: { state: 'consent_required', message: 'يلزم دليل' } },
        { quote: { total_credits: 0, within_budget: false, currency_label: 'عملية محلية' } }, { summary: [] },
        { normalized_parameters: { ...preview.normalized_parameters, actor_id: 'browser' } }]) {
        assert.equal(workspaceBusinessReviewedParameters('customers.manage', 'contacts.change', { ...preview, ...change }, context, now), null);
    }
    assert.equal(workspaceBusinessReviewedParameters('customers.manage', 'contacts.change', preview, context, now + 30_000), null);
});
