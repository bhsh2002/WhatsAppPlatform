import express from 'express';
import { localReadPrincipal, SharedProductReadError } from '../services/centralProductRead.js';
import { WorkspaceIntentError } from '../services/workspaceIntents.js';
import { WorkspaceReferenceError } from '../services/workspaceReferences.js';

const invalid = () => { throw new SharedProductReadError('workspace_request_invalid', 422); };
const exact = (value, keys, required = []) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
    return value;
};
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 180_000 && /^[A-Za-z0-9_-]+$/.test(value);

// Local owner API. Browser selections are opaque references; every service
// operation reloads real Core/native identity, policy and allowed choices.
export const createOperationalWorkspaceRouter = ({ service, appOrigin }) => {
    const router = express.Router();
    router.use('/workspace', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const intent = (req, res, next) => {
        if (req.get('X-Savana-Owner-Intent') !== 'connections-data-v1'
            || (req.get('Origin') && req.get('Origin') !== appOrigin)) {
            return res.status(403).json({ error: { code: 'workspace_owner_intent_required',
                message: 'يلزم إجراء صريح من صفحة الربط والبيانات الحالية.' }, clear_previous: true });
        }
        return next();
    };
    const call = (method, input) => async (req, res) => {
        try { return res.json(await service[method](localReadPrincipal(req.user), input(req))); }
        catch (error) {
            const known = error instanceof SharedProductReadError || error instanceof WorkspaceIntentError || error instanceof WorkspaceReferenceError;
            return res.status(known ? error.status : 503).json({ error: {
                code: known ? error.code : 'workspace_unavailable',
                message: 'تعذر تأكيد الحالة الحالية. حدّث الصفحة وافحص نتيجة المحاولة قبل تكرار أي إجراء.',
            }, clear_previous: true });
        }
    };
    const empty = req => { exact(req.query, []); if (req.body != null) exact(req.body, []); return {}; };
    const body = (keys, required = keys) => req => { exact(req.query, []); return exact(req.body, keys, required); };
    const reviewed = req => { const input = body(['review'])(req); if (!opaque(input.review)) invalid(); return input; };
    const approval = req => {
        const input = body(['intent'])(req);
        if (typeof input.intent !== 'string' || input.intent.length > 65_536 || !/^wr1\.[A-Za-z0-9_-]+$/.test(input.intent)) invalid();
        return input;
    };
    const query = keys => req => {
        const value = exact(req.query, keys);
        if (Object.values(value).some(item => typeof item !== 'string' || item.length > 16_384)) invalid();
        return value;
    };
    router.get('/workspace', call('overview', query(['activity', 'purpose', 'provider', 'action'])));
    router.post('/workspace/selection', intent, call('select', body(['activity'], ['activity'])));
    router.post('/workspace/selection/review', intent, call('reviewSelection', body(['activity'])));
    router.post('/workspace/activity/review', intent, call('reviewActivity', body(['name'])));
    router.post('/workspace/binding/review', intent, call('reviewBinding', empty));
    router.post('/workspace/provider/review', intent, call('reviewProvider', body(['provider'])));
    router.post('/workspace/provider/refresh/review', intent, call('reviewProviderRefresh', body(['provider'])));
    router.get('/workspace/grant-options', call('grantOptions', query(['activity', 'grant', 'person'])));
    router.post('/workspace/grants/review', intent, call('reviewCapabilityGrant', body(['activity', 'grant', 'person', 'actions', 'fields', 'resources', 'resourcePolicy', 'expiresAt', 'assignSourceAuthority'])));
    router.post('/workspace/connection/review', intent, call('reviewConnection', body(['activity', 'purpose', 'provider', 'fields', 'people'])));
    router.post('/workspace/products/review', intent, call('reviewProduct', body(['activity', 'provider', 'record', 'fields', 'clearFields'], ['activity', 'provider', 'fields'])));
    router.post('/workspace/actions/review', intent, call('reviewAction', body(['activity', 'provider', 'capability', 'action', 'parameters'])));
    router.post('/workspace/submit', intent, call('submit', reviewed));
    router.get('/workspace/records', call('records', query(['activity', 'q', 'cursor'])));
    router.get('/workspace/records/:record', call('record', req => ({ ...query(['activity'])(req), record: req.params.record })));
    router.get('/workspace/commands', call('commands', query(['activity'])));
    router.get('/workspace/commands/:command/result', async (req, res) => {
        try {
            const input = query(['format'])(req); const format = input.format || 'json';
            if (!['json', 'csv'].includes(format)) invalid();
            const result = await service.result(localReadPrincipal(req.user), { command: req.params.command, format });
            if (!Buffer.isBuffer(result?.bytes) || !/^[a-f0-9]{64}$/.test(result.sha256 || '')
                || result.contentType !== (format === 'csv' ? 'text/csv' : 'application/json')) throw new SharedProductReadError('workspace_result_invalid', 502);
            return res.set({ 'Content-Type': `${result.contentType}; charset=utf-8`, 'X-Savana-Result-SHA256': result.sha256,
                'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="source-result.${format}"` }).send(result.bytes);
        } catch (error) {
            const known = error instanceof SharedProductReadError || error instanceof WorkspaceIntentError || error instanceof WorkspaceReferenceError;
            return res.status(known ? error.status : 503).json({ error: { code: known ? error.code : 'workspace_unavailable',
                message: 'تعذر تأكيد صلاحية عرض النتيجة الحالية. حدّث حالة الطلب ثم أعد المحاولة.' }, clear_previous: true });
        }
    });
    router.get('/workspace/commands/:command', call('command', req => { empty(req); return { command: req.params.command }; }));
    router.post('/workspace/commands/:command/approve', intent, call('approve', req => ({ ...approval(req), command: req.params.command })));
    router.post('/workspace/commands/:command/reconcile', intent, call('reconcileCommand', req => { empty(req); return { command: req.params.command }; }));
    router.post('/workspace/commands/:command/edit/review', intent, call('reviewCommandEdit', req => ({ ...body(['fields', 'clearFields'], ['fields'])(req), command: req.params.command })));
    router.post('/workspace/commands/:command/reject/review', intent, call('reviewCommandReject', req => ({ ...body(['reason'])(req), command: req.params.command })));
    router.post('/workspace/commands/:command/dispatch/review', intent, call('reviewCommandDispatch', req => { empty(req); return { command: req.params.command }; }));
    router.post('/workspace/commands/:command/cancel/review', intent, call('reviewCommandCancel', req => ({ ...body(['reason'])(req), command: req.params.command })));
    router.get('/workspace/requests', call('requests', query(['activity'])));
    router.get('/workspace/requests/:request', call('request', req => { empty(req); return { request: req.params.request }; }));
    router.post('/workspace/requests/:request/approve', intent, call('approveRequest', req => ({ ...approval(req), request: req.params.request })));
    router.post('/workspace/requests/:request/reject/review', intent, call('reviewRequestReject', req => ({ ...body(['reason'])(req), request: req.params.request })));
    router.post('/workspace/requests/:request/edit/review', intent, call('reviewRequestEdit', req => ({ ...body(['activity', 'purpose', 'provider', 'fields', 'people'])(req), request: req.params.request })));
    router.post('/workspace/read-grants/:grant/revoke/review', intent, call('reviewGrantRevoke', req => ({ ...body(['reason'])(req), grant: req.params.grant })));
    router.get('/workspace/intents/:intent', call('intent', req => { empty(req); return { intent: req.params.intent }; }));
    router.post('/workspace/intents/:intent/reconcile', intent, call('reconcileIntent', req => { empty(req); return { intent: req.params.intent }; }));
    return router;
};
