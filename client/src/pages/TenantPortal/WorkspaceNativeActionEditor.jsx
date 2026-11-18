import React from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { workspaceAvailabilityLabel, workspaceLabel, workspaceReviewSummaryIsValid } from './connectionsDataPresentation';
import { updateWorkspaceNativeDraft, workspaceNativeConsentChoices, workspaceNativeDraftErrors, workspaceNativeInputAction, workspaceNativeOptionsIsCurrent } from './workspaceNativePresentation';

const NativeChoice = ({ label, value, choices = [], disabled, error, onChange, ar }) => <TextField select fullWidth label={label} value={value} disabled={disabled}
    error={Boolean(error)} helperText={error} onChange={event => onChange(event.target.value)}>
    <MenuItem value="">{ar ? 'اختر من القائمة الحالية' : 'Choose from the current list'}</MenuItem>
    {choices.map(option => <MenuItem key={option.value} value={option.value} disabled={option.available !== true && option.enabled !== true} sx={{ whiteSpace: 'normal' }}>
        <Box><Typography variant="body2">{workspaceLabel(option.label, ar ? 'اسم الخيار غير متاح' : 'Option name unavailable')}</Typography>
            {option.available !== true && option.enabled !== true && <Typography variant="caption">{option.reason || (ar ? 'هذا الخيار غير متاح حاليًا.' : 'This choice is currently unavailable.')}</Typography>}
        </Box>
    </MenuItem>)}
</TextField>;

const ConsentSource = ({ evidence, ar }) => evidence ? <Box sx={{ pl: 1, borderInlineStart: 2, borderColor: 'divider' }}>
    <Typography variant="body2">{ar ? 'مصدر الدليل: ' : 'Evidence source: '}{workspaceLabel(evidence.source_label, ar ? 'لم يُتحقق مصدر الدليل' : 'Evidence source unverified')}</Typography>
    {evidence.recorded_at && <Typography variant="caption" display="block">{ar ? 'تاريخ التسجيل: ' : 'Recorded: '}<bdi dir="ltr">{evidence.recorded_at}</bdi></Typography>}
    {evidence.valid_until && <Typography variant="caption" display="block">{ar ? 'صالح حتى: ' : 'Valid until: '}<bdi dir="ltr">{evidence.valid_until}</bdi></Typography>}
</Box> : null;

