import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { sharedProductDisplayValue, sharedProductRecordKey, sharedProductTitle, sharedProductVisibleFields, sharedReadErrorMessage, sharedReadResponseIsValid } from './sharedProductReadPresentation';

const SharedProductReadPanel = () => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [query, setQuery] = useState('');
    const [document, setDocument] = useState(null);
    const [mode, setMode] = useState('records');
    const [status, setStatus] = useState('unverified');
    const [error, setError] = useState(null);
    const [requirementsOpen, setRequirementsOpen] = useState(false);
    const revision = useRef(0);
    const clearCurrent = useCallback(() => {
        revision.current += 1;
        setDocument(null);
        setStatus('unverified');
        setError(null);
    }, []);

    useEffect(() => {
        const hideOnVisibility = () => { if (window.document.hidden) clearCurrent(); };
        window.addEventListener('blur', clearCurrent);
        window.addEventListener('pagehide', clearCurrent);
        window.addEventListener('savana-shared-read-setup-changed', clearCurrent);
        window.document.addEventListener('visibilitychange', hideOnVisibility);
        return () => {
            revision.current += 1;
            window.removeEventListener('blur', clearCurrent);
            window.removeEventListener('pagehide', clearCurrent);
            window.removeEventListener('savana-shared-read-setup-changed', clearCurrent);
            window.document.removeEventListener('visibilitychange', hideOnVisibility);
        };
    }, [clearCurrent]);

    useEffect(() => {
        if (!document?.context?.valid_until) return undefined;
        const expiresIn = Math.max(0, Date.parse(document.context.valid_until) - Date.now());
        const timeout = window.setTimeout(clearCurrent, Math.min(expiresIn, 2_147_483_647));
        return () => window.clearTimeout(timeout);
    }, [document, clearCurrent]);

    const read = async (nextMode, continuation = null) => {
        const expectedAuthorizationRevision = continuation === null ? null : document?.context?.authorization_revision;
        const requestRevision = revision.current + 1;
        revision.current = requestRevision;
        setMode(nextMode);
        setStatus('loading');
        setDocument(null);
        setError(null);
        try {
            const result = nextMode === 'changes'
                ? await api.getPortalSharedProductChanges(continuation ?? 0)
                : await api.getPortalSharedProducts({ q: query, cursor: continuation });
            if (revision.current !== requestRevision) return;
            if (!sharedReadResponseIsValid(result, nextMode)) throw new Error('Unverified shared product response');
            if (expectedAuthorizationRevision && result.context.authorization_revision !== expectedAuthorizationRevision) {
                const changed = new Error('Read authorization changed');
                changed.status = 409;
                throw changed;
            }
            setDocument(result);
            setStatus('verified');
        } catch (requestError) {
            if (revision.current !== requestRevision) return;
            setDocument(null);
            setError(requestError);
            setStatus('unverified');
        }
    };

    const rows = mode === 'changes' ? document?.changes || [] : (document?.records || []).map(record => ({ record }));
    const stateLabel = state => ({
        active: ar ? 'نسخة نشطة للقراءة' : 'Active read observation',
        archived: ar ? 'مؤرشف صراحةً من المصدر' : 'Explicitly archived by the source',
        tombstone: ar ? 'إشارة حذف صريحة من المصدر' : 'Explicit source tombstone',
    }[state]);
    const fieldLabel = key => ({
        name: ar ? 'الاسم' : 'Name', description: ar ? 'الوصف' : 'Description', sku: 'SKU',
        currency: ar ? 'العملة' : 'Currency', online_price: ar ? 'السعر المنشور في المرجع' : 'Source online price',
        base_unit: ar ? 'وحدة المرجع' : 'Source unit',
    }[key] || key);

    return (
        <Card component="section" aria-labelledby="shared-product-read-title" sx={{ mb: 3 }}>
            <CardContent>
                <Stack direction="row" gap={1} justifyContent="space-between" alignItems="center" flexWrap="wrap">
                    <Typography id="shared-product-read-title" variant="h6" fontWeight={800}>{ar ? 'قراءة المنتجات المشتركة' : 'Shared product reads'}</Typography>
                    <Button aria-haspopup="dialog" onClick={() => setRequirementsOpen(true)}>{ar ? 'لماذا؟ والمتطلبات' : 'Why? Read requirements'}</Button>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
                    {ar ? 'عرض مستقل للحقول المسموحة من المرجع المركزي. لا يدمج المنتجات القديمة ولا يعدّل منتجات البوت ولا يجهّز رسالة أو يعتمد سعرًا للتنفيذ.' : 'A separate view of fields allowed by the central reference. It does not merge legacy products, change bot copies, prepare messages or authorize prices for execution.'}
                </Typography>
                <Box component="form" onSubmit={event => { event.preventDefault(); read('records'); }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ my: 2 }}>
                        <TextField fullWidth label={ar ? 'البحث في الحقول المسموحة' : 'Search permitted fields'} value={query} onChange={event => { clearCurrent(); setQuery(event.target.value); }} inputProps={{ maxLength: 255 }} size="small" />
                        <Button type="submit" variant="outlined" disabled={status === 'loading'} sx={{ minWidth: { sm: 170 } }}>{ar ? 'التحقق والقراءة' : 'Verify and read'}</Button>
                        <Button onClick={() => read('changes')} disabled={status === 'loading'} sx={{ minWidth: { sm: 150 } }}>{ar ? 'التحقق من التحديثات' : 'Check updates'}</Button>
                    </Stack>
                </Box>
                <Box aria-live="polite" aria-atomic="true">
                    {status === 'loading' && <Stack direction="row" gap={1} alignItems="center"><CircularProgress size={20} /><Typography>{ar ? 'جارٍ التحقق من التفويض والقراءة الحالية…' : 'Verifying authorization and the current read…'}</Typography></Stack>}
                    {status === 'unverified' && <Alert severity={error ? 'warning' : 'info'}>{error ? sharedReadErrorMessage(error, language) : (ar ? 'لم تُتحقق قراءة حالية. تظل القدرة ظاهرة؛ يتطلب العرض جلسة قراءة خادمية وتفويضًا ساريًا. لا تُعرض نتائج قديمة عند فقد التحقق.' : 'No current read has been verified. This capability remains visible and requires a server-held read session and current authorization. Prior rows are hidden when verification is lost.')}</Alert>}
                    {status === 'verified' && <Alert severity="info">{mode === 'changes'
                        ? (ar ? 'هذه ملاحظات تحديث مرتبة بمؤشر المصدر، وليست إعادة تطبيق للأثر أو استبدالًا للقراءة الحالية. الأرشفة وإشارة الحذف صريحتان فقط.' : 'These are source change observations, not replayed effects or replacements for a current read. Archival and tombstones must be explicit.')
                        : (ar ? 'هذه قراءة مفوّضة لحظة الطلب فقط، وليست موافقة تنفيذ أو اشتراكًا في تحديثات الخلفية. أعد التحقق للحصول على الحالة الحالية.' : 'This was authorized at request time only. It is not execution approval or a background subscription. Verify again for the current state.')}</Alert>}
                    {status === 'verified' && rows.length === 0 && <Typography sx={{ mt: 2 }}>{ar ? 'لا توجد نتائج مرئية في هذه القراءة؛ لا يعني ذلك حذف سجل سابق.' : 'No visible results in this read; this does not mean an earlier record was deleted.'}</Typography>}
                </Box>
                <Stack spacing={2} sx={{ mt: 2 }}>
                    {rows.map(({ record, cursor }) => (
                        <Box component="article" key={`${sharedProductRecordKey(record)}:${cursor ?? record.version}`} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 0 }}>
                            <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
                                <Typography component="h3" variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{sharedProductTitle(record)}</Typography>
                                <Chip size="small" variant="outlined" label={stateLabel(record.state)} />
                                {record.freshness && <Chip size="small" label={{ current: ar ? 'حديث حسب المرجع' : 'Current at source', stale: ar ? 'قراءة متأخرة' : 'Stale observation', clock_ahead: ar ? 'وقت المصدر يحتاج تحققًا' : 'Source clock ahead' }[record.freshness]} />}
                            </Stack>
                            <Box component="dl" sx={{ m: 0, mt: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(140px, 1fr) minmax(0, 3fr)' }, gap: 0.5, '& dt': { fontWeight: 600 }, '& dd': { m: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }}>
                                {[
                                    [ar ? 'المعرف المركزي' : 'Central ID', record.entity_id],
                                    [ar ? 'تركيب المصدر' : 'Source installation', record.source.installation_id],
                                    [ar ? 'نوع مرجع المصدر' : 'Source entity type', record.source.entity_type],
                                    [ar ? 'معرف المصدر المحلي' : 'Source local ID', record.source.local_entity_id],
                                    [ar ? 'المجال' : 'Domain', record.domain],
                                    [ar ? 'إصدار السجل / ملكية المجال' : 'Record version / ownership epoch', `${record.version} / ${record.ownership_epoch}`],
                                    [ar ? 'مراجعة المصدر' : 'Source revision', record.source_revision ?? (ar ? 'غير محددة' : 'Not specified')],
                                    [ar ? 'وقت الواقعة / وقت الاستلام' : 'Observed / received', `${record.observed_at} / ${record.received_at}`],
                                    ...(cursor === undefined ? [] : [[ar ? 'مؤشر الملاحظة' : 'Observation cursor', cursor]]),
                                ].map(([label, value]) => <React.Fragment key={label}><Typography component="dt" variant="body2">{label}</Typography><Typography component="dd" variant="body2">{String(value)}</Typography></React.Fragment>)}
                            </Box>
                            <Typography variant="subtitle2" sx={{ mt: 2 }}>{ar ? 'الحقول المرئية بهذا التفويض' : 'Fields visible under this authorization'}</Typography>
                            {record.state === 'tombstone'
                                ? <Typography variant="body2">{ar ? 'الإشارة الصريحة لا تعيد عرض محتوى قديم.' : 'The explicit tombstone does not restore previous content.'}</Typography>
                                : <Box component="dl" sx={{ m: 0, mt: 1, '& dt': { fontWeight: 600 }, '& dd': { m: 0, mb: 1, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }}>{sharedProductVisibleFields(record).map(([key, value]) => <React.Fragment key={key}><Typography component="dt" variant="body2">{fieldLabel(key)}</Typography><Typography component="dd" variant="body2">{sharedProductDisplayValue(value, language)}</Typography></React.Fragment>)}</Box>}
                        </Box>
                    ))}
                </Stack>
                {status === 'verified' && document?.has_more && <Button sx={{ mt: 2 }} onClick={() => read(mode, mode === 'changes' ? document.cursor : document.next_cursor)}>{ar ? 'قراءة الصفحة التالية بتفويض جديد' : 'Read next page with fresh authorization'}</Button>}
            </CardContent>
            <Dialog open={requirementsOpen} onClose={() => setRequirementsOpen(false)} fullWidth maxWidth="sm" aria-labelledby="shared-product-read-requirements">
                <DialogTitle id="shared-product-read-requirements">{ar ? 'متطلبات قراءة المنتجات المشتركة' : 'Shared product read requirements'}</DialogTitle>
                <DialogContent><Stack spacing={1.5}>
                    <Alert severity="info">{ar ? 'الميزة معطّلة افتراضيًا. يحدد الخادم المؤسسة والنشاط والتركيب وجلسة القراءة، ويتحقق المركز من التفويض الحالي والحقول المسموحة في كل طلب.' : 'This feature is disabled by default. The server selects the organization, activity, installation and read session; the center verifies current authorization and permitted fields on every request.'}</Alert>
                    <Alert severity="info">{ar ? 'لا يرسل المتصفح منحًا أو أسرارًا ولا يحوّل رمز قراءة المستخدم إلى اعتماد ناشر أو عامل خلفي. فقد الاتصال أو عدم الرؤية ليس حذفًا.' : 'The browser supplies no grants or secrets and never promotes a user read token into publisher or background-worker credentials. A connection failure or invisible record is not deletion.'}</Alert>
                    <Alert severity="warning">{ar ? 'لا يفعّل هذا العرض المنتجات القديمة المعزولة ولا يغير سياسة معالجتها، ولا يستنتج تطابق الهوية من SKU أو الباركود.' : 'This view neither reactivates quarantined legacy products nor changes their handling policy. SKU or barcode equality never establishes shared identity.'}</Alert>
                </Stack></DialogContent>
                <DialogActions><Button onClick={() => setRequirementsOpen(false)}>{ar ? 'إغلاق' : 'Close'}</Button></DialogActions>
            </Dialog>
        </Card>
    );
};

export default SharedProductReadPanel;
