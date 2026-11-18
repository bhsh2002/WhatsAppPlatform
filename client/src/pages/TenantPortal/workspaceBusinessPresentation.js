import { workspaceLabel, workspaceReviewSummaryIsValid } from './connectionsDataPresentation.js';

export const WORKSPACE_BUSINESS_ACTIONS = {
    'customers.manage': ['contacts.create', 'contacts.change', 'contacts.remove', 'contacts.read'],
    'measurement.read': ['measurement.summary'], 'measurement.export': ['measurement.export'],
    'owner.operations': ['owner.operation_status'],
};
export const WORKSPACE_BUSINESS_CAPABILITIES = Object.keys(WORKSPACE_BUSINESS_ACTIONS);
const named = value => Boolean(workspaceLabel(value, null));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const option = row => text(row?.value, 16_384) && named(row.label) && typeof row.available === 'boolean';
const current = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
const find = (rows, value) => rows?.find(row => row.value === value && row.available === true);
const inputFields = ['phone', 'profile_name', 'label', 'notes'];
const purposes = ['customer_service', 'business_record', 'correction'];

export const emptyWorkspaceBusinessDraft = () => ({ action: '', account_ref: '', contact_ref: '', command_ref: '', purpose: '',
    consent_ref: '', evidence_reference: '', phone: '', profile_name: '', label: '', notes: '', changedFields: [], clearFields: [] });

export const updateWorkspaceBusinessDraft = (draft, field, value) => {
    if (!Object.hasOwn(emptyWorkspaceBusinessDraft(), field) || ['changedFields', 'clearFields'].includes(field)) return draft;
    if (field === 'action' || field === 'account_ref') return { ...emptyWorkspaceBusinessDraft(), action: draft.action, [field]: value };
    if (field === 'contact_ref' || field === 'command_ref') return { ...draft, [field]: value, consent_ref: '',
        ...(draft[field] && draft[field] !== value ? { label: '', notes: '', changedFields: [], clearFields: [], evidence_reference: '' } : {}) };
    if (field === 'purpose') return { ...draft, purpose: value, consent_ref: '' };
    return { ...draft, [field]: value, ...(inputFields.includes(field) ? { changedFields: [...new Set([...draft.changedFields, field])],
        clearFields: draft.clearFields.filter(key => key !== field) } : {}) };
};
export const clearWorkspaceBusinessField = (draft, field, cleared) => ['label', 'notes'].includes(field) ? {
    ...draft, changedFields: [...new Set([...draft.changedFields, field])],
    clearFields: cleared ? [...new Set([...draft.clearFields, field])] : draft.clearFields.filter(key => key !== field),
} : draft;
export const workspaceBusinessPageDraft = draft => ({ ...draft, contact_ref: '', command_ref: '', consent_ref: '', changedFields: [], clearFields: [] });

export const workspaceBusinessOptionsIsCurrent = (options, capability, now = Date.now()) => Boolean(options?.capability === capability
    && WORKSPACE_BUSINESS_CAPABILITIES.includes(capability) && typeof options.checked_at === 'string' && Date.parse(options.checked_at) <= now
    && current(options.valid_until, now) && Date.parse(options.checked_at) < Date.parse(options.valid_until)
    && ['accounts', 'contacts', 'actions', 'purposes', 'consent_evidence', 'editable_fields'].every(key => Array.isArray(options[key]))
    && options.accounts.every(option) && options.contacts.every(row => option(row) && Number.isSafeInteger(row.source_revision) && row.source_revision > 0)
    && options.actions.every(row => option(row) && WORKSPACE_BUSINESS_ACTIONS[capability].includes(row.value)
        && Array.isArray(row.required_fields) && row.required_fields.every(field => typeof field === 'string')
        && typeof row.availability?.state === 'string' && text(row.availability.message, 4000))
    && options.purposes.every(row => purposes.includes(row.value) && named(row.label))
    && options.editable_fields.every(field => inputFields.includes(field))
    && options.consent_evidence.every(row => text(row.value, 16_384) && named(row.label) && named(row.source_label)
        && text(row.recipient_ref, 16_384) && purposes.includes(row.purpose) && typeof row.available === 'boolean'
        && Number.isSafeInteger(row.version) && row.version > 0 && typeof row.revoked === 'boolean' && typeof row.expired === 'boolean'
        && Number.isFinite(Date.parse(row.valid_until)))
    && (options.contacts_next_cursor == null || text(options.contacts_next_cursor, 16_384))
    && (options.operations === undefined || (Array.isArray(options.operations) && options.operations.every(option)))
    && (options.operations_next_cursor == null || text(options.operations_next_cursor, 16_384))
    && (capability !== 'owner.operations' || Array.isArray(options.operations)));

