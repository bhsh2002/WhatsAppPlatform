import crypto from 'node:crypto';

export const POS_SCOPES = Object.freeze([
    'pos.products.map',
    'pos.inventory.snapshot',
    'pos.sales.events',
    'pos.returns.events',
    'pos.customers.reference',
]);

export const INTEGRATION_PROFILES = Object.freeze({
    pos: Object.freeze({ displayName: 'Savana POS', scopes: POS_SCOPES }),
    catalog: Object.freeze({
        displayName: 'Catalog',
        scopes: Object.freeze([
            'catalog.products.projection',
            'catalog.orders.events',
            'catalog.customers.reference',
            'wa_savana.products.receive',
            'wa_savana.contacts.reference',
            'wa_savana.notifications.send',
            'wa_savana.delivery_status.events',
            'wa_savana.campaigns.send',
        ]),
    }),
    sawemly: Object.freeze({
        displayName: 'Sawemly',
        scopes: Object.freeze([
            'sawemly.shelves.projection',
            'sawemly.availability.events',
            'wa_savana.products.receive',
            'wa_savana.notifications.send',
            'wa_savana.delivery_status.events',
            'wa_savana.campaigns.send',
        ]),
    }),
});

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
    connectPlatformToken: env.SAVANA_CONNECT_PLATFORM_TOKEN || '',
    callbackUrl: env.SAVANA_CONNECT_CALLBACK_URL || '',
    callbackToken: env.SAVANA_CONNECT_CALLBACK_TOKEN || '',
    subscriptionsUrl: String(env.SAVANA_SUBSCRIPTIONS_URL || 'http://savana-subscriptions:8020').replace(/\/+$/, ''),
    subscriptionsPlatformToken: env.SAVANA_SUBSCRIPTIONS_PLATFORM_TOKEN || '',
    subscriptionsSigningSecret: env.SAVANA_SUBSCRIPTIONS_SIGNING_SECRET || '',
    subscriptionsMode: String(env.SAVANA_SUBSCRIPTIONS_MODE || 'local').trim().toLowerCase(),
    timeoutMs: Math.max(500, Number(env.SAVANA_CONTROL_PLANE_TIMEOUT_MS || 10_000)),
});

export const validateIntegrationConfig = (config, env = process.env) => {
    if (!config.enabled) return;
    const missing = [
        ['SAVANA_CONNECT_CALLBACK_URL', config.callbackUrl],
        ['SAVANA_CONNECT_CALLBACK_TOKEN', config.callbackToken],
        ['SAVANA_CONNECT_PLATFORM_TOKEN', config.connectPlatformToken],
        ['SAVANA_SUBSCRIPTIONS_PLATFORM_TOKEN', config.subscriptionsPlatformToken],
        ['SAVANA_SUBSCRIPTIONS_SIGNING_SECRET', config.subscriptionsSigningSecret],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        throw new Error(`Missing Savana integration settings: ${missing.join(', ')}`);
    }
    if (
        String(config.connectPlatformToken).length < 32
        || String(config.callbackToken).length < 32
    ) {
        throw new Error(
            'Savana Connect platform and callback tokens must be at least 32 characters'
        );
    }
    if (safeCompare(config.connectPlatformToken, config.callbackToken)) {
        throw new Error(
            'SAVANA_CONNECT_PLATFORM_TOKEN must differ from SAVANA_CONNECT_CALLBACK_TOKEN'
        );
    }

    let callbackUrl;
    try {
        callbackUrl = new URL(config.callbackUrl);
    } catch {
        throw new Error('SAVANA_CONNECT_CALLBACK_URL must be a valid absolute URL');
    }

    const isPrivateDockerCallback = (
        callbackUrl.protocol === 'http:'
        && callbackUrl.hostname === 'wa-savana-server'
        && callbackUrl.port === '3031'
    );
    if (env.NODE_ENV === 'production' && callbackUrl.protocol !== 'https:' && !isPrivateDockerCallback) {
        throw new Error(
            'SAVANA_CONNECT_CALLBACK_URL must use HTTPS in production '
            + 'unless it targets the private wa-savana-server:3031 Docker service'
        );
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

const connectionSecretKey = config => crypto.createHash('sha256')
    .update(String(config.subscriptionsSigningSecret || ''))
    .digest();

const encryptConnectionSecret = (config, plaintext) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', connectionSecretKey(config), iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
};

const decryptConnectionSecret = (config, encoded) => {
    const value = Buffer.from(String(encoded || ''), 'base64');
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm', connectionSecretKey(config), value.subarray(0, 12)
    );
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
};

