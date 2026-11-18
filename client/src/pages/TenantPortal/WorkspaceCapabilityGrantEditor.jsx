import React from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { workspaceChoiceAvailable } from './connectionsDataPresentation';
import { updateWorkspaceCapabilityGrantDraft, workspaceCapabilityGrantCanReview, workspaceCapabilityGrantOptionsIsCurrent } from './workspaceCapabilityGrantPresentation';

const NamedChoice = ({ label, value, rows = [], disabled, onChange, ar }) => <TextField select fullWidth label={label} value={rows.some(row => row.value === value) ? value : ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
    <MenuItem value="">{ar ? 'اختر من القائمة الحالية' : 'Choose from the current list'}</MenuItem>{rows.map(row => <MenuItem key={row.value} value={row.value} disabled={!workspaceChoiceAvailable(row)} sx={{ whiteSpace: 'normal' }}><Stack><Typography variant="body2">{row.label}</Typography>{row.reason && <Typography variant="caption">{row.reason}</Typography>}</Stack></MenuItem>)}
</TextField>;
const NamedChecks = ({ title, rows, values, disabled, onChange, ar }) => <Box component="fieldset" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, minWidth: 0 }}><Typography component="legend" fontWeight={700}>{title}</Typography>
    {!rows.length && <Typography variant="body2" color="text.secondary">{ar ? 'لا توجد خيارات حالية لهذا الاختيار.' : 'No current choices are available for this selection.'}</Typography>}
    <FormGroup>{rows.map(row => <FormControlLabel key={row.value} disabled={disabled || (!workspaceChoiceAvailable(row) && !values.includes(row.value))}
        control={<Checkbox checked={values.includes(row.value)} onChange={event => onChange(event.target.checked ? [...values, row.value] : values.filter(value => value !== row.value))} />}
        label={<Stack><Typography variant="body2">{row.label}</Typography>{row.reason && <Typography variant="caption">{row.reason}</Typography>}</Stack>} />)}</FormGroup>
</Box>;

