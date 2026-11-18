import { workspaceLabel } from './connectionsDataPresentation.js';
import { canonicalWorkspaceDecimal } from './workspaceProductPresentation.js';

const nativeInputActions = { 'messaging.send': 'messaging.send', 'campaigns.execute': 'campaigns.execute', 'content.publish': 'content.publish',
    'messaging.review': 'messaging.send', 'campaigns.review': 'campaigns.execute', 'content.review': 'content.publish' };
export const NATIVE_WORKSPACE_ACTIONS = Object.keys(nativeInputActions);
export const workspaceNativeInputAction = action => nativeInputActions[action] || null;
const named = value => Boolean(workspaceLabel(value, null));
const available = option => Boolean(option && typeof option.value === 'string' && option.value && named(option.label) && option.available === true);
const selected = (options, value) => options?.find(option => option.value === value);
const unique = values => new Set(values).size === values.length;
const optionalText = value => value === undefined || value === null || typeof value === 'string';

export const emptyWorkspaceNativeDraft = () => ({ channel: '', account_ref: '', recipient_ref: '', consent_ref: '', purpose: '', recipients: [],
    message: '', template_ref: '', template_values: {}, content_ref: '', max_cost_credits: '' });

// A different search page carries no fresh proof for absent people/evidence.
export const workspaceNativeRecipientPageDraft = draft => ({ ...draft, recipient_ref: '', consent_ref: '', recipients: [] });

export const updateWorkspaceNativeDraft = (draft, key, value) => {
    if (!Object.hasOwn(emptyWorkspaceNativeDraft(), key)) return draft;
    if (key === 'channel') return { ...emptyWorkspaceNativeDraft(), channel: value };
    if (key === 'account_ref') return { ...emptyWorkspaceNativeDraft(), channel: draft.channel, account_ref: value };
    if (key === 'recipient_ref') return { ...draft, recipient_ref: value, consent_ref: '', purpose: '' };
    if (key === 'purpose') return { ...draft, purpose: value, consent_ref: '', recipients: draft.recipients.map(item => ({ ...item, consent_ref: '' })) };
    if (key === 'template_ref') return { ...draft, template_ref: value, template_values: {}, message: value ? '' : draft.message };
    if (key === 'message') return { ...draft, message: value, template_ref: value ? '' : draft.template_ref, template_values: value ? {} : draft.template_values };
    return { ...draft, [key]: value };
};

export const workspaceNativeConsentChoices = (options, recipientRef, purpose, now = Date.now()) => {
    const recipient = selected(options?.recipients, recipientRef);
    return (recipient?.purposes || []).filter(item => item.value === purpose && item.consent_ref).map(item => {
        const evidence = selected(options?.consent_evidence, item.consent_ref);
        const current = available(recipient) && evidence && named(evidence.label) && named(evidence.source_label)
            && Number.isSafeInteger(evidence.version) && evidence.version > 0 && evidence.version === item.consent_version
            && evidence.revoked === false && evidence.expired === false && Date.parse(evidence.valid_until) > now
            && Date.parse(item.valid_until) > now;
        return { value: item.consent_ref, label: evidence?.label || '', enabled: Boolean(current), evidence,
            reason: current ? null : evidence?.reason || recipient?.reason || null };
    });
};

