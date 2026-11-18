import crypto from 'node:crypto';

export class SharedProductReadError extends Error {
    constructor(code, status = 503) {
        super(code);
        this.code = code;
        this.status = status;
    }
}
const fail = (code, status) => { throw new SharedProductReadError(code, status); };
const text = value => typeof value === 'string' && value.length > 0;
const scopeKeys = ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'];
const sameScope = (a, b) => scopeKeys.every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const publicObject = (value, keys) => {
    if (!value || Array.isArray(value) || typeof value !== 'object'
        || Object.keys(value).some(key => !keys.includes(key))) fail('shared_product_response_invalid', 502);
};
const availabilityStates = new Set(['available', 'review_available', 'implementation_missing', 'not_supported',
    'configuration_required', 'subscription_required', 'permission_required', 'resource_scope_required',
    'provider_selection_required', 'connection_required', 'connection_pending', 'connection_paused', 'connection_revoked',
    'approval_required', 'consent_required', 'balance_required', 'quote_required', 'offline', 'authorization_stale',
    'outcome_unknown', 'provider_unavailable']);
const checkAvailability = value => {
    if (value === undefined) return;
    publicObject(value, ['state', 'reason_code', 'message', 'next_action']);
    publicObject(value.next_action, ['code', 'label', 'href']);
    if (!availabilityStates.has(value.state) || ![value.reason_code, value.message,
        value.next_action.code, value.next_action.label, value.next_action.href].every(text)) fail('shared_product_response_invalid', 502);
};
const keyFor = principal => JSON.stringify([
    String(principal.userId), String(principal.tenantId), principal.sessionId, principal.authVersion,
]);

export const localReadPrincipal = user => ({
    userId: user?.id, tenantId: user?.tenant_id, sessionId: user?.jti,
    authVersion: user?.auth_version, issuedAt: user?.iat, role: user?.role,
    sessionExpiresAt: user?.exp,
});
const validPrincipal = principal => principal?.userId != null && principal?.tenantId != null
    && text(principal.sessionId) && safeInteger(principal.authVersion);

export const validateDelegatedReadBinding = (principal, credentials) => {
    if (!validPrincipal(principal) || !text(credentials?.accessToken)
        || !Number.isFinite(Date.parse(credentials.expiresAt))
        || !text(credentials.consumerInstallationId) || !text(credentials.consumerAccountId)
        || !text(credentials.centralActorId)
        || !text(credentials.scope?.organization_id) || !text(credentials.scope?.activity_id)
        || Object.keys(credentials.scope).some(key => !scopeKeys.includes(key))
        || (credentials.scope.warehouse_id && !credentials.scope.branch_id)) {
        fail('shared_product_binding_invalid', 403);
    }
};

