import express from 'express';

import { SavanaIntegrationError } from '../services/savanaIntegration.js';

const respondError = (res, error) => {
    if (error instanceof SavanaIntegrationError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error('[SavanaIntegrations] Unexpected error:', error);
    return res.status(500).json({ error: 'فشل تنفيذ عملية الربط', code: 'integration_failure' });
};

const boundedLimit = value => Math.min(100, Math.max(1, Number.parseInt(value || '25', 10) || 25));

export const createTenantIntegrationsRouter = ({ database, service }) => {
    const router = express.Router();

    router.get('/pos', (req, res) => {
        try {
            return res.json(service.serialize(service.get(req.user.tenant_id)));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.put('/pos', async (req, res) => {
        try {
            const item = await service.requestConnection(
                req.user.tenant_id,
                req.body || {},
                req.user.id,
            );
            return res.status(201).json(service.serialize(item));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/pos/:action', async (req, res) => {
        try {
            const item = service.get(req.user.tenant_id);
            if (!item) {
                throw new SavanaIntegrationError(
                    'POS connection does not exist', 404, 'connection_not_found'
                );
            }
            if (['pause', 'resume', 'revoke'].includes(req.params.action)) {
                const result = await service.transition(item, req.params.action, req.user.id);
                return res.json(service.serialize(result));
            }
            if (req.params.action === 'refresh-status') {
                return res.json(service.serialize(await service.refreshStatus(item)));
            }
            if (req.params.action === 'refresh-entitlements') {
                return res.json(service.serialize(await service.refreshEntitlement(item)));
            }
            throw new SavanaIntegrationError('Unsupported action', 404, 'action_not_found');
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/pos/diagnostics', (req, res) => {
        try {
            return res.json(service.diagnostics(service.get(req.user.tenant_id)));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/pos/products', (req, res) => {
        try {
            const limit = boundedLimit(req.query.limit);
            const rows = database.prepare(`
                SELECT canonical_product_id, local_product_id, sku, barcode, name,
                    description, price, currency, image_url, quantity_on_hand,
                    quantity_available, unit_code, source_updated_at
                FROM savana_product_projection WHERE tenant_id = ?
                ORDER BY updated_at DESC, id DESC LIMIT ?
            `).all(req.user.tenant_id, limit);
            return res.json({ data: rows, limit });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/pos/transactions', (req, res) => {
        try {
            const limit = boundedLimit(req.query.limit);
            const rows = database.prepare(`
                SELECT id, transaction_type, local_transaction_id,
                    original_local_sale_id, reference_number, branch_id, terminal_id,
                    occurred_at, currency, total, customer_phone_e164,
                    receipt_notification_consent, created_at
                FROM savana_pos_transactions WHERE tenant_id = ?
                ORDER BY occurred_at DESC, id DESC LIMIT ?
            `).all(req.user.tenant_id, limit);
            return res.json({ data: rows, limit });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/pos/notification-candidates', (req, res) => {
        try {
            const limit = boundedLimit(req.query.limit);
            const rows = database.prepare(`
                SELECT id, transaction_id, kind, recipient_phone_e164, status, created_at
                FROM savana_notification_candidates WHERE tenant_id = ?
                ORDER BY id DESC LIMIT ?
            `).all(req.user.tenant_id, limit);
            return res.json({ data: rows, limit });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/pos/notification-candidates/:id/dismiss', (req, res) => {
        try {
            const result = database.prepare(`
                UPDATE savana_notification_candidates SET status = 'dismissed',
                    updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ? AND status = 'pending_review'
            `).run(req.params.id, req.user.tenant_id);
            if (result.changes === 0) {
                return res.status(404).json({ error: 'مرشح الإشعار غير موجود', code: 'candidate_not_found' });
            }
            return res.json({ dismissed: true });
        } catch (error) {
            return respondError(res, error);
        }
    });

    return router;
};

export const createConnectCallbacksRouter = ({ service }) => {
    const router = express.Router();
    router.post('/events', (req, res) => {
        try {
            const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
            const result = service.receiveEvent(
                req.get('X-Savana-Connection-Id'),
                req.get('X-Savana-Callback-Token'),
                rawBody,
            );
            return res.json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });
    return router;
};
