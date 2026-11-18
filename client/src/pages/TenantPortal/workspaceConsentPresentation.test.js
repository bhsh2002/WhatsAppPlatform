import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkspaceConsentDraft, workspaceConsentChoices, workspaceConsentPayload, workspaceConsentRecordMatches,
    workspaceConsentLookupIsConfirmed, workspaceConsentWasRevoked, saveWorkspaceConsentHint, readWorkspaceConsentHint, clearWorkspaceConsentHint } from './workspaceConsentPresentation.js';
import { savanaConsentMethods } from '../../api/savanaConsents.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const context = { verified: true, native_reference: 'source-owner-partition', valid_until: new Date(now + 300_000).toISOString() };
const descriptor = { activity: 'opaque-current-activity-choice' };
const nativeDraft = { channel: 'sms', account_ref: 'source-account-choice' };
const options = { valid_until: new Date(now + 30_000).toISOString(), accounts: [{ value: nativeDraft.account_ref, channel: 'sms', label: 'الحساب المعتمد', available: true }],
    recipients: [{ value: 'source-recipient-choice', label: 'عميل تجريبي', available: true }], purposes: [{ value: 'marketing', label: 'إشعارات تسويقية' }], consent_evidence: [],
    consent_management: { can_record: true, can_revoke: true } };
const draft = { ...emptyWorkspaceConsentDraft(), recipient_ref: 'source-recipient-choice', purpose: 'marketing', evidence_kind: 'owner_recorded',
    reference: 'نموذج اشتراك العميل في سجل النشاط', note: 'أعطى العميل موافقة موثقة لاستقبال الرسائل التسويقية ضمن هذا الغرض.', recorded_at: new Date(now - 60_000).toISOString(), valid_until: new Date(now + 86_400_000).toISOString() };
const input = overrides => ({ descriptor, context, options, nativeDraft, draft, idempotencyKey: 'same-original-operation', now, ...overrides });
const record = payload => ({ value: 'consent:11111111-1111-4111-8111-111111111111', version: 1, channel: payload.channel, account_ref: payload.account_ref,
    recipient_ref: payload.recipient_ref, purpose: payload.purpose, evidence_kind: payload.evidence.kind, valid_until: payload.valid_until, revoked: false, expired: false });

test('reviewed consent evidence is exact, immutable and contains neither actor authority nor a checkbox-derived signature', () => {
    const payload = workspaceConsentPayload(input()); assert.ok(payload); assert.ok(Object.isFrozen(payload)); assert.ok(Object.isFrozen(payload.evidence));
    assert.equal(payload.idempotency_key, 'same-original-operation'); assert.equal(payload.evidence.kind, 'owner_recorded');
    assert.deepEqual(Object.keys(payload).sort(), ['account_ref', 'activity_ref', 'channel', 'evidence', 'idempotency_key', 'purpose', 'recipient_ref', 'valid_until']);
    assert.equal(workspaceConsentPayload(input({ draft: { ...draft, reference: '', note: 'agreed' } })), null);
    assert.equal(workspaceConsentPayload(input({ draft: { ...draft, evidence_kind: 'checkbox' } })), null);
    assert.equal(workspaceConsentPayload(input({ draft: { ...draft, recorded_at: new Date(now + 1).toISOString() } })), null);
});
test('stale, withdrawn, foreign recipient/account or missing consent management proof cannot create a payload', () => {
    for (const overrides of [{ context: { ...context, verified: false } }, { options: { ...options, consent_management: { can_record: false } } },
        { options: { ...options, valid_until: new Date(now).toISOString() } }, { nativeDraft: { ...nativeDraft, account_ref: 'foreign-account' } },
        { draft: { ...draft, recipient_ref: 'foreign-person' } }, { draft: { ...draft, valid_until: new Date(now).toISOString() } }]) assert.equal(workspaceConsentPayload(input(overrides)), null);
    assert.equal(workspaceConsentChoices({ options, nativeDraft, draft, now }).recipient.label, 'عميل تجريبي');
});
test('current inbound service evidence is restricted to actual WhatsApp service-response selection', () => {
    assert.equal(workspaceConsentPayload(input({ draft: { ...draft, evidence_kind: 'native_inbound' } })), null);
    const wa = { channel: 'whatsapp', account_ref: nativeDraft.account_ref };
    const result = workspaceConsentPayload(input({ nativeDraft: wa, options: { ...options, accounts: [{ ...options.accounts[0], channel: 'whatsapp' }], purposes: [{ value: 'service_response', label: 'طلب خدمة' }] },
        draft: { ...draft, purpose: 'service_response', evidence_kind: 'native_inbound' } }));
    assert.deepEqual(result.evidence, { kind: 'native_inbound' });
});