const signWebhook = (secret, timestamp, deliveryId, body) => `v1=${crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([
        Buffer.from(timestamp), Buffer.from('.'), Buffer.from(deliveryId), Buffer.from('.'), body,
    ]))
    .digest('hex')}`;

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

    list(tenantId) {
        return this.db.prepare(`
            SELECT * FROM savana_integrations WHERE tenant_id = ? ORDER BY platform_code
        `).all(tenantId);
    }

    availablePlatforms() {
        return Object.keys(INTEGRATION_PROFILES);
    }

    async bindingContext(tenantId) {
        const tenant = this.db.prepare(
            'SELECT id, name FROM tenants WHERE id = ?'
        ).get(tenantId);
        if (!tenant) {
            throw new SavanaIntegrationError(
                'Tenant was not found', 404, 'tenant_not_found'
            );
        }
        const externalTenantId = `wa_savana:tenant:${tenant.id}`;
        const bindings = await this.requestJson(
            'connect',
            'GET',
            `/v1/platform-bindings?external_tenant_id=${encodeURIComponent(externalTenantId)}`
        );
        return {
            bound: bindings.length > 0,
            binding: bindings[0] || null,
            external_tenant_id: externalTenantId,
        };
    }

    async redeemBinding(tenantId, invitationCode, actorId) {
        const tenant = this.db.prepare(
            'SELECT id, name FROM tenants WHERE id = ?'
        ).get(tenantId);
        if (!tenant) {
            throw new SavanaIntegrationError(
                'Tenant was not found', 404, 'tenant_not_found'
            );
        }
        return this.requestJson(
            'connect',
            'POST',
            '/v1/platform-bindings/redeem',
            {
                invitation_code: requiredString(
                    invitationCode, 'invitation_code'
                ),
                external_tenant_id: `wa_savana:tenant:${tenant.id}`,
                display_name: tenant.name,
                actor_id: String(actorId || 'tenant'),
            },
        );
    }

    async startBindingAuthorization(
        tenantId, redirectUri, state, actorId
    ) {
        const tenant = this.db.prepare(
            'SELECT id, name FROM tenants WHERE id = ?'
        ).get(tenantId);
        if (!tenant) {
            throw new SavanaIntegrationError(
                'Tenant was not found', 404, 'tenant_not_found'
            );
        }
        return this.requestJson(
            'connect',
            'POST',
            '/v1/platform-authorizations',
            {
                external_tenant_id: `wa_savana:tenant:${tenant.id}`,
                display_name: tenant.name,
                redirect_uri: requiredString(redirectUri, 'redirect_uri'),
                state: requiredString(state, 'state'),
                actor_id: String(actorId || 'tenant'),
            },
        );
    }

    async incomingConnections(tenantId) {
        const tenant = this.db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            throw new SavanaIntegrationError(
                'Tenant was not found', 404, 'tenant_not_found'
            );
        }
        try {
            return await this.requestJson(
                'connect',
                'GET',
                '/v1/platform-connections/incoming?external_tenant_id='
                + encodeURIComponent(`wa_savana:tenant:${tenant.id}`)
            );
        } catch (error) {
            if (error.remoteStatus === 404) return [];
            throw error;
        }
    }

    async decideIncomingConnection(
        tenantId, connectionId, decision, actorId
    ) {
        if (!['approve', 'reject'].includes(decision)) {
            throw new SavanaIntegrationError(
                'Unsupported connection decision', 404, 'decision_not_found'
            );
        }
        const result = await this.requestJson(
            'connect',
            'POST',
            `/v1/platform-connections/${encodeURIComponent(connectionId)}/${decision}`,
            {
                target_external_tenant_id: `wa_savana:tenant:${tenantId}`,
                actor_id: String(actorId || 'tenant'),
            },
        );
        if (decision !== 'approve') return result;
        const connection = result.connection || {};
        const remotePlatform = connection.source_platform === 'wa_savana'
            ? connection.target_platform
            : connection.source_platform;
        return this.serialize(this.get(tenantId, remotePlatform), remotePlatform);
    }

    profile(platformCode) {
        const profile = INTEGRATION_PROFILES[platformCode];
        if (!profile) {
            throw new SavanaIntegrationError(
                'Wa Savana cannot connect to this platform', 422, 'unsupported_platform'
            );
        }
        return profile;
    }

    getOrCreate(tenantId, platformCode = 'pos') {
        const profile = this.profile(platformCode);
        this.db.prepare(`
            INSERT INTO savana_integrations (tenant_id, platform_code, scopes_json)
            VALUES (?, ?, ?)
            ON CONFLICT(tenant_id, platform_code) DO NOTHING
        `).run(tenantId, platformCode, JSON.stringify(profile.scopes));
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
                : {
                    'X-Savana-Platform-Code': 'wa_savana',
                    'X-Savana-Platform-Token': this.config.connectPlatformToken,
                }),
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
                String(detail),
                response.status >= 400 && response.status < 500 ? response.status : 502,
                body?.error?.code || 'control_plane_error'
            );
            error.remoteStatus = response.status;
            throw error;
        }
        return isSubscriptions ? body.data : body;
    }

    async subscriptionContext(tenantId) {
        if (!this.config.enabled || this.config.subscriptionsMode !== 'central') {
            return {
                managed_centrally: false,
                source: 'wa_savana',
                subscription_status: 'local',
            };
        }
        const tenant = this.db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            throw new SavanaIntegrationError('Tenant was not found', 404, 'tenant_not_found');
        }
        const externalTenantId = `wa_savana:tenant:${tenant.id}`;
        const tenants = await this.requestJson(
            'connect',
            'GET',
            `/v1/platform-bindings?external_tenant_id=${encodeURIComponent(externalTenantId)}`
        );
        if (tenants.length === 0) {
            return {
                source: 'savana_subscriptions',
                managed_centrally: true,
                bound: false,
                platform_code: 'wa_savana',
                subscription_status: 'unbound',
                subscriptions: [],
                active_items: [],
                plans: [],
                bundles: [],
                entitlement_snapshot: null,
                invoices: [],
                ui: {},
            };
        }
        if (tenants.length !== 1) {
            throw new SavanaIntegrationError(
                'External tenant resolves to multiple organizations',
                409,
                'central_subscription_conflict'
            );
        }
        const platformTenant = tenants[0];
        const context = await this.requestJson(
            'subscriptions',
            'GET',
            `/v1/organizations/${encodeURIComponent(platformTenant.organization_id)}`
            + '/subscription-context/wa_savana'
        );
        if (context.entitlement_snapshot) {
            this.verifyEntitlement(
                platformTenant.organization_id,
                context.entitlement_snapshot
            );
        }
        return {
            ...context,
            bound: true,
            platform_tenant: platformTenant,
        };
    }

    async subscriptionCheckout(tenantId, payload = {}, actorId = 'tenant') {
        const context = await this.subscriptionContext(tenantId);
        if (!context.managed_centrally || !context.bound || !context.organization?.id) {
            throw new SavanaIntegrationError(
                'The tenant is not linked to a central Savana organization',
                409,
                'central_subscription_unbound'
            );
        }

        const planId = String(payload.plan_id || '').trim();
        const bundleId = String(payload.bundle_id || '').trim();
        if (Boolean(planId) === Boolean(bundleId)) {
            throw new SavanaIntegrationError(
                'Choose exactly one central plan or bundle',
                400,
                'invalid_checkout_offer'
            );
        }

        let offer;
        if (planId) {
            const plan = context.plans?.find(item => item.id === planId);
            if (!plan) {
                throw new SavanaIntegrationError(
                    'The selected central plan is unavailable',
                    404,
                    'central_plan_not_found'
                );
            }
            const requestedPriceId = String(payload.price_id || '').trim();
            const price = requestedPriceId
                ? plan.prices?.find(item => item.id === requestedPriceId && item.active)
                : plan.prices?.find(item => item.active);
            if (!price) {
                throw new SavanaIntegrationError(
                    'The selected central plan has no active price',
                    409,
                    'central_price_unavailable'
                );
            }
            offer = {
                items: [{
                    plan_id: plan.id,
                    price_id: price.id,
                    quantity: 1,
                }],
            };
        } else {
            const bundle = context.bundles?.find(item => item.id === bundleId && item.active);
            if (!bundle) {
                throw new SavanaIntegrationError(
                    'The selected central bundle is unavailable',
                    404,
                    'central_bundle_not_found'
                );
            }
            offer = { bundle_id: bundle.id };
        }

        return this.requestJson(
            'subscriptions',
            'POST',
            `/v1/organizations/${encodeURIComponent(context.organization.id)}/checkout`,
            {
                platform_code: 'wa_savana',
                actor_id: String(actorId || 'tenant'),
                period_days: Math.min(366, Math.max(1, Number(payload.period_days || 30))),
                idempotency_key: String(
                    payload.idempotency_key || `wa-savana-checkout-${crypto.randomUUID()}`
                ),
                ...offer,
            }
        );
    }

    async synchronizeCentralSubscription(tenantId) {
        const context = await this.subscriptionContext(tenantId);
        if (!context.managed_centrally) return context;

        const activeItem = context.current_plan_item || context.active_items?.[0] || null;
        const centralPlan = context.current_plan || (
            activeItem
                ? context.plans.find(item => item.id === activeItem.plan_id)
                : null
        );
        const currentSubscription = context.current_subscription || (
            activeItem
                ? context.subscriptions.find(subscription =>
                    subscription.items.some(item => item.id === activeItem.id)
                )
                : null
        );
        const entitlements = context.entitlement_snapshot?.payload?.entitlements || {};
        const entitlementSnapshot = context.entitlement_snapshot || null;
        const includedCredits = Number(entitlements['wa_savana.credits.monthly'] || 0);
        const creditLimit = Number(entitlements['wa_savana.credit_limit.default'] || 0);
        const statusActive = ['active', 'trialing', 'past_due'].includes(
            context.subscription_status
        ) && Boolean(activeItem);

        const synchronize = this.db.transaction(() => {
            let planId = null;
            if (centralPlan) {
                const code = `savana_central_${centralPlan.id}`;
                const price = centralPlan.prices?.find(
                    item => item.billing_period === 'monthly' && item.active
                ) || centralPlan.prices?.find(item => item.active) || null;
                this.db.prepare(`
                    INSERT INTO billing_plans (
                        code, name, description, monthly_price_lyd,
                        monthly_included_credits, default_credit_limit, is_active,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now', 'localtime'))
                    ON CONFLICT(code) DO UPDATE SET
                        name = excluded.name,
                        description = excluded.description,
                        monthly_price_lyd = excluded.monthly_price_lyd,
                        monthly_included_credits = excluded.monthly_included_credits,
                        default_credit_limit = excluded.default_credit_limit,
                        is_active = 0,
                        updated_at = datetime('now', 'localtime')
                `).run(
                    code,
                    centralPlan.name,
                    centralPlan.description || 'مرآة اشتراك سافانا المركزي',
                    Number(price?.amount_minor || 0) / 100,
                    includedCredits,
                    creditLimit,
                );
                planId = this.db.prepare(
                    'SELECT id FROM billing_plans WHERE code = ?'
                ).get(code).id;
            }

            const existing = this.db.prepare(
                'SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?'
            ).get(tenantId);
            const periodStart = currentSubscription?.current_period_start || null;
            const periodEnd = currentSubscription?.current_period_end || null;
            const periodChanged = !existing || existing.billing_cycle_start !== periodStart;
            this.db.prepare(`
                INSERT INTO tenant_billing_accounts (
                    tenant_id, plan_id, plan_balance_credits, credit_limit_credits,
                    billing_cycle_start, billing_cycle_end, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    plan_id = excluded.plan_id,
                    plan_balance_credits = CASE
                        WHEN tenant_billing_accounts.billing_cycle_start IS NOT excluded.billing_cycle_start
                        THEN excluded.plan_balance_credits
                        ELSE tenant_billing_accounts.plan_balance_credits
                    END,
                    credit_limit_credits = excluded.credit_limit_credits,
                    billing_cycle_start = excluded.billing_cycle_start,
                    billing_cycle_end = excluded.billing_cycle_end,
                    status = excluded.status,
                    updated_at = datetime('now', 'localtime')
            `).run(
                tenantId,
                planId,
                periodChanged ? includedCredits : existing?.plan_balance_credits || 0,
                creditLimit,
                periodStart,
                periodEnd,
                statusActive ? 'active' : 'suspended',
            );

            if (
                context.bound
                && context.organization?.id
                && entitlementSnapshot?.payload
                && entitlementSnapshot?.signature
            ) {
                this.db.prepare(`
                    UPDATE savana_integrations SET
                        entitlement_payload_json = ?,
                        entitlement_signature = ?,
                        entitlement_valid_until = ?,
                        last_sync_at = ?,
                        last_error = NULL,
                        updated_at = datetime('now', 'localtime')
                    WHERE tenant_id = ? AND organization_id = ?
                `).run(
                    JSON.stringify(entitlementSnapshot.payload),
                    entitlementSnapshot.signature,
                    entitlementSnapshot.payload.valid_until,
                    nowIso(),
                    tenantId,
                    context.organization.id,
                );
            }

            const accountCanActivate = ['active', 'trialing'].includes(
                context.subscription_status
            ) && Boolean(activeItem);
            if (accountCanActivate) {
                const activation = this.db.prepare(`
                    UPDATE tenants
                    SET status = 'Active', updated_at = datetime('now', 'localtime')
                    WHERE id = ? AND status = 'Pending'
                `).run(tenantId);
                if (activation.changes > 0) {
                    this.db.prepare(`
                        UPDATE users
                        SET is_active = 1, updated_at = datetime('now', 'localtime')
                        WHERE tenant_id = ?
                    `).run(tenantId);
                    this.db.prepare(`
                        INSERT INTO activity_logs (
                            tenant_id, tenant_name, event_type, description, status
                        )
                        SELECT id, name, 'central_subscription_activated',
                            'تم تفعيل الحساب تلقائياً بعد تفعيل الاشتراك المركزي',
                            'success'
                        FROM tenants WHERE id = ?
                    `).run(tenantId);
                }
            }
        });
        synchronize.immediate();
        return {
            ...context,
            active_plan: centralPlan,
        };
    }

    async synchronizeAllCentralSubscriptions() {
        if (!this.config.enabled || this.config.subscriptionsMode !== 'central') return [];
        const results = [];
        for (const tenant of this.db.prepare('SELECT id FROM tenants ORDER BY id').all()) {
            try {
                results.push(await this.synchronizeCentralSubscription(tenant.id));
            } catch (error) {
                console.error(
                    `[SavanaSubscriptions] Failed to synchronize tenant ${tenant.id}:`,
                    error.message
                );
            }
        }
        return results;
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
        const key = `wa_savana.integration.${item.platform_code}.enabled`;
        return entitlements[key] === true
            || entitlements[key.replace('.integration.', '.integrations.')] === true;
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

    async requestConnection(tenantId, payload, actorId, platformCode = 'pos') {
        if (!this.config.enabled) {
            throw new SavanaIntegrationError(
                'Savana integrations are disabled', 503, 'integrations_disabled'
            );
        }
        const tenant = this.db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) throw new SavanaIntegrationError('Tenant was not found', 404, 'tenant_not_found');
        const profile = this.profile(platformCode);
        let item = this.getOrCreate(tenantId, platformCode);
        if (
            item.connection_id
            && !['disconnected', 'revoked', 'error'].includes(item.status)
        ) {
            throw new SavanaIntegrationError('Platform connection already exists', 409, 'connection_exists');
        }
        if (String(payload?.organization_id || '').trim()) {
            throw new SavanaIntegrationError(
                'Use an organization invitation and select the target account; the legacy flow is disabled',
                410,
                'legacy_connection_flow_disabled'
            );
        }
        return this.requestOneClickConnection(
            tenant,
            item,
            actorId,
            platformCode,
            profile,
            payload || {},
        );
    }

    async connectionCandidates(tenantId, targetPlatformCode) {
        this.profile(targetPlatformCode);
        const tenant = this.db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            throw new SavanaIntegrationError('Tenant was not found', 404, 'tenant_not_found');
        }
        const externalTenantId = `wa_savana:tenant:${tenant.id}`;
        const registrations = await this.requestJson(
            'connect',
            'GET',
            `/v1/platform-bindings?external_tenant_id=${encodeURIComponent(externalTenantId)}`
        );
        const organizations = [];
        if (registrations.length > 0) {
            organizations.push(await this.requestJson(
                'connect',
                'GET',
                `/v1/platform-connection-candidates?source_external_tenant_id=${encodeURIComponent(externalTenantId)}`
                + `&target_platform_code=${encodeURIComponent(targetPlatformCode)}`
            ));
        }
        return {
            source_external_tenant_id: externalTenantId,
            target_platform_code: targetPlatformCode,
            organizations,
        };
    }

    async requestOneClickConnection(tenant, item, actorId, platformCode, profile, payload = {}) {
        try {
            const discovery = await this.connectionCandidates(tenant.id, platformCode);
            if (discovery.organizations.length === 0) {
                throw new SavanaIntegrationError(
                    'Link this Wa Savana account to a central organization before connecting platforms',
                    409,
                    'central_tenant_unbound'
                );
            }
            const selectedSourceId = String(payload.source_tenant_id || '');
            let selected;
            if (selectedSourceId) {
                selected = discovery.organizations.find(
                    entry => entry.source_tenant.id === selectedSourceId
                );
                if (!selected) {
                    throw new SavanaIntegrationError(
                        'The selected Wa Savana account does not belong to this tenant',
                        403,
                        'source_tenant_mismatch'
                    );
                }
            } else if (discovery.organizations.length === 1) {
                [selected] = discovery.organizations;
            } else {
                throw new SavanaIntegrationError(
                    'Select the organization and target account before connecting',
                    409,
                    'organization_ambiguous'
                );
            }
            const platformTenant = selected.source_tenant;
            const organizationId = platformTenant.organization_id;
            this.db.prepare(`
                UPDATE savana_integrations SET organization_id = ?, status = 'disconnected',
                    last_error = NULL, updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(organizationId, item.id);
            item = await this.refreshEntitlement(this.get(tenant.id, platformCode));
            if (!this.hasEntitlement(item)) {
                throw new SavanaIntegrationError(
                    `The subscription does not include Wa Savana ${profile.displayName} integration`,
                    402,
                    'entitlement_required'
                );
            }

            const result = await this.requestJson(
                'connect',
                'POST',
                '/v1/platform-connections/requests',
                {
                    source_external_tenant_id: `wa_savana:tenant:${tenant.id}`,
                    target_tenant_id: payload.target_tenant_id || undefined,
                    actor_id: String(actorId || 'tenant'),
                },
            );
            const connection = result.connection;
            this.db.prepare(`
                UPDATE savana_integrations SET
                    organization_id = ?, local_platform_tenant_id = ?,
                    remote_platform_tenant_id = ?, remote_external_tenant_id = ?,
                    connection_id = ?, status = ?, scopes_json = ?,
                    webhook_secret_encrypted = ?, last_sync_at = ?,
                    last_error = NULL, updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                connection.organization_id,
                connection.source_tenant_id,
                connection.target_tenant_id,
                connection.target_external_tenant_id,
                connection.id,
                connection.status,
                JSON.stringify(connection.scopes || profile.scopes),
                null,
                nowIso(),
                item.id,
            );
            return this.get(tenant.id, platformCode);
        } catch (error) {
            this.db.prepare(`
                UPDATE savana_integrations SET status = 'error', last_error = ?,
                    updated_at = datetime('now', 'localtime') WHERE id = ?
            `).run(String(error.message).slice(0, 4000), item.id);
            throw error;
        }
    }

    async provisionConnection(payload, callbackToken) {
        if (!safeCompare(this.config.callbackToken, callbackToken)) {
            throw new SavanaIntegrationError(
                'Invalid Connect callback token',
                401,
                'invalid_callback_token'
            );
        }
        const connection = payload?.connection || {};
        if (
            connection.source_platform !== 'wa_savana'
            && connection.target_platform !== 'wa_savana'
        ) {
            throw new SavanaIntegrationError(
                'Wa Savana is not a participant in this connection',
                422,
                'invalid_connection_target'
            );
        }
        const localIsSource = connection.source_platform === 'wa_savana';
        const localSide = localIsSource ? 'source' : 'target';
        const remoteSide = localIsSource ? 'target' : 'source';
        const match = /^wa_savana:tenant:(\d+)$/.exec(
            String(connection[`${localSide}_external_tenant_id`] || '')
        );
        if (!match) {
            throw new SavanaIntegrationError(
                'Invalid Wa Savana target tenant identifier',
                422,
                'invalid_target_tenant'
            );
        }
        const tenantId = Number(match[1]);
        const tenant = this.db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            throw new SavanaIntegrationError('Tenant was not found', 404, 'tenant_not_found');
        }
        const remotePlatform = connection[`${remoteSide}_platform`];
        const profile = this.profile(remotePlatform);
        const secret = requiredString(payload.webhook_secret, 'webhook_secret');
        const connectionId = requiredString(connection.id, 'connection.id');
        let item = this.getOrCreate(tenantId, remotePlatform);
        if (
            item.connection_id
            && item.connection_id !== connectionId
            && !['disconnected', 'revoked', 'error'].includes(item.status)
        ) {
            throw new SavanaIntegrationError(
                'A different platform connection already exists',
                409,
                'connection_exists'
            );
        }

        this.db.prepare(`
            UPDATE savana_integrations SET
                organization_id = ?, local_platform_tenant_id = ?,
                remote_platform_tenant_id = ?, remote_external_tenant_id = ?,
                connection_id = ?, status = 'active', scopes_json = ?,
                webhook_secret_encrypted = ?, last_sync_at = ?,
                last_error = NULL, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(
            requiredString(connection.organization_id, 'connection.organization_id'),
            requiredString(
                connection[`${localSide}_tenant_id`],
                `connection.${localSide}_tenant_id`
            ),
            requiredString(
                connection[`${remoteSide}_tenant_id`],
                `connection.${remoteSide}_tenant_id`
            ),
            requiredString(
                connection[`${remoteSide}_external_tenant_id`],
                `connection.${remoteSide}_external_tenant_id`
            ),
            connectionId,
            JSON.stringify(connection.scopes || profile.scopes),
            encryptConnectionSecret(this.config, secret),
            nowIso(),
            item.id,
        );
        item = await this.refreshEntitlement(this.get(tenantId, remotePlatform));
        return item;
    }

    applyLifecycle(payload, callbackToken) {
        if (!safeCompare(this.config.callbackToken, callbackToken)) {
            throw new SavanaIntegrationError(
                'Invalid Connect callback token', 401, 'invalid_callback_token'
            );
        }
        const connection = payload?.connection || {};
        const item = this.db.prepare(
            'SELECT * FROM savana_integrations WHERE connection_id = ?'
        ).get(String(connection.id || ''));
        if (!item) {
            throw new SavanaIntegrationError(
                'Platform connection does not exist', 404, 'connection_not_found'
            );
        }
        const status = String(payload?.action || connection.status || '');
        if (!['active', 'paused', 'degraded', 'revoked'].includes(status)) {
            throw new SavanaIntegrationError(
                'Unsupported lifecycle status', 422, 'invalid_connection_state'
            );
        }
        this.db.prepare(`
            UPDATE savana_integrations SET status = ?, scopes_json = ?,
                webhook_secret_encrypted = CASE WHEN ? = 'revoked'
                    THEN NULL ELSE webhook_secret_encrypted END,
                last_error = NULL, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(
            status,
            JSON.stringify(connection.scopes || parseJson(item.scopes_json, [])),
            status,
            item.id,
        );
        return this.get(item.tenant_id, item.platform_code);
    }

    async transition(item, action, actorId) {
        if (!item?.connection_id || !CONNECTION_ACTIONS.has(action)) {
            throw new SavanaIntegrationError('Unsupported connection action', 404, 'action_not_found');
        }
        const result = await this.requestJson(
            'connect', 'POST', `/v1/platform-connections/${item.connection_id}/${action}`,
            {
                external_tenant_id: `wa_savana:tenant:${item.tenant_id}`,
                actor_id: String(actorId || 'tenant'),
            }
        );
        this.db.prepare(`
            UPDATE savana_integrations SET status = ?, last_sync_at = ?, last_error = NULL,
                webhook_secret_encrypted = CASE WHEN ? = 'revoke' THEN NULL ELSE webhook_secret_encrypted END,
                updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(result.status, nowIso(), action, item.id);
        return this.get(item.tenant_id, item.platform_code);
    }

    async refreshStatus(item) {
        if (!item?.connection_id) return item;
        const result = await this.requestJson(
            'connect',
            'GET',
            `/v1/platform-connections/${item.connection_id}`
            + `?external_tenant_id=${encodeURIComponent(`wa_savana:tenant:${item.tenant_id}`)}`
        );
        const localStatus = result.status === 'rejected' ? 'revoked' : result.status;
        this.db.prepare(`
            UPDATE savana_integrations SET status = ?, scopes_json = ?, last_sync_at = ?,
                webhook_secret_encrypted = CASE WHEN ? = 'revoked'
                    THEN NULL ELSE webhook_secret_encrypted END,
                last_error = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(
            localStatus,
            JSON.stringify(result.scopes || []),
            nowIso(),
            localStatus,
            item.id,
        );
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
                'Active platform connection was not found', 404, 'connection_not_found'
            );
        }
        let envelope;
        try {
            envelope = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
        } catch {
            throw new SavanaIntegrationError('Invalid event JSON', 400, 'invalid_event_json');
        }
        if (
            envelope.organization_id !== item.organization_id
            || envelope.source !== item.platform_code
        ) {
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
            case 'catalog.order_status_changed.v1':
                this.insertServiceRequest(item, envelope, 'order_notification');
                break;
            case 'catalog.customer_reference_updated.v1':
                this.insertServiceRequest(item, envelope, 'contact_reference');
                break;
            case 'sawemly.availability_changed.v1':
                this.applySawemlyAvailability(item.tenant_id, data);
                break;
            case 'sawemly.shelf_location_changed.v1':
                this.applySawemlyAvailability(item.tenant_id, { items: [data] });
                break;
            default:
                throw new SavanaIntegrationError(
                    'Unsupported POS projection event', 422, 'unsupported_event'
                );
        }
    }

    applySawemlyAvailability(tenantId, data) {
        for (const product of data.items || []) {
            this.upsertProduct(tenantId, {
                ...product,
                quantity_available: product.quantity_available ?? product.quantity ?? null,
                quantity_on_hand: product.quantity_on_hand ?? product.quantity ?? null,
            }, data.occurred_at || nowIso());
            if (product.shelf_code) {
                const key = this.productProjectionKey(product);
                this.db.prepare(`
                    UPDATE savana_product_projection SET shelf_code = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE tenant_id = ? AND projection_key = ?
                `).run(product.shelf_code, tenantId, key);
            }
        }
    }

    insertServiceRequest(item, envelope, kind) {
        this.db.prepare(`
            INSERT INTO savana_service_requests (
                tenant_id, integration_id, event_id, request_kind, request_key, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(integration_id, request_key) DO NOTHING
        `).run(
            item.tenant_id,
            item.id,
            envelope.event_id,
            kind,
            String(envelope.data?.request_id || envelope.data?.order_id || envelope.event_id),
            JSON.stringify(envelope.data || {}),
        );
    }

    async publishNotificationStatus(item, data) {
        if (!item?.connection_id || item.status !== 'active' || !item.webhook_secret_encrypted) {
            throw new SavanaIntegrationError('Platform connection is not active', 409, 'connection_inactive');
        }
        if (!this.hasEntitlement(item)) {
            throw new SavanaIntegrationError('Integration entitlement is unavailable', 402, 'entitlement_required');
        }
        const envelope = {
            spec_version: '1.0',
            event_id: crypto.randomUUID(),
            event_type: 'wa_savana.notification_status_changed.v1',
            source: 'wa_savana',
            organization_id: item.organization_id,
            platform_tenant_id: `wa_savana:tenant:${item.tenant_id}`,
            entity_id: null,
            entity_version: 1,
            occurred_at: nowIso(),
            idempotency_key: `wa_savana:notification:${requiredString(data.request_id, 'request_id')}:${data.status}`,
            correlation_id: crypto.randomUUID(),
            causation_id: data.causation_id || null,
            data,
        };
        const body = Buffer.from(canonicalJson(envelope));
        const timestamp = String(Math.floor(Date.now() / 1000));
        const deliveryId = crypto.randomUUID();
        const secret = decryptConnectionSecret(this.config, item.webhook_secret_encrypted);
        const response = await this.fetch(`${this.config.connectUrl}/v1/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Savana-Connection-Id': item.connection_id,
                'X-Savana-Delivery-Id': deliveryId,
                'X-Savana-Timestamp': timestamp,
                'X-Savana-Signature': signWebhook(secret, timestamp, deliveryId, body),
            },
            body,
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new SavanaIntegrationError(
                `connect returned ${response.status}`, 502, 'control_plane_error'
            );
        }
        return { event: envelope, receipt: result };
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
        this.synchronizeBotProduct(tenantId, projectionKey, row);
    }

    synchronizeBotProduct(tenantId, projectionKey, incoming) {
        const projection = this.db.prepare(`
            SELECT * FROM savana_product_projection
            WHERE tenant_id = ? AND projection_key = ?
        `).get(tenantId, projectionKey);
        if (!projection?.name) return;

        let product = this.db.prepare(`
            SELECT * FROM bot_products
            WHERE tenant_id = ? AND savana_projection_key = ?
        `).get(tenantId, projectionKey);
        if (!product && projection.sku) {
            product = this.db.prepare(`
                SELECT * FROM bot_products
                WHERE tenant_id = ? AND sku = ?
            `).get(tenantId, projection.sku);
        }
        const numericQuantity = Number(
            projection.quantity_available ?? projection.quantity_on_hand
        );
        const availability = Number.isFinite(numericQuantity) && numericQuantity <= 0
            ? 'out_of_stock'
            : 'available';
        const active = incoming.is_active === false
            ? 0
            : incoming.is_active === true
                ? 1
                : (product?.is_active ?? 1);
        if (product) {
            this.db.prepare(`
                UPDATE bot_products SET
                    savana_projection_key = ?,
                    sku = COALESCE(?, sku),
                    name = ?,
                    description = COALESCE(?, description),
                    price = COALESCE(?, price),
                    currency = COALESCE(?, currency),
                    image_url = COALESCE(?, image_url),
                    availability = ?,
                    is_active = ?,
                    approval_status = 'approved',
                    updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `).run(
                projectionKey,
                projection.sku,
                projection.name,
                projection.description,
                projection.price,
                projection.currency,
                projection.image_url,
                availability,
                active,
                product.id,
                tenantId,
            );
            return;
        }
        this.db.prepare(`
            INSERT INTO bot_products (
                tenant_id, savana_projection_key, sku, name, description,
                price, currency, image_url, availability, is_active,
                approval_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
        `).run(
            tenantId,
            projectionKey,
            projection.sku,
            projection.name,
            projection.description,
            projection.price || 0,
            projection.currency || 'LYD',
            projection.image_url,
            availability,
            active,
        );
    }

    applyProductSnapshot(tenantId, data) {
        const receivedKeys = new Set();
        for (const product of data.products || []) {
            const barcodes = product.barcodes || [];
            const normalized = {
                ...product,
                barcode: product.barcode || barcodes[0] || null,
            };
            receivedKeys.add(this.productProjectionKey(normalized));
            this.upsertProduct(tenantId, normalized, data.generated_at);
        }
        if (data.complete === true) {
            const imported = this.db.prepare(`
                SELECT id, savana_projection_key FROM bot_products
                WHERE tenant_id = ? AND savana_projection_key IS NOT NULL
            `).all(tenantId);
            const hide = this.db.prepare(`
                UPDATE bot_products SET is_active = 0, availability = 'hidden',
                    updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `);
            for (const product of imported) {
                if (!receivedKeys.has(product.savana_projection_key)) {
                    hide.run(product.id, tenantId);
                }
            }
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
        const serviceRequests = this.db.prepare(`
            SELECT COUNT(*) AS count FROM savana_service_requests
            WHERE integration_id = ? AND status = 'pending_review'
        `).get(item.id).count;
        return {
            integration: this.serialize(item),
            events,
            counts: {
                products,
                transactions,
                pending_notification_candidates: notifications,
                pending_service_requests: serviceRequests,
            },
        };
    }

    serialize(item, platformCode = 'pos') {
        if (!item) {
            const profile = this.profile(platformCode);
            return {
                platform_code: platformCode,
                status: 'disconnected',
                scopes: profile.scopes,
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
            entitled: this.hasEntitlement(item),
            pos_entitled: item.platform_code === 'pos' && this.hasEntitlement(item),
            entitlement_valid_until: item.entitlement_valid_until,
            last_sync_at: item.last_sync_at,
            last_error: item.last_error,
            independent_mode: true,
        };
    }
}
