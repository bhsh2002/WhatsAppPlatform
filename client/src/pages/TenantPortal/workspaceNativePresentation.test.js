import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkspaceNativeDraft, updateWorkspaceNativeDraft, workspaceNativeConsentChoices, workspaceNativeDraftErrors, workspaceNativeParameters, workspaceNativePreviewIsCurrent, workspaceNativeRecipientPageDraft, workspaceNativeReviewedParameters } from './workspaceNativePresentation.js';

const now = 10_000;
const future = new Date(30_000).toISOString();
const option = (value, label, more = {}) => ({ value, label, available: true, ...more });
const options = { checked_at: new Date(1_000).toISOString(), valid_until: future,
    channels: [option('sms', 'رسالة قصيرة'), option('whatsapp', 'واتساب'), option('facebook', 'فيسبوك')],
    accounts: [option('account-sms', 'حساب الرسائل', { channel: 'sms' }), option('account-wa', 'حساب واتساب', { channel: 'whatsapp' }), option('account-fb', 'صفحة المتجر', { channel: 'facebook' })],
    recipients: [option('person-sara', 'سارة', { purposes: [{ value: 'service_response', label: 'الرد على طلب الشخص', consent_ref: 'evidence-one', consent_version: 2, valid_until: future }] })],
    purposes: [{ value: 'service_response', label: 'الرد على طلب الشخص' }, { value: 'marketing', label: 'تسويق' }],
    consent_evidence: [option('evidence-one', 'طلب خدمة مسجل', { version: 2, source_label: 'محادثة الشخص الحالية', recorded_at: new Date(1_000).toISOString(), valid_until: future, revoked: false, expired: false })],
    templates: [option('template-one', 'تحديث الطلب', { fields: [{ key: 'customer', label: 'اسم الشخص' }, { key: 'status', label: 'الحالة' }] })],
    contents: [option('content-one', 'إعلان المتجر المعتمد')],
};
const draft = { ...emptyWorkspaceNativeDraft(), channel: 'sms', account_ref: 'account-sms', recipient_ref: 'person-sara', consent_ref: 'evidence-one', purpose: 'service_response', message: 'وصل طلبك.', max_cost_credits: '5' };
const input = { action: 'messaging.send', options, draft, now };

test('message parameters use current named resources and explicit evidence without authority fields', () => {
    assert.deepEqual(workspaceNativeDraftErrors(input), {});
    assert.deepEqual(workspaceNativeParameters(input), { channel: 'sms', account_ref: 'account-sms', recipient_ref: 'person-sara', purpose: 'service_response', consent_ref: 'evidence-one', message: 'وصل طلبك.', max_cost_credits: 5 });
    assert.ok(workspaceNativeDraftErrors({ ...input, draft: { ...draft, consent_ref: '', confirmed: true } }).consent_ref);
    assert.ok(workspaceNativeDraftErrors({ ...input, draft: { ...draft, recipient_ref: '+218000000000' } }).recipient_ref);
});

test('revoked, expired or changed-version evidence cannot authorize another purpose', () => {
    for (const change of [{ revoked: true }, { expired: true }, { version: 3 }, { valid_until: new Date(now).toISOString() }, { source_label: null }]) {
        const changed = { ...options, consent_evidence: options.consent_evidence.map(item => ({ ...item, ...change })) };
        assert.equal(workspaceNativeConsentChoices(changed, draft.recipient_ref, draft.purpose, now)[0].enabled, false);
        assert.ok(Object.keys(workspaceNativeDraftErrors({ ...input, options: changed })).length > 0);
        assert.equal(workspaceNativeParameters({ ...input, options: changed }), null);
    }
    assert.deepEqual(workspaceNativeConsentChoices(options, draft.recipient_ref, 'marketing', now), []);
    assert.ok(workspaceNativeDraftErrors({ ...input, draft: { ...draft, purpose: 'marketing' } }).consent_ref);
});

test('campaign selection requires separate current consent for each person and never auto-selects it', () => {
    const campaign = { ...draft, channel: 'whatsapp', account_ref: 'account-wa', message: '', recipients: [{ recipient_ref: 'person-sara', consent_ref: '' }], template_ref: 'template-one', template_values: { status: 'جاهز', customer: 'سارة' } };
    assert.ok(workspaceNativeDraftErrors({ ...input, action: 'campaigns.execute', draft: campaign }).recipients);
    campaign.recipients[0].consent_ref = 'evidence-one';
    const parameters = workspaceNativeParameters({ ...input, action: 'campaigns.execute', draft: campaign });
    assert.deepEqual(parameters.template_values, ['سارة', 'جاهز']);
    assert.deepEqual(parameters.recipients, [{ recipient_ref: 'person-sara', consent_ref: 'evidence-one' }]);
    assert.ok(workspaceNativeDraftErrors({ ...input, action: 'campaigns.execute', draft: { ...campaign, recipients: [...campaign.recipients, ...campaign.recipients] } }).recipients);
    assert.deepEqual(updateWorkspaceNativeDraft(campaign, 'purpose', 'marketing').recipients, [{ recipient_ref: 'person-sara', consent_ref: '' }]);
});