// Server-only, session-scoped delegated credentials. The native setup verifies
// OIDC/PKCE, the server-derived account map and current central read authority
// before binding. No token reaches the browser or a background worker.
export class DelegatedReadBindings {
    #entries = new Map();
    bind(principal, credentials) {
        validateDelegatedReadBinding(principal, credentials);
        const entry = Object.freeze({ ...structuredClone(credentials), bindingId: crypto.randomUUID() });
        this.#entries.set(keyFor(principal), entry);
        return entry.bindingId;
    }
    load(principal) { return validPrincipal(principal) ? this.#entries.get(keyFor(principal)) : null; }
    current(principal, entry) { return this.load(principal) === entry; }
    revoke(principal) { this.#entries.delete(keyFor(principal)); }
}

// Recheck the real local identity/session after asynchronous central requests.
// This module does not import the application's singleton database or secrets.
export const createSqliteReadPrincipalVerifier = database => principal => {
    if (!validPrincipal(principal) || !safeInteger(principal.sessionExpiresAt, 1)
        || principal.sessionExpiresAt * 1000 <= Date.now()) return false;
    const user = database.prepare(`SELECT id, tenant_id, role, is_active, auth_version, tokens_revoked_at
        FROM users WHERE id = ?`).get(principal.userId);
    const tenant = database.prepare('SELECT status FROM tenants WHERE id = ?').get(principal.tenantId);
    if (!user?.is_active || String(user.tenant_id) !== String(principal.tenantId)
        || user.auth_version !== principal.authVersion || user.role === 'admin'
        || user.role !== principal.role || !tenant || ['Pending', 'Rejected', 'Suspended'].includes(tenant.status)) return false;
    if (database.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(principal.sessionId)) return false;
    if (user.tokens_revoked_at && (!Number.isFinite(principal.issuedAt)
        || principal.issuedAt < Date.parse(user.tokens_revoked_at) / 1000)) return false;
    return true;
};

export const centralProductReadConfigFromEnv = (env = process.env) => ({
    enabled: ['1', 'true'].includes(String(env.SAVANA_SHARED_PRODUCT_READS_ENABLED || '').toLowerCase()),
    baseUrl: env.SAVANA_CONNECT_URL || 'http://savana-connect:8010',
    platformToken: env.SAVANA_CONNECT_PLATFORM_TOKEN || '',
});

const REMOTE_CODES = new Set([
    'invalid_token', 'platform_auth_required', 'integration_scope_forbidden',
    'integration_grant_required', 'integration_source_unavailable',
    'integration_authorization_changed', 'record_not_found', 'capability_not_found',
    'integration_cursor_invalid', 'integration_request_invalid',
    'integration_reads_disabled', 'integration_runtime_unavailable',
]);
const flags = Object.freeze({ enabled: true, read_only: true, execution_ready: false, pricing_use_allowed: false });

export class CentralProductReadService {
    constructor({ enabled = false, baseUrl = '', platformToken = '', fetchImpl = globalThis.fetch,
        trustedBindings = new DelegatedReadBindings(), verifyLocalPrincipal = () => false,
        now = () => Date.now(), timeoutMs = 5000, allowLoopback = false } = {}) {
        this.enabled = enabled === true;
        this.baseUrl = String(baseUrl).replace(/\/+$/, '');
        this.platformToken = platformToken;
        this.fetch = fetchImpl;
        this.bindings = trustedBindings;
        this.verifyLocalPrincipal = verifyLocalPrincipal;
        this.now = now;
        this.timeoutMs = timeoutMs;
        if (this.enabled) {
            const url = new URL(this.baseUrl);
            const privateService = url.protocol === 'http:' && url.hostname === 'savana-connect' && url.port === '8010';
            const ownedLoopback = allowLoopback === true && url.protocol === 'http:'
                && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
                || url.search || url.hash || url.pathname !== '/' || !text(platformToken)
                || !(url.protocol === 'https:' || privateService || ownedLoopback)) {
                throw new TypeError('Shared read service requires an explicit server-owned origin and platform credential');
            }
        }
    }

    #assertSession(principal, binding) {
        if (!this.enabled) fail('shared_product_reads_disabled', 503);
        if (!binding || Date.parse(binding.expiresAt) <= this.now()
            || !safeInteger(principal.sessionExpiresAt, 1) || principal.sessionExpiresAt * 1000 <= this.now()
            || !this.bindings.current(principal, binding) || this.verifyLocalPrincipal(principal) !== true) {
            fail('shared_product_read_session_required', 403);
        }
    }

    async #request(principal, binding, method, pathname, query = {}, body) {
        this.#assertSession(principal, binding);
        const url = new URL(`${this.baseUrl}${pathname}`);
        Object.entries(query).filter(([, value]) => value != null).forEach(([key, value]) => url.searchParams.set(key, String(value)));
        let response;
        let payload;
        try {
            response = await this.fetch(url.href, {
                method, redirect: 'error', cache: 'no-store',
                headers: {
                    Authorization: `Bearer ${binding.accessToken}`,
                    'X-Savana-Platform-Code': 'wa_savana',
                    'X-Savana-Platform-Token': this.platformToken,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            const raw = await response.text();
            if (raw.length > 2_000_000) fail('shared_product_response_invalid', 502);
            payload = JSON.parse(raw);
        } catch (error) {
            this.#assertSession(principal, binding);
            if (error instanceof SharedProductReadError) throw error;
            fail('shared_product_verification_unavailable', 503);
        }
        this.#assertSession(principal, binding);
        if (!response.ok) {
            const code = REMOTE_CODES.has(payload?.error?.code) ? payload.error.code : 'shared_product_verification_unavailable';
            fail(code, [401, 403, 404, 409, 422, 503].includes(response.status) ? response.status : 503);
        }
        if (!response.headers.get('cache-control')?.includes('no-store') || payload?.spec_version !== '1.0') {
            fail('shared_product_response_invalid', 502);
        }
        return payload;
    }

    #query(binding) {
        return { ...binding.scope, consumer_installation_id: binding.consumerInstallationId };
    }
    #context(context, binding, previous = null) {
        publicObject(context, ['scope', 'actor_id', 'consumer_platform', 'consumer_account_id',
            'consumer_installation_id', 'checked_at', 'valid_until', 'authorization_revision',
            'permissions', 'freshness_max_age_seconds']);
        publicObject(context.scope, scopeKeys);
        if (!context || !sameScope(context.scope, binding.scope)
            || context.consumer_platform !== 'wa_savana'
            || context.consumer_account_id !== binding.consumerAccountId
            || context.consumer_installation_id !== binding.consumerInstallationId
            || context.actor_id !== binding.centralActorId
            || !/^[a-f0-9]{64}$/.test(context.authorization_revision)
            || !Number.isFinite(Date.parse(context.checked_at))
            || !(Date.parse(context.valid_until) > this.now())
            || !Array.isArray(context.permissions) || !context.permissions.includes('data.read')) {
            fail('shared_product_response_scope_invalid', 403);
        }
        if (previous && previous.authorization_revision !== context.authorization_revision) {
            fail('integration_authorization_changed', 403);
        }
    }

