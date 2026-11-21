import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { createSharedResourcePreviewController, sharedResourceEnvelopeIsValid, sharedResourceEnvelopeKey, sharedResourcePreviewDeadline } from './sharedResourceReadPresentation';

const SharedResourceMediaPreview = ({ envelope, onPreview, onInvalidated, isArabic = true }) => {
    const [state, setState] = useState({ status: 'idle', partition: null, url: null });
    const callbacks = useRef({ onPreview, onInvalidated });
    callbacks.current = { onPreview, onInvalidated };
    const controller = useRef(null);
    useEffect(() => {
        const owned = createSharedResourcePreviewController({ onChange: setState,
            onPreview: (...args) => callbacks.current.onPreview?.(...args), onInvalidated: () => callbacks.current.onInvalidated?.() });
        controller.current = owned;
        return () => { owned.dispose(); if (controller.current === owned) controller.current = null; };
    }, []);
    useEffect(() => { controller.current?.setEnvelope(envelope); }, [envelope]);
    const current = sharedResourceEnvelopeIsValid(envelope);
    if (!current || envelope.record.resource_kind !== 'product' || !envelope.previews?.length) return null;
    const same = state.partition === sharedResourceEnvelopeKey(envelope);
    const available = same && state.status === 'available' && Date.parse(state.valid_until) > Date.now();
    return <Stack spacing={1.5}>
        <Typography component="h3" variant="subtitle1" fontWeight={800}>{isArabic ? 'معاينات الوسائط' : 'Media previews'}</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">{envelope.previews.map((preview, index) => <Button key={preview.key} variant="outlined"
            disabled={typeof onPreview !== 'function' || sharedResourcePreviewDeadline(envelope, preview) <= Date.now() || (same && state.status === 'loading')}
            onClick={() => controller.current?.load(preview.key)}>{isArabic ? `معاينة الصورة ${index + 1}` : `Preview image ${index + 1}`}</Button>)}</Stack>
        {same && state.status === 'loading' && <Box role="status"><CircularProgress size={20} /> <Typography component="span" variant="body2">{isArabic ? 'جارٍ التحقق من صلاحية المعاينة…' : 'Checking preview access…'}</Typography></Box>}
        {available && <Box><Box component="img" src={state.url} alt={envelope.record.data.name || (isArabic ? 'صورة مشتركة من المصدر' : 'Shared source image')}
            sx={{ display: 'block', maxWidth: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 1 }} />
            <Button onClick={() => controller.current?.close()}>{isArabic ? 'إغلاق المعاينة' : 'Close preview'}</Button></Box>}
        {same && ['expired', 'unavailable'].includes(state.status) && <Alert severity="info">{isArabic
            ? 'لم تعد المعاينة متاحة بهذه القراءة. حدّث قراءة المصدر للتحقق من الإذن الحالي.'
            : 'This read no longer provides a preview. Refresh the source read to verify current access.'}</Alert>}
    </Stack>;
};

export default SharedResourceMediaPreview;
