import React from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { workspaceAvailabilityLabel, workspaceLabel, workspaceReviewSummaryIsValid } from './connectionsDataPresentation';
import { clearWorkspaceBusinessField, updateWorkspaceBusinessDraft, workspaceBusinessConsentChoices, workspaceBusinessDraftErrors, workspaceBusinessOptionsIsCurrent } from './workspaceBusinessPresentation';

const Choice = ({ label, value, rows = [], disabled, error, onChange, ar }) => <TextField select fullWidth label={label} value={value} disabled={disabled}
    error={Boolean(error)} helperText={error} onChange={event => onChange(event.target.value)}>
    <MenuItem value="">{ar ? 'اختر من القائمة الحالية' : 'Choose from the current list'}</MenuItem>
    {rows.map(row => <MenuItem key={row.value} value={row.value} disabled={row.available === false} sx={{ whiteSpace: 'normal' }}><Box>
        <Typography variant="body2">{workspaceLabel(row.label, ar ? 'الاسم غير متاح' : 'Name unavailable')}</Typography>
        {row.available === false && <Typography variant="caption">{row.availability?.message || row.reason || (ar ? 'هذا الخيار غير متاح حاليًا.' : 'This choice is currently unavailable.')}</Typography>}
    </Box></MenuItem>)}
</TextField>;

