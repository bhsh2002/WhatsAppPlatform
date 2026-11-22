import React, { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, Stack, Typography } from '@mui/material';
import SharedResourceMediaPreview from './SharedResourceMediaPreview';
import { sharedResourceEnumLabel, sharedResourceEnvelopeIsValid, sharedResourceEnvelopeKey, sharedResourceFieldProvenance, sharedResourceFieldRows,
    sharedResourceTimestamp, sharedResourceValueText } from './sharedResourceReadPresentation';

export const SharedResourceFieldObservation = ({ record, field, isArabic = true }) => {
    const provenance = sharedResourceFieldProvenance(record, field);
    if (!provenance) return null;
    return <Stack spacing={0.25} sx={{ mt: 0.5 }}>
        {provenance.observed_at !== null && <Typography variant="caption" color="text.secondary">{field === 'media'
            ? (isArabic ? 'وقت ملاحظة مراجع الوسائط في المصدر: ' : 'Source media reference observation time: ')
            : (isArabic ? 'وقت الملاحظة في المصدر: ' : 'Source observation time: ')}
            <time dateTime={provenance.observed_at}>{sharedResourceTimestamp(provenance.observed_at, isArabic)}</time></Typography>}
        {provenance.version !== null && <Typography variant="caption" color="text.secondary">{isArabic ? 'تحديث المصدر رقم ' : 'Source update '}{provenance.version}</Typography>}
    </Stack>;
};

const SourceValue = ({ value, isArabic }) => {
    if (value === null || typeof value !== 'object') return <Typography component="span" variant="body2">{sharedResourceValueText(value, isArabic)}</Typography>;
    if (Array.isArray(value)) return value.length ? <Box component="ul" sx={{ m: 0, pl: 3 }}>{value.map((item, index) => <Box component="li" key={index}>
        <SourceValue value={item} isArabic={isArabic} /></Box>)}</Box> : <Typography component="span" variant="body2">{isArabic ? 'قائمة فارغة من المصدر' : 'Empty source list'}</Typography>;
    const entries = Object.entries(value);
    return entries.length ? <Box component="dl" sx={{ m: 0, '& dd': { m: 0, mb: 1 } }}>{entries.map(([key, item]) => <React.Fragment key={key}>
        <Typography component="dt" variant="body2" fontWeight={700}>{key}</Typography><Box component="dd"><SourceValue value={item} isArabic={isArabic} /></Box>
    </React.Fragment>)}</Box> : <Typography component="span" variant="body2">{isArabic ? 'لا توجد خصائص في المصدر' : 'No source attributes'}</Typography>;
};

