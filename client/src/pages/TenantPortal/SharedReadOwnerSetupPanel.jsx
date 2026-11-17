import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { ownerCanDisconnect, ownerCanLogin, ownerCanOverview, ownerChoicesForScope, ownerMutationsHeld, ownerOverviewIsValid, ownerScopeKey, ownerSessionLabel, ownerSetupError, ownerStatusIsValid } from './sharedReadOwnerPresentation';
import { sharedReadSetupIsValid } from './sharedReadSetupPresentation';
import SharedReadOwnerPolicyControls from './SharedReadOwnerPolicyControls';
import { ownerAttemptContext, restoreOwnerAttempt } from './sharedReadOwnerOperations';

const changed = () => window.dispatchEvent(new CustomEvent('savana-shared-read-setup-changed', { detail: { source: 'owner-review' } }));
const hasLocalAttempt = status => { try { return Boolean(restoreOwnerAttempt(window.sessionStorage, ownerAttemptContext(status))); } catch { return false; } };
const fieldLabel = (field, ar) => ({ name: ar ? 'الاسم' : 'Name', description: ar ? 'الوصف' : 'Description', sku: 'SKU', barcodes: ar ? 'الباركود' : 'Barcodes', base_unit: ar ? 'الوحدة الأساسية' : 'Base unit', price: ar ? 'السعر' : 'Price', media: ar ? 'الوسائط' : 'Media', is_visible: ar ? 'الظهور' : 'Visibility' }[field]);
const requestState = (state, ar) => ({ pending: ar ? 'قيد المراجعة' : 'Pending review', approved: ar ? 'معتمدة' : 'Approved', rejected: ar ? 'مرفوضة' : 'Rejected' }[state]);

