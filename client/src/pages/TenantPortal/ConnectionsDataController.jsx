import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import ConnectionsDataWorkspace from './ConnectionsDataWorkspace';
import WorkspaceProductEditor from './WorkspaceProductEditor';
import WorkspaceReviewDialog from './WorkspaceReviewDialog';
import WorkspaceNativeActionEditor from './WorkspaceNativeActionEditor';
import WorkspaceConsentDialog from './WorkspaceConsentDialog';
import WorkspaceBusinessActionEditor from './WorkspaceBusinessActionEditor';
import GuidedWhatsAppSetupPanel from './GuidedWhatsAppSetupPanel';
import WhatsAppNumberManager from './WhatsAppNumberManager';
import WorkspaceMediaActionEditor from './WorkspaceMediaActionEditor';
import WorkspaceCapabilityGrantEditor from './WorkspaceCapabilityGrantEditor';
import { emptyWorkspaceCapabilityGrantDraft, prepareWorkspaceCapabilityGrantReview, updateWorkspaceCapabilityGrantDraft, workspaceCapabilityGrantChoicesChanged, workspaceCapabilityGrantDraftFromOptions,
    workspaceCapabilityGrantInput, workspaceCapabilityGrantOptionsIsCurrent } from './workspaceCapabilityGrantPresentation';
import { emptyWorkspaceSelection, workspaceActionAvailable, workspaceConnectionReviewCanSubmit, workspaceLabel, workspaceRecordsCanBrowse, workspaceReviewSummaryIsValid } from './connectionsDataPresentation';
import { emptyWorkspaceProductDraft } from './workspaceProductPresentation';
import { observeWorkspaceEffect, readWorkspaceHolds, readWorkspaceLists, releaseWorkspaceHold, retainWorkspaceHold, watchWorkspaceReadExpiry, workspaceAccessRequestIsValid, workspaceBindingAuthorizationUrl, workspaceClientError, workspaceCommandIsValid, workspaceIntentResolved, workspaceOverviewIsValid, workspaceProductEditorIsValid, workspaceReadDeadline, workspaceReadResponseIsCurrent as currentResponse, workspaceRecordIsValid, workspaceReviewIsCurrent, workspaceServerHeld } from './connectionsDataRuntime';
import { sharedReadAuthorizationUrl } from './sharedReadSetupPresentation';
import { emptyWorkspaceNativeDraft, NATIVE_WORKSPACE_ACTIONS, workspaceNativeOptionsIsCurrent, workspaceNativeParameters, workspaceNativePreviewIsCurrent, workspaceNativeRecipientPageDraft, workspaceNativeReviewedParameters } from './workspaceNativePresentation';
import { emptyWorkspaceBusinessDraft, WORKSPACE_BUSINESS_CAPABILITIES, workspaceBusinessOptionsIsCurrent, workspaceBusinessPageDraft, workspaceBusinessParameters, workspaceBusinessPreviewIsCurrent, workspaceBusinessReviewedParameters } from './workspaceBusinessPresentation';

const recoveryStorage = () => { try { return window.sessionStorage; } catch { return null; } };
const invalidResponse = () => new Error('Unverified connections workspace response');
const filtersFor = selection => ({ activity: selection?.activity || undefined, purpose: selection?.purpose || undefined, provider: selection?.provider || undefined, action: selection?.action || undefined });
const productDraft = source => {
    const draft = emptyWorkspaceProductDraft();
    for (const key of ['name', 'description', 'sku', 'barcodes', 'base_unit']) if (typeof source?.[key] === 'string') draft[key] = source[key];
    if (Array.isArray(source?.barcodes) && source.barcodes.every(value => typeof value === 'string')) draft.barcodes = source.barcodes.join('\n');
    if (source?.price && typeof source.price.amount === 'string' && typeof source.price.choice === 'string') draft.price = { amount: source.price.amount, choice: source.price.choice };
    if (Array.isArray(source?.media) && source.media.every(value => typeof value === 'string')) draft.media = [...source.media];
    return draft;
};

