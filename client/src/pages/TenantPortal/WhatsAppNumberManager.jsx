import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useWhatsAppNumbers } from '../../context/WhatsAppNumberContext';
import { whatsappNumberDisplayName } from './guidedWhatsAppPresentation';

// Existing native number identifiers stay internal API references, never owner inputs.
const WhatsAppNumberManager = ({ language = 'ar', refreshKey = 0 }) => {
    const ar = language === 'ar';
    const { refreshNumbers, selectNumber } = useWhatsAppNumbers();
    const [numbers, setNumbers] = useState([]);
    const [labels, setLabels] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [notice, setNotice] = useState('');
    const [removing, setRemoving] = useState(null);
    const current = useRef(0);
    const running = useRef(false);
    const load = useCallback(async () => {
        const ticket = ++current.current;
        setLoading(true); setError(false); setNumbers([]); setLabels({});
        try {
            const status = await api.getPortalWhatsAppStatus();
            if (!Array.isArray(status?.numbers)) throw new Error('invalid_status');
            if (ticket !== current.current) return null;
            setNumbers(status.numbers); setLabels(Object.fromEntries(status.numbers.map(row => [row.phone_number_id, typeof row.label === 'string' ? row.label : ''])));
            return status;
        } catch { if (ticket === current.current) setError(true); return null; }
        finally { if (ticket === current.current) setLoading(false); }
    }, []);
    useEffect(() => { load(); return () => { current.current += 1; }; }, [load, refreshKey]);
    const change = async (kind, row) => {
        if (running.current || !numbers.includes(row) || !whatsappNumberDisplayName(row) || !row.phone_number_id) return;
        running.current = true; setLoading(true); setNotice(''); setError(false); setRemoving(null);
        try {
            if (kind === 'label') await api.updatePortalWhatsAppNumber(row.phone_number_id, { label: labels[row.phone_number_id]?.trim() || null });
            else if (kind === 'default') { await api.setDefaultPortalWhatsAppNumber(row.phone_number_id); selectNumber(row.phone_number_id); }
            else if (kind === 'remove') await api.deletePortalWhatsAppNumber(row.phone_number_id);
            const fresh = await load(); await refreshNumbers();
            if (fresh) setNotice(ar ? 'تحدّثت الأرقام المحفوظة.' : 'Saved numbers were refreshed.');
        } catch {
            // A read checks actual persistence; no mutation is automatically repeated.
            await load(); setError(true);
        } finally { running.current = false; setLoading(false); }
    };
    return <Card component="section" aria-label={ar ? 'الأرقام المحفوظة' : 'Saved numbers'}><CardContent><Stack spacing={2}>
        <Stack direction="row" gap={2} alignItems="center" justifyContent="space-between"><Typography component="h2" variant="h6" fontWeight={800}>{ar ? 'الأرقام المحفوظة' : 'Saved numbers'}</Typography><Button disabled={loading} onClick={load}>{ar ? 'تحديث' : 'Refresh'}</Button></Stack>
        <Typography color="text.secondary">{ar ? 'غيّر الاسم أو الرقم الافتراضي أو أزل ربط رقم محفوظ. حالة الإرسال وصلاحيات التعاون تُفحص عند استخدامها.' : 'Rename a saved number, choose a default, or remove its connection. Sending and collaboration permissions are checked when used.'}</Typography>
        {error && <Alert severity="warning">{ar ? 'تعذّر تأكيد التحديث. تحقّق من الأرقام الحالية قبل إعادة أي تغيير.' : 'The update could not be confirmed. Check the current numbers before repeating a change.'}</Alert>}
        {notice && <Alert severity="info">{notice}</Alert>}
        {!loading && !error && !numbers.length && <Typography color="text.secondary">{ar ? 'لا توجد أرقام محفوظة حاليًا. اربط رقمًا من الخطوات أعلاه.' : 'No numbers are saved yet. Connect a number using the steps above.'}</Typography>}
        {numbers.map((row, index) => {
            const name = whatsappNumberDisplayName(row);
            const id = row.phone_number_id;
            return <Card variant="outlined" key={id || `unnamed-${index}`}><CardContent><Stack spacing={2}>
                <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center"><Typography fontWeight={800}>{name || (ar ? 'رقم دون اسم متحقق' : 'Number without a verified name')}</Typography>{!!row.is_default && <Chip size="small" label={ar ? 'افتراضي' : 'Default'} />}</Stack>
                {row.display_phone_number && row.display_phone_number !== name && <Typography><bdi dir="ltr">{row.display_phone_number}</bdi></Typography>}
                {!name && <Alert severity="info">{ar ? 'تعذّر عرض اسم هذا الرقم. تحقّق من حالته قبل إدارته.' : 'This number has no display name. Check its status before managing it.'}</Alert>}
                <TextField fullWidth label={ar ? 'اسم الرقم داخل النشاط' : 'Number name in this activity'} value={labels[id] || ''} disabled={loading || !name || !id} onChange={event => setLabels(previous => ({ ...previous, [id]: event.target.value }))} inputProps={{ maxLength: 100 }} />
                <Stack direction="row" gap={1} flexWrap="wrap"><Button disabled={loading || !name || !id || (labels[id] || '').trim() === (row.label || '')} onClick={() => change('label', row)}>{ar ? 'حفظ الاسم' : 'Save name'}</Button>
                    <Button disabled={loading || !name || !id || !!row.is_default} onClick={() => change('default', row)}>{ar ? 'استخدام افتراضيًا' : 'Use by default'}</Button>
                    <Button color="error" disabled={loading || !name || !id} onClick={() => setRemoving(row)}>{ar ? 'إزالة الربط' : 'Remove connection'}</Button></Stack>
            </Stack></CardContent></Card>;
        })}
        <Dialog open={Boolean(removing)} onClose={() => { if (!loading) setRemoving(null); }} fullWidth maxWidth="sm" aria-labelledby="remove-saved-whatsapp-title"><DialogTitle id="remove-saved-whatsapp-title">{ar ? 'إزالة ربط الرقم' : 'Remove phone connection'}</DialogTitle>
            <DialogContent><Stack spacing={2}><Typography>{whatsappNumberDisplayName(removing)}</Typography><Typography>{ar ? 'سيُزال ربط هذا الرقم من النشاط. هذه الخطوة لا تلغي صلاحيات تطبيق Meta العامة.' : 'This removes the number connection from this activity. It does not revoke the Meta app’s general permissions.'}</Typography></Stack></DialogContent>
            <DialogActions><Button disabled={loading} onClick={() => setRemoving(null)}>{ar ? 'رجوع' : 'Back'}</Button><Button disabled={loading} color="error" onClick={() => change('remove', removing)}>{ar ? 'إزالة الربط' : 'Remove connection'}</Button></DialogActions>
        </Dialog>
    </Stack></CardContent></Card>;
};
export default WhatsAppNumberManager;