const RequestDetails = ({ request, readers, grants, ar, now }) => {
    const accountName = id => readers.find(reader => reader.account_id === id)?.display_name || id;
    const proposal = request.proposal;
    const effective = request.effective_resource;
    const grant = effective?.read_grant_id && grants.find(item => item.read_grant_id === effective.read_grant_id);
    const effectiveState = grant ? (grant.active && !grant.expired && Date.parse(grant.expires_at) > now
        ? (ar ? 'منحة مسجلة سارية حاليًا؛ يعاد التحقق عند القراءة' : 'A current grant is recorded; every read checks it again')
        : (ar ? 'منحة القراءة غير سارية' : 'Read grant is not current'))
        : (ar ? 'لم تُتحقق حالة المنحة الحالية' : 'Current grant state is unverified');
    return <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, overflowWrap: 'anywhere' }}>
        <Typography component="h3" variant="subtitle1" fontWeight={700}>{request.kind === 'consumer_registration' ? (ar ? 'طلب اعتماد تركيب المستهلك' : 'Consumer installation approval request') : (ar ? 'طلب مشاركة القراءة' : 'Read sharing request')}</Typography>
        <Typography variant="body2">{ar ? 'مرجع الطلب: ' : 'Request reference: '}{request.request_id}</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} gap={2} sx={{ mt: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={700}>{ar ? 'النسخة الحالية: ' : 'Current version: '}{request.version}</Typography>
                <Chip size="small" label={requestState(request.state, ar)} sx={{ my: 1 }} />
                {request.kind === 'consumer_registration' ? <Typography variant="body2">{proposal.installation_label}{' • '}{ar ? 'إصدار التسجيل: ' : 'Enrollment version: '}{proposal.enrollment_version}</Typography> : <Stack spacing={0.5}>
                    <Typography variant="body2">{ar ? 'الحقول المقترحة: ' : 'Proposed fields: '}{proposal.fields.map(field => fieldLabel(field, ar)).join('، ')}</Typography>
                    <Typography variant="body2">{ar ? 'حسابات القراءة المقترحة: ' : 'Proposed reader accounts: '}{proposal.reader_account_ids.map(accountName).join('، ')}</Typography>
                    <Typography variant="body2">{ar ? 'الانتهاء المقترح: ' : 'Proposed expiry: '}<bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{proposal.expires_at}</bdi></Typography>
                </Stack>}
                {request.reason && <Typography variant="body2">{ar ? 'سبب المراجعة: ' : 'Review reason: '}{request.reason}</Typography>}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={700}>{ar ? 'النسخة المعتمدة النافذة: ' : 'Effective approved version: '}{request.effective_version ?? (ar ? 'لا توجد' : 'None')}</Typography>
                {!effective && <Typography variant="body2" sx={{ mt: 1 }}>{ar ? 'لا تنشئ هذه النسخة المعلقة أو المرفوضة صلاحية.' : 'This pending or rejected version creates no authority.'}</Typography>}
                {effective && request.kind === 'consumer_registration' && <Typography variant="body2" sx={{ mt: 1 }}>{ar ? 'تركيب مستهلك معتمد لا يمنح القراءة وحده. مرجعه: ' : 'An approved consumer installation alone grants no reads. Reference: '}{effective.installation_id}</Typography>}
                {effective && request.kind === 'read_sharing' && <Stack spacing={0.5} sx={{ mt: 1 }}>
                    <Typography variant="body2">{effective.active === false ? (ar ? 'سُجلت المنحة غير فعالة' : 'The grant is recorded as inactive') : effectiveState}</Typography>
                    <Typography variant="body2">{ar ? 'الحقول المعتمدة: ' : 'Approved fields: '}{effective.fields.map(field => fieldLabel(field, ar)).join('، ')}</Typography>
                    <Typography variant="body2">{ar ? 'حسابات القراءة المعتمدة: ' : 'Approved reader accounts: '}{effective.reader_account_ids.map(accountName).join('، ')}</Typography>
                    <Typography variant="body2">{ar ? 'انتهاء المنحة: ' : 'Grant expiry: '}<bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{effective.expires_at}</bdi></Typography>
                </Stack>}
                {request.effective_version !== null && request.effective_version !== request.version && <Alert severity="info" sx={{ mt: 1 }}>{ar ? 'اعتماد النسخة السابقة لا يعتمد التعديل الحالي، ورفض التعديل لا يسحب المنحة السابقة تلقائيًا.' : 'Approval of the earlier version does not approve this revision; rejecting a revision does not automatically revoke the earlier grant.'}</Alert>}
            </Box>
        </Stack>
    </Box>;
};

const SharedReadOwnerSetupPanel = () => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [status, setStatus] = useState(null);
    const [overview, setOverview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [mfa, setMfa] = useState('');
    const [scopeKey, setScopeKey] = useState('');
    const [consumerId, setConsumerId] = useState('');
    const [sourceId, setSourceId] = useState('');
    const [readerAllowed, setReaderAllowed] = useState(false);
    const [readerReady, setReaderReady] = useState(null);
    const [localHold, setLocalHold] = useState(false);
    const [requirementsOpen, setRequirementsOpen] = useState(false);
    const [clock, setClock] = useState(() => Date.now());
    const [focusStatus, setFocusStatus] = useState(0);
    const revision = useRef(0);
    const refreshButton = useRef(null);
    const activeLocalHold = localHold || hasLocalAttempt(status);

    const clearView = useCallback(() => {
        setOverview(null); setScopeKey(''); setConsumerId(''); setSourceId(''); setReaderAllowed(false); setReaderReady(null); changed();
    }, []);

    const load = useCallback(async () => {
        const requestRevision = ++revision.current;
        setLoading(true); setStatus(null); setError(null); clearView();
        try {
            const result = await api.getPortalSharedReadOwnerStatus();
            if (revision.current !== requestRevision) return;
            if (!ownerStatusIsValid(result)) throw new Error('Unverified owner session status');
            setClock(Date.now());
            setLocalHold(hasLocalAttempt(result));
            setStatus(result);
            if (ownerCanOverview(result)) {
                const details = await api.getPortalSharedReadOwnerOverview();
                if (revision.current !== requestRevision) return;
                if (!ownerOverviewIsValid(details)) throw new Error('Unverified scoped owner overview');
                const core = await api.getPortalSharedReadSetup();
                if (revision.current !== requestRevision) return;
                if (!sharedReadSetupIsValid(core)) throw new Error('Unverified native read setup');
                setClock(Date.now()); setLocalHold(hasLocalAttempt(details)); setStatus(details); setOverview(details); setReaderAllowed(core.actions.bind_reader === true); setReaderReady(core.read_ready);
                return details;
            }
            return result;
        } catch (requestError) {
            if (revision.current !== requestRevision) return;
            setStatus(null); clearView(); setError(requestError);
        } finally {
            if (revision.current === requestRevision) setLoading(false);
        }
    }, [clearView]);

    const reloadAfterPolicy = useCallback(async () => {
        const fresh = await load();
        setFocusStatus(value => value + 1);
        return fresh;
    }, [load]);

    useEffect(() => {
        load();
        return () => { revision.current += 1; };
    }, [load]);
    useEffect(() => {
        const invalidateIdentity = event => {
            if (['owner-review', 'reader-binding-refresh'].includes(event?.detail?.source)) return;
            revision.current += 1;
            setStatus(null); setLoading(false); setUsername(''); setPassword(''); setMfa(''); clearView();
        };
        const hideOnVisibility = () => { if (window.document.hidden) invalidateIdentity(); };
        window.addEventListener('savana-shared-read-setup-changed', invalidateIdentity);
        window.addEventListener('blur', invalidateIdentity);
        window.addEventListener('pagehide', invalidateIdentity);
        window.document.addEventListener('visibilitychange', hideOnVisibility);
        return () => {
            window.removeEventListener('savana-shared-read-setup-changed', invalidateIdentity);
            window.removeEventListener('blur', invalidateIdentity);
            window.removeEventListener('pagehide', invalidateIdentity);
            window.document.removeEventListener('visibilitychange', hideOnVisibility);
        };
    }, [clearView]);
    useEffect(() => { if (focusStatus > 0) refreshButton.current?.focus(); }, [focusStatus]);
    useEffect(() => {
        const deadlines = [status?.session?.expires_at, overview?.context?.valid_until, ...(overview?.read_grants || []).map(grant => grant.expires_at),
            ...(overview?.scope_authorizations || []).map(authorization => authorization.expires_at)]
            .filter(Boolean).map(Date.parse).filter(deadline => deadline > clock);
        if (!deadlines.length) return undefined;
        const deadline = Math.min(...deadlines);
        if (deadline <= clock) return undefined;
        const timer = window.setTimeout(() => { setClock(Date.now()); clearView(); }, Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647));
        return () => window.clearTimeout(timer);
    }, [status, overview, clock, clearView]);

    const mutateSession = async (kind, event) => {
        event?.preventDefault();
        if (loading || activeLocalHold || !(kind === 'login' ? ownerCanLogin(status) : ownerCanDisconnect(status))) return;
        const credentials = { username, password, ...(mfa ? { mfa_code: mfa } : {}) };
        const requestRevision = ++revision.current;
        flushSync(() => { setUsername(''); setPassword(''); setMfa(''); setLoading(true); setStatus(null); setError(null); clearView(); });
        let mutationError = null;
        try {
            const pending = kind === 'login' ? api.loginPortalSharedReadOwner(credentials) : api.disconnectPortalSharedReadOwner();
            credentials.username = ''; credentials.password = ''; credentials.mfa_code = '';
            await pending;
        } catch (requestError) {
            mutationError = requestError;
        } finally {
            credentials.username = ''; credentials.password = ''; credentials.mfa_code = '';
        }
        if (revision.current !== requestRevision) return;
        await load();
        if (revision.current !== requestRevision + 1) return;
        if (mutationError) setError(mutationError);
        setFocusStatus(value => value + 1);
    };

    const scope = overview?.options.scopes.find(option => ownerScopeKey(option.scope) === scopeKey)?.scope;
    const choices = overview && scope ? ownerChoicesForScope(overview, scope) : null;
    const sessionState = status?.session.state === 'connected' && Date.parse(status.session.expires_at) <= clock ? 'expired' : status?.session.state;
    const canBind = readerAllowed && !activeLocalHold && status && !ownerMutationsHeld(status) && ownerCanOverview(status)
        && choices?.consumers.some(item => item.installation_id === consumerId);
    const bindReader = async () => {
        if (!canBind || loading) return;
        const body = { consumer_installation_id: consumerId, activity_id: scope.activity_id, branch_id: scope.branch_id, warehouse_id: scope.warehouse_id };
        const requestRevision = ++revision.current;
        setLoading(true); setStatus(null); setError(null); clearView();
        let bindError = null;
        try { await api.bindPortalSharedReadConsumer(body); }
        catch (requestError) { bindError = requestError; }
        if (revision.current !== requestRevision) return;
        await load();
        if (revision.current !== requestRevision + 1) return;
        if (bindError) setError(bindError);
        else window.dispatchEvent(new Event('savana-shared-read-core-refresh'));
        setFocusStatus(value => value + 1);
    };

    return <Card component="section" aria-labelledby="shared-read-owner-title" sx={{ mb: 3 }}>
        <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
                <Typography id="shared-read-owner-title" variant="h6" fontWeight={800}>{ar ? 'جلسة مراجعة المركز وطلبات القراءة' : 'Center review session and read requests'}</Typography>
                <Button aria-haspopup="dialog" onClick={() => setRequirementsOpen(true)}>{ar ? 'لماذا؟ صلاحيات المراجعة' : 'Why? Review permissions'}</Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{ar ? 'هذه جلسة مراجعة منفصلة عن هوية القراءة. لا يمنح تسجيل الدخول أو دور المالك موافقة أو نشرًا أو إرسالًا؛ تُفحص الصلاحيات الحالية لكل نطاق وإجراء.' : 'This review session is separate from the read identity. Signing in or holding an owner role grants no approval, publication or sending; current authorization is checked for each exact scope and action.'}</Typography>
            <Box aria-live="polite" aria-atomic="true">
                {loading && <Stack direction="row" gap={1} alignItems="center"><CircularProgress size={20} /><Typography>{ar ? 'جارٍ تأكيد جلسة المراجعة…' : 'Verifying the review session…'}</Typography></Stack>}
                {error && <Alert severity="warning">{ownerSetupError(error, language)}</Alert>}
                {status && <Stack spacing={1} sx={{ my: 1 }}>
                    <Typography fontWeight={600}>{ownerSessionLabel(sessionState, language)}</Typography>
                    {!status.enabled && <Alert severity="info">{ar ? 'تهيئة مراجعة المركز غير مفعّلة في هذه البيئة. تبقى المتطلبات ظاهرة ولا تُنشأ صلاحيات.' : 'Center review setup is disabled in this environment. Requirements remain visible and no rights are created.'}</Alert>}
                    {status.session.actor_id && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{ar ? 'حساب جلسة المراجعة: ' : 'Review session account: '}{status.session.actor_id}</Typography>}
                    {status.session.expires_at && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{ar ? 'انتهاء الجلسة: ' : 'Session expires: '}<bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{status.session.expires_at}</bdi></Typography>}
                    {ownerMutationsHeld(status) && <Alert severity="warning">{ar ? 'توجد محاولة جارية أو نتيجة غير محسومة. أوقفت الإجراءات الجديدة؛ التحقق من الحالة متاح دون إعادة إرسال.' : 'An operation is pending or its outcome is unresolved. New actions are held; check the status without resubmitting.'}</Alert>}
                </Stack>}
            </Box>
            {!activeLocalHold && ownerCanLogin(status) && <Box component="form" aria-label={ar ? 'الدخول لجلسة مراجعة المركز' : 'Sign in to the center review session'} onSubmit={event => mutateSession('login', event)} sx={{ my: 2 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>{ar ? 'استخدم حساب المركز نفسه المرتبط بهويتك. تُمسح بيانات الإدخال من هذه الشاشة فور تقديمها.' : 'Use the same center account linked to your identity. Input details are cleared from this screen when submitted.'}</Typography>
                <Stack spacing={1.5}>
                    <TextField label={ar ? 'اسم مستخدم المركز' : 'Center username'} value={username} onChange={event => setUsername(event.target.value)} required autoComplete="username" inputProps={{ maxLength: 255 }} />
                    <TextField label={ar ? 'كلمة مرور المركز' : 'Center password'} type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" />
                    <TextField label={ar ? 'رمز التحقق الإضافي، إن طُلب' : 'Additional verification code, if required'} value={mfa} onChange={event => setMfa(event.target.value)} autoComplete="one-time-code" inputProps={{ maxLength: 64 }} />
                    <Button type="submit" variant="contained" disabled={loading}>{ar ? 'الدخول لجلسة المراجعة' : 'Sign in for review'}</Button>
                </Stack>
            </Box>}
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ my: 2 }}>
                <Button ref={refreshButton} variant="outlined" disabled={loading} onClick={load}>{ar ? 'التحقق من جلسة المراجعة' : 'Check review session'}</Button>
                {!activeLocalHold && ownerCanDisconnect(status) && <Button variant="outlined" disabled={loading} onClick={() => mutateSession('disconnect')}>{ar ? 'فصل جلسة المراجعة محليًا' : 'Disconnect local review session'}</Button>}
            </Stack>
            {ownerCanDisconnect(status) && <Typography variant="body2" color="text.secondary">{ar ? 'الفصل محلي فقط؛ لا يسحب منح المركز ولا مفاتيح الناشر.' : 'Disconnection is local only; it revokes neither central grants nor publisher keys.'}</Typography>}
            {overview && <Stack spacing={2} sx={{ mt: 2 }}>
                {readerReady === true && <Alert severity="info">{ar ? 'تحقق ربط القراءة من الحالة الحالية للخادم. تبقى كل قراءة خاضعة لتفويض الحساب والنطاق والحقول الحالي.' : 'The server’s current state verifies the read connection. Every read still checks the current account, scope and field authorization.'}</Alert>}
                <TextField select label={ar ? 'النشاط والنطاق المسموح للمراجعة' : 'Activity and authorized review scope'} value={scopeKey} onChange={event => { changed(); setScopeKey(event.target.value); setConsumerId(''); setSourceId(''); }}>
                    <MenuItem value="">{ar ? 'اختر نطاقًا حاليًا' : 'Select a current scope'}</MenuItem>
                    {overview.options.scopes.map(option => <MenuItem key={ownerScopeKey(option.scope)} value={ownerScopeKey(option.scope)}>{option.label}</MenuItem>)}
                </TextField>
                {overview.options.scopes.length === 0 && <Alert severity="info">{ar ? 'لا توجد نطاقات مرئية لهذا الحساب بصلاحياته الحالية. لا تعني القائمة الفارغة حذف نطاق سابق.' : 'No scopes are visible under this account’s current permissions. An empty list does not mean an earlier scope was deleted.'}</Alert>}
                {choices && <>
                    <Box sx={{ overflowWrap: 'anywhere' }}><Typography variant="body2">{ar ? 'المؤسسة: ' : 'Organization: '}{scope.organization_id}</Typography><Typography variant="body2">{ar ? 'النشاط: ' : 'Activity: '}{scope.activity_id}</Typography><Typography variant="body2">{ar ? 'الفرع: ' : 'Branch: '}{scope.branch_id ?? (ar ? 'غير محدد في هذا النطاق' : 'Not specified in this exact scope')}</Typography><Typography variant="body2">{ar ? 'المخزن: ' : 'Warehouse: '}{scope.warehouse_id ?? (ar ? 'غير محدد في هذا النطاق' : 'Not specified in this exact scope')}</Typography></Box>
                    <TextField select label={ar ? 'تركيب WA المعتمد لهذا النطاق' : 'Approved WA installation for this scope'} value={consumerId} onChange={event => { changed(); setConsumerId(event.target.value); }}>
                        <MenuItem value="">{ar ? 'اختر تركيبًا ظاهرًا من المركز' : 'Select an installation visible from the center'}</MenuItem>
                        {choices.consumers.map(item => <MenuItem key={item.installation_id} value={item.installation_id}>{item.label}</MenuItem>)}
                    </TextField>
                    <TextField select label={ar ? 'مصدر Catalog المعتمد لهذا النطاق' : 'Authoritative Catalog source for this scope'} value={sourceId} onChange={event => setSourceId(event.target.value)}>
                        <MenuItem value="">{ar ? 'اختر مصدرًا ظاهرًا من المركز' : 'Select a source visible from the center'}</MenuItem>
                        {choices.sources.map(item => <MenuItem key={item.installation_id} value={item.installation_id}>{item.label}</MenuItem>)}
                    </TextField>
                    <Typography variant="body2">{ar ? 'الاختيار للمراجعة فقط؛ لا يربط القراءة أو يمنحها تلقائيًا.' : 'Selection is for review only; it neither binds nor grants reads automatically.'}</Typography>
                    {canBind && <Button variant="outlined" disabled={loading} onClick={bindReader}>{ar ? 'التحقق من ربط القراءة' : 'Verify read connection'}</Button>}
                    <Typography variant="body2">{ar ? 'حسابات القراءة المتاحة حاليًا: ' : 'Currently available reader accounts: '}{overview.options.readers.map(reader => reader.display_name).join('، ') || (ar ? 'لا توجد خيارات مرئية' : 'No visible choices')}</Typography>
                </>}
            </Stack>}
            <SharedReadOwnerPolicyControls status={status} overview={overview} scope={scope} choices={choices} consumerId={consumerId} sourceId={sourceId}
                onReload={reloadAfterPolicy} onHoldChange={setLocalHold} onFocusStatus={() => setFocusStatus(value => value + 1)}
                renderRequest={request => <RequestDetails request={request} readers={overview.options.readers} grants={choices.grants} ar={ar} now={clock} />} />
        </CardContent>
        <Dialog open={requirementsOpen} onClose={() => setRequirementsOpen(false)} fullWidth maxWidth="sm" aria-labelledby="shared-read-owner-requirements">
            <DialogTitle id="shared-read-owner-requirements">{ar ? 'متطلبات جلسة المراجعة' : 'Review session requirements'}</DialogTitle>
            <DialogContent><Stack spacing={1.5}>
                <Alert severity="info">{ar ? 'جلسة المراجعة مستقلة عن هوية القراءة. يتحقق الخادم من حساب المركز وعضويته الحالية، ومن التفويض الصريح لكل إجراء ونطاق؛ لا يكفي دور المالك أو التسجيل وحده.' : 'The review session is independent of the read identity. The server verifies the center account, current membership and explicit authorization for each action and scope; ownership or enrollment alone is insufficient.'}</Alert>
                <Alert severity="info">{ar ? 'تُمسح كلمة المرور ورمز التحقق من حقول الشاشة عند تقديمها. تبقى جلسة المركز خادميًا ولا تظهر أسرار أو مفاتيح في النتائج.' : 'Password and verification code inputs clear on submission. The center session remains server-side; results display no secrets or keys.'}</Alert>
                <Alert severity="warning">{ar ? 'التسجيل والاعتماد والقراءة مراحل منفصلة. لا تفتح هذه الصفحة نشرًا أو إرسالًا أو تنفيذ أسعار، ولا تغيّر قرار عزل المنتجات القديمة المتأثرة.' : 'Enrollment, approval and reading are separate stages. This page enables no publication, sending or price execution, and preserves the approved quarantine of affected legacy products.'}</Alert>
            </Stack></DialogContent>
            <DialogActions><Button onClick={() => setRequirementsOpen(false)}>{ar ? 'إغلاق' : 'Close'}</Button></DialogActions>
        </Dialog>
    </Card>;
};

export default SharedReadOwnerSetupPanel;