const WorkspaceBusinessActionEditor = ({ open = false, descriptor, options, draft, preview, verified = false, held = true, busy = false, now = 0,
    contactQuery = '', onContactQuery, onContactSearch, onContactNext, onOperationNext, onChange, onRefresh, onPreview, onReview,
    onManageConsent, onNextAction, onClose, language = 'ar' }) => {
    const ar = language === 'ar', capability = descriptor?.capability;
    const current = workspaceBusinessOptionsIsCurrent(options, capability, now);
    const blocked = !verified || held || busy;
    const errors = workspaceBusinessDraftErrors({ capability, draft, options, now, language });
    const set = (field, value) => onChange?.(updateWorkspaceBusinessDraft(draft, field, value));
    const contactAction = capability === 'customers.manage';
    const existingContact = contactAction && ['contacts.change', 'contacts.remove', 'contacts.read'].includes(draft.action);
    const action = options?.actions?.find(row => row.value === draft.action);
    const consentChoices = workspaceBusinessConsentChoices(options, draft, now);
    const consent = consentChoices.find(row => row.value === draft.consent_ref);
    const canManageConsent = options?.consent_management?.can_record === true || options?.consent_management?.can_revoke === true;
    const previewCurrent = preview && Date.parse(preview.valid_until) > now;
    const reviewable = previewCurrent && preview.availability?.state === 'review_available' && preview.quote?.within_budget === true
        && preview.quote.total_credits === 0 && /^[a-f0-9]{64}$/.test(preview.resource_fingerprint);
    const title = contactAction ? (ar ? 'إعداد طلب لجهات الاتصال' : 'Prepare a contact request')
        : capability === 'owner.operations' ? (ar ? 'فحص حالة عملية بالنشاط' : 'Check an activity operation')
            : (ar ? 'إعداد طلب لقياس نشاط الرسائل' : 'Prepare a messaging measurement request');
    const ordinary = [
        ['phone', ar ? 'رقم جهة الاتصال' : 'Contact phone', 100], ['profile_name', ar ? 'اسم جهة الاتصال' : 'Contact name', 200],
        ['label', ar ? 'التصنيف الجديد' : 'New classification', 64], ['notes', ar ? 'الملاحظات الجديدة' : 'New notes', 2000],
    ].filter(([field]) => options?.editable_fields?.includes(field) && (draft.action === 'contacts.create' || (draft.action === 'contacts.change' && ['label', 'notes'].includes(field))));
    return <Dialog open={open && verified} onClose={() => { if (!busy) onClose?.(); }} fullWidth maxWidth="md" aria-labelledby="workspace-business-editor-title">
        <DialogTitle id="workspace-business-editor-title">{title}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
            {!current && <Alert severity="info" action={<Button color="inherit" disabled={busy} onClick={onRefresh}>{ar ? 'تحديث الخيارات' : 'Refresh choices'}</Button>}>{ar ? 'يلزم التحقق من الخيارات والصلاحية الحالية قبل إعداد الطلب.' : 'Current choices and permission must be checked before preparing the request.'}</Alert>}
            {held && <Alert severity="warning">{ar ? 'افحص نتيجة العملية السابقة قبل إعداد طلب جديد.' : 'Check the earlier operation outcome before preparing a new request.'}</Alert>}
            {current && <>
                {options.privacy_notice && <Typography variant="body2">{options.privacy_notice}</Typography>}
                {!contactAction && capability !== 'owner.operations' && <Typography variant="body2">{ar ? 'تتناول هذه المؤشرات نشاط رسائل WhatsApp المسجل في هذا النشاط.' : 'These measurements cover recorded WhatsApp messaging activity for this activity.'}</Typography>}
                <Choice label={ar ? 'العملية المطلوبة' : 'Requested action'} value={draft.action} rows={options.actions} disabled={blocked} error={errors.action} onChange={value => set('action', value)} ar={ar} />
                {action?.availability && action.available !== true && <Alert severity="info">{action.availability.message}</Alert>}
                <Choice label={ar ? 'الحساب' : 'Account'} value={draft.account_ref} rows={options.accounts} disabled={blocked || !draft.action} error={errors.account_ref} onChange={value => set('account_ref', value)} ar={ar} />
                <Choice label={ar ? 'غرض استخدام البيانات' : 'Purpose for using the data'} value={draft.purpose} rows={options.purposes} disabled={blocked || !draft.account_ref} error={errors.purpose} onChange={value => set('purpose', value)} ar={ar} />
                <TextField fullWidth label={ar ? 'مرجع العمل لهذا الطلب' : 'Business reference for this request'} value={draft.evidence_reference} disabled={blocked || !draft.account_ref}
                    onChange={event => set('evidence_reference', event.target.value)} error={Boolean(errors.evidence_reference)} helperText={errors.evidence_reference || (ar ? 'مثل مرجع طلب العميل أو سجل التصحيح المعتمد.' : 'For example, a customer request or approved correction record.')} inputProps={{ maxLength: 1000 }} />
                {existingContact && <>
                    {onContactSearch && <Stack spacing={1}><Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
                        <TextField fullWidth label={ar ? 'البحث عن جهة اتصال بالاسم أو التصنيف' : 'Find a contact by name or classification'} value={contactQuery} disabled={blocked}
                            onChange={event => onContactQuery?.(event.target.value)} inputProps={{ maxLength: 100 }} />
                        <Button variant="outlined" disabled={blocked} onClick={onContactSearch}>{ar ? 'بحث' : 'Search'}</Button>
                        {options.contacts_next_cursor && <Button disabled={blocked} onClick={onContactNext}>{ar ? 'الجهات التالية' : 'Next contacts'}</Button>}
                    </Stack><Typography variant="caption">{ar ? 'تغيير صفحة البحث يلغي اختيار الجهة ودليلها السابق للتحقق من الخيارات الحالية.' : 'Changing the search page clears the earlier contact and evidence selection so current choices can be checked.'}</Typography></Stack>}
                    <Choice label={ar ? 'جهة الاتصال' : 'Contact'} value={draft.contact_ref} rows={options.contacts} disabled={blocked || !draft.account_ref} error={errors.contact_ref} onChange={value => set('contact_ref', value)} ar={ar} />
                    <Choice label={ar ? 'دليل السماح باستخدام بيانات الجهة لهذا الغرض' : 'Evidence allowing this contact’s data use for this purpose'} value={draft.consent_ref} rows={consentChoices}
                        disabled={blocked || !draft.contact_ref || !draft.purpose} error={errors.consent_ref} onChange={value => set('consent_ref', value)} ar={ar} />
                    {consent && <Box><Typography variant="body2">{ar ? 'مصدر الدليل: ' : 'Evidence source: '}{consent.source_label}</Typography>
                        <Typography variant="caption">{ar ? 'صالح حتى: ' : 'Valid until: '}<bdi dir="ltr">{consent.valid_until}</bdi></Typography></Box>}
                    {onManageConsent && <Box><Button variant="outlined" disabled={blocked || !draft.account_ref || !canManageConsent} onClick={() => onManageConsent(draft.contact_ref)}>{ar ? 'تسجيل دليل الاستخدام أو مراجعته' : 'Record or review data-use evidence'}</Button>
                        {!canManageConsent && <Typography variant="caption" display="block">{ar ? 'يلزم تفويض حقول دليل الموافقة والموارد المحددة لإدارته.' : 'Managing evidence requires permission for its fields and selected resources.'}</Typography>}</Box>}
                </>}
                {ordinary.map(([field, label, maxLength]) => <Box key={field}><TextField fullWidth label={label} value={draft[field]} multiline={field === 'notes'} minRows={field === 'notes' ? 3 : undefined}
                    disabled={blocked || draft.clearFields.includes(field)} onChange={event => set(field, event.target.value)} error={Boolean(errors[field])} helperText={errors[field]} inputProps={{ maxLength, ...(field === 'phone' ? { inputMode: 'tel', dir: 'ltr' } : {}) }} />
                    {draft.action === 'contacts.change' && <FormControlLabel disabled={blocked} label={ar ? `مسح ${field === 'label' ? 'التصنيف' : 'الملاحظات'} صراحةً` : `Explicitly clear ${field === 'label' ? 'classification' : 'notes'}`}
                        control={<Checkbox checked={draft.clearFields.includes(field)} onChange={event => onChange?.(clearWorkspaceBusinessField(draft, field, event.target.checked))} />} />}
                </Box>)}
                {draft.action === 'contacts.remove' && <Alert severity="warning">{ar ? 'سيُقدّم طلب لإزالة جهة الاتصال المختارة. راجع الاسم والغرض والدليل قبل طلب الاعتماد.' : 'A request to remove the selected contact will be prepared. Review the name, purpose and evidence before requesting approval.'}</Alert>}
                {capability === 'owner.operations' && <><Choice label={ar ? 'العملية التي تريد فحص حالتها' : 'Operation whose status you want to check'} value={draft.command_ref} rows={options.operations}
                    disabled={blocked || !draft.account_ref} error={errors.command_ref} onChange={value => set('command_ref', value)} ar={ar} />
                    {options.operations_next_cursor && <Box><Button disabled={blocked} onClick={onOperationNext}>{ar ? 'العمليات التالية' : 'Next operations'}</Button></Box>}</>}
            </>}
            {errors.form && <Typography color="error" variant="body2">{errors.form}</Typography>}
            {previewCurrent && <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}><Stack spacing={1}>
                <Typography fontWeight={700}>{workspaceAvailabilityLabel(preview.availability?.state, language)}</Typography><Typography>{preview.availability?.message}</Typography>
                {preview.availability?.next_action && onNextAction && preview.availability.state !== 'review_available' && <Box><Button disabled={busy} onClick={() => onNextAction(preview.availability.next_action)}>{preview.availability.next_action.label}</Button></Box>}
                {workspaceReviewSummaryIsValid(preview.summary) && preview.summary.map(row => <Typography key={row.label} variant="body2"><strong>{row.label}: </strong><bdi dir={/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? 'ltr' : 'auto'}>{row.value}</bdi></Typography>)}
            </Stack></Box>}
        </Stack></DialogContent><DialogActions sx={{ gap: 1, flexWrap: 'wrap' }}><Button onClick={onClose} disabled={busy}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button variant="outlined" disabled={blocked || Object.keys(errors).length > 0} onClick={onPreview}>{ar ? 'التحقق من البيانات الحالية' : 'Check current data'}</Button>
            <Button variant="contained" disabled={blocked || !reviewable} onClick={onReview}>{ar ? 'مراجعة الطلب' : 'Review request'}</Button>
        </DialogActions>
    </Dialog>;
};
export default WorkspaceBusinessActionEditor;