export const workspaceBusinessConsentChoices = (options, draft, now = Date.now()) => (options?.consent_evidence || [])
    .filter(row => row.channel === 'native' && row.account_ref === draft.account_ref && row.recipient_ref === draft.contact_ref && row.purpose === draft.purpose)
    .map(row => ({ ...row, available: row.available === true && row.revoked === false && row.expired === false && current(row.valid_until, now) }));

const phoneDigits = value => String(value).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0));
export const workspaceBusinessDraftErrors = ({ capability, draft, options, now = Date.now(), language = 'ar' }) => {
    const ar = language === 'ar', errors = {};
    const say = (arabic, english) => ar ? arabic : english;
    if (!workspaceBusinessOptionsIsCurrent(options, capability, now)) return { form: say('حدّث خيارات النشاط والصلاحية الحالية.', 'Refresh the current activity choices and permission.') };
    if (!draft || !Object.entries(emptyWorkspaceBusinessDraft()).every(([key, value]) => Array.isArray(value)
        ? Array.isArray(draft[key]) && draft[key].every(field => inputFields.includes(field)) && new Set(draft[key]).size === draft[key].length
        : typeof draft[key] === 'string')) return { form: say('راجع بيانات النموذج الحالية.', 'Review the current form values.') };
    if (!find(options.actions, draft.action)) errors.action = say('اختر عملية متاحة من القائمة الحالية.', 'Choose an available action from the current list.');
    if (!find(options.accounts, draft.account_ref)) errors.account_ref = say('اختر الحساب الحالي بالاسم.', 'Choose the current named account.');
    if (!options.purposes.some(row => row.value === draft.purpose)) errors.purpose = say('اختر غرض استخدام البيانات.', 'Choose the purpose for using the data.');
    if (!text(draft.evidence_reference, 1000)) errors.evidence_reference = say('اكتب مرجع العمل الفعلي لهذا الطلب.', 'Enter the actual business reference for this request.');
    if (capability === 'customers.manage') {
        if (draft.action === 'contacts.create') {
            const phone = phoneDigits(draft.phone);
            if (!options.editable_fields.includes('phone') || !/^[+()\s.\-0-9]+$/.test(phone) || !/^[0-9]{7,15}$/.test(phone.replace(/\D/g, ''))) errors.phone = say('اكتب رقم جهة اتصال صحيحًا من 7 إلى 15 رقمًا.', 'Enter a contact phone number with 7–15 digits.');
        } else if (WORKSPACE_BUSINESS_ACTIONS[capability].includes(draft.action)) {
            if (!find(options.contacts, draft.contact_ref)) errors.contact_ref = say('اختر جهة اتصال متاحة حاليًا.', 'Choose a currently available contact.');
            if (!workspaceBusinessConsentChoices(options, draft, now).some(row => row.value === draft.consent_ref && row.available)) errors.consent_ref = say('اختر دليلًا ساريًا لاستخدام بيانات هذه الجهة لهذا الغرض.', 'Choose current evidence for using this contact’s data for this purpose.');
            if (draft.action === 'contacts.change' && !draft.changedFields.some(field => ['label', 'notes'].includes(field))) errors.form = say('غيّر التصنيف أو الملاحظات قبل المراجعة.', 'Change the classification or notes before reviewing.');
        }
        const considered = draft.action === 'contacts.create' ? inputFields.filter(field => Boolean(draft[field])) : draft.changedFields;
        for (const field of considered) {
            if (!options.editable_fields.includes(field) || (draft.action === 'contacts.change' && !['label', 'notes'].includes(field))) errors[field] = say('لم تُتحقق صلاحية هذا البيان الحالي.', 'Current permission for this field is not verified.');
            if (typeof draft[field] !== 'string' || draft[field].length > ({ phone: 100, profile_name: 200, label: 64, notes: 2000 }[field] || 0)) errors[field] = say('تحقق من طول هذا النص.', 'Check the length of this text.');
            if (draft.action === 'contacts.change' && !draft[field]?.trim() && !draft.clearFields.includes(field)) errors[field] = say('اختر مسح القيمة صراحةً لإزالتها.', 'Choose the explicit clear action to remove this value.');
        }
        if (draft.clearFields.some(field => !['label', 'notes'].includes(field) || !options.editable_fields.includes(field))) errors.form = say('لا يمكن مسح هذا البيان ضمن الصلاحية الحالية.', 'This field cannot be cleared with the current permission.');
    }
    if (capability === 'owner.operations' && !find(options.operations, draft.command_ref)) errors.command_ref = say('اختر عملية حالية بالاسم لفحص حالتها.', 'Choose a current named operation to check.');
    return errors;
};

