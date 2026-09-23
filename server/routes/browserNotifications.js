import express from 'express';

import { WebPushServiceError } from '../services/webPush.js';

const respondError = (res, error) => {
    if (error instanceof WebPushServiceError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('[BrowserNotifications] Request failed:', error?.message || 'unknown error');
    return res.status(500).json({
        error: 'تعذر تحديث إعدادات إشعارات المتصفح',
        code: 'WEB_PUSH_REQUEST_FAILED',
    });
};

export const createBrowserNotificationsRouter = ({ service } = {}) => {
    if (!service) throw new TypeError('createBrowserNotificationsRouter requires service');
    const router = express.Router();

    router.get('/config', (req, res) => {
        try {
            return res.json(service.getPublicConfig());
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/preferences', (req, res) => {
        try {
            return res.json(service.getPreferences(req.user.id));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.patch('/preferences', (req, res) => {
        try {
            return res.json(service.updatePreferences(req.user.id, req.body || {}));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.put('/subscription', async (req, res) => {
        try {
            const subscription = await service.registerSubscription({
                user: req.user,
                subscription: req.body?.subscription || req.body,
            });
            return res.status(201).json({ subscription });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.delete('/subscription', (req, res) => {
        try {
            return res.json(service.removeSubscription({
                userId: req.user.id,
                endpoint: req.body?.endpoint,
            }));
        } catch (error) {
            return respondError(res, error);
        }
    });

    return router;
};

export default createBrowserNotificationsRouter;
