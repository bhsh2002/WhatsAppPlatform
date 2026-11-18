import express from 'express';
import rateLimit from 'express-rate-limit';
import { localReadPrincipal } from '../services/centralProductRead.js';
import { GuidedWhatsAppSetupError } from '../services/guidedWhatsAppSetup.js';

export const createGuidedWhatsAppSetupRouter = ({ service, appOrigin = null }) => {
    if (!service || appOrigin === null && service.configured !== false) throw new TypeError('Native guided setup and exact frontend origin are required');
    if (appOrigin !== null) {
        let origin;
        try { origin = new URL(appOrigin); } catch { throw new TypeError('A fixed exact frontend origin is required'); }
        if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.origin !== appOrigin) {
            throw new TypeError('A fixed exact frontend origin is required');
        }
    }
    const router = express.Router();
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const reject = (res, code, status) => res.status(status).json({ error: { code, message: 'تعذر تأكيد ربط WhatsApp. افحص الحالة أو أعد تسجيل الدخول إلى Meta.' }, clear_previous: true });
    const intent = (req, res, next) => {
        if (appOrigin === null || req.get('X-Savana-Owner-Intent') !== 'guided-whatsapp-setup-v1' || req.get('Origin') !== appOrigin) {
            return reject(res, 'whatsapp_setup_owner_intent_required', 403);
        }
        next();
    };
    const call = (method, empty = false) => async (req, res) => {
        try {
            if (Object.keys(req.query).length || (empty && req.body != null
                && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))) {
                throw new GuidedWhatsAppSetupError('whatsapp_setup_request_invalid', 422);
            }
            return res.json(await service[method](localReadPrincipal(req.user), ...(empty ? [] : [req.body])));
        } catch (error) { return reject(res, error instanceof GuidedWhatsAppSetupError ? error.code : 'whatsapp_setup_unavailable', error instanceof GuidedWhatsAppSetupError ? error.status : 503); }
    };
    const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
        handler: (_req, res) => reject(res, 'whatsapp_setup_rate_limited', 429) });
    router.get('/whatsapp/setup', call('status', true));
    router.post('/whatsapp/setup/start', intent, loginLimit, call('start', true));
    router.post('/whatsapp/setup/complete', intent, loginLimit, call('complete'));
    router.post('/whatsapp/setup/choose', intent, call('choose'));
    router.post('/whatsapp/setup/connect', intent, call('connect'));
    router.post('/whatsapp/setup/cancel', intent, call('cancel', true));
    return router;
};