export const workspaceBusinessParameters = input => {
    if (Object.keys(workspaceBusinessDraftErrors(input)).length) return null;
    const { capability, draft, options } = input;
    const result = { channel: 'native', account_ref: draft.account_ref, purpose: draft.purpose, evidence_reference: draft.evidence_reference.trim() };
    if (capability === 'owner.operations') return { ...result, command_ref: draft.command_ref };
    if (capability !== 'customers.manage') return result;
    if (draft.action === 'contacts.create') {
        result.phone = phoneDigits(draft.phone).replace(/\D/g, '');
        for (const field of ['profile_name', 'label', 'notes']) if (draft[field].trim()) result[field] = draft[field].trim();
    } else {
        result.contact_ref = draft.contact_ref; result.consent_ref = draft.consent_ref;
        if (draft.action !== 'contacts.read') result.expected_revision = find(options.contacts, draft.contact_ref).source_revision;
        if (draft.action === 'contacts.change') for (const field of draft.changedFields) result[field] = draft.clearFields.includes(field) ? null : draft[field].trim();
    }
    return result;
};

export const workspaceBusinessPreviewIsCurrent = (preview, context, now = Date.now()) => Boolean(preview && current(preview.valid_until, now)
    && typeof preview.checked_at === 'string' && Date.parse(preview.checked_at) <= now && Date.parse(preview.valid_until) <= Date.parse(context?.valid_until)
    && (preview.resource_fingerprint === null || /^[a-f0-9]{64}$/.test(preview.resource_fingerprint))
    && preview.normalized_parameters && typeof preview.normalized_parameters === 'object' && !Array.isArray(preview.normalized_parameters)
    && preview.quote?.total_credits === 0 && typeof preview.quote.within_budget === 'boolean' && named(preview.quote.currency_label)
    && typeof preview.availability?.state === 'string' && text(preview.availability.message, 4000));

export const workspaceBusinessReviewedParameters = (capability, action, preview, context, now = Date.now()) => {
    if (!WORKSPACE_BUSINESS_ACTIONS[capability]?.includes(action) || !workspaceBusinessPreviewIsCurrent(preview, context, now)
        || preview.availability.state !== 'review_available' || preview.quote.within_budget !== true || !/^[a-f0-9]{64}$/.test(preview.resource_fingerprint)
        || !workspaceReviewSummaryIsValid(preview.summary)) return null;
    const allowed = ['channel', 'account_ref', 'purpose', 'evidence_reference', ...(capability === 'owner.operations' ? ['command_ref'] : []),
        ...(action === 'contacts.create' ? inputFields : action === 'contacts.change' ? ['contact_ref', 'consent_ref', 'expected_revision', 'label', 'notes']
            : ['contacts.remove', 'contacts.read'].includes(action) ? ['contact_ref', 'consent_ref', ...(action === 'contacts.read' ? [] : ['expected_revision'])] : [])];
    if (Object.keys(preview.normalized_parameters).some(key => !allowed.includes(key))) return null;
    return { ...preview.normalized_parameters, resource_fingerprint: preview.resource_fingerprint };
};