test('native CRM consent uses only actual named native-contact choices and source-listed business purposes', () => {
    const native = { channel: 'native', account_ref: 'native_contacts' };
    const businessOptions = { ...options, accounts: [{ value: 'native_contacts', label: 'جهات الاتصال الأصلية', available: true }],
        contacts: options.recipients, recipients: undefined, purposes: [{ value: 'customer_service', label: 'خدمة العميل' }] };
    const payload = workspaceConsentPayload(input({ nativeDraft: native, options: businessOptions, draft: { ...draft, purpose: 'customer_service' } }));
    assert.equal(payload.channel, 'native'); assert.equal(payload.account_ref, 'native_contacts');
    assert.equal(payload.purpose, 'customer_service');
    assert.equal(workspaceConsentPayload(input({ nativeDraft: native, options: businessOptions, draft: { ...draft, purpose: 'marketing' } })), null);
    assert.equal(workspaceConsentPayload(input({ nativeDraft: { ...native, account_ref: 'native_messages' }, options: businessOptions })), null);
});
test('a foreign receipt or unmatched original lookup cannot confirm the record or clear its pending identity', () => {
    const payload = workspaceConsentPayload(input()); const accepted = record(payload);
    assert.equal(workspaceConsentRecordMatches(accepted, payload), true);
    for (const changed of [{ recipient_ref: 'foreign' }, { purpose: 'transactional' }, { evidence_kind: 'signed_source' }, { version: 0 }]) assert.equal(workspaceConsentRecordMatches({ ...accepted, ...changed }, payload), false);
    assert.equal(workspaceConsentLookupIsConfirmed({ record: accepted, operation_key: payload.idempotency_key }, payload.idempotency_key), true);
    assert.equal(workspaceConsentLookupIsConfirmed({ record: accepted, operation_key: 'another-key' }, payload.idempotency_key), false);
    assert.equal(workspaceConsentWasRevoked({ ...accepted, revoked: true, version: 1 }, accepted), false);
    assert.equal(workspaceConsentWasRevoked({ ...accepted, revoked: true, version: 2 }, accepted), true);
});
test('recovery storage retains only the original opaque operation key; unavailable storage never substitutes evidence', () => {
    const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    assert.equal(saveWorkspaceConsentHint(storage, context.native_reference, 'same-original-operation'), true);
    assert.equal(readWorkspaceConsentHint(storage, context.native_reference), 'same-original-operation');
    assert.equal([...values.values()].some(value => value.includes(draft.reference) || value.includes(draft.note) || value.includes(draft.recipient_ref)), false);
    assert.equal(clearWorkspaceConsentHint(storage, context.native_reference, 'different-attempt'), false);
    assert.equal(clearWorkspaceConsentHint(storage, context.native_reference, 'same-original-operation'), true);
    assert.equal(saveWorkspaceConsentHint(null, context.native_reference, 'same-original-operation'), false);
});
test('normal consent API sends exact original selection/key and uses GET alone for recovery', async () => {
    const calls = []; const service = { request: async (...args) => { calls.push(args); return {}; }, ...savanaConsentMethods };
    const payload = workspaceConsentPayload(input()); await service.createPortalConsentRecord(payload);
    await service.lookupPortalConsentRecord({ activity_ref: descriptor.activity, idempotency_key: payload.idempotency_key });
    assert.equal(calls.length, 2); assert.equal(calls[0][1].method, 'POST'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
    assert.equal(calls[1][1], undefined); assert.match(calls[1][0], /consents\/lookup\?/);
    await assert.rejects(service.createPortalConsentRecord({ ...payload, actor_id: 'forged' }));
    await assert.rejects(service.createPortalConsentRecord({ ...payload, evidence: { ...payload.evidence, verified: true } }));
    assert.equal(calls.length, 2);
});