test('approved template fields are ordinary ordered text and cannot mix with free-form message text', () => {
    const templated = { ...draft, message: '', template_ref: 'template-one', template_values: { status: 'جاهز', customer: 'سارة', browser_injected: 'ignored' } };
    assert.deepEqual(workspaceNativeParameters({ ...input, draft: templated }).template_values, ['سارة', 'جاهز']);
    assert.ok(workspaceNativeDraftErrors({ ...input, draft: { ...templated, template_values: { customer: 'سارة' } } }).template_ref);
    assert.ok(workspaceNativeDraftErrors({ ...input, draft: { ...templated, message: 'نص آخر' } }).message);
    assert.equal(updateWorkspaceNativeDraft(templated, 'message', 'نص جديد').template_ref, '');
});

test('integer budgets, account/channel binding and approved library choices are enforced before preview', () => {
    for (const value of ['-1', '1.5', '1e3', '01', '9007199254740992', 5]) assert.ok(workspaceNativeDraftErrors({ ...input, draft: { ...draft, max_cost_credits: value } }).max_cost_credits);
    assert.equal(workspaceNativeParameters({ ...input, draft: { ...draft, max_cost_credits: '٥' } }).max_cost_credits, 5);
    assert.ok(workspaceNativeDraftErrors({ ...input, draft: { ...draft, account_ref: 'account-wa' } }).account_ref);
    const content = { ...emptyWorkspaceNativeDraft(), channel: 'facebook', account_ref: 'account-fb', content_ref: 'content-one', max_cost_credits: '0' };
    assert.deepEqual(workspaceNativeParameters({ ...input, action: 'content.publish', draft: content }), { channel: 'facebook', account_ref: 'account-fb', content_ref: 'content-one', max_cost_credits: 0 });
    assert.equal(workspaceNativeParameters({ ...input, action: 'content.publish', draft: { ...content, content_ref: 'manual-url-or-id' } }), null);
    assert.deepEqual(updateWorkspaceNativeDraft(draft, 'channel', 'whatsapp'), { ...emptyWorkspaceNativeDraft(), channel: 'whatsapp' });
    assert.ok(workspaceNativeDraftErrors({ ...input, now: 30_000 }).form);
});

test('only a bounded current preview within budget can supply allowlisted reviewed native parameters', () => {
    const context = { valid_until: new Date(60_000).toISOString() };
    const preview = { checked_at: new Date(1_000).toISOString(), valid_until: future, normalized_parameters: workspaceNativeParameters(input),
        resource_fingerprint: 'a'.repeat(64), quote: { total_credits: 2, within_budget: true, currency_label: 'رصيد' }, availability: { state: 'review_available', message: 'متاح لطلب المراجعة.' } };
    assert.equal(workspaceNativeReviewedParameters(input.action, preview, context, now).resource_fingerprint, 'a'.repeat(64));
    assert.equal(workspaceNativeReviewedParameters(input.action, preview, context, 30_000), null);
    assert.equal(workspaceNativeReviewedParameters(input.action, { ...preview, quote: { ...preview.quote, within_budget: false } }, context, now), null);
    assert.equal(workspaceNativeReviewedParameters(input.action, { ...preview, availability: { state: 'consent_required', message: 'يلزم دليل.' } }, context, now), null);
    assert.equal(workspaceNativeReviewedParameters(input.action, { ...preview, normalized_parameters: { ...preview.normalized_parameters, actor_id: 'browser' } }, context, now), null);
    assert.equal(workspaceNativeReviewedParameters(input.action, { ...preview, resource_fingerprint: 'browser-assertion' }, context, now), null);
    const missingQuote = { ...preview, resource_fingerprint: null, quote: { total_credits: null, within_budget: null, currency_label: 'رصيد' }, availability: { state: 'quote_required', message: 'يلزم عرض تكلفة حالي.' } };
    assert.equal(workspaceNativePreviewIsCurrent(missingQuote, context, now), true);
    assert.equal(workspaceNativeReviewedParameters(input.action, missingQuote, context, now), null);
});

test('changing a recipient search page cannot retain people or consent evidence not revalidated on that page', () => {
    const before = { ...draft, recipients: [{ recipient_ref: 'person-other-page', consent_ref: 'old-evidence' }] };
    const next = workspaceNativeRecipientPageDraft(before);
    assert.equal(next.recipient_ref, ''); assert.equal(next.consent_ref, ''); assert.deepEqual(next.recipients, []);
    assert.equal(next.account_ref, draft.account_ref); assert.equal(next.message, draft.message); assert.equal(next.max_cost_credits, draft.max_cost_credits);
    assert.equal(workspaceNativeParameters({ ...input, draft: next }), null);
    assert.equal(before.recipients.length, 1);
});

test('review capabilities reuse typed source inputs without changing the requested capability into execution authority', () => {
    assert.deepEqual(workspaceNativeParameters({ ...input, action: 'messaging.review' }), workspaceNativeParameters(input));
    const parameters = workspaceNativeParameters({ ...input, action: 'messaging.review' });
    assert.equal(Object.hasOwn(parameters, 'execution_authorized'), false);
    assert.equal(Object.hasOwn(parameters, 'capability_grant'), false);
    assert.equal(workspaceNativeParameters({ ...input, action: 'unregistered.review' }), null);
});
