import crypto from 'node:crypto';

export const POS_SCOPES = Object.freeze([
    'pos.inventory.snapshot',
    'pos.sales.events',
    'pos.returns.events',
    'pos.customers.reference',
]);

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);
const CONNECTION_ACTIONS = new Set(['pause', 'resume', 'revoke']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SavanaIntegrationError extends Error {
    constructor(message, statusCode = 400, code = 'integration_error') {
        super(message);
        this.name = 'SavanaIntegrationError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

const parseBoolean = value => ['1', 'true', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase()
);

export const integrationConfigFromEnv = (env = process.env) => ({
    enabled: parseBoolean(env.SAVANA_INTEGRATIONS_ENABLED),
    connectUrl: String(env.SAVANA_CONNECT_URL || 'http://savana-connect:8010').replace(/\/+$/, ''),
    connectAdminToken: env.SAVANA_CONNECT_ADMIN_TOKEN || '',
    callbackUrl: env.SAVANA_CONNECT_CALLBACK_URL || '',
    callbackToken: env.SAVANA_CONNECT_CALLBACK_TOKEN || '',
    subscriptionsUrl: String(env.SAVANA_SUBSCRIPTIONS_URL || 'http://savana-subscriptions:8020').replace(/\/+$/, ''),
    subscriptionsPlatformToken: env.SAVANA_SUBSCRIPTIONS_PLATFORM_TOKEN || '',
    subscriptionsSigningSecret: env.SAVANA_SUBSCRIPTIONS_SIGNING_SECRET || '',
    timeoutMs: Math.max(500, Number(env.SAVANA_CONTROL_PLANE_TIMEOUT_MS || 10_000)),
});

export const validateIntegrationConfig = config => {
    if (!config.enabled) return;
    const missing = [
        ['SAVANA_CONNECT_ADMIN_TOKEN', config.connectAdminToken],
        ['SAVANA_CONNECT_CALLBACK_URL', config.callbackUrl],
        ['SAVANA_CONNECT_CALLBACK_TOKEN', config.callbackToken],
        ['SAVANA_SUBSCRIPTIONS_PLATFORM_TOKEN', config.subscriptionsPlatformToken],
        ['SAVANA_SUBSCRIPTIONS_SIGNING_SECRET', config.subscriptionsSigningSecret],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        throw new Error(`Missing Savana integration settings: ${missing.join(', ')}`);
    }
    if (!config.callbackUrl.startsWith('https://') && process.env.NODE_ENV === 'production') {
        throw new Error('SAVANA_CONNECT_CALLBACK_URL must use HTTPS in production');
    }
};

const sortForSigning = value => {
    if (Array.isArray(value)) return value.map(sortForSigning);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map(key => [key, sortForSigning(value[key])])
        );
    }
    return value;
};

export const canonicalJson = value => JSON.stringify(sortForSigning(value));

const safeCompare = (left, right) => {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};

const requireUuid = (value, field) => {
    const normalized = String(value || '').trim();
    if (!UUID_PATTERN.test(normalized)) {
        throw new SavanaIntegrationError(`${field} must be a UUID`, 400, 'invalid_uuid');
    }
    return normalized.toLowerCase();
};

const requiredString = (value, field) => {
    const normalized = String(value || '').trim();
    if (!normalized) throw new SavanaIntegrationError(`${field} is required`);
    return normalized;
};

const parseJson = (value, fallback = null) => {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
};

const nowIso = () => new Date().toISOString();

export class SavanaIntegrationService {
    constructor({ database, fetchImpl = globalThis.fetch, config = integrationConfigFromEnv() }) {
        if (!database) throw new TypeError('database is required');
        if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
        this.db = database;
        this.fetch = fetchImpl;
        this.config = config;
    }

    get(tenantId, platformCode = 'pos') {
        return this.db.prepare(`
            SELECT * FROM savana_integrations
            WHERE tenant_id = ? AND platform_code = ?
        `).get(tenantId, platformCode);
    }

    getOrCreate(tenantId, platformCode = 'pos') {
        this.db.prepare(`
            INSERT INTO savana_integrations (tenant_id, platform_code, scopes_json)
            VALUES (?, ?, ?)
            ON CONFLICT(tenant_id, platform_code) DO NOTHING
        `).run(tenantId, platformCode, JSON.stringify(POS_SCOPES));
        return this.get(tenantId, platformCode);
    }

    async requestJson(service, method, path, payload = undefined) {
        const isSubscriptions = service === 'subscriptions';
        const base = isSubscriptions ? this.config.subscriptionsUrl : this.config.connectUrl;
        const headers = {
            Accept: 'application/json',
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(isSubscriptions
                ? { 'X-Savana-Platform-Token': this.config.subscriptionsPlatformToken }
                : { Authorization: `Bearer ${this.config.connectAdminToken}` }),
        };
        let response;
        try {
            response = await this.fetch(`${base}${path}`, {
                method,
                headers,
                ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
                signal: AbortSignal.timeout(this.config.timeoutMs),
            });
        } catch (error) {
            throw new SavanaIntegrationError(
                `${service} is unavailable: ${error.message}`,
                502,
                'control_plane_unavailable'
            );
        }
        const text = await response.text();
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch {
            throw new SavanaIntegrationError(
                `${service} returned invalid JSON`, 502, 'invalid_control_plane_response'
            );
        }
        if (!response.ok) {
            const detail = body?.error?.message || body?.detail || body?.error || text || response.statusText;
            const error = new SavanaIntegrationError(
                `${service} returned ${response.status}: ${detail}`,
                502,
                'control_plane_error'
            );
            error.remoteStatus = response.status;
            throw error;
        }
        return isSubscriptions ? body.data : body;
    }

    verifyEntitlement(organizationId, snapshot) {
        const { payload, signature } = snapshot || {};
        if (payload?.organization_id !== organizationId || payload?.platform_code !== 'wa_savana') {
            throw new SavanaIntegrationError(
                'Entitlement scope mismatch', 409, 'snapshot_scope_mismatch'
            );
        }
        const expected = `v1=${crypto.createHmac('sha256', this.config.subscriptionsSigningSecret)
            .update(canonicalJson(payload)).digest('hex')}`;
        if (!this.config.subscriptionsSigningSecret || !safeCompare(expected, signature)) {
            throw new SavanaIntegrationError(
                'Invalid entitlement signature', 401, 'invalid_entitlement_signature'
            );
        }
        const expiry = Date.parse(payload.valid_until);
        if (!Number.isFinite(expiry) || expiry <= Date.now()) {
            throw new SavanaIntegrationError('Entitlement snapshot expired', 402, 'entitlement_expired');
        }
        return { payload, signature };
    }

    hasEntitlement(item) {
        const payload = parseJson(item?.entitlement_payload_json, {});
        if (!item?.entitlement_valid_until || Date.parse(item.entitlement_valid_until) <= Date.now()) {
            return false;
        }
        if (!ACTIVE_SUBSCRIPTION_STATUSES.has(payload.subscription_status)) return false;
        const entitlements = payload.entitlements || {};
        return entitlements['wa_savana.integration.pos.enabled'] === true
            || entitlements['wa_savana.integrations.pos.enabled'] === true;
    }

    async refreshEntitlement(item) {
        if (!item?.organization_id) {
            throw new SavanaIntegrationError('organization_id is required', 400, 'organization_required');
        }
        const snapshot = await this.requestJson(
            'subscriptions',
            'GET',
            `/v1/organizations/${encodeURIComponent(item.organization_id)}/entitlements/wa_savana/latest`
        );
        const verified = this.verifyEntitlement(item.organization_id, snapshot);
        this.db.prepare(`
            UPDATE savana_integrations SET
                entitlement_payload_json = ?, entitlement_signature = ?,
                entitlement_valid_until = ?, last_sync_at = ?, last_error = NULL,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(
            JSON.stringify(verified.payload),
            verified.signature,
            verified.payload.valid_until,
            nowIso(),
            item.id,
        );
        return this.get(item.tenant_id, item.platform_code);
    }

    async requestConnection(tenantId, payload, actorId) {
        if (!this.config.enabled) {
            throw new SavanaIntegrationError(
                'Savana integrations are disabled', 503, 'integrations_disabled'
            );
        }
        const tenant = this.db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) throw new SavanaIntegrationError('Tenant was not found', 404, 'tenant_not_found');
        let item = this.getOrCreate(tenantId);
        if (item.connection_id && item.status !== 'revoked') {
            throw new SavanaIntegrationError('POS connection already exists', 409, 'connection_exists');
        }
        const organizationId = requireUuid(payload.organization_id, 'organization_id');
        const remoteExternalTenantId = requiredString(
            payload.pos_external_tenant_id, 'pos_external_tenant_id'
        );
        const callbackUrl = String(payload.callback_url || this.config.callbackUrl || '').trim();
        if (!/^https?:\/\//.test(callbackUrl)) {
            throw new SavanaIntegrationError('A valid callback_url is required');
        }
        this.db.prepare(`
            UPDATE savana_integrations SET organization_id = ?, status = 'disconnected',
                last_error = NULL, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(organizationId, item.id);
        item = await this.refreshEntitlement(this.get(tenantId));
        if (!this.hasEntitlement(item)) {
            throw new SavanaIntegrationError(
                'The subscription does not include Wa Savana POS integration',
                402,
                'entitlement_required'
            );
        }

        try {
            try {
                await this.requestJson('connect', 'POST', '/v1/organizations', {
                    organization_id: organizationId,
                    name: `Wa Savana — ${tenant.name}`,
                });
            } catch (error) {
                if (error.remoteStatus !== 409) throw error;
            }
            const local = await this.requestJson('connect', 'POST', '/v1/platform-tenants', {
                organization_id: organizationId,
                platform_code: 'wa_savana',
                external_tenant_id: `wa_savana:tenant:${tenant.id}`,
                display_name: tenant.name,
            });
            const remote = await this.requestJson('connect', 'POST', '/v1/platform-tenants', {
                organization_id: organizationId,
                platform_code: 'pos',
                external_tenant_id: remoteExternalTenantId,
                display_name: String(payload.pos_display_name || 'Savana POS'),
            });
            const connection = await this.requestJson('connect', 'POST', '/v1/connections', {
                organization_id: organizationId,
                source_tenant_id: local.id,
                target_tenant_id: remote.id,
                scopes: POS_SCOPES,
                source_callback_url: callbackUrl,
                target_callback_url: payload.pos_callback_url || null,
                actor_id: String(actorId || 'tenant'),
            });
            this.db.prepare(`
                UPDATE savana_integrations SET
                    local_platform_tenant_id = ?, remote_platform_tenant_id = ?,
                    remote_external_tenant_id = ?, connection_id = ?, status = ?,
                    scopes_json = ?, last_sync_at = ?, last_error = NULL,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                local.id,
                remote.id,
                remoteExternalTenantId,
                connection.id,
                connection.status,
                JSON.stringify(POS_SCOPES),
                nowIso(),
                item.id,
            );
        } catch (error) {
            this.db.prepare(`
                UPDATE savana_integrations SET status = 'error', last_error = ?,
                    updated_at = datetime('now', 'localtime') WHERE id = ?
            `).run(String(error.message).slice(0, 4000), item.id);
            throw error;
        }
        return this.get(tenantId);
    }

    async transition(item, action, actorId) {
        if (!item?.connection_id || !CONNECTION_ACTIONS.has(action)) {
            throw new SavanaIntegrationError('Unsupported connection action', 404, 'action_not_found');
        }
        const result = await this.requestJson(
            'connect', 'POST', `/v1/connections/${item.connection_id}/${action}`,
            { actor_id: String(actorId || 'tenant') }
        );
        this.db.prepare(`
            UPDATE savana_integrations SET status = ?, last_sync_at = ?, last_error = NULL,
                updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(result.status, nowIso(), item.id);
        return this.get(item.tenant_id, item.platform_code);
    }

    async refreshStatus(item) {
        if (!item?.connection_id) return item;
        const result = await this.requestJson(
            'connect', 'GET', `/v1/connections/${item.connection_id}`
        );
        this.db.prepare(`
            UPDATE savana_integrations SET status = ?, scopes_json = ?, last_sync_at = ?,
                last_error = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(result.status, JSON.stringify(result.scopes || []), nowIso(), item.id);
        return this.get(item.tenant_id, item.platform_code);
    }

    receiveEvent(connectionId, callbackToken, rawBody) {
        if (!safeCompare(this.config.callbackToken, callbackToken)) {
            throw new SavanaIntegrationError(
                'Invalid Connect callback token', 401, 'invalid_callback_token'
            );
        }
        const item = this.db.prepare(`
            SELECT * FROM savana_integrations WHERE connection_id = ? AND status = 'active'
        `).get(String(connectionId || ''));
        if (!item) {
            throw new SavanaIntegrationError(
                'Active POS connection was not found', 404, 'connection_not_found'
            );
        }
        let envelope;
        try {
            envelope = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
        } catch {
            throw new SavanaIntegrationError('Invalid event JSON', 400, 'invalid_event_json');
        }
        if (envelope.organization_id !== item.organization_id) {
            throw new SavanaIntegrationError('Event organization mismatch', 403, 'event_scope_mismatch');
        }
        const eventId = requireUuid(envelope.event_id, 'event_id');
        const idempotencyKey = requiredString(envelope.idempotency_key, 'idempotency_key');
        const duplicate = this.db.prepare(`
            SELECT event_id FROM savana_integration_events
            WHERE event_id = ? OR idempotency_key = ?
        `).get(eventId, idempotencyKey);
        if (duplicate) return { accepted: true, duplicate: true, event_id: duplicate.event_id };

        const process = this.db.transaction(() => {
            const receipt = this.db.prepare(`
                INSERT INTO savana_integration_events (
                    integration_id, event_id, idempotency_key, event_type, payload_json
                ) VALUES (?, ?, ?, ?, ?)
            `).run(item.id, eventId, idempotencyKey, String(envelope.event_type || ''), JSON.stringify(envelope));
            this.applyEvent(item, envelope);
            this.db.prepare(`
                UPDATE savana_integration_events SET status = 'processed',
                    processed_at = datetime('now', 'localtime') WHERE id = ?
            `).run(receipt.lastInsertRowid);
            this.db.prepare(`
                UPDATE savana_integrations SET last_sync_at = ?, last_error = NULL,
                    updated_at = datetime('now', 'localtime') WHERE id = ?
            `).run(nowIso(), item.id);
        });
        process.immediate();
        return { accepted: true, duplicate: false, event_id: eventId };
    }

    applyEvent(item, envelope) {
        const data = envelope.data || {};
        switch (envelope.event_type) {
            case 'catalog.product_snapshot.v1':
                this.applyProductSnapshot(item.tenant_id, data);
                break;
            case 'pos.inventory_snapshot.v1':
                this.applyInventorySnapshot(item.tenant_id, data);
                break;
            case 'pos.retail_sale_completed.v1':
                this.applySale(item.tenant_id, data);
                break;
            case 'pos.retail_sale_returned.v1':
                this.applyReturn(item.tenant_id, data);
                break;
            default:
                throw new SavanaIntegrationError(
                    'Unsupported POS projection event', 422, 'unsupported_event'
                );
        }
    }

    productProjectionKey(row) {
        if (row.canonical_product_id) return `canonical:${row.canonical_product_id}`;
        if (row.barcode) return `barcode:${row.barcode}`;
        if (row.sku) return `sku:${row.sku}`;
        return `local:${requiredString(row.local_product_id, 'local_product_id')}`;
    }

    upsertProduct(tenantId, row, sourceUpdatedAt) {
        const projectionKey = this.productProjectionKey(row);
        this.db.prepare(`
            INSERT INTO savana_product_projection (
                tenant_id, projection_key, canonical_product_id, local_product_id,
                sku, barcode, name, description, price, currency, image_url,
                quantity_on_hand, quantity_available, unit_code, source_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, projection_key) DO UPDATE SET
                canonical_product_id = COALESCE(excluded.canonical_product_id, canonical_product_id),
                local_product_id = COALESCE(excluded.local_product_id, local_product_id),
                sku = COALESCE(excluded.sku, sku),
                barcode = COALESCE(excluded.barcode, barcode),
                name = COALESCE(excluded.name, name),
                description = COALESCE(excluded.description, description),
                price = COALESCE(excluded.price, price),
                currency = COALESCE(excluded.currency, currency),
                image_url = COALESCE(excluded.image_url, image_url),
                quantity_on_hand = COALESCE(excluded.quantity_on_hand, quantity_on_hand),
                quantity_available = COALESCE(excluded.quantity_available, quantity_available),
                unit_code = COALESCE(excluded.unit_code, unit_code),
                source_updated_at = excluded.source_updated_at,
                updated_at = datetime('now', 'localtime')
        `).run(
            tenantId, projectionKey, row.canonical_product_id || null,
            row.local_product_id || null, row.sku || null, row.barcode || null,
            row.name || null, row.description || null,
            row.online_price === undefined ? (row.price ?? null) : row.online_price,
            row.currency || null, row.image_url || null,
            row.quantity_on_hand ?? null, row.quantity_available ?? null,
            row.unit_code || row.base_unit || null, sourceUpdatedAt || nowIso(),
        );
    }

    applyProductSnapshot(tenantId, data) {
        for (const product of data.products || []) {
            const barcodes = product.barcodes || [];
            this.upsertProduct(tenantId, {
                ...product,
                barcode: product.barcode || barcodes[0] || null,
            }, data.generated_at);
        }
    }

    applyInventorySnapshot(tenantId, data) {
        for (const product of data.items || []) {
            this.upsertProduct(tenantId, product, data.captured_at);
        }
    }

    insertTransaction(tenantId, type, data) {
        const isSale = type === 'sale';
        const localId = requiredString(
            isSale ? data.local_sale_id : data.local_return_id,
            isSale ? 'local_sale_id' : 'local_return_id'
        );
        const customer = isSale ? (data.customer || {}) : {};
        this.db.prepare(`
            INSERT INTO savana_pos_transactions (
                tenant_id, transaction_type, local_transaction_id,
                original_local_sale_id, reference_number, branch_id, terminal_id,
                occurred_at, currency, total, customer_phone_e164,
                receipt_notification_consent, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, transaction_type, local_transaction_id) DO NOTHING
        `).run(
            tenantId, type, localId, data.original_local_sale_id || null,
            data.sale_number || null, data.branch_id || null, data.terminal_id || null,
            requiredString(isSale ? data.sold_at : data.returned_at, 'occurred_at'),
            data.currency || null, data.total ?? null, customer.phone_e164 || null,
            customer.receipt_notification_consent === true ? 1 : 0,
            JSON.stringify(data),
        );
        return this.db.prepare(`
            SELECT * FROM savana_pos_transactions
            WHERE tenant_id = ? AND transaction_type = ? AND local_transaction_id = ?
        `).get(tenantId, type, localId);
    }

    applySale(tenantId, data) {
        for (const product of data.items || []) this.upsertProduct(tenantId, product, data.sold_at);
        const transaction = this.insertTransaction(tenantId, 'sale', data);
        if (transaction.customer_phone_e164 && transaction.receipt_notification_consent === 1) {
            this.insertNotificationCandidate(tenantId, transaction, 'pos_receipt');
        }
    }

    applyReturn(tenantId, data) {
        const transaction = this.insertTransaction(tenantId, 'return', data);
        const sale = this.db.prepare(`
            SELECT customer_phone_e164, receipt_notification_consent
            FROM savana_pos_transactions
            WHERE tenant_id = ? AND transaction_type = 'sale' AND local_transaction_id = ?
        `).get(tenantId, data.original_local_sale_id);
        if (sale?.customer_phone_e164 && sale.receipt_notification_consent === 1) {
            transaction.customer_phone_e164 = sale.customer_phone_e164;
            this.insertNotificationCandidate(tenantId, transaction, 'pos_return');
        }
    }

    insertNotificationCandidate(tenantId, transaction, kind) {
        this.db.prepare(`
            INSERT INTO savana_notification_candidates (
                tenant_id, transaction_id, kind, recipient_phone_e164, payload_json
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(transaction_id, kind) DO NOTHING
        `).run(
            tenantId,
            transaction.id,
            kind,
            transaction.customer_phone_e164,
            transaction.payload_json,
        );
    }

    diagnostics(item) {
        if (!item) return { integration: this.serialize(null), events: [], counts: {} };
        const events = this.db.prepare(`
            SELECT event_id, event_type, status, received_at
            FROM savana_integration_events WHERE integration_id = ?
            ORDER BY id DESC LIMIT 20
        `).all(item.id);
        const products = this.db.prepare(
            'SELECT COUNT(*) AS count FROM savana_product_projection WHERE tenant_id = ?'
        ).get(item.tenant_id).count;
        const transactions = this.db.prepare(
            'SELECT COUNT(*) AS count FROM savana_pos_transactions WHERE tenant_id = ?'
        ).get(item.tenant_id).count;
        const notifications = this.db.prepare(`
            SELECT COUNT(*) AS count FROM savana_notification_candidates
            WHERE tenant_id = ? AND status = 'pending_review'
        `).get(item.tenant_id).count;
        return {
            integration: this.serialize(item),
            events,
            counts: { products, transactions, pending_notification_candidates: notifications },
        };
    }

    serialize(item) {
        if (!item) {
            return {
                platform_code: 'pos',
                status: 'disconnected',
                scopes: POS_SCOPES,
                independent_mode: true,
                pos_entitled: false,
            };
        }
        return {
            platform_code: item.platform_code,
            organization_id: item.organization_id,
            connection_id: item.connection_id,
            status: item.status,
            scopes: parseJson(item.scopes_json, []),
            remote_external_tenant_id: item.remote_external_tenant_id,
            pos_entitled: this.hasEntitlement(item),
            entitlement_valid_until: item.entitlement_valid_until,
            last_sync_at: item.last_sync_at,
            last_error: item.last_error,
            independent_mode: true,
        };
    }
}
