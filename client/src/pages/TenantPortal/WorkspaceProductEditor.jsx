import React from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { workspaceChoiceAvailable, workspaceLabel } from './connectionsDataPresentation';
import { clearWorkspaceProductField, emptyWorkspaceProductDraft, updateWorkspaceProductDraft, workspaceProductDraftErrors, workspaceProductSelection } from './workspaceProductPresentation';

const WorkspaceProductEditor = ({ open = false, mode = 'create', sourceLabel, recordLabel, draft = emptyWorkspaceProductDraft(),
    fields = [], units = [], priceChoices = [], mediaChoices = [], verified = false, held = false, busy = false,
    onChange, onReview, onClose, language = 'ar' }) => {
    const ar = language === 'ar';
    const config = { mode, draft, fields, units, priceChoices, mediaChoices, language };
    const errors = workspaceProductDraftErrors(config);
    const blocked = !verified || held || busy;
    const update = (key, value) => onChange?.(updateWorkspaceProductDraft(draft, key, value));
    const input = field => {
        const disabled = blocked || field.enabled !== true || draft.clearFields.includes(field.key);
        if (['name', 'description', 'sku', 'barcodes'].includes(field.key)) return <TextField
            label={field.label} value={draft[field.key]} disabled={disabled} required={field.required === true}
            multiline={['description', 'barcodes'].includes(field.key)} minRows={field.key === 'description' ? 3 : undefined}
            onChange={event => update(field.key, event.target.value)} error={Boolean(errors[field.key])}
            helperText={errors[field.key] || (field.key === 'barcodes' ? (ar ? 'باركود واحد في كل سطر.' : 'One barcode per line.') : field.description)}
            inputProps={{ maxLength: { name: 200, description: 4000, sku: 100, barcodes: 5050 }[field.key] }} />;
        if (field.key === 'base_unit') return <TextField select label={field.label} value={draft.base_unit} disabled={disabled} required={field.required === true}
            onChange={event => update('base_unit', event.target.value)} error={Boolean(errors.base_unit)} helperText={errors.base_unit}>
            <MenuItem value="">{ar ? 'اختر الوحدة' : 'Choose a unit'}</MenuItem>
            {units.map(option => <MenuItem key={option.value} value={option.value} disabled={!workspaceChoiceAvailable(option)}>{workspaceLabel(option.label, ar ? 'اسم الوحدة غير متاح' : 'Unit name unavailable')}</MenuItem>)}
        </TextField>;
        if (field.key === 'price') return <Stack spacing={1}>
            <Typography fontWeight={700}>{field.label}</Typography>
            <TextField label={ar ? 'المبلغ' : 'Amount'} value={draft.price.amount} disabled={disabled} inputProps={{ inputMode: 'decimal', maxLength: 30 }} onChange={event => update('price', { ...draft.price, amount: event.target.value })} />
            <TextField select label={ar ? 'قائمة السعر والعملة والوحدة' : 'Price list, currency and unit'} value={draft.price.choice} disabled={disabled} onChange={event => update('price', { ...draft.price, choice: event.target.value })} error={Boolean(errors.price)} helperText={errors.price}>
                <MenuItem value="">{ar ? 'اختر سعر المصدر المعتمد' : 'Choose the source price configuration'}</MenuItem>
                {priceChoices.map(option => <MenuItem key={option.value} value={option.value} disabled={!workspaceChoiceAvailable(option)} sx={{ whiteSpace: 'normal' }}>{workspaceLabel(option.label, ar ? 'اسم الخيار غير متاح' : 'Option name unavailable')}</MenuItem>)}
            </TextField>
        </Stack>;
        if (field.key === 'media') return <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}><Typography component="legend" fontWeight={700}>{field.label}</Typography>
            <FormGroup>{mediaChoices.map(option => <FormControlLabel key={option.value} disabled={disabled || (!workspaceChoiceAvailable(option) && !draft.media.includes(option.value))}
                control={<Checkbox checked={draft.media.includes(option.value)} onChange={event => {
                    if (!event.target.checked || workspaceChoiceAvailable(option)) update('media', event.target.checked ? [...draft.media, option.value] : draft.media.filter(value => value !== option.value));
                }} />} label={workspaceLabel(option.label, ar ? 'اسم الصورة غير متاح' : 'Image name unavailable')} />)}</FormGroup>
            {!mediaChoices.length && <Typography variant="body2" color="text.secondary">{ar ? 'لا توجد صور مصدر مسموحة متاحة للاختيار.' : 'No allowed source images are available to select.'}</Typography>}
            {errors.media && <Typography variant="caption" color="error">{errors.media}</Typography>}
        </Box>;
        return null;
    };

    return <Dialog open={open} onClose={() => { if (!busy) onClose?.(); }} fullWidth maxWidth="sm" aria-labelledby="workspace-product-editor-title">
        <DialogTitle id="workspace-product-editor-title">{mode === 'create' ? (ar ? 'إضافة منتج في المصدر' : 'Create a product at source') : (ar ? 'طلب تعديل المنتج' : 'Request a product change')}</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{ar ? 'سيُراجع الطلب ثم يُرسل إلى المرجع المعتمد: ' : 'The request will be reviewed and sent to the authoritative source: '}{workspaceLabel(sourceLabel, ar ? 'اسم المصدر غير متاح' : 'Source name unavailable')}</Typography>
            {recordLabel && <Typography fontWeight={700}>{workspaceLabel(recordLabel, ar ? 'المنتج المحدد' : 'Selected product')}</Typography>}
            {held && <Alert severity="warning">{ar ? 'توجد نتيجة لم تُحسم بعد؛ تحقق من العملية السابقة قبل تقديم تعديل جديد.' : 'An earlier outcome is unresolved. Check it before submitting another change.'}</Alert>}
            <Box component="form" id="workspace-product-form" onSubmit={event => { event.preventDefault(); if (!blocked) { const selection = workspaceProductSelection(config); if (selection) onReview?.(selection); } }}>
                <Stack spacing={2}>{fields.map(field => <Box key={field.key}>
                    {input(field)}
                    {field.enabled !== true && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{field.reason || (ar ? 'لا يمكن تعديل هذا البيان ضمن الصلاحية الحالية.' : 'This field cannot be changed with the current permission.')}</Typography>}
                    {mode === 'change' && field.clearable === true && !field.required && <FormControlLabel disabled={blocked || field.enabled !== true}
                        control={<Checkbox checked={draft.clearFields.includes(field.key)} onChange={event => onChange?.(clearWorkspaceProductField(draft, field.key, event.target.checked))} />}
                        label={ar ? `مسح ${field.label} من المصدر` : `Clear ${field.label} at source`} />}
                </Box>)}</Stack>
            </Box>
            {errors.form && <Typography variant="body2" color="text.secondary">{errors.form}</Typography>}
        </Stack></DialogContent>
        <DialogActions><Button disabled={busy} onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button type="submit" form="workspace-product-form" variant="contained" disabled={blocked || Object.keys(errors).length > 0}>{ar ? 'مراجعة التغيير' : 'Review change'}</Button></DialogActions>
    </Dialog>;
};

export default WorkspaceProductEditor;
