import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import SharedResourceReadPanel, { SharedResourceFieldObservation } from './SharedResourceReadPanel';
import { sharedResourceBrowserBinding, sharedResourceEnvelopeIsValid, sharedResourceEnumLabel, sharedResourceListIsValid,
    sharedResourceOptionsIsValid, sharedResourceResponseIsCurrent } from './sharedResourceReadPresentation';

const invalid = () => new Error('Current shared source read could not be verified');
const canceled = () => Object.assign(new Error('Shared read context changed'), { name: 'AbortError' });

const SharedResourceBrowser = ({ context, activity, sharedResources, productRecord = null, isArabic = true }) => {
    const auth = useAuth();
    const [provider, setProvider] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(null);
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const revision = useRef(0), request = useRef(null), latest = useRef(null);
    const optionsValid = sharedResourceOptionsIsValid(sharedResources);
    const providerCurrent = productRecord !== null || provider === '' || (optionsValid && sharedResources.providers.some(row => row.value === provider));
    const binding = optionsValid && providerCurrent ? sharedResourceBrowserBinding({ context, activity, auth, productRecord }) : null;
    const partition = binding === null ? null : JSON.stringify([binding, productRecord === null ? provider : null]);
    const currentPage = page?.partition === partition && partition !== null && sharedResourceListIsValid(page.document, context) ? page : null;
    const currentDetail = detail?.partition === partition && partition !== null && sharedResourceEnvelopeIsValid(detail.envelope)
        && sharedResourceResponseIsCurrent(detail.envelope, context) ? detail : null;
    latest.current = { context, activity, auth, productRecord, binding, partition, detailEnvelope: currentDetail?.envelope ?? null };
    const clear = useCallback(() => {
        revision.current += 1; request.current?.abort(); request.current = null;
        setPage(null); setDetail(null); setLoading(false); setError(false);
    }, []);
    const stillCurrent = snapshot => snapshot.partition !== null && snapshot.partition === latest.current?.partition
        && snapshot.binding === sharedResourceBrowserBinding(latest.current);
    useEffect(() => { clear(); return () => { revision.current += 1; request.current?.abort(); }; }, [partition, clear]);
    useEffect(() => {
        const hidden = () => { if (document.hidden) clear(); };
        window.addEventListener('blur', clear); window.addEventListener('pagehide', clear);
        window.addEventListener('savana-shared-read-setup-changed', clear); document.addEventListener('visibilitychange', hidden);
        return () => { window.removeEventListener('blur', clear); window.removeEventListener('pagehide', clear);
            window.removeEventListener('savana-shared-read-setup-changed', clear); document.removeEventListener('visibilitychange', hidden); };
    }, [clear]);
    useEffect(() => {
        const values = [context?.valid_until, currentPage?.document.valid_until, currentDetail?.envelope.valid_until].filter(Boolean).map(Date.parse);
        if (!values.length || values.some(value => !Number.isFinite(value))) return undefined;
        const timer = window.setTimeout(clear, Math.min(Math.max(0, Math.min(...values) - Date.now()), 2_147_483_647));
        return () => window.clearTimeout(timer);
    }, [context, currentPage, currentDetail, clear]);

    const read = async (kind, selector = null, cursor = null) => {
        const snapshot = latest.current;
        if (!optionsValid || !stillCurrent(snapshot) || (kind === 'search' && (!sharedResources.browseAction.enabled
            || !sharedResources.providers.some(row => row.value === provider && row.enabled) || [...query].length > 200))) return;
        request.current?.abort(); const owned = new AbortController(); request.current = owned;
        const requestRevision = ++revision.current;
        setError(false); setLoading(true); setDetail(null);
        if (kind === 'search') setPage(null);
        const searchQuery = cursor === null ? query.trim() : currentPage?.query || '';
        try {
            const result = kind === 'search'
                ? await api.getPortalWorkspaceResources({ activity: snapshot.activity, provider, q: searchQuery, cursor, signal: owned.signal })
                : kind === 'product' ? await api.getPortalWorkspaceProductResource(snapshot.productRecord, snapshot.activity, { signal: owned.signal })
                    : await api.getPortalWorkspaceResource(selector, snapshot.activity, { signal: owned.signal });
            if (owned.signal.aborted || revision.current !== requestRevision || !stillCurrent(snapshot)) return;
            if (kind === 'search') {
                if (!sharedResourceListIsValid(result, snapshot.context)) throw invalid();
                setPage({ partition: snapshot.partition, document: result, query: searchQuery });
            } else {
                if (!sharedResourceEnvelopeIsValid(result) || !sharedResourceResponseIsCurrent(result, snapshot.context)
                    || result.record.resource_kind !== (kind === 'product' ? 'product' : 'offering')) throw invalid();
                setDetail({ partition: snapshot.partition, envelope: result });
            }
        } catch {
            if (owned.signal.aborted || revision.current !== requestRevision || !stillCurrent(snapshot)) return;
            clear(); setError(true);
        } finally { if (revision.current === requestRevision) { request.current = null; setLoading(false); } }
    };
    const preview = async (key, { signal }) => {
        const snapshot = latest.current, selected = snapshot.detailEnvelope, requestRevision = revision.current;
        const selectionCurrent = () => revision.current === requestRevision && stillCurrent(snapshot) && selected === latest.current?.detailEnvelope
            && sharedResourceEnvelopeIsValid(selected) && sharedResourceResponseIsCurrent(selected, latest.current.context);
        if (!selectionCurrent() || !selected.previews?.some(row => row.key === key) || signal.aborted) throw canceled();
        try {
            const result = await api.getPortalWorkspaceResourcePreview(key, snapshot.activity, { signal });
            if (signal.aborted || !selectionCurrent()) throw canceled();
            return result;
        } catch (failure) {
            if (!signal.aborted && selectionCurrent()) { clear(); setError(true); }
            throw failure;
        }
    };

    if (!optionsValid) return null;
    const current = partition !== null && stillCurrent(latest.current);
    const selectedProvider = sharedResources.providers.some(row => row.value === provider) ? provider : '';
    return <Stack component="section" spacing={2}>
        <Typography component="h2" variant="h6" fontWeight={800}>{productRecord === null
            ? (isArabic ? 'العروض والخدمات المشتركة' : 'Shared offerings and services') : (isArabic ? 'السياق الحالي من المصدر' : 'Current source context')}</Typography>
        {productRecord !== null ? <Box><Button variant="outlined" disabled={!current || loading} onClick={() => read('product')}>{isArabic ? 'قراءة سياق المنتج من المصدر' : 'Read current product context'}</Button></Box>
            : <Box component="form" onSubmit={event => { event.preventDefault(); read('search'); }}><Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
                <TextField select label={isArabic ? 'حساب المصدر' : 'Source account'} value={selectedProvider} disabled={!current || loading} sx={{ minWidth: 200 }}
                    onChange={event => { clear(); setProvider(event.target.value); setQuery(''); }}>
                    <MenuItem value="">{isArabic ? 'اختر المصدر' : 'Choose source'}</MenuItem>
                    {sharedResources.providers.map(row => <MenuItem key={row.value} value={row.value}>{row.label}</MenuItem>)}
                </TextField>
                <TextField fullWidth label={isArabic ? 'ابحث في البيانات المسموحة' : 'Search permitted data'} value={query} disabled={!current || loading}
                    onChange={event => { clear(); setQuery(event.target.value); }} inputProps={{ maxLength: 400 }} />
                <Button type="submit" variant="outlined" disabled={!current || loading || !selectedProvider || !sharedResources.browseAction.enabled || [...query].length > 200}>{sharedResources.browseAction.label}</Button>
            </Stack></Box>}
        {!current && <Alert severity="info">{isArabic ? 'تحقق من الحساب والنشاط الحاليين لقراءة المصدر.' : 'Verify the current account and activity to read the source.'}</Alert>}
        {loading && <Box role="status"><CircularProgress size={20} /> <Typography component="span">{isArabic ? 'جارٍ التحقق من قراءة المصدر…' : 'Checking the source read…'}</Typography></Box>}
        {error && <Alert severity="info">{isArabic ? 'تعذر التحقق من القراءة الحالية. أُخفيت البيانات السابقة؛ هذا لا يعني حذفها من المصدر.' : 'The current read could not be verified. Previous data was hidden; no source deletion is implied.'}</Alert>}
        {currentPage?.document.records.map(record => <Card key={record.key} component="article" variant="outlined"><CardContent><Stack spacing={1}>
            <Typography component="h3" fontWeight={800}>{record.data.name || (isArabic ? 'عرض مشترك' : 'Shared offering')}</Typography>
            {Object.hasOwn(record.data, 'name') && <SharedResourceFieldObservation record={record} field="name" isArabic={isArabic} />}
            <Typography variant="body2">{record.sourceLabel}</Typography>
            {record.data.kind && <Box><Typography variant="body2">{sharedResourceEnumLabel('kind', record.data.kind, isArabic)}</Typography>
                <SharedResourceFieldObservation record={record} field="kind" isArabic={isArabic} /></Box>}
            {record.data.status && <Box><Typography variant="body2">{sharedResourceEnumLabel('status', record.data.status, isArabic)}</Typography>
                <SharedResourceFieldObservation record={record} field="status" isArabic={isArabic} /></Box>}
            <Box><Button disabled={loading} onClick={() => read('detail', record.key)}>{isArabic ? 'تفاصيل المصدر' : 'Source details'}</Button></Box>
        </Stack></CardContent></Card>)}
        {currentPage?.document.records.length === 0 && <Typography>{isArabic ? 'لا توجد نتائج مرئية في هذه القراءة.' : 'No results are visible in this read.'}</Typography>}
        {currentPage?.document.cursor && <Box><Button disabled={loading} onClick={() => read('search', null, currentPage.document.cursor)}>{isArabic ? 'الصفحة التالية' : 'Next page'}</Button></Box>}
        {currentDetail && <Box><SharedResourceReadPanel envelope={currentDetail.envelope} onPreview={preview} isArabic={isArabic} />
            <Button onClick={() => { revision.current += 1; request.current?.abort(); setDetail(null); setLoading(false); }}>{isArabic ? 'إغلاق تفاصيل المصدر' : 'Close source details'}</Button></Box>}
    </Stack>;
};

export default SharedResourceBrowser;