export const workspaceNativeOptionsIsCurrent = (options, now = Date.now()) => Boolean(options
    && typeof options.checked_at === 'string' && Date.parse(options.checked_at) <= now
    && typeof options.valid_until === 'string' && Date.parse(options.valid_until) > now
    && Date.parse(options.checked_at) < Date.parse(options.valid_until)
    && ['channels', 'accounts', 'recipients', 'templates', 'contents', 'purposes', 'consent_evidence'].every(key => Array.isArray(options[key]))
    && ['channels', 'accounts', 'recipients', 'templates', 'contents'].every(key => options[key].every(option => typeof option.value === 'string' && named(option.label) && typeof option.available === 'boolean' && optionalText(option.reason)))
    && options.accounts.every(account => typeof account.channel === 'string')
    && (options.recipients_next_cursor == null || (typeof options.recipients_next_cursor === 'string' && options.recipients_next_cursor.length > 0))
    && options.recipients.every(recipient => Array.isArray(recipient.purposes) && recipient.purposes.every(purpose => typeof purpose.value === 'string'))
    && options.templates.every(template => optionalText(template.body_preview) && Array.isArray(template.fields)
        && template.fields.every(field => typeof field.key === 'string' && named(field.label)))
    && options.contents.every(content => optionalText(content.preview))
    && (options.capabilities === undefined || (Array.isArray(options.capabilities) && options.capabilities.every(item => typeof item?.action === 'string'
        && typeof item.availability?.state === 'string' && typeof item.availability.message === 'string'
        && (item.availability.next_action === undefined || (typeof item.availability.next_action.code === 'string'
            && named(item.availability.next_action.label) && typeof item.availability.next_action.href === 'string')))))
    && options.consent_evidence.every(evidence => typeof evidence.value === 'string' && named(evidence.label) && named(evidence.source_label)
        && Number.isSafeInteger(evidence.version) && evidence.version > 0 && typeof evidence.revoked === 'boolean' && typeof evidence.expired === 'boolean'
        && Number.isFinite(Date.parse(evidence.recorded_at)) && Number.isFinite(Date.parse(evidence.valid_until)) && optionalText(evidence.reason))
    && options.purposes.every(option => typeof option.value === 'string' && named(option.label)));

export const workspaceNativeDraftErrors = ({ action, draft, options, now = Date.now(), language = 'ar' }) => {
    action = workspaceNativeInputAction(action);
    const ar = language === 'ar';
    const errors = {};
    const message = (arabic, english) => ar ? arabic : english;
    if (!NATIVE_WORKSPACE_ACTIONS.includes(action) || !workspaceNativeOptionsIsCurrent(options, now)) {
        errors.form = message('حدّث خيارات النشاط والصلاحية الحالية قبل المراجعة.', 'Refresh current activity choices and permissions before reviewing.');
        return errors;
    }
    if (!available(selected(options.channels, draft.channel)) || (action === 'campaigns.execute' && draft.channel !== 'whatsapp')
        || (action === 'content.publish' && draft.channel !== 'facebook')) errors.channel = message('اختر قناة متاحة لهذا الإجراء.', 'Choose an available channel for this action.');
    const account = selected(options.accounts, draft.account_ref);
    if (!available(account) || account.channel !== draft.channel) errors.account_ref = message('اختر حسابًا متاحًا في القناة الحالية.', 'Choose an available account in the current channel.');
    const budget = canonicalWorkspaceDecimal(draft.max_cost_credits);
    if (typeof draft.max_cost_credits !== 'string' || !/^(0|[1-9][0-9]*)$/.test(budget) || !Number.isSafeInteger(Number(budget))) errors.max_cost_credits = message('اكتب حدًا أقصى صحيحًا وغير سالب للتكلفة.', 'Enter a non-negative whole-number cost limit.');
    if (action === 'content.publish') {
        if (!available(selected(options.contents, draft.content_ref))) errors.content_ref = message('اختر محتوى معتمدًا متاحًا من المصدر.', 'Choose available approved source content.');
        return errors;
    }
    if (!selected(options.purposes, draft.purpose)) errors.purpose = message('اختر الغرض الحالي لاستخدام بيانات الشخص.', 'Choose the current purpose for using the person’s data.');
    const consentValid = (recipient, consent) => workspaceNativeConsentChoices(options, recipient, draft.purpose, now).some(option => option.value === consent && option.enabled);
    if (action === 'messaging.send') {
        if (!available(selected(options.recipients, draft.recipient_ref))) errors.recipient_ref = message('اختر شخصًا متاحًا في هذا الحساب.', 'Choose an available person in this account.');
        if (!consentValid(draft.recipient_ref, draft.consent_ref)) errors.consent_ref = message('اختر دليل موافقة حاليًا لهذا الشخص والغرض.', 'Choose current consent evidence for this person and purpose.');
    } else if (!Array.isArray(draft.recipients) || draft.recipients.length < 1 || draft.recipients.length > 100 || !unique(draft.recipients.map(item => item.recipient_ref))
        || draft.recipients.some(item => !consentValid(item.recipient_ref, item.consent_ref))) errors.recipients = message('اختر حتى 100 شخص مختلف، مع دليل حالي لكل شخص والغرض المحدد.', 'Choose up to 100 different people, with current evidence for each person and the selected purpose.');
    if (draft.template_ref) {
        const template = selected(options.templates, draft.template_ref);
        if (!available(template) || !Array.isArray(template.fields) || !template.fields.every(field => typeof field.key === 'string' && named(field.label)
            && typeof draft.template_values[field.key] === 'string' && draft.template_values[field.key].trim().length > 0 && draft.template_values[field.key].length <= 4000)) errors.template_ref = message('اختر قالبًا معتمدًا وأكمل حقوله العادية.', 'Choose an approved template and complete its ordinary text fields.');
        if (draft.message) errors.message = message('اختر النص أو القالب المعتمد في الطلب الواحد.', 'Choose message text or an approved template for one request.');
    } else if (action === 'campaigns.execute' || typeof draft.message !== 'string' || !draft.message.trim() || draft.message.length > 10_000) errors.message = message(action === 'campaigns.execute' ? 'اختر قالب حملة معتمدًا.' : 'اكتب نص الرسالة أو اختر قالبًا معتمدًا.', action === 'campaigns.execute' ? 'Choose an approved campaign template.' : 'Enter the message text or choose an approved template.');
    return errors;
};