// This controller speaks only the WA-owned normalized BFF. Core wire models,
// authority, source references and idempotency construction remain server-side.
const ConnectionsDataController = () => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [overview, setOverview] = useState(null);
    const [selection, setSelection] = useState(emptyWorkspaceSelection);
    const [records, setRecords] = useState([]);
    const [recordsValidUntil, setRecordsValidUntil] = useState(null);
    const [commands, setCommands] = useState([]);
    const [accessRequests, setAccessRequests] = useState([]);
    const [requestDetail, setRequestDetail] = useState(null);
    const [requestLoading, setRequestLoading] = useState(false);
    const [editingRequest, setEditingRequest] = useState(null);
    const [reasonOperation, setReasonOperation] = useState(null);
    const [reason, setReason] = useState('');
    const [query, setQuery] = useState('');
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [editor, setEditor] = useState(null);
    const [draft, setDraft] = useState(emptyWorkspaceProductDraft);
    const [review, setReview] = useState(null);
    const [reviewKind, setReviewKind] = useState(null);
    const [commandReview, setCommandReview] = useState(null);
    const [activityOpen, setActivityOpen] = useState(false);
    const [activityName, setActivityName] = useState('');
    const [activeTab, setActiveTab] = useState('connection');
    const [loading, setLoading] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState('');
    const [hints, setHints] = useState([]);
    const [memoryHold, setMemoryHold] = useState(null);
    const [nativeEditor, setNativeEditor] = useState(null);
    const [nativeOptions, setNativeOptions] = useState(null);
    const [nativeDraft, setNativeDraft] = useState(emptyWorkspaceNativeDraft);
    const [nativePreview, setNativePreview] = useState(null);
    const [recipientQuery, setRecipientQuery] = useState('');
    const [consentDialog, setConsentDialog] = useState(null);
    const [businessEditor, setBusinessEditor] = useState(null);
    const [businessOptions, setBusinessOptions] = useState(null);
    const [businessDraft, setBusinessDraft] = useState(emptyWorkspaceBusinessDraft);
    const [businessPreview, setBusinessPreview] = useState(null);
    const [contactQuery, setContactQuery] = useState('');
    const [nativeClock, setNativeClock] = useState(() => Date.now());
    // Core proposals are cleared on blur. Native setup has its own authenticated
    // popup flow, which must remain mounted for the exact callback to return.
    const [whatsAppSetupOpen, setWhatsAppSetupOpen] = useState(false);
    const [numberRefresh, setNumberRefresh] = useState(0);
    const [mediaOpen, setMediaOpen] = useState(false);
    const [grantOpen, setGrantOpen] = useState(false);
    const [grantOptions, setGrantOptions] = useState(null);
    const [grantDraft, setGrantDraft] = useState(emptyWorkspaceCapabilityGrantDraft);
    const [grantMessage, setGrantMessage] = useState('');
    const [grantNeedsContext, setGrantNeedsContext] = useState(false);
    const revision = useRef(0);
    const busy = useRef(false);
    const latest = useRef(null);
    const submitted = useRef(new Set());
    const formQueryHandled = useRef(null);
    const requestedAction = useRef(new URLSearchParams(window.location.search).get('action'));
    const recipientSearch = useRef('');
    const contactSearch = useRef('');

    const clearView = useCallback(() => {
        latest.current = null;
        setOverview(null); setSelection(emptyWorkspaceSelection()); setRecords([]); setCommands([]); setQuery('');
        setRecordsValidUntil(null);
        setDetail(null); setDetailLoading(false); setEditor(null); setDraft(emptyWorkspaceProductDraft());
        setAccessRequests([]); setRequestDetail(null); setRequestLoading(false); setEditingRequest(null); setReasonOperation(null); setReason('');
        setReview(null); setReviewKind(null); setCommandReview(null); setActivityOpen(false); setActivityName(''); setNotice('');
        setNativeEditor(null); setNativeOptions(null); setNativeDraft(emptyWorkspaceNativeDraft()); setNativePreview(null);
        setRecipientQuery('');
        setConsentDialog(null);
        setBusinessEditor(null); setBusinessOptions(null); setBusinessDraft(emptyWorkspaceBusinessDraft()); setBusinessPreview(null); setContactQuery('');
        setGrantOpen(false); setGrantOptions(null); setGrantDraft(emptyWorkspaceCapabilityGrantDraft()); setGrantMessage(''); setGrantNeedsContext(false);
    }, []);

    const applyOverview = useCallback(result => {
        latest.current = result;
        setOverview(result); setSelection(result.connection.selection); setRecords(result.sharedData.records); setCommands(result.commands);
        setRecordsValidUntil(result.sharedData.valid_until ?? (result.sharedData.records.length ? result.context.valid_until : null));
        setAccessRequests(result.connection.requests);
        setQuery(result.sharedData.query || '');
        setHints(result.context.verified ? readWorkspaceHolds(recoveryStorage(), result.context.native_reference).records : []);
    }, []);

    const load = useCallback(async (filters = {}, includeLists = false) => {
        const requestRevision = ++revision.current;
        setLoading(true); setError(null); clearView();
        try {
            const action = filters.action || requestedAction.current;
            let result = await api.getPortalConnectionsWorkspace({ ...filtersFor(filters), ...(action ? { action } : {}) });
            if (revision.current !== requestRevision) return null;
            if (!workspaceOverviewIsValid(result)) throw invalidResponse();
            if (!workspaceRecordsCanBrowse(result.sharedData, result.context.verified)) result = { ...result, sharedData: { ...result.sharedData, records: [] } };
            if (includeLists && result.context.verified && result.connection.selection.activity) {
                const activity = result.connection.selection.activity;
                const { recordDocument, commandDocument, requestDocument } = await readWorkspaceLists({ sharedData: result.sharedData, verified: true,
                    readRecords: () => api.getPortalWorkspaceRecords({ activity }), readCommands: () => api.getPortalWorkspaceCommands(activity), readRequests: () => api.getPortalWorkspaceRequests(activity) });
                if (revision.current !== requestRevision) return null;
                const responseRevision = { requestRevision, currentRevision: revision.current };
                if ((recordDocument !== null && (!currentResponse(recordDocument, result.context, responseRevision) || !Array.isArray(recordDocument.records) || !recordDocument.records.every(workspaceRecordIsValid)))
                    || !currentResponse(commandDocument, result.context, responseRevision) || !Array.isArray(commandDocument.commands) || !commandDocument.commands.every(workspaceCommandIsValid)
                    || !currentResponse(requestDocument, result.context, responseRevision) || !Array.isArray(requestDocument.requests) || !requestDocument.requests.every(workspaceAccessRequestIsValid)) throw invalidResponse();
                result = { ...result, sharedData: { ...result.sharedData, ...(recordDocument || { records: [] }) }, commands: commandDocument.commands,
                    connection: { ...result.connection, requests: requestDocument.requests } };
                if (!workspaceOverviewIsValid(result)) throw invalidResponse();
            }
            applyOverview(result);
            return result;
        } catch (requestError) {
            if (revision.current === requestRevision) { clearView(); setError(requestError); }
            return null;
        } finally { if (revision.current === requestRevision) setLoading(false); }
    }, [applyOverview, clearView]);
    const refreshMediaContext = useCallback(() => load({ ...filtersFor(latest.current?.connection.selection), action: 'media.manage' }), [load]);

    useEffect(() => { load(); return () => { revision.current += 1; }; }, [load]);
    useEffect(() => {
        const invalidate = () => { revision.current += 1; clearView(); setLoading(false); };
        const hidden = () => { if (document.hidden) invalidate(); };
        window.addEventListener('blur', invalidate);
        window.addEventListener('pagehide', invalidate);
        window.addEventListener('savana-shared-read-setup-changed', invalidate);
        document.addEventListener('visibilitychange', hidden);
        return () => {
            window.removeEventListener('blur', invalidate); window.removeEventListener('pagehide', invalidate);
            window.removeEventListener('savana-shared-read-setup-changed', invalidate); document.removeEventListener('visibilitychange', hidden);
        };
    }, [clearView]);
    useEffect(() => watchWorkspaceReadExpiry({ context: overview?.context, recordsValidUntil, detail, editor, review,
        onExpire: () => { revision.current += 1; clearView(); setLoading(false); },
        schedule: window.setTimeout.bind(window), cancel: window.clearTimeout.bind(window),
    }), [overview, recordsValidUntil, detail, editor, review, clearView]);
    useEffect(() => {
        const deadlines = [nativeOptions?.valid_until, nativePreview?.valid_until, businessOptions?.valid_until, businessPreview?.valid_until, grantOptions?.valid_until].filter(Boolean).map(Date.parse).filter(Number.isFinite);
        if (!deadlines.length) return undefined;
        const timer = window.setTimeout(() => {
            const now = Date.now(); setNativeClock(now);
            setNativeOptions(previous => previous && Date.parse(previous.valid_until) > now ? previous : null);
            setNativePreview(previous => previous && Date.parse(previous.valid_until) > now ? previous : null);
            setBusinessOptions(previous => previous && Date.parse(previous.valid_until) > now ? previous : null);
            setBusinessPreview(previous => previous && Date.parse(previous.valid_until) > now ? previous : null);
            setGrantOptions(previous => previous && Date.parse(previous.valid_until) > now ? previous : null);
        }, Math.min(Math.max(0, Math.min(...deadlines) - Date.now()), 2_147_483_647));
        return () => window.clearTimeout(timer);
    }, [nativeOptions, nativePreview, businessOptions, businessPreview, grantOptions]);

    const context = overview?.context;
    const partitionHeld = Boolean(context?.verified && ((memoryHold?.native_reference === context.native_reference) || hints.length));
    const held = !context?.verified || workspaceServerHeld(overview) || partitionHeld;
    const canUse = useCallback(() => Boolean(latest.current && workspaceOverviewIsValid(latest.current) && latest.current.context.verified), []);
    const canMutate = () => canUse() && !workspaceServerHeld(latest.current)
        && !(memoryHold?.native_reference === latest.current.context.native_reference)
        && !readWorkspaceHolds(recoveryStorage(), latest.current.context.native_reference).records.length && !busy.current;

    const resolveHints = async (nativeReference, pending, fresh) => {
        for (const intent of pending) {
            if (!workspaceIntentResolved(intent, fresh, nativeReference)) continue;
            releaseWorkspaceHold(recoveryStorage(), nativeReference, intent, fresh);
            setMemoryHold(previous => previous?.native_reference === nativeReference && previous.key === intent.key ? null : previous);
        }
        if (fresh?.context.native_reference === nativeReference) setHints(readWorkspaceHolds(recoveryStorage(), nativeReference).records);
    };

    const checkOutcomes = async () => {
        if (!canUse() || busy.current) return;
        const operationRevision = revision.current;
        const nativeReference = latest.current.context.native_reference;
        const keys = [...new Set([...hints.map(hint => hint.key), ...(memoryHold?.native_reference === nativeReference ? [memoryHold.key] : []), ...latest.current.intents.map(intent => intent.key)])];
        busy.current = true; setWorking(true);
        const metadata = [];
        for (const key of keys) {
            try { const result = await api.getPortalWorkspaceIntent(key); if (result?.intent?.state) metadata.push({ key, state: result.intent.state }); }
            catch { /* A missing/unknown response cannot prove the earlier effect absent. */ }
        }
        if (revision.current !== operationRevision) { busy.current = false; setWorking(false); return; }
        const fresh = await load({}, true);
        await resolveHints(nativeReference, metadata, fresh);
        busy.current = false; setWorking(false);
    };

    const performEffect = async (intentKey, dispatch, submittedKey, binding = false) => {
        if (!canMutate() || typeof intentKey !== 'string' || !intentKey || intentKey.length > 180_000 || (submittedKey && submitted.current.has(submittedKey))) return;
        const nativeReference = latest.current.context.native_reference;
        const operationRevision = revision.current;
        if (submittedKey) submitted.current.add(submittedKey);
        requestedAction.current = null;
        retainWorkspaceHold(recoveryStorage(), nativeReference, intentKey);
        setMemoryHold({ native_reference: nativeReference, key: intentKey });
        setHints(readWorkspaceHolds(recoveryStorage(), nativeReference).records);
        busy.current = true; setWorking(true); setError(null);
        const observation = await observeWorkspaceEffect({ intentKey, dispatch, readIntent: key => api.getPortalWorkspaceIntent(key),
            readFresh: () => load({}, true), isCurrent: () => revision.current === operationRevision });
        if (observation.stale) { busy.current = false; setWorking(false); return; }
        await resolveHints(nativeReference, observation.intent ? [observation.intent] : [], observation.overview);
        if (observation.error) setError(observation.error);
        else if (observation.overview) setNotice(ar ? 'تحدّثت الحالة الحالية. تابع نتيجة الطلب وتحديث البيانات أدناه.' : 'The current status was refreshed. Follow the request outcome and data update below.');
        busy.current = false; setWorking(false);
        if (binding) {
            const destination = workspaceBindingAuthorizationUrl(observation, nativeReference);
            if (destination) { revision.current += 1; clearView(); window.location.assign(destination); }
        }
    };

    const connect = async () => {
        if (!context?.connect?.enabled || busy.current) return;
        if (context.connect.code === 'native_binding_required') {
            await prepareReview('binding', {});
            return;
        }
        const requestRevision = ++revision.current;
        busy.current = true; setWorking(true); setError(null); clearView();
        try {
            const result = await api.authorizePortalSharedRead();
            if (revision.current !== requestRevision) return;
            const destination = sharedReadAuthorizationUrl(result?.authorization_url);
            if (!destination) throw invalidResponse();
            window.location.assign(destination);
        } catch (requestError) { if (revision.current === requestRevision) setError(requestError); }
        finally { busy.current = false; setWorking(false); }
    };

    const changeSelection = async next => {
        if (busy.current || !canUse()) return;
        setReview(null); setReviewKind(null);
        if (!['activity', 'purpose', 'provider'].some(key => next[key] !== selection[key])) { setSelection(next); return; }
        const editTarget = editingRequest;
        const previousViewKey = context.viewKey;
        if (editTarget) { busy.current = true; setWorking(true); }
        const fresh = await load(filtersFor(next));
        if (editTarget && fresh) {
            const requestRevision = revision.current;
            try {
                if (fresh.context.viewKey !== previousViewKey) throw invalidResponse();
                const result = await api.getPortalWorkspaceRequest(editTarget.key);
                if (revision.current !== requestRevision) return;
                if (!currentResponse(result, fresh.context, { requestRevision, currentRevision: revision.current }) || !workspaceAccessRequestIsValid(result.request)
                    || !result.request.actions.some(action => action.key === 'edit' && action.enabled === true)) throw invalidResponse();
                setEditingRequest(result.request);
            } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
            finally { busy.current = false; setWorking(false); }
        } else if (editTarget) { busy.current = false; setWorking(false); }
    };

    const prepareReview = async (kind, body) => {
        if (!canMutate()) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        busy.current = true; setWorking(true); setReview(null); setError(null);
        try {
            let result;
            switch (kind) {
                case 'binding': result = await api.reviewPortalWorkspaceBinding(); break;
                case 'selection': result = await api.reviewPortalWorkspaceSelection(body.activity); break;
                case 'grant': {
                    const prepared = await prepareWorkspaceCapabilityGrantReview({ input: body, context: currentContext,
                        readFresh: () => api.getPortalWorkspaceGrantOptions({ activity: body.activity, grant: body.grant, person: body.person }),
                        requestReview: input => api.reviewPortalWorkspaceGrant(input), isCurrent: () => revision.current === requestRevision });
                    if (prepared.stale) return;
                    setGrantOptions(prepared.options); setGrantNeedsContext(!prepared.options); setNativeClock(Date.now());
                    if (prepared.changed) {
                        setGrantMessage(ar ? 'تغيّرت الخيارات أو الصلاحية المسجلة. راجع الاختيارات الحالية قبل تقديم تغيير جديد.' : 'Choices or the recorded permission changed. Review the current selections before submitting another change.');
                        return;
                    }
                    result = prepared.result; break;
                }
                case 'connection': result = await api.reviewPortalWorkspaceConnection(body); break;
                case 'connection-edit': result = await api.reviewPortalWorkspaceRequestEdit(editingRequest.key, body); break;
                case 'product': result = await api.reviewPortalWorkspaceProduct(body); break;
                case 'command-edit': result = await api.reviewPortalWorkspaceCommandEdit(body.command, body); break;
                case 'request-reject': result = await api.reviewPortalWorkspaceRequestRejection(reasonOperation.target, body.reason); break;
                case 'grant-revoke': result = await api.reviewPortalWorkspaceReadGrantRevocation(reasonOperation.target, body.reason); break;
                case 'command-reject': result = await api.reviewPortalWorkspaceCommandRejection(reasonOperation.target, body.reason); break;
                case 'command-dispatch': result = await api.reviewPortalWorkspaceCommandDispatch(body.command); break;
                case 'command-cancel': result = await api.reviewPortalWorkspaceCommandCancellation(reasonOperation.target, body.reason); break;
                case 'native': result = await api.reviewPortalWorkspaceNativeAction(body); break;
                case 'activity': result = await api.reviewPortalWorkspaceActivity(body.name); break;
                case 'provider': result = await api.reviewPortalWorkspaceProvider(body.provider); break;
                case 'provider-refresh': result = await api.reviewPortalWorkspaceProviderRefresh(body.provider); break;
                default: throw invalidResponse();
            }
            if (revision.current !== requestRevision) return;
            if (!workspaceReviewIsCurrent(result?.review, currentContext)) throw invalidResponse();
            setReview(result.review); setReviewKind(kind); setActivityOpen(false); setGrantOpen(false);
            setReasonOperation(null); setReason('');
        } catch (requestError) { if (revision.current === requestRevision) {
            if (kind === 'grant' && workspaceCapabilityGrantChoicesChanged(requestError)) {
                setGrantOptions(null); setGrantNeedsContext(true);
                setGrantMessage(ar ? 'تغيّرت الخيارات المسجلة. بقيت مسودة اختيارك فقط؛ حدّث السياق واختر الصلاحية الحالية قبل المراجعة.' : 'Recorded choices changed. Only your draft remains; refresh the context and choose the current permission before reviewing.');
            } else { clearView(); setError(requestError); }
        } }
        finally { busy.current = false; setWorking(false); }
    };

    const submitReview = () => {
        if (!review || !workspaceReviewIsCurrent(review, latest.current?.context)) return;
        if (['connection', 'connection-edit'].includes(reviewKind) && !workspaceConnectionReviewCanSubmit({ review, viewKey: context.viewKey, selection,
            choices: overview.connection.choices, requirements: overview.connection.requirements, verified: true, held, busy: working })) return;
        performEffect(review.intentKey, () => api.submitPortalWorkspaceReview(review.key), review.key, reviewKind === 'binding');
    };

    const search = async () => {
        if (!canUse() || busy.current || !selection.activity || !workspaceRecordsCanBrowse(latest.current.sharedData, true)) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        setLoading(true); setRecords([]); setRecordsValidUntil(null); setDetail(null); setError(null);
        try {
            const result = await api.getPortalWorkspaceRecords({ activity: selection.activity, q: query });
            if (revision.current !== requestRevision) return;
            if (!currentResponse(result, currentContext, { requestRevision, currentRevision: revision.current }) || !Array.isArray(result.records) || !result.records.every(workspaceRecordIsValid)) throw invalidResponse();
            setRecords(result.records);
            setRecordsValidUntil(result.valid_until);
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { if (revision.current === requestRevision) setLoading(false); }
    };

    const showDetail = async key => {
        if (!canUse() || busy.current || !selection.activity || !workspaceRecordsCanBrowse(latest.current.sharedData, true)) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        setDetail(null); setDetailLoading(true); setError(null);
        try {
            const result = await api.getPortalWorkspaceRecord(key, selection.activity);
            if (revision.current !== requestRevision) return;
            if (!currentResponse(result, currentContext, { requestRevision, currentRevision: revision.current }) || !workspaceRecordIsValid(result.record)
                || (result.productEditor && !workspaceProductEditorIsValid(result.productEditor))) throw invalidResponse();
            setDetail(result);
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { if (revision.current === requestRevision) setDetailLoading(false); }
    };

    const openProduct = (mode, descriptor, record = null, readValidUntil = null) => {
        if (!canMutate() || context?.viewKey !== latest.current?.context.viewKey || !workspaceProductEditorIsValid(descriptor) || !descriptor.provider) return;
        const deadline = workspaceReadDeadline({ context, recordsValidUntil,
            detail: readValidUntil == null ? null : { valid_until: readValidUntil } });
        if (!Number.isFinite(deadline) || deadline <= Date.now()) { revision.current += 1; clearView(); setLoading(false); return; }
        setReview(null); setReviewKind(null); setDraft(mode === 'change' ? productDraft(descriptor.draft) : emptyWorkspaceProductDraft());
        setEditor({ descriptor, mode, record, viewKey: context.viewKey, valid_until: new Date(deadline).toISOString() }); setActiveTab('data');
    };
    const createProduct = () => {
        if (workspaceActionAvailable(overview?.sharedData.createAction, { verified: context?.verified, held, busy: working })) openProduct('create', overview.productEditor);
    };
    const workspaceAction = key => {
        const action = overview?.actions?.find(item => item.key === key);
        if (!workspaceActionAvailable(action, { verified: context?.verified, held, busy: working }) || !canMutate()) return;
        if (key === 'activity.create') setActivityOpen(true);
        if (key === 'activity.select' && selection.activity) prepareReview('selection', { activity: selection.activity });
        if (key === 'capability-grants.manage' && overview.grantEditor) loadGrantOptions(overview.grantEditor);
        if (key === 'provider.prepare' && selection.provider) prepareReview('provider', { provider: selection.provider });
        if (key === 'provider.refresh' && selection.provider) prepareReview('provider-refresh', { provider: selection.provider });
    };

    const loadGrantOptions = useCallback(async (descriptor, filters = {}) => {
        if (!canUse() || busy.current || !descriptor?.activity) return;
        const action = latest.current.actions?.find(row => row.key === 'capability-grants.manage');
        if (!workspaceActionAvailable(action, { verified: true, held: workspaceServerHeld(latest.current), busy: false })) return;
        const currentContext = latest.current.context, requestRevision = ++revision.current;
        busy.current = true; setWorking(true); setGrantOpen(true); setGrantOptions(null); setGrantMessage(''); setReview(null); setReviewKind(null);
        try {
            const result = await api.getPortalWorkspaceGrantOptions({ activity: descriptor.activity, grant: filters.grant, person: filters.person });
            if (revision.current !== requestRevision) return;
            if (!workspaceCapabilityGrantOptionsIsCurrent(result, currentContext)) throw invalidResponse();
            setGrantOptions(result); setGrantDraft(workspaceCapabilityGrantDraftFromOptions(result)); setGrantNeedsContext(false); setNativeClock(Date.now());
        } catch (requestError) { if (revision.current === requestRevision) {
            if (workspaceCapabilityGrantChoicesChanged(requestError)) {
                setGrantOptions(null); setGrantNeedsContext(true); setGrantMessage(ar ? 'تغيّرت الخيارات. حدّث السياق واختر الصلاحية الحالية من جديد.' : 'Choices changed. Refresh the context and choose the current permission again.');
            } else { clearView(); setError(requestError); }
        } }
        finally { busy.current = false; setWorking(false); }
    }, [canUse, clearView, ar]);

    const chooseGrantContext = (field, value) => {
        if (busy.current || !overview?.grantEditor) return;
        const next = updateWorkspaceCapabilityGrantDraft(grantDraft, field, value);
        setGrantDraft(next); setReview(null); setReviewKind(null);
        loadGrantOptions(overview.grantEditor, { grant: next.grant, person: next.person });
    };
    const refreshGrantOptions = async () => {
        if (busy.current) return;
        if (grantNeedsContext) {
            const fresh = await load();
            if (fresh?.grantEditor) loadGrantOptions(fresh.grantEditor);
        } else loadGrantOptions(overview?.grantEditor, { grant: grantDraft.grant, person: grantDraft.person });
    };

    const showRequest = async key => {
        if (!canUse() || busy.current) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        setRequestDetail(null); setRequestLoading(true); setError(null);
        try {
            const result = await api.getPortalWorkspaceRequest(key);
            if (revision.current !== requestRevision) return;
            if (!currentResponse(result, currentContext, { requestRevision, currentRevision: revision.current }) || !workspaceAccessRequestIsValid(result.request)) throw invalidResponse();
            setRequestDetail(result.request);
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { if (revision.current === requestRevision) setRequestLoading(false); }
    };

    const requestAction = (_key, actionKey) => {
        const action = requestDetail?.actions.find(item => item.key === actionKey);
        if (!workspaceActionAvailable(action, { verified: context?.verified, held, busy: working }) || !canMutate()) return;
        if (actionKey === 'approve' && action.intentKey) performEffect(action.intentKey, () => api.approvePortalWorkspaceRequest(requestDetail.key, action.intentKey), action.intentKey);
        else if (actionKey === 'edit' && requestDetail.selection) {
            setEditingRequest(requestDetail); setSelection(requestDetail.selection); setRequestDetail(null); setReview(null); setReviewKind(null); setActiveTab('connection');
        } else if (actionKey === 'reject' || (actionKey === 'revoke' && requestDetail.grant)) {
            setReasonOperation({ kind: actionKey === 'reject' ? 'request-reject' : 'grant-revoke', target: actionKey === 'reject' ? requestDetail.key : requestDetail.grant, label: action.label });
            setReason(''); setRequestDetail(null);
        }
    };

    const loadNativeOptions = useCallback(async (descriptor, filters = {}) => {
        if (!canUse() || busy.current || !NATIVE_WORKSPACE_ACTIONS.includes(descriptor?.action) || !descriptor.activity || !descriptor.provider || !descriptor.capability) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        busy.current = true; setWorking(true); setNativeOptions(null); setNativePreview(null); setError(null);
        try {
            const result = await api.getPortalCollaborativeOptions({ activity_ref: descriptor.activity, capability: descriptor.capability, channel: filters.channel, account_ref: filters.account_ref,
                recipient_q: filters.recipient_q, recipient_cursor: filters.recipient_cursor });
            if (revision.current !== requestRevision) return;
            if (!workspaceNativeOptionsIsCurrent(result) || latest.current?.context.viewKey !== currentContext.viewKey
                || Date.parse(result.valid_until) > Date.parse(currentContext.valid_until)) throw invalidResponse();
            recipientSearch.current = filters.recipient_q || ''; setRecipientQuery(recipientSearch.current);
            setNativeClock(Date.now()); setNativeOptions(result); setNativeEditor({ ...descriptor, viewKey: currentContext.viewKey });
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { busy.current = false; setWorking(false); }
    }, [canUse, clearView]);

    const changeNativeDraft = next => {
        if (busy.current) return;
        const changedAccount = next.channel !== nativeDraft.channel || next.account_ref !== nativeDraft.account_ref;
        setNativeDraft(next); setNativePreview(null); setReview(null); setReviewKind(null);
        if (changedAccount) { setRecipientQuery(''); loadNativeOptions(nativeEditor, { channel: next.channel, account_ref: next.account_ref }); }
    };

    const searchNativeRecipients = cursor => {
        if (!canUse() || busy.current || !nativeEditor || recipientQuery.length > 100) return;
        setNativeDraft(workspaceNativeRecipientPageDraft(nativeDraft)); setNativePreview(null); setReview(null); setReviewKind(null);
        loadNativeOptions(nativeEditor, { channel: nativeDraft.channel, account_ref: nativeDraft.account_ref,
            recipient_q: cursor ? recipientSearch.current : recipientQuery.trim(), ...(cursor ? { recipient_cursor: cursor } : {}) });
    };

    const previewNativeAction = async () => {
        if (!canMutate() || !nativeEditor || nativeEditor.viewKey !== context.viewKey) return;
        const parameters = workspaceNativeParameters({ action: nativeEditor.action, draft: nativeDraft, options: nativeOptions, language });
        if (!parameters) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        busy.current = true; setWorking(true); setNativePreview(null); setError(null);
        try {
            const result = await api.previewPortalCollaborativeAction({ activity_ref: nativeEditor.activity, capability: nativeEditor.capability, action: nativeEditor.action, parameters });
            if (revision.current !== requestRevision) return;
            if (!workspaceNativePreviewIsCurrent(result, currentContext)) throw invalidResponse();
            setNativeClock(Date.now()); setNativePreview({ ...result, inputKey: JSON.stringify(nativeDraft) });
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { busy.current = false; setWorking(false); }
    };

    const reviewNativeAction = () => {
        if (!nativeEditor || nativeEditor.viewKey !== context?.viewKey || nativePreview?.inputKey !== JSON.stringify(nativeDraft)) return;
        const parameters = workspaceNativeReviewedParameters(nativeEditor.action, nativePreview, context);
        if (parameters) prepareReview('native', { activity: nativeEditor.activity, provider: nativeEditor.provider,
            capability: nativeEditor.capability, action: nativeEditor.action, parameters });
    };

    const loadBusinessOptions = useCallback(async (descriptor, filters = {}) => {
        if (!canUse() || busy.current || !WORKSPACE_BUSINESS_CAPABILITIES.includes(descriptor?.capability) || !descriptor.activity || !descriptor.provider) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        busy.current = true; setWorking(true); setBusinessOptions(null); setBusinessPreview(null); setError(null);
        try {
            const result = await api.getPortalCollaborativeBusinessOptions({ activity_ref: descriptor.activity, capability: descriptor.capability,
                contact_q: filters.contact_q, contact_cursor: filters.contact_cursor, operation_cursor: filters.operation_cursor });
            if (revision.current !== requestRevision) return;
            if (!workspaceBusinessOptionsIsCurrent(result, descriptor.capability) || latest.current?.context.viewKey !== currentContext.viewKey
                || Date.parse(result.valid_until) > Date.parse(currentContext.valid_until)) throw invalidResponse();
            contactSearch.current = filters.contact_q || ''; setContactQuery(contactSearch.current);
            setNativeClock(Date.now()); setBusinessOptions(result); setBusinessEditor({ ...descriptor, viewKey: currentContext.viewKey });
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { busy.current = false; setWorking(false); }
    }, [canUse, clearView]);

    const changeBusinessDraft = next => {
        if (busy.current) return;
        setBusinessDraft(next); setBusinessPreview(null); setReview(null); setReviewKind(null);
    };
    const pageBusinessChoices = (contactCursor, operationCursor) => {
        if (!canUse() || busy.current || !businessEditor || contactQuery.length > 100) return;
        setBusinessDraft(workspaceBusinessPageDraft(businessDraft)); setBusinessPreview(null); setReview(null); setReviewKind(null);
        loadBusinessOptions(businessEditor, { contact_q: contactCursor || operationCursor ? contactSearch.current : contactQuery.trim(),
            contact_cursor: contactCursor, operation_cursor: operationCursor });
    };
    const previewBusinessAction = async () => {
        if (!canMutate() || !businessEditor || businessEditor.viewKey !== context.viewKey) return;
        const parameters = workspaceBusinessParameters({ capability: businessEditor.capability, draft: businessDraft, options: businessOptions, language });
        if (!parameters) return;
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        busy.current = true; setWorking(true); setBusinessPreview(null); setError(null);
        try {
            const result = await api.previewPortalCollaborativeBusinessAction({ activity_ref: businessEditor.activity,
                capability: businessEditor.capability, action: businessDraft.action, parameters });
            if (revision.current !== requestRevision) return;
            if (!workspaceBusinessPreviewIsCurrent(result, currentContext) || latest.current?.context.viewKey !== currentContext.viewKey) throw invalidResponse();
            setNativeClock(Date.now()); setBusinessPreview({ ...result, inputKey: JSON.stringify(businessDraft) });
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { busy.current = false; setWorking(false); }
    };
    const reviewBusinessAction = () => {
        if (!businessEditor || businessEditor.viewKey !== context?.viewKey || businessPreview?.inputKey !== JSON.stringify(businessDraft)) return;
        const parameters = workspaceBusinessReviewedParameters(businessEditor.capability, businessDraft.action, businessPreview, context);
        if (parameters) prepareReview('native', { activity: businessEditor.activity, provider: businessEditor.provider,
            capability: businessEditor.capability, action: businessDraft.action, parameters });
    };

    const commandAction = async (key, actionKey) => {
        const command = commands.find(item => item.key === key);
        const action = command?.actions.find(item => item.key === actionKey);
        if (!workspaceActionAvailable(action, { verified: context?.verified, held, busy: working }) || busy.current) return;
        if (actionKey === 'dispatch') { prepareReview('command-dispatch', { command: key }); return; }
        if (actionKey === 'cancel') { setReasonOperation({ kind: 'command-cancel', target: key, label: action.label }); setReason(''); return; }
        if (actionKey === 'reconcile') {
            const operationRevision = revision.current;
            busy.current = true; setWorking(true);
            let reconciliationError = null;
            try { await api.reconcilePortalWorkspaceCommand(key); } catch (requestError) { reconciliationError = requestError; }
            if (revision.current === operationRevision) { await load({}, true); if (reconciliationError) setError(reconciliationError); }
            busy.current = false; setWorking(false);
            return;
        }
        const currentContext = latest.current.context;
        const requestRevision = ++revision.current;
        setLoading(true); setError(null);
        try {
            const result = await api.getPortalWorkspaceCommand(key);
            if (revision.current !== requestRevision) return;
            if (!currentResponse(result, currentContext, { requestRevision, currentRevision: revision.current }) || !workspaceCommandIsValid(result.command)) throw invalidResponse();
            const freshAction = result.command.actions.find(item => item.key === actionKey);
            if (actionKey === 'reject' && workspaceActionAvailable(freshAction, { verified: true, held, busy: false })) {
                setReasonOperation({ kind: 'command-reject', target: result.command.key, label: freshAction.label }); setReason('');
            } else if (actionKey === 'edit' && workspaceActionAvailable(freshAction, { verified: true, held, busy: false }) && workspaceProductEditorIsValid(result.productEditor)) {
                setEditor({ descriptor: result.productEditor, mode: 'change', command: result.command.key, viewKey: context.viewKey, valid_until: result.valid_until });
                setDraft(productDraft(result.productEditor.draft));
            } else setCommandReview(result.command);
        } catch (requestError) { if (revision.current === requestRevision) { clearView(); setError(requestError); } }
        finally { if (revision.current === requestRevision) setLoading(false); }
    };

    const routeNextAction = next => {
        if (!canUse() || busy.current) return;
        if (!next || typeof next.href !== 'string' || [...next.href].some(character => character === '\\' || character.charCodeAt(0) < 32)) return;
        let destination;
        try {
            destination = new URL(next.href, window.location.origin);
            if (destination.username || destination.password || !(destination.protocol === 'https:' || (destination.origin === window.location.origin && destination.protocol === 'http:'))) return;
        } catch { return; }
        const action = destination.searchParams.get('action');
        if (destination.origin === window.location.origin && destination.pathname.replace(/\/$/, '') === '/portal/integrations') {
            if (action === 'product.create') createProduct();
            else if (NATIVE_WORKSPACE_ACTIONS.includes(action)) { requestedAction.current = action; formQueryHandled.current = null; load({ ...filtersFor(selection), action }); }
            else if (WORKSPACE_BUSINESS_CAPABILITIES.includes(action)) { requestedAction.current = action; formQueryHandled.current = null; load({ ...filtersFor(selection), action }); }
            else if (action === 'media.manage') { requestedAction.current = action; formQueryHandled.current = null; load({ ...filtersFor(selection), action }); }
            else if (action === 'activity.create') setActivityOpen(true);
            else if (action === 'activity.select') workspaceAction('activity.select');
            else if (action === 'capability-grants.manage') workspaceAction('capability-grants.manage');
            else if (action === 'provider.prepare' && selection.provider) prepareReview('provider', { provider: selection.provider });
            else if (action === 'provider.refresh') workspaceAction('provider.refresh');
            else if (['products.read', 'products.browse', 'product.browse'].includes(action)) setActiveTab('data');
            else if (!action || action === 'connection.setup') setActiveTab('connection');
            else setError(new Error('Current native action form unavailable'));
        } else if (destination.origin === window.location.origin && destination.pathname.replace(/\/$/, '') === '/portal/whatsapp-connect') setWhatsAppSetupOpen(true);
        else window.location.assign(destination.href);
    };
    const nextAction = (capabilityKey, code) => {
        const capability = overview.capabilities.capabilities.find(item => item.key === capabilityKey);
        const next = capability?.availability?.next_action;
        if (next?.code === code) routeNextAction(next);
    };

    useEffect(() => {
        const action = requestedAction.current;
        const formKey = `${overview?.context.viewKey}:${action}`;
        if (!overview?.context.verified || formQueryHandled.current === formKey) return;
        formQueryHandled.current = formKey;
        if (action === 'product.create' && workspaceActionAvailable(overview.sharedData.createAction, { verified: true, held, busy: working })
            && workspaceProductEditorIsValid(overview.productEditor) && overview.productEditor.provider) {
            setEditor({ descriptor: overview.productEditor, mode: 'create', record: null, viewKey: overview.context.viewKey, valid_until: overview.context.valid_until });
            setDraft(emptyWorkspaceProductDraft()); setActiveTab('data');
        }
        if (NATIVE_WORKSPACE_ACTIONS.includes(action) && overview.nativeEditor?.action === action && !held) {
            setNativeDraft(emptyWorkspaceNativeDraft()); loadNativeOptions(overview.nativeEditor);
        }
        if (WORKSPACE_BUSINESS_CAPABILITIES.includes(action) && overview.businessEditor?.capability === action && !held) {
            setBusinessDraft(emptyWorkspaceBusinessDraft()); loadBusinessOptions(overview.businessEditor);
        }
        if (action === 'media.manage' && overview.mediaEditor?.capability === action && !held) setMediaOpen(true);
        if (action === 'capability-grants.manage' && overview.grantEditor && !held) loadGrantOptions(overview.grantEditor);
        if (action === 'product.change') setActiveTab('data');
    }, [overview, held, working, loadNativeOptions, loadBusinessOptions, loadGrantOptions]);

    const commandApprove = commandReview?.actions?.find(action => action.key === 'approve');
    const reasonLimit = reasonOperation?.kind === 'grant-revoke' ? 500 : 1000;
    const businessConsent = consentDialog?.family === 'business';
    const refreshConsentOptions = () => businessConsent ? loadBusinessOptions(businessEditor, { contact_q: contactSearch.current })
        : loadNativeOptions(nativeEditor, { ...nativeDraft, recipient_q: recipientSearch.current });
    return <Stack spacing={2}>
        <Box><Button onClick={() => setWhatsAppSetupOpen(true)} disabled={working}>{ar ? 'حسابات واتساب' : 'WhatsApp accounts'}</Button></Box>
        {loading && <Stack direction="row" alignItems="center" gap={1}><CircularProgress size={20} /><Typography>{ar ? 'جارٍ التحقق من الحساب والخيارات الحالية…' : 'Checking the account and current choices…'}</Typography></Stack>}
        {error && <Alert severity="warning">{workspaceClientError(error, language)}</Alert>}
        {notice && <Alert severity="info">{notice}</Alert>}
        {!overview && !loading && <Box><Typography component="h1" variant="h4" fontWeight={900}>{ar ? 'الربط والبيانات' : 'Connections & data'}</Typography><Button onClick={() => load()} disabled={working} sx={{ mt: 2 }}>{ar ? 'التحقق من الحالة الحالية' : 'Check current status'}</Button></Box>}
        {overview && <>
            {(held && context?.verified) && <Alert severity="warning" action={<Button color="inherit" disabled={working} onClick={checkOutcomes}>{ar ? 'التحقق من النتيجة' : 'Check outcome'}</Button>}>{ar ? 'توجد عملية قيد التحقق. يمكنك متابعة حالتها قبل بدء طلب جديد.' : 'An operation needs confirmation. Check its status before starting a new request.'}</Alert>}
            <ConnectionsDataWorkspace context={context} actions={overview.actions || []} onWorkspaceAction={workspaceAction} activeTab={activeTab} onTabChange={setActiveTab} refreshing={loading || working} onConnect={connect} onRefresh={() => load({}, true)} language={language}
                connection={{ ...overview.connection, selection, held, busy: loading || working, onSelectionChange: changeSelection,
                    editingLabel: editingRequest?.label, onCancelEditing: () => { setEditingRequest(null); setReview(null); setReviewKind(null); setSelection(overview.connection.selection); },
                    review: ['connection', 'connection-edit'].includes(reviewKind) ? review : null, onCancelReview: () => { setReview(null); setReviewKind(null); },
                    onReview: () => prepareReview(editingRequest ? 'connection-edit' : 'connection', selection), onSubmit: submitReview, onReconcile: checkOutcomes }}
                accessRequests={{ requests: accessRequests, detail: requestDetail, detailLoading: requestLoading, held, busy: loading || working,
                    onDetail: showRequest, onCloseDetail: () => { revision.current += 1; setRequestDetail(null); setRequestLoading(false); }, onAction: requestAction }}
                capabilities={{ ...overview.capabilities, held, busy: loading || working, onNextAction: nextAction,
                    onAction: (capabilityKey, actionKey) => { const capability = overview.capabilities.capabilities.find(item => item.key === capabilityKey); const action = capability?.actions?.find(item => item.key === actionKey); if (workspaceActionAvailable(action, { verified: true, held, busy: working })) routeNextAction(action.availability?.next_action); }, onRefresh: () => load() }}
                sharedData={{ ...overview.sharedData, records, query, held, loading, detailRecord: detail?.record || null, detailLoading,
                    onCloseDetail: () => { revision.current += 1; setDetail(null); setDetailLoading(false); }, onQueryChange: value => { revision.current += 1; setLoading(false); setQuery(value); setRecords([]); setRecordsValidUntil(null); setDetail(null); }, onSearch: search, onDetail: showDetail,
                    onCreate: createProduct, onAction: (_key, actionKey) => { if (['product.change', 'edit'].includes(actionKey) && detail?.productEditor) { const selectedAction = detail.record.actions?.find(action => action.key === actionKey); if (workspaceActionAvailable(selectedAction, { verified: true, held, busy: working })) { const currentDetail = detail; setDetail(null); openProduct('change', currentDetail.productEditor, currentDetail.record.key, currentDetail.valid_until); } } } }}
                operations={{ commands, held, busy: loading || working, onAction: commandAction }} />
        </>}
        <Dialog open={whatsAppSetupOpen} onClose={() => setWhatsAppSetupOpen(false)} fullWidth maxWidth="md" aria-labelledby="workspace-whatsapp-setup-title">
            <DialogTitle id="workspace-whatsapp-setup-title">{ar ? 'حسابات واتساب' : 'WhatsApp accounts'}</DialogTitle><DialogContent>
                {whatsAppSetupOpen && <Stack spacing={2}><GuidedWhatsAppSetupPanel language={language} onConnected={() => setNumberRefresh(value => value + 1)} /><WhatsAppNumberManager language={language} refreshKey={numberRefresh} /></Stack>}
            </DialogContent><DialogActions><Button onClick={() => { setWhatsAppSetupOpen(false); load({}, true); }}>{ar ? 'العودة وتحديث مساحة العمل' : 'Return and refresh workspace'}</Button></DialogActions>
        </Dialog>
        <WorkspaceMediaActionEditor open={mediaOpen} context={context} descriptor={overview?.mediaEditor} held={held} busy={working} language={language}
            onRefreshContext={refreshMediaContext} onClose={() => { requestedAction.current = null; setMediaOpen(false); }}
            onShowOperations={() => { requestedAction.current = null; setMediaOpen(false); setActiveTab('operations'); load({}, true); }}
            onReview={body => { setMediaOpen(false); prepareReview('native', body); }} />
        <WorkspaceCapabilityGrantEditor open={grantOpen} context={context} descriptor={overview?.grantEditor} options={grantOptions} draft={grantDraft}
            held={held} busy={working} now={nativeClock} language={language} message={grantMessage} onChoiceChange={chooseGrantContext}
            onChange={next => { setGrantDraft(next); setGrantMessage(''); setReview(null); setReviewKind(null); }}
            onClose={() => { requestedAction.current = null; setGrantOpen(false); setGrantOptions(null); setGrantDraft(emptyWorkspaceCapabilityGrantDraft()); }}
            onRefresh={refreshGrantOptions}
            onReview={() => { const input = workspaceCapabilityGrantInput({ context, descriptor: overview?.grantEditor, options: grantOptions, draft: grantDraft, held, busy: working }); if (input) prepareReview('grant', input); }} />
        <WorkspaceProductEditor open={Boolean(editor) && !review && context?.verified === true} {...editor?.descriptor} mode={editor?.mode || 'create'} draft={draft}
            verified={context?.verified === true} held={held} busy={working} onChange={setDraft} onClose={() => { requestedAction.current = null; setEditor(null); setDraft(emptyWorkspaceProductDraft()); }} language={language}
            onReview={values => { if (editor?.viewKey === context?.viewKey) prepareReview(editor.command ? 'command-edit' : 'product', {
                ...(editor.command ? { command: editor.command } : { activity: selection.activity, provider: editor.descriptor.provider, ...(editor.record ? { record: editor.record } : {}) }),
                fields: values.values, clearFields: values.clearFields }); }} />
        <WorkspaceReviewDialog review={!['connection', 'connection-edit'].includes(reviewKind) ? review : null} context={context} held={held} busy={working}
            submitted={Boolean(review && submitted.current.has(review.key))} onSubmit={submitReview} onClose={() => { setReview(null); setReviewKind(null); }} language={language} />
        <WorkspaceNativeActionEditor open={Boolean(nativeEditor) && !review} descriptor={nativeEditor} options={nativeOptions} draft={nativeDraft} preview={nativePreview}
            verified={context?.verified === true} held={held} busy={working} now={nativeClock} onChange={changeNativeDraft}
            recipientQuery={recipientQuery} onRecipientQuery={setRecipientQuery} onRecipientSearch={() => searchNativeRecipients()}
            onRecipientNext={() => { if (nativeOptions?.recipients_next_cursor) searchNativeRecipients(nativeOptions.recipients_next_cursor); }}
            onRefresh={() => loadNativeOptions(nativeEditor, nativeDraft)} onPreview={previewNativeAction} onReview={reviewNativeAction}
            onNextAction={routeNextAction}
            onManageConsent={recipient => { if (!working && nativeEditor && nativeOptions) setConsentDialog({ family: 'native', recipient }); }}
            onClose={() => { requestedAction.current = null; setNativeEditor(null); setNativeOptions(null); setNativePreview(null); setNativeDraft(emptyWorkspaceNativeDraft()); }} language={language} />
        <WorkspaceBusinessActionEditor open={Boolean(businessEditor) && !review} descriptor={businessEditor} options={businessOptions} draft={businessDraft} preview={businessPreview}
            verified={context?.verified === true} held={held} busy={working} now={nativeClock} language={language} onChange={changeBusinessDraft}
            contactQuery={contactQuery} onContactQuery={setContactQuery} onContactSearch={() => pageBusinessChoices()}
            onContactNext={() => { if (businessOptions?.contacts_next_cursor) pageBusinessChoices(businessOptions.contacts_next_cursor); }}
            onOperationNext={() => { if (businessOptions?.operations_next_cursor) pageBusinessChoices(null, businessOptions.operations_next_cursor); }}
            onRefresh={() => loadBusinessOptions(businessEditor, { contact_q: contactSearch.current })} onPreview={previewBusinessAction} onReview={reviewBusinessAction}
            onNextAction={routeNextAction} onManageConsent={recipient => { if (!working && businessEditor && businessOptions) setConsentDialog({ family: 'business', recipient }); }}
            onClose={() => { requestedAction.current = null; setBusinessEditor(null); setBusinessOptions(null); setBusinessPreview(null); setBusinessDraft(emptyWorkspaceBusinessDraft()); }} />
        <WorkspaceConsentDialog open={Boolean(consentDialog)} context={context} descriptor={businessConsent ? businessEditor : nativeEditor} options={businessConsent ? businessOptions : nativeOptions}
            nativeDraft={businessConsent ? { channel: 'native', account_ref: businessDraft.account_ref, recipient_ref: businessDraft.contact_ref, purpose: businessDraft.purpose } : nativeDraft}
            defaultRecipient={consentDialog?.recipient || ''} verified={context?.verified === true} held={held} busy={working} language={language}
            onClose={() => setConsentDialog(null)} onRefresh={refreshConsentOptions}
            onSaved={() => { setConsentDialog(null); setNativePreview(null); setBusinessPreview(null); setReview(null); setReviewKind(null); refreshConsentOptions(); }} />
        <Dialog open={activityOpen && context?.verified === true} onClose={() => { if (!working) setActivityOpen(false); }} fullWidth maxWidth="sm" aria-labelledby="workspace-new-activity-title">
            <DialogTitle id="workspace-new-activity-title">{ar ? 'إضافة نشاط إلى المؤسسة' : 'Add an activity to the organization'}</DialogTitle><DialogContent><TextField autoFocus fullWidth label={ar ? 'اسم النشاط' : 'Activity name'} value={activityName} onChange={event => setActivityName(event.target.value)} inputProps={{ maxLength: 200 }} sx={{ mt: 1 }} /></DialogContent>
            <DialogActions><Button disabled={working} onClick={() => setActivityOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button variant="contained" disabled={working || held || !activityName.trim()} onClick={() => prepareReview('activity', { name: activityName.trim() })}>{ar ? 'مراجعة النشاط الجديد' : 'Review new activity'}</Button></DialogActions>
        </Dialog>
        <Dialog open={Boolean(reasonOperation) && context?.verified === true} onClose={() => { if (!working) setReasonOperation(null); }} fullWidth maxWidth="sm" aria-labelledby="workspace-policy-reason-title">
            <DialogTitle id="workspace-policy-reason-title">{workspaceLabel(reasonOperation?.label, ar ? 'مراجعة تغيير الصلاحية' : 'Review access change')}</DialogTitle><DialogContent><TextField fullWidth multiline minRows={3} label={ar ? 'سبب هذا الإجراء' : 'Reason for this action'} value={reason} onChange={event => setReason(event.target.value)} disabled={working} inputProps={{ maxLength: reasonLimit }} sx={{ mt: 1 }} /></DialogContent>
            <DialogActions><Button disabled={working} onClick={() => setReasonOperation(null)}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button variant="contained" disabled={working || held || !reason.trim() || reason.length > reasonLimit} onClick={() => prepareReview(reasonOperation.kind, { reason: reason.trim() })}>{ar ? 'مراجعة الإجراء والسبب' : 'Review action and reason'}</Button></DialogActions>
        </Dialog>
        <Dialog open={Boolean(commandReview) && context?.verified === true} onClose={() => { if (!working) setCommandReview(null); }} fullWidth maxWidth="sm" aria-labelledby="workspace-command-review-title">
            <DialogTitle id="workspace-command-review-title">{workspaceLabel(commandReview?.label, ar ? 'مراجعة طلب التغيير' : 'Review change request')}</DialogTitle><DialogContent><Stack spacing={2}>
                {(workspaceReviewSummaryIsValid(commandReview?.summary) ? commandReview.summary : []).map(row => <Box key={row.label}><Typography fontWeight={700}>{row.label}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><bdi dir={/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? 'ltr' : 'auto'}>{row.value}</bdi></Typography></Box>)}
                {!workspaceReviewSummaryIsValid(commandReview?.summary) && <Alert severity="info">{ar ? 'ملخص المراجعة الحالي غير متاح؛ لا يمكن اعتماد الطلب من هذه الشاشة.' : 'A current review summary is unavailable; this screen cannot approve the request.'}</Alert>}
            </Stack></DialogContent><DialogActions><Button onClick={() => setCommandReview(null)} disabled={working}>{ar ? 'إغلاق' : 'Close'}</Button><Button variant="contained"
                disabled={working || held || !workspaceReviewSummaryIsValid(commandReview?.summary) || !workspaceActionAvailable(commandApprove, { verified: true, held, busy: working }) || !commandApprove?.intentKey}
                onClick={() => performEffect(commandApprove.intentKey, () => api.approvePortalWorkspaceCommand(commandReview.key, commandApprove.intentKey), commandApprove.intentKey)}>{ar ? 'اعتماد الطلب المراجع' : 'Approve reviewed request'}</Button></DialogActions>
        </Dialog>
    </Stack>;
};

export default ConnectionsDataController;
