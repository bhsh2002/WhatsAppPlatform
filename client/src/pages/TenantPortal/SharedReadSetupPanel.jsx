import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { sharedReadAuthorizationUrl, sharedReadCanAuthorize, sharedReadCanDisconnect, sharedReadCanEnroll, sharedReadDisconnectIsValid, sharedReadEffectiveSessionState, sharedReadEnrollmentLabel, sharedReadSessionLabel, sharedReadSetupError, sharedReadSetupIsValid } from './sharedReadSetupPresentation';

const changedEvent = (source = 'identity-setup') => window.dispatchEvent(new CustomEvent('savana-shared-read-setup-changed', { detail: { source } }));

const SharedReadSetupPanel = () => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [document, setDocument] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [disconnected, setDisconnected] = useState(false);
    const [statusFocus, setStatusFocus] = useState(0);
    const [requirementsOpen, setRequirementsOpen] = useState(false);
    const [clock, setClock] = useState(() => Date.now());
    const revision = useRef(0);
    const previousState = useRef(null);
    const statusButton = useRef(null);

    const load = useCallback(async event => {
        const requestRevision = ++revision.current;
        setLoading(true);
        setDocument(null);
        setError(null);
        setDisconnected(false);
        try {
            const result = await api.getPortalSharedReadSetup();
            if (revision.current !== requestRevision) return;
            if (!sharedReadSetupIsValid(result)) throw new Error('Unverified shared read setup');
            const fingerprint = JSON.stringify({ enabled: result.enabled, read_ready: result.read_ready, session: result.session, requests: result.requests,
                enrollment: result.enrollment && { state: result.enrollment.state, requires_reconciliation: result.enrollment.requires_reconciliation,
                    enrollment_id: result.enrollment.enrollment?.enrollment_id, version: result.enrollment.enrollment?.version } });
            if (previousState.current !== null && previousState.current !== fingerprint) changedEvent(event?.type === 'savana-shared-read-core-refresh' ? 'reader-binding-refresh' : 'identity-setup');
            previousState.current = fingerprint;
            setClock(Date.now());
            setDocument(result);
        } catch (requestError) {
            if (revision.current !== requestRevision) return;
            changedEvent();
            setError(requestError);
        } finally {
            if (revision.current === requestRevision) setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        window.addEventListener('savana-shared-read-core-refresh', load);
        return () => { revision.current += 1; window.removeEventListener('savana-shared-read-core-refresh', load); };
    }, [load]);

    useEffect(() => {
        if (statusFocus > 0) statusButton.current?.focus();
    }, [statusFocus]);

    useEffect(() => {
        if (document?.session?.state !== 'connected' || !document.session.expires_at) return undefined;
        const expiresAt = Date.parse(document.session.expires_at);
        if (expiresAt <= clock) return undefined;
        const wait = Math.max(0, expiresAt - Date.now());
        const timer = window.setTimeout(() => { setClock(Date.now()); changedEvent(); }, Math.min(wait, 2_147_483_647));
        return () => window.clearTimeout(timer);
    }, [document, clock]);

    const sessionState = sharedReadEffectiveSessionState(document, clock);

    const authorize = async () => {
        if (!sharedReadCanAuthorize(document) || loading) return;
        const requestRevision = ++revision.current;
        setLoading(true);
        setError(null);
        setDisconnected(false);
        changedEvent();
        try {
            const result = await api.authorizePortalSharedRead();
            if (revision.current !== requestRevision) return;
            const url = sharedReadAuthorizationUrl(result?.authorization_url);
            if (!url) throw new Error('Unverified authorization destination');
            window.location.assign(url);
        } catch (requestError) {
            if (revision.current !== requestRevision) return;
            setDocument(null);
            setError(requestError);
            setLoading(false);
        }
    };

    const disconnect = async () => {
        if (!sharedReadCanDisconnect(document) || loading) return;
        const requestRevision = ++revision.current;
        setLoading(true);
        setError(null);
        setDisconnected(false);
        changedEvent();
        try {
            const result = await api.disconnectPortalSharedRead();
            if (revision.current !== requestRevision) return;
            if (!sharedReadDisconnectIsValid(result)) throw new Error('Unverified local identity disconnection');
            setDocument(null);
            await load();
            if (revision.current !== requestRevision + 1) return;
            setDisconnected(true);
            setStatusFocus(value => value + 1);
        } catch (requestError) {
            if (revision.current !== requestRevision) return;
            setDocument(null);
            setError(requestError);
            setLoading(false);
        }
    };

    const enroll = async () => {
        if (!sharedReadCanEnroll(document) || loading) return;
        const requestRevision = ++revision.current;
        setLoading(true);
        setError(null);
        setDisconnected(false);
        changedEvent();
        let submissionError = null;
        try {
            await api.enrollPortalSharedReadConsumer();
        } catch (requestError) {
            submissionError = requestError;
        }
        if (revision.current !== requestRevision) return;
        await load();
        if (revision.current !== requestRevision + 1) return;
        if (submissionError) setError(submissionError);
        setStatusFocus(value => value + 1);
    };

    return (
        <Card component="section" aria-labelledby="shared-read-setup-title" sx={{ mb: 3 }}>
            <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography id="shared-read-setup-title" variant="h6" fontWeight={800}>{ar ? 'إعداد قراءة المنتجات وصلاحياتها' : 'Product read setup and permissions'}</Typography>
                    <Button aria-haspopup="dialog" onClick={() => setRequirementsOpen(true)}>{ar ? 'لماذا؟ والمتطلبات' : 'Why? Setup requirements'}</Button>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{ar
                    ? 'ربط الهوية يؤكد المستخدم فقط؛ لا يمنح قراءة أو إجراءات المالك التشغيلية. يتطلب كل نطاق تفويضًا صريحًا حاليًا من مركز التحكم، ولا يكفي دور المالك المحلي.'
                    : 'Connecting an identity verifies the user only; it grants neither reads nor owner operations. Each scope requires current explicit authorization from ControlCenter; a local owner role is insufficient.'}</Typography>
                <Box aria-live="polite" aria-atomic="true">
                    {loading && <Stack direction="row" alignItems="center" gap={1}><CircularProgress size={20} /><Typography>{ar ? 'جارٍ التحقق من الإعداد…' : 'Checking current setup…'}</Typography></Stack>}
                    {error && <Alert severity="warning">{sharedReadSetupError(error, language)}</Alert>}
                    {disconnected && <Alert severity="success">{ar ? 'أُلغي ربط الهوية محليًا ومحاولات الربط المعلقة، مع حفظ السجل. لم يسحب هذا الإجراء منح القراءة في المركز أو مفاتيح الناشر.' : 'The local identity connection and pending connection attempts were cleared; history is preserved. This action did not revoke central read grants or publisher keys.'}</Alert>}
                    {document && <Stack spacing={1.5} sx={{ mt: 1 }}>
                        <Chip sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }} label={sharedReadSessionLabel(sessionState, language)} variant="outlined" />
                        {!document.read_ready && <Typography variant="body2">{ar ? 'تهيئة القراءة لم تتحقق بعد.' : 'Read setup has not yet been verified.'}</Typography>}
                        {!document.enabled && <Alert severity="info">{ar ? 'الميزة معطّلة افتراضيًا. لا ينشئ فتح هذه الصفحة منحة أو يفعّل القراءة.' : 'This feature is disabled by default. Opening this page neither creates a grant nor enables reads.'}</Alert>}
                        {document.session.expires_at && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{ar ? 'انتهاء جلسة الهوية: ' : 'Identity session expires: '}<bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{document.session.expires_at}</bdi></Typography>}
                        {sessionState === 'connected' && <Alert severity="info">{ar ? 'الهوية مرتبطة فقط. يدير مركز التحكم اعتماد تركيب المستهلك ومشاركة القراءة؛ لا يعني هذا الربط أن تهيئة القراءة مكتملة. يُعاد التحقق من النطاق والحساب والحقول والمنحة السارية عند كل قراءة.' : 'Only the identity is connected. ControlCenter manages consumer installation approval and read sharing; this connection does not establish completed read setup. Exact scope, account, fields and a current grant are checked on every read.'}</Alert>}
                        {document.enrollment && <Box aria-label={ar ? 'تسجيل النشاط لدى المركز' : 'Activity registration with the center'}>
                            <Alert severity={['unknown', 'failed'].includes(document.enrollment.state) ? 'warning' : 'info'}>{sharedReadEnrollmentLabel(document.enrollment.state, language)}</Alert>
                            <Typography variant="body2" sx={{ mt: 1 }}>{ar ? 'التسجيل يعرّف الخدمة لدى المركز فقط؛ لا يعتمد تركيب مستهلك ولا يمنح قراءة أو نشرًا. تبقى المفاتيح خادميًا.' : 'Registration identifies the service to the center only; it approves no consumer installation and grants neither reading nor publication. Keys remain server-side.'}</Typography>
                            {document.enrollment.enrollment && <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{ar ? 'مرجع التسجيل: ' : 'Registration reference: '}{document.enrollment.enrollment.enrollment_id}{ar ? ' • الإصدار: ' : ' • Version: '}{document.enrollment.enrollment.version}</Typography>}
                            {document.enrollment.requires_reconciliation && <Typography variant="body2" sx={{ mt: 1 }}>{ar ? 'يلزم تأكيد نتيجة المحاولة السابقة. لا تتوفر تسوية أو إعادة إرسال من هذه الصفحة؛ استخدم التحقق من الحالة.' : 'The previous attempt requires confirmation. Reconciliation and resubmission are unavailable here; check the current status.'}</Typography>}
                        </Box>}
                    </Stack>}
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
                    <Button ref={statusButton} variant="outlined" disabled={loading} onClick={load}>{ar ? 'التحقق من حالة الإعداد' : 'Check setup status'}</Button>
                    {sharedReadCanAuthorize(document) && <Button variant="contained" disabled={loading} onClick={authorize}>{document.session.state === 'disconnected'
                        ? (ar ? 'ربط الهوية بالمركز' : 'Connect central identity')
                        : (ar ? 'إعادة ربط الهوية بالمركز' : 'Reconnect central identity')}</Button>}
                    {sharedReadCanDisconnect(document) && <Button variant="outlined" disabled={loading} onClick={disconnect}>{document.session.state === 'authorizing'
                        ? (ar ? 'إلغاء محاولة ربط الهوية' : 'Cancel identity connection')
                        : (ar ? 'إلغاء ربط الهوية محليًا' : 'Disconnect local identity')}</Button>}
                    {sharedReadCanEnroll(document) && <Button variant="contained" disabled={loading} onClick={enroll}>{ar ? 'تسجيل هذا النشاط لدى المركز' : 'Register this activity with center'}</Button>}
                </Stack>
                {sharedReadCanDisconnect(document) && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{ar ? 'الإلغاء محلي فقط؛ لا يسحب منح المركز أو مفاتيح الناشر، ويحفظ السجل.' : 'Disconnection is local only; it does not revoke central grants or publisher keys, and history is preserved.'}</Typography>}
            </CardContent>
            <Dialog open={requirementsOpen} onClose={() => setRequirementsOpen(false)} fullWidth maxWidth="sm" aria-labelledby="shared-read-setup-requirements">
                <DialogTitle id="shared-read-setup-requirements">{ar ? 'متطلبات التهيئة والتفويض' : 'Setup and authorization requirements'}</DialogTitle>
                <DialogContent><Stack spacing={1.5}>
                    <Alert severity="info">{ar ? 'يؤكد ربط الهوية المستخدم لدى المركز، وتبقى بيانات الجلسة خادميًا. لا تُعرض أسرار أو رموز وصول ولا تُرسل منح من المتصفح. إجراءات المالك التشغيلية تتطلب جلسة مركز التحكم وتفويضاتها الحالية؛ رمز الهوية وحده لا يسمح بها.' : 'Identity connection verifies the user with the center, while session credentials stay server-side. Tokens and secrets are not displayed; the browser supplies no grants. Owner operations require the current ControlCenter session and its explicit authorizations; an identity token alone cannot perform them.'}</Alert>
                    <Alert severity="info">{ar ? 'التفويض محدد للمؤسسة والنشاط والفرع والمخزن المختارين، وللحساب والحقول الصريحة. لا يمنح دور المالك وحده صلاحية الطلب أو الاعتماد، ولا ينتقل تفويض نطاق إلى نطاق آخر.' : 'Authorization applies to the exact selected organization, activity, branch and warehouse, account and explicit fields. Ownership alone grants neither request nor approval actions, and authorization does not carry over to another scope.'}</Alert>
                    <Alert severity="info">{ar ? 'النسخة المعلقة أو المرفوضة لا تضيف صلاحيات. تبقى النسخة المعتمدة السابقة نافذة فقط ما دامت منحتها سارية؛ اعتمادها لا يعتمد التعديل الجديد. سحب منحة القراءة أو انتهاؤها يمنع استخدامها، ولا تمنح القراءة حق النشر أو الإرسال.' : 'A pending or rejected version adds no rights. A previous approved version remains effective only while its grant is current; its approval does not approve a new revision. A revoked or expired read grant cannot be used, and reading grants neither publication nor sending.'}</Alert>
                    <Alert severity="warning">{ar ? 'تبقى منتجات البوت القديمة والصادر منفصلين. قرار إخفاء المنتجات المتأثرة عند الترقية حتى تصحيح المرجع محفوظ؛ لا يعيد الربط تفعيلها أو يجيز سعرًا ناقصًا.' : 'Legacy bot products and outbound effects remain separate. The approved policy to hide affected products at upgrade until source correction remains in force; reconnecting neither reactivates them nor authorizes incomplete pricing.'}</Alert>
                </Stack></DialogContent>
                <DialogActions><Button onClick={() => setRequirementsOpen(false)}>{ar ? 'إغلاق' : 'Close'}</Button></DialogActions>
            </Dialog>
        </Card>
    );
};

export default SharedReadSetupPanel;
