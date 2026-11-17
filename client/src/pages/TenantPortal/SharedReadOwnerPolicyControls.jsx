import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, MenuItem, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { ownerMutationsHeld, ownerOverviewIsValid, ownerScopeKey, ownerSetupError } from './sharedReadOwnerPresentation';
import { ownerAttemptContext, ownerAttemptStorageKey, ownerAuthorizationEditable, ownerIntentIsValid, ownerKnownPreDispatchRejection, ownerPolicyDiff, persistOwnerAttempt, prepareOwnerCommand, READ_SCOPE_ACTIONS, restoreOwnerAttempt } from './sharedReadOwnerOperations';

const fieldName = (field, ar) => ({ name: ar ? 'الاسم' : 'Name', description: ar ? 'الوصف' : 'Description', sku: 'SKU', barcodes: ar ? 'الباركود' : 'Barcodes', base_unit: ar ? 'الوحدة الأساسية' : 'Base unit', price: ar ? 'السعر' : 'Price', media: ar ? 'الوسائط' : 'Media', is_visible: ar ? 'الظهور' : 'Visibility' }[field]);
const actionName = (action, ar) => ({ 'read.request': ar ? 'طلب تركيب المستهلك ومشاركة القراءة' : 'Request consumer installation and read sharing', 'read.approve': ar ? 'اعتماد تركيب المستهلك والقراءة' : 'Approve consumer installation and reads', 'fields.approve': ar ? 'اعتماد الحقول' : 'Approve fields', 'read.manage': ar ? 'إدارة منح القراءة' : 'Manage read grants', 'reviews.read': ar ? 'عرض المراجعات' : 'View reviews', 'operations.inspect': ar ? 'عرض تشخيص العمليات' : 'Inspect operations' }[action]);
const operationName = (form, ar) => ({ 'scope.authorize': ar ? 'تعديل تفويض حساب لهذا النطاق' : 'Change account authorization for this scope', 'request.create': form.kind === 'consumer_registration' ? (ar ? 'طلب اعتماد تركيب المستهلك' : 'Request consumer installation approval') : (ar ? 'طلب مشاركة القراءة' : 'Request read sharing'), 'request.edit': ar ? 'تقديم نسخة معدّلة للمراجعة' : 'Submit a revised version for review', 'request.approve': ar ? 'اعتماد النسخة المعروضة' : 'Approve the displayed version', 'request.reject': ar ? 'رفض النسخة المعروضة' : 'Reject the displayed version', 'read_grant.revoke': ar ? 'سحب منحة القراءة المحددة' : 'Revoke the selected read grant' }[form.operation]);
const toLocalInput = value => {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    const date = new Date(value);
    const pad = item => String(item).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const iso = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : '';
const getIntent = result => result?.read_only === true && result.execution_ready === false && result.pricing_use_allowed === false && ownerIntentIsValid(result.intent) ? result.intent : null;
const storage = () => { try { return window.sessionStorage; } catch { return null; } };
const outlineColor = { color: 'primary.dark', '&.Mui-disabled': { color: 'text.disabled' } };
const attemptSignature = value => value ? `${ownerAttemptStorageKey(value)}:${value.idempotencyKey}` : null;

const SharedReadOwnerPolicyControls = ({ status, overview, scope, choices, consumerId, sourceId, onReload, onHoldChange, onFocusStatus, renderRequest }) => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [form, setForm] = useState(null);
    const [review, setReview] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(null);
    const [attemptVerified, setAttemptVerified] = useState(null);
    const [validationRejected, setValidationRejected] = useState(false);
    const reviewTitle = useRef(null);
    const rawContext = ownerAttemptContext(status);
    const nativeReference = rawContext?.native_reference;
    const actorId = rawContext?.actor_id;
    const organizationId = rawContext?.organization_id;
    const context = useMemo(() => nativeReference && actorId && organizationId
        ? { native_reference: nativeReference, actor_id: actorId, organization_id: organizationId } : null, [nativeReference, actorId, organizationId]);
    const partitionKey = ownerAttemptStorageKey(context);
    const activeAttempt = attempt && partitionKey && ownerAttemptStorageKey(attempt) === partitionKey ? attempt : null;
    const valid = ownerOverviewIsValid(overview);
    const held = Boolean(activeAttempt) || !valid || ownerMutationsHeld(overview);
    const option = valid && scope ? overview.options.scopes.find(item => ownerScopeKey(item.scope) === ownerScopeKey(scope)) : null;
    const currentScopeKey = scope ? ownerScopeKey(scope) : null;
    const currentAttemptVerified = activeAttempt && ['completed', 'failed'].includes(activeAttempt.state)
        && attemptVerified === attemptSignature(activeAttempt) && valid && activeAttempt.native_reference === overview.native_reference
        && activeAttempt.actor_id === overview.context.actor_id && activeAttempt.organization_id === overview.context.organization_id;
    const reviewing = Boolean(review);
    const formOpen = Boolean(form);
    const formOperation = form?.operation;
    const readerName = id => {
        const reader = overview?.options.readers.find(item => item.account_id === id);
        return reader ? `${reader.display_name} • ${id}` : id;
    };

    useEffect(() => { onHoldChange(Boolean(activeAttempt)); }, [activeAttempt, onHoldChange]);
    useLayoutEffect(() => {
        setAttempt(restoreOwnerAttempt(storage(), context));
        setForm(null); setReview(null);
    }, [context]);
    useLayoutEffect(() => {
        setForm(value => value?.scopeKey === currentScopeKey ? value : null);
        setReview(value => value?.scopeKey === currentScopeKey ? value : null);
    }, [currentScopeKey]);
    useEffect(() => { if (formOpen && valid && !held) reviewTitle.current?.focus(); }, [reviewing, formOpen, formOperation, valid, held]);

    const saveAttempt = value => { persistOwnerAttempt(storage(), value, context); setAttempt(value); };
    const open = (operation, request = null) => {
        if (held || !scope) return;
        setError(null); setValidationRejected(false); setReview(null);
        const proposal = request?.proposal || {};
        setForm({ operation, scopeKey: currentScopeKey, requestId: request?.request_id, kind: request?.kind || 'consumer_registration',
            enrollmentId: proposal.enrollment_id || '', installationLabel: proposal.installation_label || '',
            sourceId: proposal.source_installation_id || sourceId || '', consumerId: proposal.consumer_installation_id || consumerId || '',
            fields: [...(proposal.fields || [])], readerIds: [...(proposal.reader_account_ids || [])],
            expiry: toLocalInput(proposal.expires_at), originalExpiry: proposal.expires_at || null, noExpiry: false, targetAccountId: '', scopeActions: [], reason: '' });
    };
    const update = changes => { setReview(null); setForm(value => ({ ...value, ...changes })); };
    const toggle = (key, value, checked) => update({ [key]: checked ? [...form[key], value] : form[key].filter(item => item !== value) });
    const request = choices?.requests.find(item => item.request_id === form?.requestId);
    const source = choices?.sources.find(item => item.installation_id === form?.sourceId);
    const targetAuthorization = overview?.scope_authorizations.find(item => item.actor_id === form?.targetAccountId && scope && ownerScopeKey(item.scope) === ownerScopeKey(scope));
    const editableAuthorization = ownerAuthorizationEditable(targetAuthorization);
    const isProposal = form && ['request.create', 'request.edit'].includes(form.operation);
    const isPolicy = form?.kind === 'read_sharing' && (isProposal || form.operation === 'request.approve');

    const prepareReview = event => {
        event.preventDefault();
        if (held || !form || !scope) return;
        try {
            const input = { ...form, expiresAt: form.operation === 'scope.authorize' && form.noExpiry ? null
                : form.originalExpiry && form.expiry === toLocalInput(form.originalExpiry) ? form.originalExpiry : iso(form.expiry) };
            const command = prepareOwnerCommand(overview, scope, input);
            const proposed = command.body.proposal || (form.operation === 'request.approve' ? request?.proposal : null);
            const existing = proposed?.consumer_installation_id && choices.grants.find(grant => grant.consumer_installation_id === proposed.consumer_installation_id && grant.active);
            setReview({ command, input, idempotencyKey: window.crypto.randomUUID(), scopeKey: ownerScopeKey(scope),
                proposal: proposed, before: existing || {}, diff: ownerPolicyDiff(existing || {}, proposed || {}) });
            setError(null);
        } catch (requestError) { setError(requestError); }
    };

    const dispatch = async () => {
        if (busy || held || !review || !scope) return;
        try {
            const current = prepareOwnerCommand(overview, scope, review.input);
            if (review.scopeKey !== ownerScopeKey(scope) || JSON.stringify(current) !== JSON.stringify(review.command)) throw new Error('Reviewed operation changed');
        } catch (requestError) { setReview(null); setError(requestError); return; }
        const record = { idempotencyKey: review.idempotencyKey, id: null, operation: review.command.operation, state: 'prepared',
            native_reference: overview.native_reference, actor_id: overview.context.actor_id, organization_id: overview.context.organization_id };
        if (!persistOwnerAttempt(storage(), record)) { setError(new Error('Cannot retain attempt reference')); return; }
        setAttempt(record); setAttemptVerified(null); setBusy(true); setError(null);
        const command = { ...review.command, idempotencyKey: review.idempotencyKey };
        setForm(null); setReview(null);
        window.dispatchEvent(new CustomEvent('savana-shared-read-setup-changed', { detail: { source: 'owner-review' } }));
        let result = null;
        let dispatchError = null;
        try { result = getIntent(await api.submitPortalSharedReadOwnerOperation(command)); }
        catch (requestError) { dispatchError = requestError; result = getIntent(requestError?.data); setError(requestError); }
        const pending = { ...record, id: result?.id || null, state: result?.state || 'unknown' };
        saveAttempt(pending);
        const fresh = await onReload();
        if (ownerKnownPreDispatchRejection(dispatchError, fresh) && fresh.context.actor_id === record.actor_id
            && fresh.context.organization_id === record.organization_id && fresh.native_reference === record.native_reference) {
            saveAttempt(null); setAttemptVerified(null); setValidationRejected(true); setError(null); setBusy(false); return;
        }
        const confirmed = result && ['completed', 'failed'].includes(result.state) && ownerOverviewIsValid(fresh)
            && fresh.context.actor_id === record.actor_id && fresh.context.organization_id === record.organization_id && fresh.native_reference === record.native_reference;
        setAttemptVerified(confirmed ? attemptSignature(pending) : null); setBusy(false);
    };

    const inspectAttempt = async () => {
        if (!activeAttempt || busy) return;
        setBusy(true); setError(null); setAttemptVerified(null);
        try {
            const result = getIntent(await api.getPortalSharedReadOwnerIntentByKey(activeAttempt.idempotencyKey));
            if (!result || result.operation !== activeAttempt.operation || (activeAttempt.id && result.id !== activeAttempt.id)) throw new Error('Unverified original attempt');
            const updated = { ...activeAttempt, id: result.id, state: result.state };
            saveAttempt(updated);
            const fresh = await onReload();
            const confirmed = ['completed', 'failed'].includes(result.state) && ownerOverviewIsValid(fresh)
                && fresh.context.actor_id === activeAttempt.actor_id && fresh.context.organization_id === activeAttempt.organization_id
                && fresh.native_reference === activeAttempt.native_reference;
            setAttemptVerified(confirmed ? attemptSignature(updated) : null);
        } catch (requestError) { setError(requestError); }
        finally { setBusy(false); }
    };

    return <Box sx={{ mt: 2 }}>
        {error && <Alert severity="warning" sx={{ mb: 2 }}>{error.status === 422 ? (ar ? 'لم تُقبل الخيارات أو النسخة الحالية. يلزم التحقق من المحاولة والحالة قبل أي إجراء جديد.' : 'The selected values or current version were not accepted. Verify the original attempt and current state before a new action.') : ownerSetupError(error, language)}</Alert>}
        {validationRejected && <Alert severity="info" sx={{ mb: 2 }}>{ar ? 'أكد الخادم رفض المراجعة قبل الإرسال، ولا توجد محاولات غير محسومة في الحالة الجديدة. راجع النسخة والخيارات الحالية من جديد؛ لم تُعد المحاولة تلقائيًا.' : 'The server confirmed rejection before dispatch, and fresh status shows no unresolved attempts. Review the current version and choices again; no automatic retry occurred.'}</Alert>}
        {activeAttempt && <Alert severity={currentAttemptVerified ? 'info' : 'warning'} sx={{ mb: 2 }}>
            <Typography>{currentAttemptVerified ? (activeAttempt.state === 'completed' ? (ar ? 'أكد الخادم انتهاء المحاولة؛ حُدّثت الحالة الحالية. لا تعني المحاولة حق نشر أو إرسال.' : 'The server confirmed completion and current status was refreshed. This grants no publication or sending right.') : (ar ? 'أكد الخادم عدم اكتمال المحاولة؛ حُدّثت الحالة الحالية.' : 'The server confirmed the attempt did not complete and current status was refreshed.')) : (ar ? 'تنتظر هذه المحاولة تأكيدًا. أوقفت الإجراءات الجديدة؛ لا تُعاد المحاولة ولا يُستبدل مرجعها. عدم العثور عليها بعد لا يثبت أنها لم تصل.' : 'This attempt needs confirmation. New actions are held; it is neither retried nor given a replacement reference. Not finding it yet does not prove it never arrived.')}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mt: 1 }}>
                <Button disabled={busy} onClick={inspectAttempt}>{ar ? 'التحقق من المحاولة نفسها' : 'Check the same attempt'}</Button>
                {currentAttemptVerified && <Button disabled={busy} onClick={() => { saveAttempt(null); setAttemptVerified(null); onFocusStatus(); }}>{ar ? 'إغلاق نتيجة المحاولة' : 'Close the confirmed attempt'}</Button>}
            </Stack>
        </Alert>}
        {valid && option && choices && <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} flexWrap="wrap">
                {option.actions.request_consumer_registration && <Button sx={outlineColor} variant="outlined" disabled={held} onClick={() => open('request.create')}>{ar ? 'طلب اعتماد تركيب المستهلك' : 'Request consumer installation approval'}</Button>}
                {option.actions.request_read_sharing && <Button sx={outlineColor} variant="outlined" disabled={held} onClick={() => { open('request.create'); setForm(value => ({ ...value, kind: 'read_sharing' })); }}>{ar ? 'طلب مشاركة القراءة' : 'Request read sharing'}</Button>}
                {overview.actions.authorize_scope === true && <Button sx={outlineColor} variant="outlined" disabled={held} onClick={() => open('scope.authorize')}>{ar ? 'تفويض حساب لهذا النطاق' : 'Authorize an account for this scope'}</Button>}
            </Stack>
            <Typography variant="body2" color="text.secondary">{ar ? 'إنشاء نطاق جديد يحتاج مرجع نشاط معتمدًا من المركز؛ لا تُدخل معرفات يدويًا هنا.' : 'Creating a new scope requires a center-reviewed activity reference; technical identifiers are not entered here.'}</Typography>
            {choices.requests.map(item => <Box key={item.request_id}>
                {renderRequest(item)}
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mt: 1 }}>
                    {item.actions.edit && <Button disabled={held} onClick={() => open('request.edit', item)}>{ar ? 'تعديل نسخة الطلب' : 'Revise request version'}</Button>}
                    {item.actions.approve && <Button disabled={held} onClick={() => open('request.approve', item)}>{ar ? 'مراجعة اعتماد هذه النسخة' : 'Review approval of this version'}</Button>}
                    {item.actions.reject && <Button disabled={held} onClick={() => open('request.reject', item)}>{ar ? 'رفض هذه النسخة بسبب' : 'Reject this version with reason'}</Button>}
                </Stack>
            </Box>)}
            {choices.grants.filter(grant => grant.active && option.actions.revoke_read_grant).map(grant => <Box key={grant.read_grant_id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, overflowWrap: 'anywhere' }}>
                <Typography>{ar ? 'منحة القراءة: ' : 'Read grant: '}{grant.read_grant_id}{ar ? ' • المراجعة: ' : ' • Revision: '}{grant.revision}</Typography>
                <Typography variant="body2">{ar ? 'الحسابات: ' : 'Accounts: '}{grant.reader_account_ids.map(readerName).join('، ')}</Typography>
                <Button disabled={held} onClick={() => { open('read_grant.revoke'); setForm(value => ({ ...value, requestId: grant.read_grant_id })); }}>{ar ? 'مراجعة سحب هذه المنحة' : 'Review revocation of this grant'}</Button>
            </Box>)}
        </Stack>}
        <Dialog open={Boolean(form) && form.scopeKey === currentScopeKey && valid && Boolean(option) && !held} onClose={() => { if (!busy) { setForm(null); setReview(null); } }} fullWidth maxWidth="md" aria-labelledby="owner-policy-form-title">
            <DialogTitle ref={reviewTitle} tabIndex={-1} id="owner-policy-form-title">{form && operationName(form, ar)}</DialogTitle>
            <DialogContent>
                {form && !review && <Box component="form" id="owner-policy-form" onSubmit={prepareReview}><Stack spacing={2} sx={{ mt: 1 }}>
                    {error && <Alert severity="warning">{ar ? 'تعذر إعداد المراجعة بهذه الخيارات. تحقق من الحقول والحسابات والانتهاء والصلاحية الحالية.' : 'These choices could not prepare a review. Check fields, accounts, expiry and current authorization.'}</Alert>}
                    {request && <Typography>{ar ? 'نسخة الطلب المعروضة: ' : 'Displayed request version: '}{request.version}{ar ? ' • النافذة: ' : ' • Effective: '}{request.effective_version ?? (ar ? 'لا توجد' : 'None')}</Typography>}
                    {isProposal && form.kind === 'consumer_registration' && <>
                        {overview.options.enrollments.length === 0 && <Alert severity="info">{ar ? 'لا يوجد تسجيل ظاهر لهذا النشاط حاليًا. أكمل خطوة تسجيل النشاط ثم أعد التحقق.' : 'No enrollment is currently visible for this activity. Complete activity registration and check again.'}</Alert>}
                        <TextField select label={ar ? 'تسجيل هذا النشاط' : 'This activity enrollment'} value={form.enrollmentId} required onChange={event => update({ enrollmentId: event.target.value })}>
                            {overview.options.enrollments.map(item => <MenuItem key={item.enrollment_id} value={item.enrollment_id}>{item.display_name || (ar ? 'تسجيل النشاط' : 'Activity enrollment')}{' • '}{ar ? 'الإصدار ' : 'Version '}{item.version}</MenuItem>)}
                        </TextField>
                        <TextField label={ar ? 'اسم ربط المنصة' : 'Platform connection name'} value={form.installationLabel} required inputProps={{ maxLength: 200 }} onChange={event => update({ installationLabel: event.target.value })} />
                        <Alert severity="info">{ar ? 'اعتماد تركيب المستهلك لا يمنح قراءة المنتجات وحده.' : 'Consumer installation approval alone grants no product reads.'}</Alert>
                    </>}
                    {isProposal && form.kind === 'read_sharing' && <>
                        {(choices.sources.length === 0 || choices.consumers.length === 0) && <Alert severity="info">{ar ? 'لا توجد خيارات مصدر أو مستهلك معتمد ظاهرة لهذا النطاق حاليًا. يلزم التحقق من اعتمادها في المركز.' : 'An approved source or consumer choice is not currently visible for this scope. Verify their approval in the center.'}</Alert>}
                        <TextField select required label={ar ? 'مصدر Catalog المعتمد' : 'Authoritative Catalog source'} value={form.sourceId} onChange={event => update({ sourceId: event.target.value, fields: [] })}>{choices.sources.map(item => <MenuItem key={item.installation_id} value={item.installation_id}>{item.label}</MenuItem>)}</TextField>
                        <TextField select required label={ar ? 'تركيب WA المعتمد' : 'Approved WA installation'} value={form.consumerId} onChange={event => update({ consumerId: event.target.value })}>{choices.consumers.map(item => <MenuItem key={item.installation_id} value={item.installation_id}>{item.label}</MenuItem>)}</TextField>
                        <Typography fontWeight={600}>{ar ? 'الحقول المطلوبة صراحة' : 'Explicitly requested fields'}</Typography>
                        <FormGroup>{(source?.fields || []).map(field => <FormControlLabel key={field} control={<Checkbox checked={form.fields.includes(field)} onChange={event => toggle('fields', field, event.target.checked)} />} label={fieldName(field, ar)} />)}</FormGroup>
                        <Typography fontWeight={600}>{ar ? 'حسابات القراءة' : 'Reader accounts'}</Typography>
                        <FormGroup>{overview.options.readers.map(reader => <FormControlLabel key={reader.account_id} sx={{ '& .MuiTypography-root': { overflowWrap: 'anywhere' } }} control={<Checkbox checked={form.readerIds.includes(reader.account_id)} onChange={event => toggle('readerIds', reader.account_id, event.target.checked)} />} label={readerName(reader.account_id)} />)}</FormGroup>
                        <TextField type="datetime-local" required label={ar ? 'انتهاء المشاركة بتوقيت جهازك' : 'Sharing expiry in your device timezone'} slotProps={{ inputLabel: { shrink: true } }} value={form.expiry} onChange={event => update({ expiry: event.target.value })} />
                        <Alert severity="warning">{ar ? 'هذه سياسة كاملة بديلة لهذا المستهلك والنطاق؛ الحسابات المحذوفة تفقد المنحة المدارة عند الاعتماد. ستُعرض التغييرات قبل الإرسال.' : 'This replaces the complete managed policy for this consumer and scope. Removed accounts lose managed access upon approval. Changes are shown before submission.'}</Alert>
                    </>}
                    {form.operation === 'scope.authorize' && <>
                        <TextField select required label={ar ? 'الحساب النشط في المؤسسة' : 'Active organization account'} value={form.targetAccountId} onChange={event => {
                            const authorization = overview.scope_authorizations.find(item => item.actor_id === event.target.value && ownerScopeKey(item.scope) === ownerScopeKey(scope));
                            update({ targetAccountId: event.target.value, scopeActions: authorization?.actions.filter(action => READ_SCOPE_ACTIONS.includes(action)) || [], expiry: toLocalInput(authorization?.expires_at), originalExpiry: authorization?.expires_at || null, noExpiry: authorization?.expires_at === null });
                        }}>{overview.options.readers.map(reader => <MenuItem key={reader.account_id} value={reader.account_id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{readerName(reader.account_id)}</MenuItem>)}</TextField>
                        {!editableAuthorization && <Alert severity="warning">{ar ? 'لهذا الحساب تفويضات أخرى لا يمكن استبدالها من هنا. راجعها في مركز التحكم.' : 'This account has other authorizations that cannot be replaced here. Review them in ControlCenter.'}</Alert>}
                        <FormGroup>{READ_SCOPE_ACTIONS.map(action => <FormControlLabel key={action} control={<Checkbox disabled={!editableAuthorization} checked={form.scopeActions.includes(action)} onChange={event => toggle('scopeActions', action, event.target.checked)} />} label={actionName(action, ar)} />)}</FormGroup>
                        <FormControlLabel control={<Checkbox checked={form.noExpiry} onChange={event => update({ noExpiry: event.target.checked })} />} label={ar ? 'تفويض دون انتهاء محدد' : 'Authorization without a fixed expiry'} />
                        {!form.noExpiry && <TextField type="datetime-local" required label={ar ? 'انتهاء التفويض بتوقيت جهازك' : 'Authorization expiry in your device timezone'} slotProps={{ inputLabel: { shrink: true } }} value={form.expiry} onChange={event => update({ expiry: event.target.value })} />}
                        <Alert severity="warning">{ar ? 'ستستبدل هذه القائمة التفويضات المدارة لهذا الحساب في هذا النطاق. إلغاء كل الخيارات يزيل التفويض المحدد.' : 'This list replaces managed authorization for this account at this exact scope. Clearing every action removes that delegation.'}</Alert>
                    </>}
                    {['request.reject', 'read_grant.revoke'].includes(form.operation) && <TextField label={ar ? 'السبب' : 'Reason'} value={form.reason} onChange={event => update({ reason: event.target.value })} required multiline minRows={2} inputProps={{ maxLength: 1000 }} helperText={ar ? 'حتى 1000 حرف' : 'Up to 1000 characters'} />}
                    {form.operation === 'request.approve' && <Alert severity="info">{ar ? 'سيُراجع المقترح الحالي كاملًا قبل اعتماد نسخته المحددة. لا يعتمد ذلك أي تعديل لاحق.' : 'The complete current proposal is reviewed before approving its exact version. This approves no later revision.'}</Alert>}
                </Stack></Box>}
                {review && <Stack spacing={1.5} sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                    <Typography fontWeight={700}>{ar ? 'راجع الأثر قبل الإرسال' : 'Review the effect before submission'}</Typography>
                    <Typography>{option?.label}</Typography>
                    <Typography variant="body2">{ar ? 'المؤسسة: ' : 'Organization: '}{scope?.organization_id}{' • '}{ar ? 'النشاط: ' : 'Activity: '}{scope?.activity_id}</Typography>
                    <Typography variant="body2">{ar ? 'الفرع: ' : 'Branch: '}{scope?.branch_id ?? (ar ? 'غير محدد بهذا النطاق' : 'Not specified in this scope')}{' • '}{ar ? 'المخزن: ' : 'Warehouse: '}{scope?.warehouse_id ?? (ar ? 'غير محدد بهذا النطاق' : 'Not specified in this scope')}</Typography>
                    <Typography variant="body2">{ar ? 'النطاق ثابت؛ لا يمتد إلى فرع أو مخزن آخر.' : 'This exact scope does not extend to another branch or warehouse.'}</Typography>
                    {request && <Typography>{ar ? 'نسخة الطلب: ' : 'Request version: '}{review.command.body.expected_version}</Typography>}
                    {review.proposal?.installation_label && <Typography>{ar ? 'اسم الربط: ' : 'Connection name: '}{review.proposal.installation_label}</Typography>}
                    {review.proposal?.enrollment_version && <Typography>{ar ? 'إصدار تسجيل النشاط: ' : 'Activity enrollment version: '}{review.proposal.enrollment_version}{ar ? '؛ اعتماد التركيب لا يمنح القراءة وحده.' : '; installation approval alone grants no reads.'}</Typography>}
                    {review.proposal?.enrollment_id && <Typography variant="body2">{ar ? 'مرجع التسجيل: ' : 'Enrollment reference: '}{review.proposal.enrollment_id}</Typography>}
                    {isPolicy && <>
                        <Typography>{ar ? 'المصدر: ' : 'Source: '}{choices.sources.find(item => item.installation_id === review.proposal.source_installation_id)?.label}{' • '}{review.proposal.source_installation_id}</Typography>
                        <Typography>{ar ? 'المستهلك: ' : 'Consumer: '}{choices.consumers.find(item => item.installation_id === review.proposal.consumer_installation_id)?.label}{' • '}{review.proposal.consumer_installation_id}</Typography>
                        <Alert severity="warning">{ar ? 'سياسة مشاركة كاملة بديلة؛ لا تُدمج تلقائيًا مع منحة سابقة.' : 'A complete replacement sharing policy; it is not automatically merged with an earlier grant.'}</Alert>
                        <Typography>{ar ? 'الحقول الحالية: ' : 'Current fields: '}{(review.before.fields || []).map(field => fieldName(field, ar)).join('، ') || (ar ? 'لا توجد سياسة مدارة ظاهرة' : 'No visible managed policy')}</Typography>
                        <Typography>{ar ? 'الحقول المقترحة: ' : 'Proposed fields: '}{review.proposal.fields.map(field => fieldName(field, ar)).join('، ')}</Typography>
                        <Typography>{ar ? 'الحسابات الحالية: ' : 'Current accounts: '}{(review.before.reader_account_ids || []).map(readerName).join('، ') || (ar ? 'لا توجد' : 'None')}</Typography>
                        <Typography>{ar ? 'الحسابات المقترحة: ' : 'Proposed accounts: '}{review.proposal.reader_account_ids.map(readerName).join('، ')}</Typography>
                        <Typography>{ar ? 'الحقول المحذوفة: ' : 'Removed fields: '}{review.diff.removed_fields.map(field => fieldName(field, ar)).join('، ') || (ar ? 'لا توجد' : 'None')}</Typography>
                        <Typography>{ar ? 'الحسابات التي ستفقد المنحة المدارة: ' : 'Accounts losing managed access: '}{review.diff.removed_readers.map(readerName).join('، ') || (ar ? 'لا توجد' : 'None')}</Typography>
                        <Typography>{ar ? 'الانتهاء المقترح: ' : 'Proposed expiry: '}<bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{review.proposal.expires_at}</bdi></Typography>
                    </>}
                    {form.operation === 'scope.authorize' && <><Typography>{ar ? 'الحساب: ' : 'Account: '}{readerName(review.command.targetAccountId)}</Typography><Typography>{ar ? 'الصلاحيات المقترحة: ' : 'Proposed actions: '}{review.command.body.actions.map(action => actionName(action, ar)).join('، ') || (ar ? 'إزالة التفويض' : 'Remove delegation')}</Typography><Typography>{ar ? 'الانتهاء: ' : 'Expiry: '}{review.command.body.expires_at ? <bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{review.command.body.expires_at}</bdi> : (ar ? 'دون انتهاء محدد' : 'No fixed expiry')}</Typography></>}
                    {review.command.body.reason && <Typography>{ar ? 'السبب: ' : 'Reason: '}{review.command.body.reason}</Typography>}
                    {form.operation === 'read_grant.revoke' && <Alert severity="warning">{ar ? 'يسحب هذا الإجراء منحة القراءة المحددة فقط؛ لا يسحب مفاتيح الناشر ولا يغيّر منشأ المنتجات.' : 'This action revokes only the selected read grant; it does not revoke publisher keys or change product origins.'}</Alert>}
                    {form.operation === 'read_grant.revoke' && <Typography>{ar ? 'مراجعة المنحة الحالية: ' : 'Current grant revision: '}{review.command.body.expected_revision}</Typography>}
                    <Alert severity="info">{ar ? 'لا يفتح هذا الإجراء إرسالًا أو نشرًا أو تنفيذ أسعار. تبقى سياسة عزل المنتجات المتأثرة كما هي.' : 'This action enables no sending, publication or price execution. The approved affected-product quarantine remains in force.'}</Alert>
                </Stack>}
            </DialogContent>
            <DialogActions sx={{ flexWrap: 'wrap' }}>
                <Button disabled={busy} onClick={() => { if (review) setReview(null); else setForm(null); }}>{review ? (ar ? 'العودة للخيارات' : 'Back to choices') : (ar ? 'إلغاء' : 'Cancel')}</Button>
                {!review && <Button type="submit" form="owner-policy-form" disabled={busy || (form?.operation === 'scope.authorize' && !editableAuthorization)}>{ar ? 'مراجعة قبل الإرسال' : 'Review before submission'}</Button>}
                {review && <Button variant="contained" disabled={busy} onClick={dispatch}>{ar ? 'تقديم الإجراء المراجع' : 'Submit the reviewed action'}</Button>}
            </DialogActions>
        </Dialog>
    </Box>;
};

export default SharedReadOwnerPolicyControls;
