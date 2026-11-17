import express from 'express';
import { localReadPrincipal, SharedProductReadError } from '../services/centralProductRead.js';

export const createOperationalReadSetupRouter = ({ service }) => {
    const router = express.Router();
    const emptyInput = req => {
        if (Object.keys(req.query).length || (req.body != null
            && (Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).length))) {
            throw new SharedProductReadError('shared_read_setup_request_invalid', 422);
        }
    };
    const intent = (req, res, next) => {
        if (req.get('X-Savana-Owner-Intent') !== 'shared-read-setup-v1'
            || (req.get('Origin') && req.get('Origin') !== service.appOrigin)) {
            return res.status(403).json({ error: { code: 'shared_read_owner_intent_required', message: 'يلزم طلب صريح من الواجهة الحالية؛ لم يُعتمد أو يُفعّل شيء.' } });
        }
        next();
    };
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const call = action => async (req, res) => {
        try { return res.json(await action(localReadPrincipal(req.user), req)); }
        catch (error) {
            const known = error instanceof SharedProductReadError;
            return res.status(known ? error.status : 503).json({
                error: { code: known ? error.code : 'shared_read_setup_unavailable', message: 'تعذر تأكيد التهيئة الحالية. لم يمنح الطلب قراءة أو نشرًا أو إرسالًا.' },
                read_only: true, execution_ready: false, pricing_use_allowed: false, clear_previous: true,
            });
        }
    };
    router.get('/shared-read-setup', call((principal, req) => {
        emptyInput(req);
        return service.status(principal);
    }));
    router.post('/shared-read-setup/authorization', intent, call((principal, req) => {
        emptyInput(req);
        return service.authorize(principal);
    }));
    router.post('/shared-read-setup/disconnect', intent, call((principal, req) => {
        emptyInput(req);
        return service.disconnect(principal);
    }));
    router.post('/shared-read-setup/reader', intent, call((principal, req) => {
        if (Object.keys(req.query).length) throw new SharedProductReadError('shared_read_setup_request_invalid', 422);
        return service.bindReader(principal, req.body);
    }));
    router.post('/shared-read-setup/enrollment', intent, call((principal, req) => {
        emptyInput(req);
        return service.enrollConsumer(principal);
    }));
    router.get('/shared-read-setup/callback', async (req, res) => {
        try {
            if (Object.keys(req.query).some(key => !['state', 'code', 'error', 'error_description'].includes(key))
                || typeof req.query.state !== 'string' || req.query.state.length > 128
                || (req.query.code && (typeof req.query.code !== 'string' || req.query.code.length > 4096))) {
                throw new SharedProductReadError('shared_read_authorization_state_invalid', 409);
            }
            const result = await service.callback(localReadPrincipal(req.user), req.query);
            return res.redirect(303, result.redirect);
        } catch (error) {
            const reason = error.code === 'shared_read_authorization_unknown' ? 'unknown' : 'unverified';
            return res.redirect(303, `/portal/integrations?shared_read_setup=${reason}`);
        }
    });
    return router;
};
