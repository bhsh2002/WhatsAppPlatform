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

const parseMessageRequest = row => ({
    ...row,
    payload: JSON.parse(row.payload_json || '{}'),
    payload_json: undefined,
});

export const createTenantIntegrationsRouter = ({ database, service }) => {
    const router = express.Router();

    router.get('/binding', async (req, res) => {
        try {
            return res.json(await service.bindingContext(req.user.tenant_id));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/binding/redeem', async (req, res) => {
        try {
            const result = await service.redeemBinding(
                req.user.tenant_id,
                req.body?.invitation_code,
                req.user.id,
            );
            return res.status(201).json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/binding/authorize', async (req, res) => {
        try {
            const result = await service.startBindingAuthorization(
                req.user.tenant_id,
                req.body?.redirect_uri,
                req.body?.state,
                req.user.id,
            );
            return res.status(201).json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/incoming-connections', async (req, res) => {
        try {
            return res.json({
                data: await service.incomingConnections(req.user.tenant_id),
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post(
        '/incoming-connections/:connectionId/:decision',
        async (req, res) => {
            try {
                return res.json(await service.decideIncomingConnection(
                    req.user.tenant_id,
                    req.params.connectionId,
                    req.params.decision,
                    req.user.id,
                ));
            } catch (error) {
                return respondError(res, error);
            }
        }
    );

    router.get('/subscription', async (req, res) => {
        try {
            return res.json(await service.synchronizeCentralSubscription(req.user.tenant_id));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/subscription/checkout', async (req, res) => {
        try {
            const result = await service.subscriptionCheckout(
                req.user.tenant_id,
                req.body || {},
                req.user.id,
            );
            return res.status(201).json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/platforms', (req, res) => {
        try {
            const existing = new Map(
                service.list(req.user.tenant_id).map(item => [item.platform_code, item])
            );
            return res.json({
                data: service.availablePlatforms().map(platformCode => service.serialize(
                    existing.get(platformCode), platformCode
                )),
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/platforms/:platformCode', (req, res) => {
        try {
            service.profile(req.params.platformCode);
            return res.json(service.serialize(
                service.get(req.user.tenant_id, req.params.platformCode),
                req.params.platformCode,
            ));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/platforms/:platformCode/candidates', async (req, res) => {
        try {
            return res.json(await service.connectionCandidates(
                req.user.tenant_id, req.params.platformCode
            ));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.put('/platforms/:platformCode', async (req, res) => {
        try {
            const item = await service.requestConnection(
                req.user.tenant_id, req.body || {}, req.user.id, req.params.platformCode,
            );
            return res.status(201).json(service.serialize(item));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/platforms/:platformCode/:action', async (req, res) => {
        try {
            const item = service.get(req.user.tenant_id, req.params.platformCode);
            if (!item) {
                throw new SavanaIntegrationError(
                    'Platform connection does not exist', 404, 'connection_not_found'
                );
            }
            if (['pause', 'resume', 'revoke'].includes(req.params.action)) {
                return res.json(service.serialize(
                    await service.transition(item, req.params.action, req.user.id)
                ));
            }
            if (req.params.action === 'refresh-status') {
                return res.json(service.serialize(await service.refreshStatus(item)));
            }
            if (req.params.action === 'refresh-entitlements') {
                return res.json(service.serialize(await service.refreshEntitlement(item)));
            }
            if (req.params.action === 'publish-status') {
                return res.status(202).json(await service.publishNotificationStatus(item, req.body || {}));
            }
            if (req.params.action === 'retry-outbox') {
                return res.status(202).json(await service.retryOutbox(item));
            }
            throw new SavanaIntegrationError('Unsupported action', 404, 'action_not_found');
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/platforms/:platformCode/diagnostics', (req, res) => {
        try {
            const item = service.get(req.user.tenant_id, req.params.platformCode);
            if (!item) {
                throw new SavanaIntegrationError(
                    'Platform connection does not exist', 404, 'connection_not_found'
                );
            }
            return res.json(service.diagnostics(item));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/platforms/:platformCode/service-requests', (req, res) => {
        try {
            const item = service.get(req.user.tenant_id, req.params.platformCode);
            if (!item) {
                throw new SavanaIntegrationError(
                    'Platform connection does not exist', 404, 'connection_not_found'
                );
            }
            const rows = database.prepare(`
                SELECT id, request_kind, request_key, payload_json, status, created_at
                FROM savana_service_requests
                WHERE integration_id = ? AND tenant_id = ?
                ORDER BY id DESC LIMIT ?
            `).all(item.id, req.user.tenant_id, boundedLimit(req.query.limit));
            return res.json({
                data: rows.map(row => ({
                    ...row,
                    payload: JSON.parse(row.payload_json || '{}'),
                    payload_json: undefined,
                })),
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.get('/message-requests', (req, res) => {
        try {
            const statuses = String(req.query.status || 'pending_review,approved')
                .split(',')
                .map(value => value.trim())
                .filter(value => ['pending_review', 'approved'].includes(value));
            const selectedStatuses = statuses.length ? statuses : ['pending_review', 'approved'];
            const placeholders = selectedStatuses.map(() => '?').join(', ');
            const rows = database.prepare(`
                SELECT requests.id, requests.request_kind, requests.request_key,
                    requests.payload_json, requests.status, requests.created_at,
                    integrations.platform_code
                FROM savana_service_requests requests
                JOIN savana_integrations integrations
                  ON integrations.id = requests.integration_id
                WHERE requests.tenant_id = ?
                  AND requests.request_kind IN ('notification_request', 'order_notification')
                  AND requests.status IN (${placeholders})
                ORDER BY requests.id DESC LIMIT ?
            `).all(req.user.tenant_id, ...selectedStatuses, boundedLimit(req.query.limit));
            return res.json({ data: rows.map(parseMessageRequest) });
        } catch (error) {
            return respondError(res, error);
        }
    });

    const loadMessageRequest = (tenantId, requestId, allowedStatuses) => {
        const placeholders = allowedStatuses.map(() => '?').join(', ');
        return database.prepare(`
            SELECT requests.id, requests.integration_id, requests.event_id,
                requests.request_key, requests.payload_json, requests.status,
                integrations.platform_code
            FROM savana_service_requests requests
            JOIN savana_integrations integrations
              ON integrations.id = requests.integration_id
            WHERE requests.id = ? AND requests.tenant_id = ?
              AND requests.request_kind IN ('notification_request', 'order_notification')
              AND requests.status IN (${placeholders})
        `).get(requestId, tenantId, ...allowedStatuses);
    };

    const publishMessageStatus = async (item, requestRecord, status, extra = {}) => {
        try {
            await service.publishNotificationStatus(item, {
                request_id: requestRecord.request_key,
                status,
                causation_id: requestRecord.event_id,
                ...extra,
            });
            return true;
        } catch (error) {
            console.warn(
                `[SavanaIntegrations] Failed to publish ${status} request status:`,
                error.message
            );
            return false;
        }
    };

    router.post('/message-requests/:id/accept', async (req, res) => {
        try {
            const requestRecord = loadMessageRequest(
                req.user.tenant_id, req.params.id, ['pending_review', 'approved']
            );
            if (!requestRecord) {
                throw new SavanaIntegrationError(
                    'Message request was not found', 404, 'message_request_not_found'
                );
            }
            const item = service.get(req.user.tenant_id, requestRecord.platform_code);
            if (requestRecord.status === 'pending_review') {
                database.prepare(`
                    UPDATE savana_service_requests
                    SET status = 'approved', updated_at = datetime('now', 'localtime')
                    WHERE id = ? AND tenant_id = ? AND status = 'pending_review'
                `).run(req.params.id, req.user.tenant_id);
            }
            const statusPublished = requestRecord.status === 'approved'
                ? true
                : await publishMessageStatus(item, requestRecord, 'accepted');
            return res.json({
                accepted: true,
                status_published: statusPublished,
                request: parseMessageRequest({
                    ...requestRecord,
                    status: 'approved',
                }),
            });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/message-requests/:id/complete', async (req, res) => {
        try {
            const requestRecord = loadMessageRequest(
                req.user.tenant_id, req.params.id, ['approved']
            );
            if (!requestRecord) {
                throw new SavanaIntegrationError(
                    'Approved message request was not found',
                    404,
                    'message_request_not_found',
                );
            }
            database.prepare(`
                UPDATE savana_service_requests
                SET status = 'sent', updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ? AND status = 'approved'
            `).run(req.params.id, req.user.tenant_id);
            const item = service.get(req.user.tenant_id, requestRecord.platform_code);
            const channelMessageId = typeof req.body?.channel_message_id === 'string'
                ? req.body.channel_message_id.slice(0, 255)
                : null;
            const statusPublished = await publishMessageStatus(
                item,
                requestRecord,
                'sent',
                { channel_message_id: channelMessageId },
            );
            return res.json({ sent: true, status_published: statusPublished });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/message-requests/:id/dismiss', async (req, res) => {
        try {
            const requestRecord = loadMessageRequest(
                req.user.tenant_id, req.params.id, ['pending_review', 'approved']
            );
            if (!requestRecord) {
                throw new SavanaIntegrationError(
                    'Message request was not found', 404, 'message_request_not_found'
                );
            }
            database.prepare(`
                UPDATE savana_service_requests
                SET status = 'dismissed', updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
                  AND status IN ('pending_review', 'approved')
            `).run(req.params.id, req.user.tenant_id);
            const item = service.get(req.user.tenant_id, requestRecord.platform_code);
            const statusPublished = await publishMessageStatus(
                item, requestRecord, 'rejected'
            );
            return res.json({ dismissed: true, status_published: statusPublished });
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/platforms/:platformCode/service-requests/:id/dismiss', async (req, res) => {
        try {
            const item = service.get(req.user.tenant_id, req.params.platformCode);
            if (!item) {
                throw new SavanaIntegrationError(
                    'Platform connection does not exist', 404, 'connection_not_found'
                );
            }
            const requestRecord = database.prepare(`
                SELECT id, event_id, request_key FROM savana_service_requests
                WHERE id = ? AND integration_id = ? AND tenant_id = ?
                  AND status = 'pending_review'
            `).get(req.params.id, item.id, req.user.tenant_id);
            if (!requestRecord) {
                throw new SavanaIntegrationError(
                    'Service request was not found', 404, 'service_request_not_found'
                );
            }
            database.prepare(`
                UPDATE savana_service_requests
                SET status = 'dismissed', updated_at = datetime('now', 'localtime')
                WHERE id = ? AND integration_id = ? AND tenant_id = ?
                  AND status = 'pending_review'
            `).run(req.params.id, item.id, req.user.tenant_id);
            let statusPublished = true;
            try {
                await service.publishNotificationStatus(item, {
                    request_id: requestRecord.request_key,
                    status: 'rejected',
                    causation_id: requestRecord.event_id,
                });
            } catch (error) {
                statusPublished = false;
                console.warn(
                    '[SavanaIntegrations] Failed to publish dismissed request status:',
                    error.message
                );
            }
            return res.json({ dismissed: true, status_published: statusPublished });
        } catch (error) {
            return respondError(res, error);
        }
    });

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

export const createAdminSubscriptionsRouter = ({ service }) => {
    const router = express.Router();

    router.get('/mode', (_req, res) => res.json({
        mode: service.config.subscriptionsMode,
        managed_centrally: (
            service.config.enabled && service.config.subscriptionsMode === 'central'
        ),
    }));

    router.get('/:tenantId', async (req, res) => {
        try {
            return res.json(await service.synchronizeCentralSubscription(req.params.tenantId));
        } catch (error) {
            return respondError(res, error);
        }
    });

    router.post('/:tenantId/checkout', async (req, res) => {
        try {
            const result = await service.subscriptionCheckout(
                req.params.tenantId,
                req.body || {},
                `admin:${req.user.id}`,
            );
            return res.status(201).json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });

    return router;
};

export const createConnectCallbacksRouter = ({ service }) => {
    const router = express.Router();
    router.post('/provision', async (req, res) => {
        try {
            const item = await service.provisionConnection(
                req.body || {},
                req.get('X-Savana-Callback-Token'),
            );
            return res.json(service.serialize(item, item.platform_code));
        } catch (error) {
            return respondError(res, error);
        }
    });
    router.post('/lifecycle', (req, res) => {
        try {
            const item = service.applyLifecycle(
                req.body || {},
                req.get('X-Savana-Callback-Token'),
            );
            return res.json(service.serialize(item, item.platform_code));
        } catch (error) {
            return respondError(res, error);
        }
    });
    router.post('/events', (req, res) => {
        try {
            const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
            const result = service.receiveEvent(
                req.get('X-Savana-Connection-Id'),
                req.get('X-Savana-Callback-Token'),
                req.get('X-Savana-Delivery-Id'),
                req.get('X-Savana-Timestamp'),
                req.get('X-Savana-Signature'),
                rawBody,
            );
            return res.json(result);
        } catch (error) {
            return respondError(res, error);
        }
    });
    return router;
};