const WorkspaceCapabilityGrantEditor = ({ open = false, context, descriptor, options, draft, held = true, busy = false, now = 0,
    message = '', onChoiceChange, onChange, onRefresh, onReview, onClose, language = 'ar' }) => {
    const ar = language === 'ar';
    const current = workspaceCapabilityGrantOptionsIsCurrent(options, context, now);
    const blocked = !current || held || busy;
    const editor = current ? options.editor : null;
    const set = (field, value) => onChange?.(updateWorkspaceCapabilityGrantDraft(draft, field, value));
    const canReview = workspaceCapabilityGrantCanReview({ context, descriptor, options, draft, held, busy, now });
    const canAssign = editor?.sourceAuthority.enabled === true && draft.resourcePolicy === 'selected' && draft.resources.length > 0
        && draft.actions.length > 0 && draft.resources.every(value => editor.resources.find(row => row.value === value)?.sourceAuthorityAvailable === true);
    return <Dialog open={open && context?.verified === true} onClose={() => { if (!busy) onClose?.(); }} fullWidth maxWidth="md" aria-labelledby="workspace-capability-grant-title">
        <DialogTitle id="workspace-capability-grant-title">{ar ? 'صلاحيات الأشخاص على الحساب والبيانات' : 'People’s permissions for accounts and data'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>{ar ? 'اختر الشخص والحساب والقدرة، ثم حدد ما يمكنه فعله والبيانات والموارد والمدة. ستراجع التغيير كاملًا قبل تقديمه.' : 'Choose a person, account and capability, then specify their actions, data, resources and expiry. Review the full change before submitting it.'}</Typography>
            {message && <Alert severity="info">{message}</Alert>}
            {!current && <Alert severity="info" action={<Button color="inherit" disabled={busy} onClick={onRefresh}>{ar ? 'تحديث الخيارات الحالية' : 'Refresh current choices'}</Button>}>{ar ? 'يلزم التحقق من صلاحية إدارة الأشخاص والخيارات الحالية.' : 'Current people-management permission and choices must be verified.'}</Alert>}
            {current && <>
                <NamedChoice label={ar ? 'الشخص' : 'Person'} value={draft.person} rows={options.choices.people} disabled={blocked} onChange={value => onChoiceChange?.('person', value)} ar={ar} />
                <NamedChoice label={ar ? 'الحساب والقدرة المطلوبة' : 'Account and capability'} value={draft.grant} rows={options.choices.grants} disabled={blocked || !draft.person} onChange={value => onChoiceChange?.('grant', value)} ar={ar} />
                {!editor && <Alert severity="info">{ar ? 'اختر الشخص والحساب والقدرة لعرض الصلاحية الحالية والخيارات المتاحة.' : 'Choose a person, account and capability to see current permission and available choices.'}</Alert>}
                {editor && <>
                    <Box><Typography component="h3" fontWeight={800}>{ar ? 'الصلاحية المسجلة حاليًا' : 'Currently recorded permission'}</Typography>{!editor.currentSummary.length ? <Typography variant="body2">{ar ? 'لا توجد صلاحية مسجلة لهذا الاختيار.' : 'No permission is recorded for this selection.'}</Typography>
                        : <Box component="dl" sx={{ '& dt': { fontWeight: 700 }, '& dd': { m: 0, mb: 1, overflowWrap: 'anywhere' } }}>{editor.currentSummary.map(row => <React.Fragment key={row.label}><Typography component="dt" variant="body2">{row.label}</Typography><Typography component="dd" variant="body2"><bdi dir={/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? 'ltr' : 'auto'}>{row.value}</bdi></Typography></React.Fragment>)}</Box>}</Box>
                    <Alert severity="info">{ar ? 'الاختيارات التالية تستبدل هذه الصلاحية كاملة. إزالة تحديد جميع العمليات تسحب حقوق هذا الشخص لهذا الحساب والقدرة؛ ولا تنقل المرجع المعتمد تلقائيًا.' : 'The following choices replace this permission in full. Clearing all actions withdraws this person’s rights for this account and capability; it does not automatically transfer the authoritative source.'}</Alert>
                    <NamedChecks title={ar ? 'العمليات المسموحة' : 'Allowed actions'} rows={editor.actions} values={draft.actions} disabled={blocked} onChange={values => set('actions', values)} ar={ar} />
                    <NamedChecks title={ar ? 'البيانات المسموح استخدامها' : 'Data that may be used'} rows={editor.fields} values={draft.fields} disabled={blocked} onChange={values => set('fields', values)} ar={ar} />
                    <NamedChoice label={ar ? 'نطاق الموارد' : 'Resource scope'} value={draft.resourcePolicy} rows={editor.policies} disabled={blocked} onChange={value => set('resourcePolicy', value)} ar={ar} />
                    {draft.resourcePolicy === 'selected' && <NamedChecks title={ar ? 'الموارد المختارة' : 'Selected resources'} rows={editor.resources} values={draft.resources} disabled={blocked} onChange={values => set('resources', values)} ar={ar} />}
                    <TextField fullWidth type="datetime-local" label={ar ? 'الصلاحية سارية حتى' : 'Permission valid until'} value={draft.expiresAt} disabled={blocked} onChange={event => set('expiresAt', event.target.value)}
                        helperText={ar ? 'اختر المدة صراحةً وفق توقيت جهازك. لا تُمنح مدة مفتوحة تلقائيًا.' : 'Choose an explicit expiry using your device time. An open-ended duration is never assigned automatically.'} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr' } }} />
                    {editor.currentSelection.expiresAt && <Typography variant="caption">{ar ? 'نهاية الصلاحية المسجلة: ' : 'Recorded expiry: '}<bdi dir="ltr">{editor.currentSelection.expiresAt}</bdi></Typography>}
                    <Box><Typography component="h3" fontWeight={800}>{ar ? 'المرجع المعتمد للبيانات' : 'Authoritative data source'}</Typography>{editor.sourceAuthority.currentLabel && <Typography variant="body2">{editor.sourceAuthority.currentLabel}</Typography>}
                        <FormControlLabel disabled={blocked || !canAssign}
                            control={<Checkbox checked={draft.assignSourceAuthority} onChange={event => set('assignSourceAuthority', event.target.checked)} />} label={editor.sourceAuthority.label} />
                        {editor.sourceAuthority.reason && <Typography variant="body2" color="text.secondary">{editor.sourceAuthority.reason}</Typography>}</Box>
                    {editor.sourceAuthority.enabled && draft.resourcePolicy === 'selected' && draft.resources.length > 0 && !canAssign && <Typography variant="body2" color="text.secondary">{ar ? 'يمكن منح الحقوق على هذه الموارد دون نقل المرجع المعتمد. تعيين المرجع غير متاح لكل مورد مختار حاليًا.' : 'Permissions can be granted for these resources without transferring the authoritative source. Source assignment is not currently available for every selected resource.'}</Typography>}
                </>}
            </>}
            {held && <Alert severity="warning">{ar ? 'افحص نتيجة العملية السابقة قبل تقديم تغيير جديد.' : 'Check the earlier operation outcome before submitting another change.'}</Alert>}
        </Stack></DialogContent><DialogActions sx={{ gap: 1, flexWrap: 'wrap' }}><Button onClick={onClose} disabled={busy}>{ar ? 'إغلاق' : 'Close'}</Button><Button onClick={onRefresh} disabled={busy}>{ar ? 'تحديث الخيارات' : 'Refresh choices'}</Button>
            <Button variant="contained" disabled={!canReview} onClick={onReview}>{ar ? 'مراجعة تغيير الصلاحية' : 'Review permission change'}</Button>
        </DialogActions>
    </Dialog>;
};
export default WorkspaceCapabilityGrantEditor;