const WorkspaceNativeActionEditor = ({ open = false, descriptor, options, draft, preview, verified = false, held = true, busy = false,
    now = 0, onChange, onRefresh, onPreview, onReview, onNextAction, onClose,
    recipientQuery = '', onRecipientQuery, onRecipientSearch, onRecipientNext, onManageConsent, language = 'ar' }) => {
    const ar = language === 'ar';
    const action = workspaceNativeInputAction(descriptor?.action);
    const reviewOnly = ['messaging.review', 'campaigns.review', 'content.review'].includes(descriptor?.action);
    const blocked = !verified || held || busy;
    const current = workspaceNativeOptionsIsCurrent(options, now);
    const errors = current ? workspaceNativeDraftErrors({ action, draft, options, now, language }) : { form: ar ? 'حدّث الخيارات الحالية لهذا النشاط.' : 'Refresh the current activity choices.' };
    const set = (key, value) => onChange?.(updateWorkspaceNativeDraft(draft, key, value));
    const accountOptions = (options?.accounts || []).filter(account => account.channel === draft.channel);
    const template = options?.templates.find(item => item.value === draft.template_ref);
    const consentOptions = workspaceNativeConsentChoices(options, draft.recipient_ref, draft.purpose, now);
    const selectedConsent = consentOptions.find(item => item.value === draft.consent_ref);
    const content = options?.contents.find(item => item.value === draft.content_ref);
    const availability = options?.capabilities?.find(item => item.action === descriptor?.action)?.availability;
    const canManageConsent = options?.consent_management?.can_record === true || options?.consent_management?.can_revoke === true;
    const title = reviewOnly ? (ar ? 'إعداد مسودة مراجعة للنشاط' : 'Prepare an activity review draft')
        : { 'messaging.send': ar ? 'إعداد رسالة لشخص محدد' : 'Prepare a message for a person', 'campaigns.execute': ar ? 'إعداد حملة لأشخاص محددين' : 'Prepare a campaign for selected people', 'content.publish': ar ? 'إعداد نشر محتوى معتمد' : 'Prepare approved content for publication' }[action] || (ar ? 'إعداد طلب' : 'Prepare a request');
    const previewCurrent = preview && typeof preview.valid_until === 'string' && Date.parse(preview.valid_until) > now;
    const canReviewPreview = previewCurrent && ['available', 'review_available'].includes(preview.availability?.state)
        && preview.quote?.within_budget === true && Number.isSafeInteger(preview.quote.total_credits) && typeof preview.resource_fingerprint === 'string';
    return <Dialog open={open && verified} onClose={() => { if (!busy) onClose?.(); }} fullWidth maxWidth="md" aria-labelledby="workspace-native-editor-title">
        <DialogTitle id="workspace-native-editor-title">{title}</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{reviewOnly ? (ar ? 'يحفظ هذا الطلب مسودة مراجعة لدى النشاط. يحتاج أي إرسال أو نشر لاحق إلى طلب وصلاحية مستقلة.' : 'This request records an activity review draft. Any later sending or publication requires a separate request and permission.')
                : (ar ? 'اختر الموارد الحالية وراجع الدليل والتكلفة. يُقدّم الطلب للمراجعة قبل تنفيذه.' : 'Choose current resources and review the evidence and cost. The request is submitted for review before execution.')}</Typography>
            {held && <Alert severity="warning">{ar ? 'افحص نتيجة العملية السابقة قبل إعداد طلب جديد.' : 'Check the earlier operation outcome before preparing a new request.'}</Alert>}
            {!current && <Alert severity="info" action={<Button color="inherit" disabled={busy} onClick={onRefresh}>{ar ? 'تحديث الخيارات' : 'Refresh choices'}</Button>}>{ar ? 'يلزم التحقق من الحساب والموارد ودليل الموافقة الحالي قبل المتابعة.' : 'The current account, resources and consent evidence must be checked before continuing.'}</Alert>}
            {current && <>
                {availability && <Alert severity={['available', 'review_available'].includes(availability.state) ? 'info' : 'warning'} action={availability.next_action && onNextAction && !['available', 'review_available'].includes(availability.state) ? <Button color="inherit" disabled={busy} onClick={() => onNextAction(availability.next_action)}>{workspaceLabel(availability.next_action.label, ar ? 'عرض الخطوة التالية' : 'View next step')}</Button> : null}>{availability.message}</Alert>}
                <NativeChoice label={ar ? 'القناة' : 'Channel'} value={draft.channel} choices={options.channels.filter(channel => action === 'campaigns.execute' ? channel.value === 'whatsapp' : action === 'content.publish' ? channel.value === 'facebook' : true)} disabled={blocked} error={errors.channel} onChange={value => set('channel', value)} ar={ar} />
                <NativeChoice label={ar ? 'الحساب الذي سينفذ الطلب' : 'Account that will carry out the request'} value={draft.account_ref} choices={accountOptions} disabled={blocked || !draft.channel} error={errors.account_ref} onChange={value => set('account_ref', value)} ar={ar} />
                {action !== 'content.publish' && <>
                    {onRecipientSearch && <Stack spacing={1}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}><TextField fullWidth label={ar ? 'البحث عن شخص بالاسم أو بيانات الاتصال' : 'Find a person by name or contact details'} value={recipientQuery} disabled={blocked || !draft.account_ref}
                            onChange={event => onRecipientQuery?.(event.target.value)} inputProps={{ maxLength: 100 }} />
                            <Button variant="outlined" disabled={blocked || !draft.account_ref} onClick={onRecipientSearch}>{ar ? 'بحث' : 'Search'}</Button>
                            {options.recipients_next_cursor && onRecipientNext && <Button variant="outlined" disabled={blocked || !draft.account_ref} onClick={onRecipientNext}>{ar ? 'الأشخاص التاليون' : 'Next people'}</Button>}</Stack>
                        <Typography variant="caption" color="text.secondary">{ar ? 'يعرض البحث حتى 100 شخص في الصفحة. تغيير البحث أو الصفحة يمسح اختيار الأشخاص السابق للتحقق من دليلهم الحالي.' : 'Search shows up to 100 people per page. Changing the search or page clears the earlier people selection so their current evidence can be checked.'}</Typography>
                    </Stack>}
                    {action === 'messaging.send' && <NativeChoice label={ar ? 'الشخص المستلم' : 'Recipient'} value={draft.recipient_ref} choices={options.recipients} disabled={blocked || !draft.account_ref} error={errors.recipient_ref} onChange={value => set('recipient_ref', value)} ar={ar} />}
                    <NativeChoice label={ar ? 'غرض التواصل' : 'Purpose of contact'} value={draft.purpose} choices={options.purposes.map(purpose => ({ ...purpose, available: true }))} disabled={blocked || !draft.account_ref} error={errors.purpose} onChange={value => set('purpose', value)} ar={ar} />
                    {action === 'messaging.send' && onManageConsent && <Box><Button variant="outlined" disabled={blocked || !draft.account_ref || !canManageConsent} onClick={() => onManageConsent(draft.recipient_ref)}>{ar ? 'تسجيل دليل الموافقة أو مراجعته' : 'Record or review consent evidence'}</Button>
                        {!canManageConsent && <Typography variant="caption" display="block">{ar ? 'إدارة الدليل تتطلب تفويض حقول الموافقة والموارد الحالية لهذا النشاط.' : 'Managing evidence requires current consent field and resource permission for this activity.'}</Typography>}</Box>}
                    {action === 'messaging.send' && <>
                        <NativeChoice label={ar ? 'دليل الموافقة الحالي لهذا الغرض' : 'Current consent evidence for this purpose'} value={draft.consent_ref} choices={consentOptions} disabled={blocked || !draft.recipient_ref || !draft.purpose} error={errors.consent_ref} onChange={value => set('consent_ref', value)} ar={ar} />
                        <ConsentSource evidence={selectedConsent?.evidence} ar={ar} />
                        {draft.recipient_ref && draft.purpose && !consentOptions.length && <Alert severity="info">{ar ? 'لا يوجد دليل مسجل لهذا الشخص والغرض. أكمل متطلب الموافقة من المسار المعتمد ثم حدّث الخيارات.' : 'No evidence is recorded for this person and purpose. Complete the approved consent step, then refresh choices.'}</Alert>}
                    </>}
                    {action === 'campaigns.execute' && <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}><Typography component="legend" fontWeight={700}>{ar ? 'الأشخاص ودليل الموافقة لكل منهم' : 'People and consent evidence for each'}</Typography>
                        {options.recipients.map(recipient => {
                            const picked = draft.recipients.find(item => item.recipient_ref === recipient.value);
                            const evidenceChoices = workspaceNativeConsentChoices(options, recipient.value, draft.purpose, now);
                            return <Stack key={recipient.value} spacing={1} sx={{ my: 1.5 }}><FormControlLabel label={recipient.label} disabled={blocked || !draft.purpose || (!picked && (recipient.available !== true || draft.recipients.length >= 100))}
                                control={<Checkbox checked={Boolean(picked)} onChange={event => set('recipients', event.target.checked ? [...draft.recipients, { recipient_ref: recipient.value, consent_ref: '' }] : draft.recipients.filter(item => item.recipient_ref !== recipient.value))} />} />
                                {picked && <><NativeChoice label={ar ? `دليل الموافقة — ${recipient.label}` : `Consent evidence — ${recipient.label}`} value={picked.consent_ref} choices={evidenceChoices} disabled={blocked} onChange={value => set('recipients', draft.recipients.map(item => item.recipient_ref === recipient.value ? { ...item, consent_ref: value } : item))} ar={ar} />
                                    {onManageConsent && <Box><Button disabled={blocked || !canManageConsent} onClick={() => onManageConsent(recipient.value)}>{ar ? 'تسجيل الدليل أو مراجعته لهذا الشخص' : 'Record or review this person’s evidence'}</Button></Box>}
                                    <ConsentSource evidence={evidenceChoices.find(item => item.value === picked.consent_ref)?.evidence} ar={ar} /></>}
                            </Stack>;
                        })}
                        {errors.recipients && <Typography variant="caption" color="error">{errors.recipients}</Typography>}
                    </Box>}
                    <NativeChoice label={ar ? 'قالب الرسالة المعتمد، إن استُخدم' : 'Approved message template, when used'} value={draft.template_ref} choices={options.templates} disabled={blocked || !draft.account_ref} error={errors.template_ref} onChange={value => set('template_ref', value)} ar={ar} />
                    {template && <><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{template.body_preview}</Typography>{(template.fields || []).map(field => <TextField key={field.key} fullWidth label={field.label} disabled={blocked} value={draft.template_values[field.key] || ''} inputProps={{ maxLength: 4000 }} onChange={event => set('template_values', { ...draft.template_values, [field.key]: event.target.value })} />)}</>}
                    {action === 'messaging.send' && !draft.template_ref && <TextField multiline minRows={4} label={ar ? 'نص الرسالة' : 'Message text'} value={draft.message} disabled={blocked || !draft.account_ref} onChange={event => set('message', event.target.value)} error={Boolean(errors.message)} helperText={errors.message} inputProps={{ maxLength: 10_000 }} />}
                    {action === 'campaigns.execute' && errors.message && <Typography variant="caption" color="error">{errors.message}</Typography>}
                </>}
                {action === 'content.publish' && <><NativeChoice label={ar ? 'المحتوى المعتمد من مكتبة المصدر' : 'Approved content from the source library'} value={draft.content_ref} choices={options.contents} disabled={blocked || !draft.account_ref} error={errors.content_ref} onChange={value => set('content_ref', value)} ar={ar} />
                    {content && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{content.preview}</Typography>}</>}
                <TextField label={ar ? 'الحد الأقصى للتكلفة بالأرصدة' : 'Maximum cost in credits'} value={draft.max_cost_credits} disabled={blocked} onChange={event => set('max_cost_credits', event.target.value)} error={Boolean(errors.max_cost_credits)} helperText={errors.max_cost_credits} inputProps={{ inputMode: 'numeric', maxLength: 16 }} />
            </>}
            {previewCurrent && <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}><Stack spacing={1}>
                <Typography fontWeight={700}>{workspaceAvailabilityLabel(preview.availability?.state, language)}</Typography><Typography variant="body2">{preview.availability?.message}</Typography>
                {preview.availability?.next_action && onNextAction && !['available', 'review_available'].includes(preview.availability.state) && <Box><Button disabled={busy} onClick={() => onNextAction(preview.availability.next_action)}>{workspaceLabel(preview.availability.next_action.label, ar ? 'عرض الخطوة التالية' : 'View next step')}</Button></Box>}
                {Number.isSafeInteger(preview.quote?.total_credits) && <Typography>{ar ? 'التكلفة الحالية: ' : 'Current cost: '}{preview.quote.total_credits} {workspaceLabel(preview.quote.currency_label, ar ? 'رصيد' : 'credits')}</Typography>}
                {preview.quote?.total_credits === null && <Typography>{ar ? 'لم تتأكد التكلفة الحالية بعد.' : 'The current cost has not been confirmed yet.'}</Typography>}
                {workspaceReviewSummaryIsValid(preview.summary) && preview.summary.map(row => <Typography key={row.label} variant="body2"><strong>{row.label}: </strong>{row.value}</Typography>)}
            </Stack></Box>}
        </Stack></DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}><Button onClick={onClose} disabled={busy}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button variant="outlined" disabled={blocked || Object.keys(errors).length > 0} onClick={onPreview}>{ar ? 'حساب التكلفة والتحقق' : 'Calculate cost and check'}</Button><Button variant="contained" disabled={blocked || !canReviewPreview} onClick={onReview}>{ar ? 'مراجعة الطلب' : 'Review request'}</Button></DialogActions>
    </Dialog>;
};

export default WorkspaceNativeActionEditor;
