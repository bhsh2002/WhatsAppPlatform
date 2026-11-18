import React, { useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, FormGroup, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { emptyWorkspaceSelection, updateWorkspaceSelection, workspaceChoiceAvailable, workspaceConnectionReviewCanSubmit, workspaceLabel, workspaceReviewSummaryIsValid, workspaceSelectionCanReview } from './connectionsDataPresentation';

const NamedChoice = ({ label, options = [], value, onChange, disabled, emptyText, ar, name }) => <TextField
    select fullWidth label={label} value={value} onChange={event => onChange(event.target.value)}
    disabled={disabled} inputProps={{ name }} helperText={options.length ? undefined : emptyText}
>
    <MenuItem value="">{ar ? 'اختر من الخيارات المتاحة' : 'Choose an available option'}</MenuItem>
    {options.map(option => <MenuItem key={option.value} value={option.value} disabled={!workspaceChoiceAvailable(option)} sx={{ whiteSpace: 'normal' }}>
        <Box><Typography variant="body2">{workspaceLabel(option.label, ar ? 'اسم الخيار غير متاح' : 'Option name unavailable')}</Typography>
            {!workspaceChoiceAvailable(option) && <Typography variant="caption" color="text.secondary">{option.reason || (ar ? 'يلزم التحقق من هذا الخيار أولًا.' : 'This option needs verification first.')}</Typography>}
        </Box>
    </MenuItem>)}
</TextField>;

const NamedChecks = ({ title, options = [], values = [], onChange, disabled, emptyText, ar }) => <Box component="fieldset" sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
    <Typography component="legend" fontWeight={700} sx={{ mb: 0.5 }}>{title}</Typography>
    {!options.length && <Typography variant="body2" color="text.secondary">{emptyText}</Typography>}
    <FormGroup>{options.map(option => <FormControlLabel key={option.value} disabled={disabled || (!workspaceChoiceAvailable(option) && !values.includes(option.value))}
        control={<Checkbox checked={values.includes(option.value)} onChange={event => {
            if (!event.target.checked || workspaceChoiceAvailable(option)) onChange(event.target.checked
                ? [...values, option.value] : values.filter(value => value !== option.value));
        }} />}
        label={<Box><Typography variant="body2">{workspaceLabel(option.label, ar ? 'اسم الخيار غير متاح' : 'Option name unavailable')}</Typography>
            {option.description && <Typography variant="caption" color="text.secondary">{option.description}</Typography>}
            {!workspaceChoiceAvailable(option) && <Typography variant="caption" color="text.secondary" display="block">{option.reason || (ar ? 'هذا الخيار غير متاح حاليًا.' : 'This choice is currently unavailable.')}</Typography>}
        </Box>} sx={{ alignItems: 'flex-start', '& .MuiFormControlLabel-label': { pt: 1 } }} />)}</FormGroup>
</Box>;

const GuidedDataConnection = ({ verified = false, choices = {}, selection = emptyWorkspaceSelection(), onSelectionChange,
    review = null, viewKey, requirements, editingLabel, onCancelEditing, onReview, onSubmit, onCancelReview, held = false, busy = false, result = null, onReconcile, language = 'ar' }) => {
    const ar = language === 'ar';
    const submittedReview = useRef(null);
    const [submittedKey, setSubmittedKey] = useState(null);
    const blocked = !verified || held || busy;
    const canReview = workspaceSelectionCanReview({ selection, choices, requirements, verified, held, busy });
    const canSubmit = workspaceConnectionReviewCanSubmit({ review, viewKey, selection, choices, requirements, verified, held, busy });
    const selectionCurrent = workspaceSelectionCanReview({ selection, choices, requirements, verified, held: false, busy: false });
    const change = (name, value) => {
        onCancelReview?.();
        onSelectionChange?.(updateWorkspaceSelection(selection, name, value));
    };
    const submit = () => {
        if (!canSubmit || submittedReview.current === review.key) return;
        submittedReview.current = review.key;
        setSubmittedKey(review.key);
        onSubmit?.();
    };

    return <Stack spacing={2}>
        <Typography component="h2" variant="h6" fontWeight={800}>{ar ? 'إعداد الربط واستخدام البيانات' : 'Set up a connection and data use'}</Typography>
        <Typography color="text.secondary" variant="body2">{ar ? 'اختر النشاط والغرض، ثم راجع الحساب والبيانات والأشخاص قبل إرسال الطلب.' : 'Choose the activity and purpose, then review the account, data and people before submitting.'}</Typography>
        {editingLabel && <Alert severity="info" action={onCancelEditing ? <Button color="inherit" disabled={busy || held} onClick={onCancelEditing}>{ar ? 'إلغاء التعديل' : 'Cancel editing'}</Button> : null}>{ar ? 'تعدّل الطلب الحالي: ' : 'Editing the current request: '}{workspaceLabel(editingLabel, ar ? 'طلب الربط' : 'Connection request')}{ar ? '. يحتاج الاقتراح المعدّل إلى مراجعة واعتماد جديدين.' : '. The revised proposal needs fresh review and approval.'}</Alert>}
        {held && <Alert severity="warning" action={onReconcile ? <Button color="inherit" onClick={onReconcile} disabled={busy}>{ar ? 'التحقق من النتيجة' : 'Check outcome'}</Button> : null}>
            {ar ? 'توجد عملية لم تتأكد نتيجتها بعد. ننتظر التحقق منها قبل بدء عملية جديدة.' : 'An earlier operation still needs confirmation. Check its outcome before starting another operation.'}
        </Alert>}
        {result && <Alert severity={result.state === 'completed' ? 'success' : result.state === 'failed' ? 'warning' : 'info'}>
            <Typography fontWeight={700}>{result.title}</Typography>{result.message && <Typography variant="body2">{result.message}</Typography>}
        </Alert>}
        {!review ? <Box component="form" onSubmit={event => { event.preventDefault(); if (canReview) onReview?.(); }}>
            <Stack spacing={2}>
                <NamedChoice label={ar ? '1. النشاط الذي تعمل فيه' : '1. Your activity'} name="workspace-activity" options={choices.activities} value={selection.activity} onChange={value => change('activity', value)} disabled={blocked} emptyText={ar ? 'لا يوجد نشاط ظاهر لهذا الحساب. تحقق من صلاحية الوصول.' : 'No activity is visible to this account. Check its access.'} ar={ar} />
                <NamedChoice label={ar ? '2. لماذا تريد هذا الربط؟' : '2. What is this connection for?'} name="workspace-purpose" options={choices.purposes} value={selection.purpose} onChange={value => change('purpose', value)} disabled={blocked || !selection.activity} emptyText={ar ? 'ستظهر الأغراض المتاحة بعد اختيار النشاط.' : 'Available purposes appear after choosing an activity.'} ar={ar} />
                <NamedChoice label={ar ? '3. الحساب الذي يزوّدك بالبيانات' : '3. Account providing the data'} name="workspace-provider" options={choices.providers} value={selection.provider} onChange={value => change('provider', value)} disabled={blocked || !selection.purpose} emptyText={ar ? 'لا يوجد حساب مزوّد متاح لهذا الغرض حاليًا.' : 'No provider account is currently available for this purpose.'} ar={ar} />
                {(requirements?.fields !== false || choices.fields?.length > 0) && <NamedChecks title={ar ? '4. البيانات المطلوبة' : '4. Data you need'} options={choices.fields} values={selection.fields} onChange={value => change('fields', value)} disabled={blocked || !selection.provider} emptyText={ar ? 'اختر الحساب لعرض البيانات التي يمكن طلبها.' : 'Choose an account to see which data can be requested.'} ar={ar} />}
                {(requirements?.people !== false || choices.people?.length > 0) && <NamedChecks title={ar ? '5. الأشخاص الذين سيستخدمون البيانات' : '5. People who will use the data'} options={choices.people} values={selection.people} onChange={value => change('people', value)} disabled={blocked || !selection.provider} emptyText={ar ? 'لا يوجد أشخاص متاحون لهذا الاختيار حاليًا.' : 'No people are currently available for this selection.'} ar={ar} />}
                <Box><Button type="submit" variant="contained" disabled={!canReview}>{ar ? 'مراجعة الاختيارات' : 'Review choices'}</Button></Box>
            </Stack>
        </Box> : <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}><Typography component="h3" fontWeight={800}>{ar ? 'راجع قبل تقديم الطلب' : 'Review before submitting'}</Typography><Chip size="small" label={submittedKey === review.key ? (ar ? 'النتيجة قيد التحقق' : 'Outcome being checked') : (ar ? 'لم يُرسل بعد' : 'Not submitted yet')} /></Stack>
            <Box component="dl" sx={{ m: 0, '& dt': { fontWeight: 700 }, '& dd': { m: 0, mb: 1.5, overflowWrap: 'anywhere' } }}>
                {(workspaceReviewSummaryIsValid(review.summary) ? review.summary : []).map(row => <React.Fragment key={row.label}><Typography component="dt" variant="body2">{row.label}</Typography><Typography component="dd" variant="body2"><bdi dir={/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? 'ltr' : 'auto'}>{row.value}</bdi></Typography></React.Fragment>)}
            </Box>
            {!workspaceReviewSummaryIsValid(review.summary) && <Alert severity="warning" sx={{ mb: 2 }}>{ar ? 'لم يتوفر ملخص مراجع متحقق. حدّث الاختيارات وراجعها من جديد.' : 'A verified review summary is not available. Refresh the choices and review again.'}</Alert>}
            {review.message && <Alert severity="info" sx={{ mb: 2 }}>{review.message}</Alert>}
            {verified && !selectionCurrent && <Alert severity="warning" sx={{ mb: 2 }}>{ar ? 'تغيّرت الخيارات المتاحة لهذا الحساب. راجع الاختيارات من جديد قبل تقديم الطلب.' : 'Available choices have changed for this account. Review your choices again before submitting.'}</Alert>}
            {(review.removedFields?.length > 0 || review.removedPeople?.length > 0) && <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography fontWeight={700}>{ar ? 'سيُسحب الوصول التالي عند اعتماد هذا التغيير:' : 'Approval will remove this access:'}</Typography>
                {review.removedFields?.length > 0 && <Typography variant="body2">{ar ? 'البيانات: ' : 'Data: '}{review.removedFields.join(ar ? '، ' : ', ')}</Typography>}
                {review.removedPeople?.length > 0 && <Typography variant="body2">{ar ? 'الأشخاص: ' : 'People: '}{review.removedPeople.join(ar ? '، ' : ', ')}</Typography>}
            </Alert>}
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
                <Button variant="contained" disabled={!canSubmit || submittedKey === review.key} onClick={submit}>{review.submitLabel || (ar ? 'تقديم الطلب المراجع' : 'Submit reviewed request')}</Button>
                <Button disabled={busy || held} onClick={onCancelReview}>{ar ? 'تعديل الاختيارات' : 'Change choices'}</Button>
            </Stack>
        </Box>}
    </Stack>;
};

export default GuidedDataConnection;