export const workspaceNativeParameters = input => {
    if (Object.keys(workspaceNativeDraftErrors(input)).length) return null;
    const { draft, options } = input;
    const action = workspaceNativeInputAction(input.action);
    const common = { channel: draft.channel, account_ref: draft.account_ref, max_cost_credits: Number(canonicalWorkspaceDecimal(draft.max_cost_credits)) };
    if (action === 'content.publish') return { ...common, content_ref: draft.content_ref };
    const template = selected(options.templates, draft.template_ref);
    const content = template ? { template_ref: template.value, template_values: template.fields.map(field => draft.template_values[field.key]) }
        : { message: draft.message.trim() };
    return action === 'messaging.send' ? { ...common, recipient_ref: draft.recipient_ref, purpose: draft.purpose, consent_ref: draft.consent_ref, ...content }
        : { ...common, recipients: draft.recipients.map(item => ({ recipient_ref: item.recipient_ref, consent_ref: item.consent_ref })), purpose: draft.purpose, ...content };
};

export const workspaceNativePreviewIsCurrent = (preview, context, now = Date.now()) => Boolean(preview
    && typeof preview.checked_at === 'string' && Date.parse(preview.checked_at) <= now
    && typeof preview.valid_until === 'string' && Date.parse(preview.valid_until) > now
    && Date.parse(preview.valid_until) <= Date.parse(context?.valid_until)
    && (preview.resource_fingerprint === null || /^[a-f0-9]{64}$/.test(preview.resource_fingerprint))
    && preview.normalized_parameters && typeof preview.normalized_parameters === 'object' && !Array.isArray(preview.normalized_parameters)
    && (preview.quote?.total_credits === null || (Number.isSafeInteger(preview.quote?.total_credits) && preview.quote.total_credits >= 0))
    && (preview.quote.within_budget === null || typeof preview.quote.within_budget === 'boolean') && named(preview.quote.currency_label)
    && typeof preview.availability?.state === 'string' && typeof preview.availability.message === 'string');

export const workspaceNativeReviewedParameters = (action, preview, context, now = Date.now()) => {
    action = workspaceNativeInputAction(action);
    if (!workspaceNativePreviewIsCurrent(preview, context, now) || !['available', 'review_available'].includes(preview.availability.state)
        || !/^[a-f0-9]{64}$/.test(preview.resource_fingerprint)
        || preview.quote.within_budget !== true || !Number.isSafeInteger(preview.quote.total_credits)
        || !Number.isSafeInteger(preview.normalized_parameters.max_cost_credits) || preview.normalized_parameters.max_cost_credits < preview.quote.total_credits) return null;
    const allowed = action === 'content.publish' ? ['channel', 'account_ref', 'content_ref', 'max_cost_credits']
        : action === 'campaigns.execute' ? ['channel', 'account_ref', 'recipients', 'purpose', 'template_ref', 'template_values', 'max_cost_credits']
            : action === 'messaging.send' ? ['channel', 'account_ref', 'recipient_ref', 'purpose', 'consent_ref', 'message', 'template_ref', 'template_values', 'max_cost_credits'] : [];
    if (!allowed.length || Object.keys(preview.normalized_parameters).some(key => !allowed.includes(key))) return null;
    return { ...preview.normalized_parameters, resource_fingerprint: preview.resource_fingerprint };
};
