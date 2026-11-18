const purposes = new Set(['service_response', 'transactional', 'marketing', 'customer_service', 'business_record', 'correction']);
const channels = new Set(['sms', 'whatsapp', 'messenger', 'native']);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const current = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
const consentRef = value => /^consent:[a-f0-9-]{36}$/.test(value || '');
const hintPrefix = 'wa-consent-save:v1:';
export const emptyWorkspaceConsentDraft = () => ({ recipient_ref: '', purpose: '', evidence_kind: 'owner_recorded', reference: '', note: '', recorded_at: '', valid_until: '' });
export const workspaceConsentChoices = ({ options, nativeDraft, draft, now = Date.now() }) => {
    const ready = current(options?.valid_until, now) && channels.has(nativeDraft?.channel)
        && options?.accounts?.some(row => row.value === nativeDraft.account_ref && row.available === true
            && (nativeDraft.channel === 'native' ? row.value === 'native_contacts' : row.channel === nativeDraft.channel));
    if (!ready) return { ready: false, recipients: [], purposes: [], records: [], account: null };
    const recipients = nativeDraft.channel === 'native' ? options.contacts || [] : options.recipients || [];
    const recipient = recipients.find(row => row.value === draft.recipient_ref && row.available === true);
    return { ready: true, recipients, purposes: options.purposes || [],
        account: options.accounts.find(row => row.value === nativeDraft.account_ref),
        records: (options.consent_evidence || []).filter(row => row.channel === nativeDraft.channel && row.account_ref === nativeDraft.account_ref
            && row.recipient_ref === draft.recipient_ref && row.purpose === draft.purpose), recipient };
};
export const workspaceConsentPayload = ({ descriptor, context, options, nativeDraft, draft, idempotencyKey, now = Date.now() }) => {
    const choices = workspaceConsentChoices({ options, nativeDraft, draft, now });
    if (!context?.verified || !current(context.valid_until, now) || !text(descriptor?.activity, 16_384)
        || !choices.ready || !choices.recipient || !purposes.has(draft.purpose) || !choices.purposes.some(row => row.value === draft.purpose)
        || options.consent_management?.can_record !== true
        || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey || '') || !current(draft.valid_until, now)) return null;
    let evidence;
    if (draft.evidence_kind === 'native_inbound' && nativeDraft.channel === 'whatsapp' && draft.purpose === 'service_response') evidence = { kind: 'native_inbound' };
    else if (draft.evidence_kind === 'owner_recorded' && text(draft.reference, 255) && text(draft.note, 2000) && draft.note.trim().length >= 20
        && typeof draft.recorded_at === 'string' && Number.isFinite(Date.parse(draft.recorded_at)) && Date.parse(draft.recorded_at) <= now
        && Date.parse(draft.recorded_at) < Date.parse(draft.valid_until)) evidence = { kind: 'owner_recorded', reference: draft.reference.trim(),
        note: draft.note.trim(), recorded_at: new Date(draft.recorded_at).toISOString() };
    else return null;
    return Object.freeze({ activity_ref: descriptor.activity, channel: nativeDraft.channel, account_ref: nativeDraft.account_ref,
        recipient_ref: draft.recipient_ref, purpose: draft.purpose, evidence: Object.freeze(evidence),
        valid_until: new Date(draft.valid_until).toISOString(), idempotency_key: idempotencyKey });
};
export const workspaceConsentRecordMatches = (record, payload) => Boolean(consentRef(record?.value)
    && ['channel', 'account_ref', 'recipient_ref', 'purpose'].every(key => record[key] === payload[key])
    && record.evidence_kind === payload.evidence.kind && Number.isSafeInteger(record.version) && record.version > 0
    && typeof record.revoked === 'boolean' && typeof record.expired === 'boolean'
    && Number.isFinite(Date.parse(record.valid_until)) && Date.parse(record.valid_until) <= Date.parse(payload.valid_until));
export const workspaceConsentLookupIsConfirmed = (result, key) => Boolean(result?.operation_key === key && consentRef(result.record?.value)
    && Number.isSafeInteger(result.record.version) && result.record.version > 0);
export const workspaceConsentWasRevoked = (record, before) => Boolean(record?.value === before?.value && record.revoked === true
    && Number.isSafeInteger(record.version) && record.version > before.version);
export const readWorkspaceConsentHint = (storage, nativeReference) => {
    if (!text(nativeReference, 2048)) return null;
    try { const value = JSON.parse(storage.getItem(hintPrefix + nativeReference));
        return value && Object.keys(value).length === 1 && /^[A-Za-z0-9._:-]{8,128}$/.test(value.key || '') ? value.key : null;
    } catch { return null; }
};
export const saveWorkspaceConsentHint = (storage, nativeReference, key) => {
    if (!text(nativeReference, 2048) || !/^[A-Za-z0-9._:-]{8,128}$/.test(key || '')) return false;
    try { storage.setItem(hintPrefix + nativeReference, JSON.stringify({ key })); return true; } catch { return false; }
};
export const clearWorkspaceConsentHint = (storage, nativeReference, key) => {
    if (readWorkspaceConsentHint(storage, nativeReference) !== key) return false;
    try { storage.removeItem(hintPrefix + nativeReference); return true; } catch { return false; }
};
