import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { workspaceAvailabilityLabel, workspaceReviewSummaryIsValid } from './connectionsDataPresentation';
import { clearWorkspaceMediaStageHint, emptyWorkspaceMediaDraft, readWorkspaceMediaStageHint, saveWorkspaceMediaStageHint,
    workspaceMediaOptionsIsCurrent, workspaceMediaParameters, workspaceMediaReviewedParameters, workspaceMediaSameSelection,
    workspaceMediaStageIsConfirmed, workspaceMediaStagePayload } from './workspaceMediaPresentation';
import { workspaceBusinessPreviewIsCurrent } from './workspaceBusinessPresentation';

const storage = () => { try { return window.sessionStorage; } catch { return null; } };
const Choice = ({ label, value, rows = [], disabled, onChange }) => <TextField select fullWidth label={label} value={rows.some(row => row.value === value) ? value : ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
    <MenuItem value="">—</MenuItem>{rows.map(row => <MenuItem key={row.value} value={row.value} disabled={row.available === false} sx={{ whiteSpace: 'normal' }}><Stack><Typography variant="body2">{row.label}</Typography>{row.reason && <Typography variant="caption">{row.reason}</Typography>}</Stack></MenuItem>)}
</TextField>;

// Local file staging is independent of Core dialog mounting. A file-picker blur
// discards authority and previews; only the owner's local file/draft survives.
const WorkspaceMediaActionEditor = ({ open = false, context, descriptor, held = true, busy = false,
    onRefreshContext, onReview, onShowOperations, onClose, language = 'ar' }) => {
    const ar = language === 'ar';
    const [binding, setBinding] = useState(null);
    const [options, setOptions] = useState(null);
    const [draft, setDraft] = useState(emptyWorkspaceMediaDraft);
    const [file, setFile] = useState(null);
    const [fileInputKey, setFileInputKey] = useState(0);
    const [pickerActive, setPickerActive] = useState(false);
    const [stageReview, setStageReview] = useState(null);
    const [preview, setPreview] = useState(null);
    const [pendingKey, setPendingKey] = useState(null);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [clock, setClock] = useState(() => Date.now());
    const revision = useRef(0);
    const running = useRef(false);
    const selection = useRef(null);
    const pending = useRef(null);
    const local = useRef(null);
    local.current = { context, descriptor, draft, file, open, held, busy };
    const refreshContext = useRef(onRefreshContext); refreshContext.current = onRefreshContext;
    const close = useRef(onClose); close.current = onClose;
    const resetFile = useCallback(() => { setFile(null); setFileInputKey(value => value + 1); setPickerActive(false); }, []);
    const invalidate = useCallback(() => {
        revision.current += 1; setBinding(null); setOptions(null); setPreview(null); setStageReview(null); setClock(Date.now());
    }, []);
    const refresh = useCallback(async () => {
        const ticket = revision.current;
        setBinding(null); setOptions(null); setPreview(null); setStageReview(null);
        const fresh = await refreshContext.current?.();
        if (ticket !== revision.current || !local.current.open) return null;
        const next = { context: fresh?.context, descriptor: fresh?.mediaEditor };
        if (!next.context?.verified || !next.descriptor?.activity || !next.descriptor?.provider || next.descriptor.capability !== 'media.manage'
            || !/^[a-f0-9]{64}$/.test(next.descriptor.selectionKey)) throw new Error('media_context_unverified');
        const same = !selection.current || workspaceMediaSameSelection(selection.current, next);
        if (!same) { resetFile(); setDraft(emptyWorkspaceMediaDraft()); setNotice(ar ? 'تغيّر الحساب أو النشاط أو مدة التحقق. اختر الحساب والملف من جديد.' : 'The account, activity or verification window changed. Choose the account and file again.'); }
        const account = same ? local.current.draft.account_ref : '';
        const result = await api.getPortalCollaborativeMediaOptions({ activity_ref: next.descriptor.activity, ...(account ? { account_ref: account } : {}) });
        if (ticket !== revision.current || !local.current.open) return null;
        if (!workspaceMediaOptionsIsCurrent(result, next.context)) throw new Error('media_options_unverified');
        selection.current = next; setBinding(next); setOptions(result); setPreview(null); setStageReview(null); setClock(Date.now());
        const hint = readWorkspaceMediaStageHint(storage(), next.context.native_reference);
        if (pending.current?.owner !== next.context.native_reference) pending.current = hint ? { owner: next.context.native_reference, key: hint } : null;
        setPendingKey(pending.current?.key || hint);
        return { ...next, options: result, same };
    }, [ar, resetFile]);
    const check = useCallback(async () => {
        if (running.current) return;
        running.current = true; setWorking(true); setError('');
        try { await refresh(); } catch { invalidate(); setError(ar ? 'تعذّر التحقق من النشاط وخيارات الملفات الحالية.' : 'Could not verify the current activity and file choices.'); }
        finally { running.current = false; setWorking(false); }
    }, [ar, refresh, invalidate]);
    useEffect(() => {
        revision.current += 1; selection.current = null; setBinding(null); setOptions(null); setDraft(emptyWorkspaceMediaDraft()); resetFile(); setStageReview(null); setPreview(null); setPendingKey(null); setError(''); setNotice('');
        if (open) check();
        return () => { revision.current += 1; };
    }, [open, check, resetFile]);
    useEffect(() => {
        if (!open) return undefined;
        const hide = () => { invalidate(); resetFile(); setDraft(emptyWorkspaceMediaDraft()); close.current?.(); };
        const hidden = () => { if (window.document.hidden) invalidate(); };
        window.addEventListener('blur', invalidate); window.addEventListener('pagehide', hide); window.document.addEventListener('visibilitychange', hidden);
        return () => { window.removeEventListener('blur', invalidate); window.removeEventListener('pagehide', hide); window.document.removeEventListener('visibilitychange', hidden); };
    }, [open, invalidate, resetFile]);
    useEffect(() => {
        if (open && context?.verified && selection.current?.context.native_reference && context.native_reference !== selection.current.context.native_reference) {
            invalidate(); resetFile(); setDraft(emptyWorkspaceMediaDraft()); close.current?.();
        }
    }, [open, context, invalidate, resetFile]);
    useEffect(() => {
        const deadlines = [binding?.context?.valid_until, options?.valid_until, preview?.valid_until].filter(Boolean).map(Date.parse).filter(Number.isFinite);
        if (!open || !deadlines.length) return undefined;
        const timer = window.setTimeout(invalidate, Math.max(0, Math.min(...deadlines) - Date.now()));
        return () => window.clearTimeout(timer);
    }, [open, binding, options, preview, invalidate]);
    const current = binding && context?.verified && binding.context.viewKey === context.viewKey && workspaceMediaOptionsIsCurrent(options, context, clock);
    const blocked = !current || held || busy || working || Boolean(pendingKey);
    const set = (field, value) => { setDraft(previous => ({ ...previous, [field]: value, ...(['account_ref', 'asset_ref'].includes(field) ? { action: '' } : {}), ...(field === 'account_ref' ? { asset_ref: '' } : {}) })); setStageReview(null); setPreview(null); setError(''); };
    const parameters = workspaceMediaParameters({ draft, options, context: binding?.context, now: clock });
    const asset = options?.assets.find(row => row.value === draft.asset_ref);
    const previewCurrent = preview && preview.inputKey === JSON.stringify(draft) && workspaceMediaReviewedParameters(draft.action, preview, binding?.context, parameters, clock);
    const prepareStage = async () => {
        if (running.current || held || busy || pendingKey || !file) return;
        running.current = true; setWorking(true); setError('');
        const ticket = revision.current, capturedFile = file, capturedDraft = draft;
        try {
            const fresh = await refresh();
            if (!fresh || ticket !== revision.current || !fresh.same || capturedFile !== local.current.file || JSON.stringify(capturedDraft) !== JSON.stringify(local.current.draft)) return;
            const payload = workspaceMediaStagePayload({ ...fresh, draft: capturedDraft, file: capturedFile, idempotencyKey: crypto.randomUUID() });
            if (!payload) { setError(ar ? 'أكمل الملف والحساب ومرجع حق الاستخدام ووصفه وتواريخه الفعلية.' : 'Complete the file, account, rights reference, description and actual dates.'); return; }
            setStageReview({ payload, file: capturedFile, viewKey: fresh.context.viewKey, accountLabel: fresh.options.accounts.find(row => row.value === payload.account_ref).label });
        } catch { invalidate(); setError(ar ? 'تعذّر تجهيز مراجعة الحفظ. تحقّق من الخيارات الحالية.' : 'Could not prepare the local save review. Check current choices.'); }
        finally { running.current = false; setWorking(false); }
    };
    const saveStage = async () => {
        if (blocked || running.current || !stageReview || stageReview.viewKey !== context?.viewKey || stageReview.file !== file) return;
        const frozen = stageReview, owner = binding.context.native_reference, ticket = revision.current;
        running.current = true; setWorking(true); setError('');
        saveWorkspaceMediaStageHint(storage(), owner, frozen.payload.idempotency_key); pending.current = { owner, key: frozen.payload.idempotency_key }; setPendingKey(frozen.payload.idempotency_key); setStageReview(null);
        try {
            const result = await api.stagePortalCollaborativeMedia(frozen.file, frozen.payload);
            if (ticket !== revision.current || !local.current.open) return;
            if (!workspaceMediaStageIsConfirmed(result, frozen.payload.idempotency_key)) throw new Error('media_save_unverified');
            clearWorkspaceMediaStageHint(storage(), owner, frozen.payload.idempotency_key); pending.current = null; setPendingKey(null); resetFile();
            setNotice(ar ? 'حُفظ الملف محليًا مشفّرًا. لم يُرفع إلى WhatsApp ولم تُرسل رسالة. اختره لإعداد طلب الرفع.' : 'The file was saved locally with encryption. It has not been uploaded to WhatsApp or sent in a message. Select it to prepare an upload request.');
            await refresh();
        } catch { if (ticket === revision.current) setError(ar ? 'لم تتأكد نتيجة الحفظ المحلي. افحص المحاولة نفسها؛ لن يُعاد رفع الملف تلقائيًا.' : 'The local save outcome is unconfirmed. Check this same attempt; the file will not be submitted again automatically.'); }
        finally { running.current = false; setWorking(false); }
    };
    const lookup = async () => {
        if (running.current || !pendingKey) return;
        running.current = true; setWorking(true); setError(''); const key = pendingKey, ticket = revision.current;
        try {
            const fresh = await refresh();
            if (!fresh || ticket !== revision.current) return;
            const result = await api.lookupPortalCollaborativeMediaStage(fresh.descriptor.activity, key);
            if (ticket !== revision.current || !workspaceMediaStageIsConfirmed(result, key)) throw new Error('unresolved');
            clearWorkspaceMediaStageHint(storage(), fresh.context.native_reference, key); pending.current = null; setPendingKey(null); resetFile();
            setNotice(ar ? 'تأكد الحفظ المحلي للمحاولة الأصلية. راجع الملف ضمن القائمة الحالية.' : 'The original local save was confirmed. Review the file in the current list.'); await refresh();
        } catch { if (ticket === revision.current) setError(ar ? 'ما زالت النتيجة غير مؤكدة. عدم العثور على المحاولة لا يثبت عدم حفظ الملف؛ لا تبدأ حفظًا مكررًا.' : 'The outcome is still unconfirmed. A missing lookup does not prove the file was not saved; do not start a duplicate save.'); }
        finally { running.current = false; setWorking(false); }
    };
    const checkPreview = async () => {
        if (running.current || held || busy || pendingKey) return;
        running.current = true; setWorking(true); setError(''); const ticket = revision.current, captured = JSON.stringify(draft);
        try {
            const fresh = await refresh();
            if (!fresh || ticket !== revision.current || !fresh.same || captured !== JSON.stringify(local.current.draft)) return;
            const selected = workspaceMediaParameters({ ...fresh, draft: local.current.draft });
            if (!selected) { setError(ar ? 'اختر ملفًا وعملية متاحة من الحالة الحالية. الملف ذو النتيجة المجهولة يحتاج فحص طلبه الأصلي.' : 'Choose a file and an action available in its current state. An unknown outcome requires checking the original request.'); return; }
            const result = await api.previewPortalCollaborativeMedia({ activity_ref: fresh.descriptor.activity, capability: 'media.manage', action: local.current.draft.action, parameters: selected });
            if (ticket !== revision.current || captured !== JSON.stringify(local.current.draft)) return;
            if (!workspaceBusinessPreviewIsCurrent(result, fresh.context)) throw new Error('media_preview_unverified');
            setClock(Date.now()); setPreview({ ...result, inputKey: captured });
        } catch { invalidate(); setError(ar ? 'تعذّر تأكيد الملف وحق استخدامه حاليًا.' : 'Could not confirm the file and current usage rights.'); }
        finally { running.current = false; setWorking(false); }
    };
    return <Dialog open={open} onClose={() => { if (!working) onClose?.(); }} fullWidth maxWidth="md" aria-labelledby="workspace-media-editor-title"><DialogTitle id="workspace-media-editor-title">{ar ? 'ملفات قناة واتساب' : 'WhatsApp channel files'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography>{ar ? 'احفظ ملفًا مع سجل حق استخدامه أولًا، ثم قدّم طلبًا مراجعًا لرفعه إلى مكتبة القناة أو فحص حالته. لا يرسل هذا النموذج رسالة.' : 'First save a file with its usage-rights record, then prepare a reviewed request to upload it to the channel library or inspect its status. This form sends no message.'}</Typography>
        {!current && <Alert severity="info" action={<Button color="inherit" disabled={working || busy} onClick={check}>{ar ? 'التحقق من النشاط والخيارات' : 'Check activity and choices'}</Button>}>{ar ? 'يلزم تحقق حديث بعد اختيار الملف أو العودة إلى الصفحة. لا تُستخدم الخيارات السابقة كصلاحية.' : 'A fresh check is needed after choosing a file or returning to this page. Previous choices do not establish permission.'}</Alert>}
        {error && <Alert severity="warning">{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}
        {pendingKey && <Alert severity="warning" action={<Button color="inherit" disabled={working || busy} onClick={lookup}>{ar ? 'فحص الحفظ الأصلي' : 'Check original save'}</Button>}>{ar ? 'توجد محاولة حفظ محلي تحتاج تأكيدًا. لن يُنشأ مفتاح جديد لتجاوزها.' : 'A local save attempt needs confirmation. A new key will not bypass it.'}</Alert>}
        <Choice label={ar ? 'حساب واتساب' : 'WhatsApp account'} value={draft.account_ref} rows={current ? options.accounts : []} disabled={blocked} onChange={value => { set('account_ref', value); setOptions(null); }} />
        <Typography variant="body2" color="text.secondary">{ar ? 'بعد تغيير الحساب، تحقّق من الخيارات لتحميل ملفاته الحالية.' : 'After changing the account, check choices to load its current files.'}</Typography>
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}><Stack spacing={2}>
            <Typography component="h3" fontWeight={800}>{ar ? 'حفظ ملف محليًا قبل المراجعة' : 'Save a local file before review'}</Typography>
            <Typography variant="body2">{options?.provenance_notice || (ar ? 'يلزم سجل فعلي لحق استخدام هذا الملف على القناة، وليس مربع موافقة فقط.' : 'An actual record of the right to use this file on the channel is required.')}</Typography>
            <input key={fileInputKey} type="file" aria-label={ar ? 'اختيار ملف محلي' : 'Choose a local file'} disabled={!pickerActive && (!current || held || busy || working || Boolean(pendingKey) || options?.can_stage !== true)}
                onClick={() => setPickerActive(true)} onCancel={() => setPickerActive(false)} onChange={event => { setFile(event.target.files?.[0] || null); setPickerActive(false); setStageReview(null); setPreview(null); }} />
            {file && <Typography variant="body2"><bdi>{file.name}</bdi> · {file.size} {ar ? 'بايت' : 'bytes'}</Typography>}
            <TextField fullWidth label={ar ? 'مرجع حق استخدام الملف' : 'File usage-rights reference'} value={draft.evidence_reference} disabled={blocked || options?.can_stage !== true} onChange={event => set('evidence_reference', event.target.value)} inputProps={{ maxLength: 1000 }} />
            <TextField fullWidth multiline minRows={3} label={ar ? 'وصف الدليل الفعلي لحق الاستخدام' : 'Describe the actual usage-rights evidence'} value={draft.rights_note} disabled={blocked || options?.can_stage !== true} onChange={event => set('rights_note', event.target.value)} helperText={ar ? 'اذكر مصدر الحق ونطاقه بما لا يقل عن 20 حرفًا.' : 'Describe the rights source and scope in at least 20 characters.'} inputProps={{ maxLength: 2000 }} />
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField fullWidth type="datetime-local" label={ar ? 'وقت تسجيل الدليل الفعلي' : 'Actual evidence recording time'} value={draft.rights_recorded_at} disabled={blocked} onChange={event => set('rights_recorded_at', event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr' } }} />
                <TextField fullWidth type="datetime-local" label={ar ? 'نهاية صلاحية حق الاستخدام' : 'Usage-rights expiry'} value={draft.rights_valid_until} disabled={blocked} onChange={event => set('rights_valid_until', event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr' } }} /></Stack>
            {stageReview && <Alert severity="info"><Stack spacing={1}><Typography fontWeight={800}>{ar ? 'مراجعة الحفظ المحلي' : 'Review local save'}</Typography><Typography>{stageReview.accountLabel}</Typography><Typography>{stageReview.file.name} · {stageReview.file.size} {ar ? 'بايت' : 'bytes'}</Typography>
                <Typography>{stageReview.payload.evidence_reference}</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{stageReview.payload.rights_note}</Typography><Typography><bdi dir="ltr">{stageReview.payload.rights_recorded_at}</bdi> → <bdi dir="ltr">{stageReview.payload.rights_valid_until}</bdi></Typography>
                <Typography>{ar ? 'هذا حفظ محلي مشفّر فقط. الرفع إلى واتساب يحتاج طلبًا منفصلًا مراجعًا.' : 'This is an encrypted local save only. Uploading to WhatsApp requires a separate reviewed request.'}</Typography></Stack></Alert>}
            <Box><Button variant="outlined" disabled={blocked || !file || options?.can_stage !== true} onClick={stageReview ? saveStage : prepareStage}>{stageReview ? (ar ? 'حفظ هذا الملف محليًا' : 'Save this file locally') : (ar ? 'مراجعة الحفظ المحلي' : 'Review local save')}</Button></Box>
        </Stack></Box>
        <Choice label={ar ? 'ملف محفوظ بالنشاط' : 'File saved by the activity'} value={draft.asset_ref} rows={current ? options.assets : []} disabled={blocked} onChange={value => set('asset_ref', value)} />
        {current && options.assets.some(row => ['unknown', 'uploading'].includes(row.state)) && <Alert severity="warning" action={onShowOperations && <Button color="inherit" onClick={onShowOperations}>{ar ? 'متابعة الطلب الأصلي' : 'Follow original request'}</Button>}>{ar ? 'توجد ملفات ذات رفع قيد التحقق أو نتيجة غير مؤكدة. تابع طلب الرفع الأصلي؛ لا تُنشئ رفعًا جديدًا لتجاوزه.' : 'Some file uploads are pending verification or have unknown outcomes. Follow the original upload request; do not create another upload to bypass it.'}</Alert>}
        {asset && current && !asset.evidence_reference && <Alert severity="info">{ar ? 'مرجع حق استخدام هذا الملف غير متاح ضمن تفويض البيانات الحالي. يلزم إتاحته قبل إعداد طلب القناة.' : 'This file’s usage-rights reference is not available within the current data permission. It must be available before preparing a channel request.'}</Alert>}
        {asset && current && <Alert severity={['unknown', 'uploading'].includes(asset.state) ? 'warning' : 'info'}><Stack><Typography>{asset.filename} · {asset.mime_type} · {asset.byte_size} {ar ? 'بايت' : 'bytes'}</Typography><Typography>{({ staged: ar ? 'محفوظ محليًا، لم يُرفع' : 'Saved locally, not uploaded', uploading: ar ? 'الرفع الأصلي قيد التحقق' : 'Original upload is being checked', uploaded: ar ? 'يوجد إيصال رفع محفوظ' : 'An upload receipt is stored', unknown: ar ? 'نتيجة الرفع غير مؤكدة' : 'Upload outcome unconfirmed', rejected: ar ? 'لم يُقبل الرفع السابق' : 'Previous upload rejected' })[asset.state]}</Typography>{asset.reason && <Typography>{asset.reason}</Typography>}
            <Typography variant="body2">{ar ? 'صلاحية سجل الحق: ' : 'Rights record expiry: '}<bdi dir="ltr">{asset.rights_valid_until}</bdi></Typography></Stack></Alert>}
        <Choice label={ar ? 'العملية المطلوبة' : 'Requested action'} value={draft.action} rows={current ? options.actions.map(row => ({ ...row, available: Boolean(asset?.available && !['unknown', 'uploading'].includes(asset.state) && asset.actions.some(item => item.value === row.value && item.available)) })) : []} disabled={blocked || !asset} onChange={value => set('action', value)} />
        {preview && <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}><Stack spacing={1}><Typography fontWeight={800}>{workspaceAvailabilityLabel(preview.availability?.state, language)}</Typography><Typography>{preview.availability?.message}</Typography>
            {workspaceReviewSummaryIsValid(preview.summary) && preview.summary.map(row => <Typography key={row.label}><strong>{row.label}: </strong><bdi dir={/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? 'ltr' : 'auto'}>{row.value}</bdi></Typography>)}</Stack></Box>}
    </Stack></DialogContent><DialogActions sx={{ gap: 1, flexWrap: 'wrap' }}><Button disabled={working} onClick={onClose}>{ar ? 'إغلاق' : 'Close'}</Button><Button disabled={working || busy} onClick={check}>{ar ? 'تحديث الخيارات' : 'Refresh choices'}</Button>
        <Button variant="outlined" disabled={blocked || !parameters} onClick={checkPreview}>{ar ? 'التحقق من الملف والحق الحالي' : 'Check file and current rights'}</Button>
        <Button variant="contained" disabled={blocked || !previewCurrent} onClick={() => { if (previewCurrent) onReview?.({ activity: binding.descriptor.activity, provider: binding.descriptor.provider, capability: 'media.manage', action: draft.action, parameters: previewCurrent }); }}>{ar ? 'مراجعة طلب القناة' : 'Review channel request'}</Button>
    </DialogActions></Dialog>;
};
export default WorkspaceMediaActionEditor;
