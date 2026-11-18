import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, CardContent, Checkbox, CircularProgress, FormControlLabel, Radio, RadioGroup, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import api from '../../api';
import { guidedWhatsAppAuthorizationUrl, guidedWhatsAppChoice, guidedWhatsAppPopupMessage, guidedWhatsAppReviewKey, guidedWhatsAppStatusIsValid } from './guidedWhatsAppPresentation';

const GuidedWhatsAppSetupPanel = ({ language = 'ar', onConnected }) => {
    const ar = language === 'ar';
    const [document, setDocument] = useState(null);
    const [busy, setBusy] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [uncertain, setUncertain] = useState(false);
    const [error, setError] = useState('');
    const [choice, setChoice] = useState('');
    const [setDefault, setSetDefault] = useState(false);
    const [review, setReview] = useState(null);
    const current = useRef(null);
    const active = useRef(false);
    const running = useRef(false);
    const popup = useRef(null);
    const pending = useRef(null);
    const poll = useRef(null);
    const lost = useRef(null);
    const connected = useRef(onConnected);
    connected.current = onConnected;

    const closePopup = useCallback((close = false) => {
        if (poll.current) window.clearInterval(poll.current);
        poll.current = null;
        if (close && popup.current && !popup.current.closed) popup.current.close();
        popup.current = null; pending.current = null;
        if (active.current) setWaiting(false);
    }, []);
    const accept = useCallback(value => {
        if (!guidedWhatsAppStatusIsValid(value)) throw new Error('unverified_setup');
        if (!active.current) return null;
        current.current = value; setDocument(value); setChoice(''); setReview(null);
        if (lost.current && (value.stage !== lost.current.stage || ['connected', 'expired', 'idle'].includes(value.stage))) {
            lost.current = null; setUncertain(false);
        }
        return value;
    }, []);
    const readStatus = useCallback(async () => accept(await api.getPortalGuidedWhatsAppSetup()), [accept]);
    const refresh = useCallback(async () => {
        if (running.current) return;
        running.current = true; setBusy(true); setError('');
        try { await readStatus(); }
        catch { if (active.current) { current.current = null; setDocument(null); setReview(null); setChoice(''); setError(ar ? 'تعذّر التحقق من حالة الربط. أعد التحقق من الحالة.' : 'Could not verify the connection status. Check the status again.'); } }
        finally { running.current = false; if (active.current) setBusy(false); }
    }, [ar, readStatus]);
    useEffect(() => {
        active.current = true; refresh();
        return () => { active.current = false; closePopup(true); };
    }, [refresh, closePopup]);

    const mutate = useCallback(async (kind, dispatch) => {
        if (running.current || (lost.current && kind !== 'cancel')) return;
        const stage = current.current?.stage;
        running.current = true; setBusy(true); setError(''); setReview(null);
        lost.current = { kind, stage }; setUncertain(true);
        try {
            const result = await dispatch();
            if (!guidedWhatsAppStatusIsValid(result)) throw new Error('unverified_setup');
            const fresh = await readStatus();
            if (fresh && active.current) {
                lost.current = null; setUncertain(false);
                if (kind === 'connect' && fresh.stage === 'connected') connected.current?.();
            }
        } catch {
            if (active.current) setError(ar ? 'لم تتأكد نتيجة الخطوة. تحقّق من الحالة قبل المتابعة؛ لن تُعاد العملية تلقائيًا.' : 'The step outcome is unconfirmed. Check the status before continuing; the operation will not be repeated automatically.');
            try {
                const fresh = await readStatus();
                if (fresh && !lost.current && active.current) setError('');
                if (kind === 'connect' && fresh?.stage === 'connected') connected.current?.();
            } catch { if (active.current) { current.current = null; setDocument(null); setChoice(''); } }
        } finally { running.current = false; if (active.current) setBusy(false); }
    }, [ar, readStatus]);

    useEffect(() => {
        const receive = event => {
            const message = guidedWhatsAppPopupMessage({ event, origin: window.location.origin, popup: popup.current,
                state: pending.current?.state, expiresAt: pending.current?.expires_at });
            if (!message) return;
            closePopup(true);
            if (message.kind === 'complete') mutate('complete', () => api.completePortalGuidedWhatsAppSetup(message.code, message.state));
            else setError(ar ? 'لم يكتمل التفويض لدى Meta. يمكنك إلغاء المحاولة ثم بدء تفويض جديد.' : 'Meta authorization was not completed. Cancel this attempt before starting a new one.');
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, [ar, closePopup, mutate]);
    useEffect(() => {
        if (!document?.expires_at || !['authorizing', 'business', 'account', 'phone'].includes(document.stage)) return undefined;
        const timer = window.setTimeout(() => {
            closePopup(true); current.current = null; setDocument(null); setReview(null); setChoice('');
            setError(ar ? 'انتهت مهلة هذه المحاولة. تحقّق من الحالة لبدء تفويض جديد.' : 'This attempt expired. Check the status to start a new authorization.');
        }, Math.max(0, Date.parse(document.expires_at) - Date.now()));
        return () => window.clearTimeout(timer);
    }, [document, ar, closePopup]);

    const start = async () => {
        if (running.current || lost.current || !current.current?.configured) return;
        let child;
        try { child = window.open('', '_blank', 'width=650,height=750'); } catch { child = null; }
        if (!child) { setError(ar ? 'اسمح بفتح نافذة التفويض ثم حاول مجددًا.' : 'Allow the authorization popup, then try again.'); return; }
        closePopup(true); popup.current = child;
        running.current = true; setBusy(true); setError(''); setReview(null);
        try {
            const result = await api.startPortalGuidedWhatsAppSetup();
            if (!guidedWhatsAppStatusIsValid(result) || result.stage !== 'authorizing') throw new Error('unverified_setup');
            const url = guidedWhatsAppAuthorizationUrl(result.authorization_url, { appOrigin: window.location.origin, state: result.state });
            if (!url || child.closed || !active.current) throw new Error('unverified_authorization');
            accept(result); pending.current = { state: result.state, expires_at: result.expires_at };
            child.location.href = url; setWaiting(true);
            poll.current = window.setInterval(() => {
                if (!child.closed) return;
                closePopup();
                if (active.current) setError(ar ? 'أُغلقت نافذة التفويض. تحقّق من الحالة أو ألغِ المحاولة لبدء تفويض جديد.' : 'The authorization window closed. Check the status, or cancel the attempt to start again.');
            }, 500);
        } catch {
            closePopup(true);
            lost.current = { kind: 'start', stage: 'authorizing' }; setUncertain(true);
            setError(ar ? 'تعذّر فتح تفويض متحقق. تحقّق من الحالة أو ألغِ هذه المحاولة.' : 'Could not open a verified authorization. Check the status or cancel this attempt.');
            try { await readStatus(); } catch { current.current = null; setDocument(null); }
        } finally { running.current = false; if (active.current) setBusy(false); }
    };
    const selected = guidedWhatsAppChoice(document, choice, document?.stage);
    const currentReview = review && selected && review.key === guidedWhatsAppReviewKey(document) && review.choice === choice && review.setDefault === setDefault;
    const disabled = busy || uncertain || waiting;
    const step = { idle: 0, authorizing: 0, business: 1, account: 2, phone: 3, connected: 4, expired: 0 }[document?.stage] || 0;
    const canStart = document?.configured && ['idle', 'connected', 'expired'].includes(document.stage);
    return <Card component="section" aria-label={ar ? 'ربط حساب واتساب' : 'Connect a WhatsApp account'}><CardContent><Stack spacing={2}>
        <Typography component="h2" variant="h6" fontWeight={800}>{ar ? 'ربط حساب واتساب' : 'Connect a WhatsApp account'}</Typography>
        <Typography color="text.secondary">{ar ? 'ادخل إلى Meta، ثم اختر المؤسسة وحساب واتساب والرقم من حساباتك المتاحة.' : 'Sign in to Meta, then choose your available business, WhatsApp account and phone number.'}</Typography>
        <Stepper activeStep={step} alternativeLabel sx={{ '& .MuiStepLabel-label': { fontSize: { xs: 11, sm: 14 } } }}>
            {(ar ? ['تفويض Meta', 'المؤسسة', 'حساب واتساب', 'الرقم', 'حُفظ الربط'] : ['Authorize Meta', 'Business', 'WhatsApp account', 'Phone', 'Connection saved']).map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>
        {busy && <Stack direction="row" gap={1} alignItems="center" role="status"><CircularProgress size={20} /><Typography>{ar ? 'جارٍ التحقق…' : 'Checking…'}</Typography></Stack>}
        {error && <Alert severity="warning">{error}</Alert>}
        {uncertain && <Alert severity="warning">{ar ? 'نتيجة الخطوة غير مؤكدة. استخدم التحقق من الحالة؛ لا تبدأ محاولة مكررة.' : 'The step outcome is unconfirmed. Check its status before starting another attempt.'}</Alert>}
        {document && !document.configured && <Alert severity="info">{document.next_action.label}</Alert>}
        {document?.connection.connected && <Alert severity="info">{ar ? 'توجد بيانات ربط محفوظة للرقم. هذا لا يثبت صلاحية الإرسال أو تسليم الرسائل.' : 'A phone connection credential is stored. This does not establish send permission or message delivery.'}</Alert>}
        {document?.stage === 'connected' && <Alert severity={document.webhook_status === 'confirmed' ? 'success' : 'info'}>{document.webhook_status === 'confirmed'
            ? (ar ? 'حُفظ الرقم وأكد Meta اشتراك الاستقبال لهذه المحاولة.' : 'The number was saved and Meta confirmed the webhook subscription for this attempt.')
            : (ar ? 'حُفظ الرقم، ولم يُتحقق هنا من اشتراك استقبال الأحداث. راجع إعداد الاستقبال قبل الاعتماد عليه.' : 'The number was saved. The webhook subscription is not verified here; check reception setup before relying on it.')}</Alert>}
        {waiting && <Typography role="status">{ar ? 'أكمل التفويض في النافذة المفتوحة. لا تنسخ رموزًا أو مفاتيح إلى هذه الصفحة.' : 'Complete authorization in the open window. No codes or keys need to be copied to this page.'}</Typography>}
        {document && ['business', 'account', 'phone'].includes(document.stage) && <Stack spacing={1}>
            <Typography component="h3" fontWeight={800}>{document.stage === 'business' ? (ar ? 'اختر المؤسسة' : 'Choose a business') : document.stage === 'account' ? (ar ? 'اختر حساب واتساب' : 'Choose a WhatsApp account') : (ar ? 'اختر الرقم' : 'Choose a phone number')}</Typography>
            {!document.choices.length ? <Alert severity="info">{document.next_action.label}</Alert>
                : <RadioGroup aria-label={document.stage === 'phone' ? (ar ? 'الرقم' : 'Phone number') : (ar ? 'الحساب المتاح' : 'Available account')} value={choice} onChange={event => { setChoice(event.target.value); setReview(null); }}>
                    {document.choices.map(row => <FormControlLabel key={row.value} value={row.value} disabled={disabled} control={<Radio />} label={<Stack><Typography>{row.label}</Typography>{row.detail && <Typography variant="body2" color="text.secondary">{row.detail}</Typography>}</Stack>} />)}
                </RadioGroup>}
            {document.stage === 'phone' && selected && <FormControlLabel control={<Checkbox checked={setDefault} disabled={disabled} onChange={event => { setSetDefault(event.target.checked); setReview(null); }} />} label={ar ? 'استخدام هذا الرقم افتراضيًا' : 'Use this number by default'} />}
            {document.stage === 'phone' && currentReview && <Alert severity="info"><Stack spacing={1}>
                <Typography fontWeight={800}>{ar ? 'مراجعة ربط الرقم' : 'Review phone connection'}</Typography><Typography>{selected.label}</Typography>{selected.detail && <Typography>{selected.detail}</Typography>}
                <Typography>{setDefault ? (ar ? 'سيُستخدم هذا الرقم افتراضيًا.' : 'This number will be the default.') : (ar ? 'يُحفظ الرقم؛ إذا كان أول رقم متاح فسيُستخدم افتراضيًا.' : 'The number will be saved. The first available number becomes the default.')}</Typography>
                <Typography>{ar ? 'ستُحفظ بيانات التفويض مشفّرة لدى المنصة، ويُطلب اشتراك استقبال الأحداث. لا تُرسل هذه الخطوة رسالة.' : 'The platform stores the authorization encrypted and requests webhook reception. This step sends no message.'}</Typography>
            </Stack></Alert>}
            {selected && <Button variant="contained" disabled={disabled} onClick={() => {
                if (document.stage !== 'phone') mutate('choose', () => api.choosePortalGuidedWhatsAppSetup(selected.value));
                else if (!currentReview) setReview({ key: guidedWhatsAppReviewKey(document), choice, setDefault });
                else mutate('connect', () => api.connectPortalGuidedWhatsAppSetup(selected.value, setDefault));
            }}>{document.stage !== 'phone' ? (ar ? 'متابعة بهذا الاختيار' : 'Continue with this choice') : currentReview ? (ar ? 'حفظ ربط هذا الرقم' : 'Save this phone connection') : (ar ? 'مراجعة ربط الرقم' : 'Review phone connection')}</Button>}
        </Stack>}
        {document?.stage === 'expired' && <Alert severity="info">{ar ? 'انتهت هذه المحاولة. يلزم تفويض جديد لعرض الحسابات المتاحة.' : 'This attempt expired. Authorize again to view available accounts.'}</Alert>}
        <Stack direction="row" gap={1} flexWrap="wrap">
            {canStart && <Button variant="contained" onClick={start} disabled={disabled}>{document.connection.connected ? (ar ? 'ربط رقم آخر أو تجديد التفويض' : 'Connect another number or renew authorization') : (ar ? 'الدخول إلى Meta' : 'Sign in to Meta')}</Button>}
            <Button onClick={refresh} disabled={busy}>{ar ? 'التحقق من الحالة' : 'Check status'}</Button>
            {(uncertain || (document && ['authorizing', 'business', 'account', 'phone'].includes(document.stage))) && <Button disabled={busy} onClick={() => { closePopup(true); mutate('cancel', () => api.cancelPortalGuidedWhatsAppSetup()); }}>{ar ? 'إلغاء محاولة الإعداد' : 'Cancel setup attempt'}</Button>}
        </Stack>
        <Typography variant="caption" color="text.secondary">{ar ? 'إلغاء محاولة الإعداد لا يحذف رقمًا محفوظًا ولا يلغي صلاحيات Meta العامة.' : 'Cancelling setup does not delete a saved number or revoke permissions at Meta.'}</Typography>
    </Stack></CardContent></Card>;
};
export default GuidedWhatsAppSetupPanel;
