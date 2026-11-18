import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { workspaceLabel } from './connectionsDataPresentation';
import { clearWorkspaceConsentHint, emptyWorkspaceConsentDraft, readWorkspaceConsentHint, saveWorkspaceConsentHint,
    workspaceConsentChoices, workspaceConsentLookupIsConfirmed, workspaceConsentPayload, workspaceConsentRecordMatches, workspaceConsentWasRevoked } from './workspaceConsentPresentation';

const storage = () => { try { return window.sessionStorage; } catch { return null; } };
const Choice = ({ label, value, rows, disabled, onChange }) => <TextField select fullWidth label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
    <MenuItem value="">—</MenuItem>{rows.map(row => <MenuItem key={row.value} value={row.value} disabled={row.available === false}>{row.label}</MenuItem>)}
</TextField>;

// The evidence itself stays in memory until the explicit reviewed submission.
// Only its opaque operation key is retained for an original-identity lookup.
const WorkspaceConsentDialog = ({ open = false, context, descriptor, options, nativeDraft, defaultRecipient = '', verified = false,
    held = true, busy = false, onClose, onSaved, onRefresh, language = 'ar' }) => {
    const ar = language === 'ar';
    const [draft, setDraft] = useState(emptyWorkspaceConsentDraft);
    const [review, setReview] = useState(null);
    const [pendingKey, setPendingKey] = useState(null);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [clock, setClock] = useState(() => Date.now());
    const revision = useRef(0);
    const latest = useRef(); latest.current = { open, context, descriptor, options, nativeDraft, verified };
    useEffect(() => {
        revision.current += 1;
        setDraft({ ...emptyWorkspaceConsentDraft(), recipient_ref: defaultRecipient || nativeDraft?.recipient_ref || '', purpose: nativeDraft?.purpose || '' });
        setReview(null); setError(''); setNotice(''); setWorking(false); setClock(Date.now());
        setPendingKey(open ? readWorkspaceConsentHint(storage(), context?.native_reference) : null);
    }, [open, context?.viewKey, context?.native_reference, nativeDraft?.channel, nativeDraft?.account_ref, defaultRecipient, nativeDraft?.recipient_ref, nativeDraft?.purpose]);
    useEffect(() => {
        if (!open) return undefined;
        const expire = () => { revision.current += 1; setReview(null); setClock(Date.now()); setWorking(false); };
        const timer = window.setTimeout(expire, Math.min(Math.max(0, Math.min(Date.parse(context?.valid_until), Date.parse(options?.valid_until)) - Date.now()), 2_147_483_647));
        window.addEventListener('blur', expire);
        return () => { window.clearTimeout(timer); window.removeEventListener('blur', expire); };
    }, [open, context?.valid_until, options?.valid_until]);
    const choices = workspaceConsentChoices({ options, nativeDraft, draft, now: clock });
    const current = verified && context?.verified && Date.parse(context.valid_until) > clock && choices.ready;
    const blocked = !current || held || busy || working || Boolean(pendingKey);
    const snapshot = () => ({ revision: revision.current, viewKey: context?.viewKey, account: nativeDraft?.account_ref, channel: nativeDraft?.channel });
    const isCurrent = captured => {
        const value = latest.current;
        return captured.revision === revision.current && value.open && value.verified && value.context?.verified
            && value.context.viewKey === captured.viewKey && value.nativeDraft?.account_ref === captured.account
            && value.nativeDraft?.channel === captured.channel && Date.parse(value.context.valid_until) > Date.now();
    };
    const change = (field, value) => { setDraft(previous => ({ ...previous, [field]: value })); setReview(null); setError(''); };
    const prepare = () => {
        if (blocked) return;
        const payload = workspaceConsentPayload({ descriptor, context, options, nativeDraft, draft, idempotencyKey: crypto.randomUUID(), now: Date.now() });
        if (!payload) { setError(ar ? 'أكمل الشخص والغرض وتاريخ الصلاحية ودليل الموافقة الفعلي.' : 'Complete the person, purpose, expiry and actual consent evidence.'); return; }
        setReview({ kind: 'record', payload, accountLabel: choices.account.label, recipientLabel: choices.recipient.label,
            purposeLabel: options.purposes.find(row => row.value === payload.purpose)?.label, viewKey: context.viewKey });
    };
    const saved = record => {
        setReview(null); setPendingKey(null); setNotice(ar ? 'تحدّث سجل الموافقة الحالي. تُفحص صلاحيته مجددًا قبل أي تنفيذ.' : 'The consent record was updated. Its validity is checked again before execution.');
        onSaved?.({ record });
    };
    const sendRecord = async (frozen, captured) => {
        try {
            const result = await api.createPortalConsentRecord(frozen.payload);
            if (!isCurrent(captured)) return;
            if (!workspaceConsentRecordMatches(result, frozen.payload)) throw new Error();
            clearWorkspaceConsentHint(storage(), context.native_reference, frozen.payload.idempotency_key); saved(result);
        } catch {
            if (isCurrent(captured)) setError(ar ? 'لم يُحسم تأكيد الحفظ. افحص نتيجة المحاولة نفسها قبل تسجيل دليل آخر.' : 'Saving has not been confirmed. Check this same attempt before recording other evidence.');
        } finally { if (isCurrent(captured)) setWorking(false); }
    };
    const save = async () => {
        if (!review || !current || held || busy || working || pendingKey || review.viewKey !== context.viewKey) return;
        const captured = snapshot(); const frozen = review;
        setWorking(true); setError('');
        if (frozen.kind === 'record') {
            saveWorkspaceConsentHint(storage(), context.native_reference, frozen.payload.idempotency_key);
            setPendingKey(frozen.payload.idempotency_key);
            await sendRecord(frozen, captured);
        } else {
            try {
                const result = await api.revokePortalConsentRecord(frozen.record.value, { activity_ref: descriptor.activity, expected_version: frozen.record.version });
                if (!isCurrent(captured)) return;
                if (!workspaceConsentWasRevoked(result, frozen.record)) throw new Error();
                saved(result);
            } catch {
                if (isCurrent(captured)) { setReview({ ...frozen, unknown: true }); setError(ar ? 'لم يُحسم تأكيد السحب. افحص السجل الحالي قبل إجراء آخر.' : 'Withdrawal has not been confirmed. Check the current record before another action.'); }
            } finally { if (isCurrent(captured)) setWorking(false); }
        }
    };
    const finishOriginalSave = async () => {
        if (!current || held || busy || working || review?.kind !== 'record' || pendingKey !== review.payload.idempotency_key
            || review.viewKey !== context.viewKey || options.consent_management?.can_record !== true) return;
        setWorking(true); setError(''); await sendRecord(review, snapshot());
    };
    const check = async () => {
        if (!current || working || busy) return;
        const captured = snapshot(); setWorking(true); setError('');
        try {
            if (pendingKey) {
                const result = await api.lookupPortalConsentRecord({ activity_ref: descriptor.activity, idempotency_key: pendingKey });
                if (!isCurrent(captured)) return;
                if (!workspaceConsentLookupIsConfirmed(result, pendingKey)) throw new Error();
                clearWorkspaceConsentHint(storage(), context.native_reference, pendingKey); saved(result.record);
            } else if (review?.kind === 'revoke' && review.unknown) {
                const result = await api.listPortalConsentRecords({ activity_ref: descriptor.activity, channel: nativeDraft.channel,
                    account_ref: nativeDraft.account_ref, recipient_ref: draft.recipient_ref, purpose: draft.purpose });
                if (!isCurrent(captured)) return;
                const record = result?.records?.find(row => row.value === review.record.value);
                if (!workspaceConsentWasRevoked(record, review.record)) throw new Error();
                saved(record);
            }
        } catch { if (isCurrent(captured)) setError(ar ? 'النتيجة غير محسومة حاليًا؛ غياب الرد أو السجل لا يثبت أن الحفظ لم يحدث.' : 'The outcome remains unresolved. An absent reply or record does not prove the save did not occur.'); }
        finally { if (isCurrent(captured)) setWorking(false); }
    };
    const makeRevoke = record => {
        if (blocked || options.consent_management?.can_revoke !== true || record.revoked || record.expired) return;
        setReview({ kind: 'revoke', record: { ...record }, accountLabel: choices.account.label, recipientLabel: choices.recipient?.label,
            purposeLabel: options.purposes.find(row => row.value === record.purpose)?.label, viewKey: context.viewKey });
    };
    return <Dialog open={open && verified} onClose={() => { if (!working) { revision.current += 1; onClose?.(); } }} fullWidth maxWidth="sm" aria-labelledby="workspace-consent-title">
        <DialogTitle id="workspace-consent-title">{ar ? 'دليل الموافقة لهذا الغرض' : 'Consent evidence for this purpose'}</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{ar ? 'يسجّل هذا المسار دليلًا موجودًا لدى النشاط لشخص وغرض محددين. راجع مرجعه وتاريخه قبل الحفظ.' : 'This records existing business evidence for a specific person and purpose. Review its reference and date before saving.'}</Typography>
            {!current && <Alert severity="info" action={onRefresh && <Button color="inherit" disabled={working || busy} onClick={onRefresh}>{ar ? 'تحديث الخيارات' : 'Refresh choices'}</Button>}>{ar ? 'يلزم تحديث سياق الحساب والخيارات قبل المتابعة. تبقى مسودة الدليل محفوظة في هذه الشاشة.' : 'Refresh the current account context and choices before continuing. The evidence draft stays in this screen.'}</Alert>}
            {error && <Alert severity="warning">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
            {(pendingKey || review?.unknown) && <Alert severity="warning" action={<Button color="inherit" disabled={working || !current} onClick={check}>{ar ? 'فحص النتيجة نفسها' : 'Check same outcome'}</Button>}>{ar ? 'يوجد تأكيد معلّق لهذه المحاولة؛ لم يبدأ حفظ جديد.' : 'Confirmation for this attempt is pending; no new save has started.'}</Alert>}
            {current && !review && !pendingKey && <>
                <Typography>{ar ? 'الحساب: ' : 'Account: '}{workspaceLabel(choices.account?.label, '—')}</Typography>
                <Choice label={ar ? 'الشخص' : 'Person'} value={draft.recipient_ref} rows={choices.recipients} disabled={blocked} onChange={value => change('recipient_ref', value)} />
                <Choice label={ar ? 'الغرض' : 'Purpose'} value={draft.purpose} rows={choices.purposes} disabled={blocked} onChange={value => change('purpose', value)} />
                {choices.records.map(record => <Box key={record.value} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography>{record.label}</Typography><Typography variant="body2">{record.source_label}</Typography>
                    <Typography variant="caption">{ar ? 'صالح حتى: ' : 'Valid until: '}<bdi dir="ltr">{record.valid_until}</bdi>{record.revoked ? (ar ? ' — مسحوب' : ' — withdrawn') : record.expired ? (ar ? ' — منتهي' : ' — expired') : ''}</Typography>
                    {!record.revoked && !record.expired && <Button color="warning" disabled={blocked || options.consent_management?.can_revoke !== true} onClick={() => makeRevoke(record)}>{ar ? 'مراجعة سحب هذه الموافقة' : 'Review withdrawing this consent'}</Button>}
                </Box>)}
                {options.consent_management?.can_record !== true ? <Alert severity="info">{ar ? 'تسجيل دليل جديد يتطلب صلاحية إدارة دليل الموافقة لهذا النشاط والموارد المحددة.' : 'Recording new evidence requires consent management permission for this activity and the selected resources.'}</Alert> : <>
                    <Choice label={ar ? 'مصدر الدليل' : 'Evidence source'} value={draft.evidence_kind} disabled={blocked} onChange={value => change('evidence_kind', value)} rows={[
                        { value: 'owner_recorded', label: ar ? 'دليل موثق في سجل النشاط' : 'Evidence documented in the business records' },
                        ...(nativeDraft.channel === 'whatsapp' && draft.purpose === 'service_response' ? [{ value: 'native_inbound', label: ar ? 'طلب خدمة في المحادثة الحالية' : 'A service request in the current conversation' }] : [])]} />
                    {draft.evidence_kind === 'owner_recorded' && <>
                        <TextField label={ar ? 'مرجع الدليل في سجل النشاط' : 'Evidence reference in the business records'} value={draft.reference} disabled={blocked} onChange={event => change('reference', event.target.value)} inputProps={{ maxLength: 255 }} />
                        <TextField multiline minRows={3} label={ar ? 'وصف الدليل وكيف أُعطيت الموافقة لهذا الغرض' : 'Describe the evidence and how consent was given for this purpose'} value={draft.note} disabled={blocked} onChange={event => change('note', event.target.value)} inputProps={{ maxLength: 2000 }} helperText={ar ? 'وصف محدد من 20 حرفًا على الأقل.' : 'A specific description of at least 20 characters.'} />
                        <TextField type="datetime-local" label={ar ? 'تاريخ توثيق الدليل' : 'Evidence recorded at'} InputLabelProps={{ shrink: true }} value={draft.recorded_at} disabled={blocked} onChange={event => change('recorded_at', event.target.value)} />
                    </>}
                    <TextField type="datetime-local" label={ar ? 'الموافقة صالحة حتى' : 'Consent valid until'} InputLabelProps={{ shrink: true }} value={draft.valid_until} disabled={blocked} onChange={event => change('valid_until', event.target.value)} />
                </>}
            </>}
            {review && !review.unknown && <Box component="dl" sx={{ m: 0 }}>
                {[[ar ? 'الإجراء' : 'Action', review.kind === 'record' ? (ar ? 'تسجيل دليل الموافقة' : 'Record consent evidence') : (ar ? 'سحب دليل الموافقة الحالي' : 'Withdraw the current consent evidence')],
                    [ar ? 'الحساب' : 'Account', review.accountLabel], [ar ? 'الشخص' : 'Person', review.recipientLabel], [ar ? 'الغرض' : 'Purpose', review.purposeLabel],
                    ...(review.kind === 'record' ? [[ar ? 'مصدر الدليل' : 'Evidence source', review.payload.evidence.kind === 'owner_recorded' ? (ar ? 'سجل النشاط' : 'Business records') : (ar ? 'المحادثة الحالية' : 'Current conversation')],
                        ...(review.payload.evidence.kind === 'owner_recorded' ? [[ar ? 'المرجع' : 'Reference', review.payload.evidence.reference], [ar ? 'الدليل' : 'Evidence', review.payload.evidence.note], [ar ? 'تاريخ الدليل' : 'Recorded at', review.payload.evidence.recorded_at]] : []),
                        [ar ? 'صالح حتى' : 'Valid until', review.payload.valid_until]] : [])].map(([label, value]) => <Box key={label} sx={{ mb: 1.5 }}><Typography component="dt" fontWeight={700}>{label}</Typography><Typography component="dd" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) ? <bdi dir="ltr">{value}</bdi> : value}</Typography></Box>)}
            </Box>}
        </Stack></DialogContent>
        <DialogActions><Button disabled={working} onClick={() => { revision.current += 1; onClose?.(); }}>{ar ? 'إغلاق' : 'Close'}</Button>
            {pendingKey && review?.kind === 'record' && <Button disabled={!current || held || busy || working} onClick={finishOriginalSave}>{ar ? 'إكمال الحفظ بالمحاولة نفسها' : 'Complete the same save attempt'}</Button>}
            {review && !review.unknown && !pendingKey ? <><Button disabled={working} onClick={() => setReview(null)}>{ar ? 'تعديل المراجعة' : 'Edit review'}</Button><Button variant="contained" color={review.kind === 'revoke' ? 'warning' : 'primary'} disabled={!current || held || busy || working} onClick={save}>{review.kind === 'revoke' ? (ar ? 'تأكيد السحب' : 'Confirm withdrawal') : (ar ? 'حفظ الدليل المراجع' : 'Save reviewed evidence')}</Button></>
                : !pendingKey && !review?.unknown && <Button variant="contained" disabled={blocked || options?.consent_management?.can_record !== true} onClick={prepare}>{ar ? 'مراجعة الدليل قبل الحفظ' : 'Review evidence before saving'}</Button>}
        </DialogActions>
    </Dialog>;
};
export default WorkspaceConsentDialog;