    async #prepare(principal) {
        if (!this.enabled) fail('shared_product_reads_disabled', 503);
        const binding = this.bindings.load(principal);
        this.#assertSession(principal, binding);
        const result = await this.#request(principal, binding, 'GET', '/v1/integration/context', this.#query(binding));
        publicObject(result, ['spec_version', 'context']);
        this.#context(result.context, binding);
        const catalogue = await this.#request(principal, binding, 'GET', '/v1/integration/capabilities');
        if (!catalogue.platforms?.includes('pos') || !catalogue.platforms.includes('wa_savana')
            || !catalogue.capabilities?.some(item => item.code === 'products.read')) {
            fail('shared_product_response_invalid', 502);
        }
        const eligibility = await this.#request(principal, binding, 'POST', '/v1/integration/eligibility', {}, {
            scope: binding.scope, consumer_installation_id: binding.consumerInstallationId,
            capability_code: 'products.read',
        });
        publicObject(eligibility, ['spec_version', 'capability_code', 'scope', 'actor_id', 'consumer_platform',
            'checked_at', 'view_requirements', 'request_review', 'execute', 'selected_platform',
            'selected_account_id', 'selected_installation_id', 'eligible_providers',
            'provider_evaluations', 'blockers', 'next_action', 'authorization_token', 'availability']);
        checkAvailability(eligibility.availability);
        publicObject(eligibility.scope, scopeKeys);
        for (const blocker of eligibility.blockers || []) publicObject(blocker, ['code', 'message', 'blocks', 'next_action']);
        for (const provider of [...(eligibility.provider_evaluations || []), ...(eligibility.eligible_providers || [])]) {
            publicObject(provider, ['platform', 'account_id', 'installation_id', 'authorization_revision', 'can_request_review', 'can_execute', 'blockers', 'availability']);
            checkAvailability(provider.availability);
            for (const blocker of provider.blockers || []) publicObject(blocker, ['code', 'message', 'blocks', 'next_action']);
        }
        if (eligibility.consumer_platform !== 'wa_savana' || eligibility.actor_id !== binding.centralActorId
            || !sameScope(eligibility.scope, binding.scope) || eligibility.capability_code !== 'products.read'
            || eligibility.authorization_token !== false) fail('shared_product_response_scope_invalid', 403);
        // Business execution eligibility is advisory and does not authorize or
        // prohibit a data.read operation that the data endpoint checks itself.
        return { binding, context: result.context, eligibility };
    }

    #record(record, binding) {
        publicObject(record, ['scope', 'entity_id', 'entity_type', 'domain', 'source', 'ownership_epoch',
            'expected_version', 'source_revision', 'observed_at', 'state', 'data', 'version',
            'received_at', 'freshness', 'field_visibility']);
        publicObject(record.scope, scopeKeys);
        publicObject(record.source, ['installation_id', 'entity_type', 'local_entity_id']);
        if (!record || !sameScope(record.scope, binding.scope)
            || record.entity_type !== 'product' || record.domain !== 'product.core'
            || !text(record.entity_id) || record.entity_id.length > 255
            || !text(record.source?.installation_id) || !text(record.source.local_entity_id)
            || !text(record.source.entity_type) || record.source.entity_type.length > 80
            || !safeInteger(record.version, 1) || !safeInteger(record.ownership_epoch, 1)
            || !safeInteger(record.expected_version)
            || !['active', 'archived', 'tombstone'].includes(record.state)
            || !['current', 'stale', 'clock_ahead'].includes(record.freshness)
            || !Number.isFinite(Date.parse(record.observed_at)) || !Number.isFinite(Date.parse(record.received_at))
            || record.field_visibility !== 'explicit_grants_only'
            || !record.data || Array.isArray(record.data) || typeof record.data !== 'object') {
            fail('shared_product_response_invalid', 502);
        }
        return record;
    }
    #finish(principal, prepared, result, keys) {
        publicObject(result, keys);
        this.#context(result.context, prepared.binding, prepared.context);
        this.#assertSession(principal, prepared.binding);
        return { ...result, ...flags, eligibility: prepared.eligibility };
    }

    async readiness(principal) {
        const prepared = await this.#prepare(principal);
        this.#assertSession(principal, prepared.binding);
        return { ...flags, context: prepared.context, eligibility: prepared.eligibility };
    }

    async search(principal, { q = '', limit = 50, cursor = null } = {}) {
        if (typeof q !== 'string' || q.length > 255 || !safeInteger(limit, 1) || limit > 100
            || (cursor != null && (!text(cursor) || cursor.length > 16384))) fail('integration_request_invalid', 422);
        const prepared = await this.#prepare(principal);
        const result = await this.#request(principal, prepared.binding, 'GET', '/v1/integration/data/search', {
            ...this.#query(prepared.binding), q, limit, ...(cursor == null ? {} : { cursor }),
        });
        if (!Array.isArray(result.records) || result.records.length > limit || typeof result.has_more !== 'boolean'
            || !(result.next_cursor === null || text(result.next_cursor))
            || (result.has_more && !text(result.next_cursor))) fail('shared_product_response_invalid', 502);
        result.records = result.records.filter(record => record.entity_type === 'product' && record.domain === 'product.core')
            .map(record => this.#record(record, prepared.binding));
        if (result.records.some(record => record.state !== 'active')) fail('shared_product_response_invalid', 502);
        return this.#finish(principal, prepared, result, ['spec_version', 'context', 'records', 'has_more', 'next_cursor']);
    }

    async changes(principal, { after = 0, limit = 50 } = {}) {
        if (!safeInteger(after) || !safeInteger(limit, 1) || limit > 100) fail('integration_request_invalid', 422);
        const prepared = await this.#prepare(principal);
        const result = await this.#request(principal, prepared.binding, 'GET', '/v1/integration/data/changes', {
            ...this.#query(prepared.binding), after, limit,
        });
        if (!Array.isArray(result.changes) || result.changes.length > limit || !safeInteger(result.cursor)
            || result.cursor < after || typeof result.has_more !== 'boolean') fail('shared_product_response_invalid', 502);
        let previousCursor = after;
        for (const change of result.changes) {
            if (!safeInteger(change.cursor, 1) || change.cursor <= previousCursor || change.cursor > result.cursor) fail('shared_product_response_invalid', 502);
            previousCursor = change.cursor;
        }
        result.changes = result.changes.filter(change => change.record?.entity_type === 'product' && change.record.domain === 'product.core')
            .map(change => ({ cursor: change.cursor, record: this.#record(change.record, prepared.binding) }));
        // Observations only: returned cursor is unaltered; no projection/inbox,
        // legacy identity merge, source publication or external effect occurs.
        return this.#finish(principal, prepared, result, ['spec_version', 'context', 'changes', 'cursor', 'has_more']);
    }

    async record(principal, { entityId, domain = 'product.core' } = {}) {
        if (!text(entityId) || entityId.length > 255 || ['.', '..'].includes(entityId)
            || domain !== 'product.core') fail('integration_request_invalid', 422);
        const prepared = await this.#prepare(principal);
        const result = await this.#request(principal, prepared.binding, 'GET',
            `/v1/integration/data/records/product/${encodeURIComponent(entityId)}`,
            { ...this.#query(prepared.binding), domain });
        this.#record(result.record, prepared.binding);
        if (result.record.entity_id !== entityId) fail('shared_product_response_invalid', 502);
        return this.#finish(principal, prepared, result, ['spec_version', 'context', 'record']);
    }
}
