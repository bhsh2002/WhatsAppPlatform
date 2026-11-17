import express from 'express';
import rateLimit from 'express-rate-limit';
import { localReadPrincipal, SharedProductReadError } from '../services/centralProductRead.js';

export const createOperationalOwnerPortalRouter = ({ service, appOrigin }) => {
    const router = express.Router();
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const empty = req => {
        if (Object.keys(req.query).length || (req.body != null
            && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))) {
            throw new SharedProductReadError('owner_portal_request_invalid', 422);
        }
    };
    const intent = (req, res, next) => {
        if (req.get('X-Savana-Owner-Intent') !== 'shared-read-setup-v1'
            || (req.get('Origin') && req.get('Origin') !== appOrigin)) {
            return res.status(403).json({ error: { code: 'shared_read_owner_intent_required', message: 'يلزم طلب صريح من الواجهة الحالية.' }, clear_previous: true });
        }
        next();
    };
    const call = action => async (req, res) => {
        try { return res.json(await action(localReadPrincipal(req.user), req)); }
        catch (failure) {
            const known = failure instanceof SharedProductReadError;
            return res.status(known ? failure.status : 503).json({
                error: { code: known ? failure.code : 'owner_portal_unavailable', message: 'تعذر تأكيد الإجراء الحالي لدى مركز التحكم. أعد فحص الحالة قبل أي إجراء آخر.' },
                read_only: true, execution_ready: false, pricing_use_allowed: false, clear_previous: true,
            });
        }
    };
    const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
        handler: (_req, res) => res.status(429).json({ error: { code: 'owner_portal_login_rate_limited', message: 'تجاوزت محاولات الدخول الحد المؤقت.' } }) });
    const prefix = '/shared-read-setup/owner';
    router.get(prefix, call((p, req) => { empty(req); return service.status(p); }));
    router.post(`${prefix}/login`, intent, loginLimit, call((p, req) => {
        if (Object.keys(req.query).length) throw new SharedProductReadError('owner_portal_request_invalid', 422);
        return service.login(p, req.body);
    }));
    router.post(`${prefix}/disconnect`, intent, call((p, req) => { empty(req); return service.disconnect(p); }));
    router.get(`${prefix}/overview`, call((p, req) => { empty(req); return service.overview(p); }));
    router.post(`${prefix}/operations`, intent, call((p, req) => {
        if (Object.keys(req.query).length) throw new SharedProductReadError('owner_portal_request_invalid', 422);
        return service.perform(p, req.body);
    }));
    router.get(`${prefix}/intents/by-key/:key`, call((p, req) => { empty(req); return service.intentByKey(p, req.params.key); }));
    router.get(`${prefix}/intents/:id`, call((p, req) => { empty(req); return service.intent(p, req.params.id); }));
    return router;
};