const SharedResourceReadPanel = ({ envelope, onPreview, isArabic = true }) => {
    const [, updateClock] = useState(0);
    const [invalidated, setInvalidated] = useState(null);
    const partition = sharedResourceEnvelopeKey(envelope);
    useEffect(() => {
        const deadline = Date.parse(envelope?.valid_until);
        if (!Number.isFinite(deadline)) return undefined;
        const timer = window.setTimeout(() => updateClock(value => value + 1), Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647));
        return () => window.clearTimeout(timer);
    }, [envelope]);
    if (!sharedResourceEnvelopeIsValid(envelope) || invalidated === partition) return <Alert severity="info">{isArabic
        ? 'يلزم التحقق من قراءة المصدر الحالية لعرض التفاصيل.' : 'A current source read is required to display details.'}</Alert>;
    const record = envelope.record, data = record.data;
    return <Card variant="outlined" component="section"><CardContent><Stack spacing={2}>
        <Typography component="h2" variant="h6" fontWeight={800}>{data.name || (record.resource_kind === 'product'
            ? (isArabic ? 'سياق المنتج من المصدر' : 'Source product context') : (isArabic ? 'عرض مشترك' : 'Shared offering'))}</Typography>
        <Typography variant="body2" color="text.secondary">{isArabic ? 'المرجع المعتمد: ' : 'Authoritative source: '}{record.sourceLabel}</Typography>
        <Typography variant="caption" color="text.secondary">{isArabic ? 'وقت الملاحظة في المصدر: ' : 'Source observation time: '}
            <time dateTime={record.observed_at}>{sharedResourceTimestamp(record.observed_at, isArabic)}</time></Typography>
        <Box component="dl" sx={{ m: 0, '& dt': { fontWeight: 700 }, '& dd': { m: 0, mb: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>
            {sharedResourceFieldRows(record, isArabic).map(field => <React.Fragment key={field.key}><Typography component="dt" variant="body2">{field.label}</Typography><Box component="dd">
                {field.sourceValue !== null && typeof field.sourceValue === 'object' ? <SourceValue value={field.sourceValue} isArabic={isArabic} /> : <Typography variant="body2">{field.value}</Typography>}
                <SharedResourceFieldObservation record={record} field={field.key} isArabic={isArabic} /></Box></React.Fragment>)}
        </Box>
        {record.resource_kind === 'offering' && data.attributes && <Box><Typography component="h3" fontWeight={800}>{isArabic ? 'خصائص المصدر' : 'Source attributes'}</Typography>
            <SourceValue value={data.attributes} isArabic={isArabic} /><SharedResourceFieldObservation record={record} field="attributes" isArabic={isArabic} /></Box>}
        {record.resource_kind === 'product' && Object.hasOwn(data, 'base_unit') && <Box><Typography component="h3" fontWeight={800}>{isArabic ? 'الوحدة الأساسية' : 'Base unit'}</Typography>
            <Typography>{data.base_unit === null ? sharedResourceValueText(null, isArabic) : sharedResourceEnumLabel('unit', data.base_unit.code, isArabic)}</Typography>
            <SharedResourceFieldObservation record={record} field="base_unit" isArabic={isArabic} /></Box>}
        {record.resource_kind === 'product' && data.price_options && <Stack spacing={1.5}><Typography component="h3" fontWeight={800}>{isArabic ? 'خيارات السعر من المصدر' : 'Source price options'}</Typography>
            <SharedResourceFieldObservation record={record} field="price_options" isArabic={isArabic} />
            {data.price_options.map((option, index) => <Box key={option.key || `${index}:${option.code}`} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Typography fontWeight={700}>{option.code}</Typography>
                <Typography variant="body2">{isArabic ? 'العملية: ' : 'Process: '}{sharedResourceEnumLabel('process', option.process, isArabic)}</Typography>
                <Typography variant="body2">{isArabic ? 'نموذج التسعير: ' : 'Pricing model: '}{sharedResourceEnumLabel('pricing', option.pricing_model, isArabic)}</Typography>
                <Typography variant="body2">{isArabic ? 'المبلغ: ' : 'Amount: '}{sharedResourceValueText(option.amount, isArabic)}</Typography>
                <Typography variant="body2">{isArabic ? 'العملة: ' : 'Currency: '}{sharedResourceValueText(option.currency, isArabic)}</Typography>
                <Typography variant="body2">{isArabic ? 'الوحدة: ' : 'Unit: '}{option.unit === null ? sharedResourceValueText(null, isArabic) : sharedResourceEnumLabel('unit', option.unit, isArabic)}</Typography>
            </Box>)}
        </Stack>}
        {Object.hasOwn(envelope, 'mediaCount') && <Box><Typography variant="body2">{isArabic ? 'عدد ملفات الوسائط المسموحة بهذه القراءة: ' : 'Media items allowed by this read: '}{envelope.mediaCount}</Typography>
            <SharedResourceFieldObservation record={record} field="media" isArabic={isArabic} /></Box>}
        <SharedResourceMediaPreview envelope={envelope} onPreview={onPreview} isArabic={isArabic} onInvalidated={() => setInvalidated(partition)} />
    </Stack></CardContent></Card>;
};

export default SharedResourceReadPanel;
