import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { CentralProductReadService, DelegatedReadBindings, SharedProductReadError, createSqliteReadPrincipalVerifier } from './centralProductRead.js';
import { SqliteDelegatedReadBindings } from './delegatedReadSessionStore.js';
import { OperationalConsumerEnrollmentService } from './operationalConsumerEnrollment.js';
import { OperationalOwnerPortalService } from './operationalOwnerPortal.js';

const fail = (code, status = 503) => { throw new SharedProductReadError(code, status); };
const flags = { read_only: true, execution_ready: false, pricing_use_allowed: false };
const fingerprint = config => crypto.createHash('sha256').update(JSON.stringify([
    config.centerOrigin, config.oidcIssuer, config.oidcClientId, config.oidcRedirectUri,
    config.oidcAuthorizationEndpoint, config.oidcTokenEndpoint, config.oidcJwksUri, config.oidcUserInfoEndpoint,
])).digest('hex');
const validEndpoint = (value, config, sameCenter = true) => {
    const url = new URL(value);
    const center = new URL(config.centerOrigin);
    const ownedLoopback = config.allowLoopback === true && url.protocol === 'http:'
        && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    const privateService = url.protocol === 'http:' && url.hostname === 'savana-connect' && url.port === '8010';
    if (!(url.protocol === 'https:' || ownedLoopback || privateService)
        || url.username || url.password || url.search || url.hash
        || (sameCenter && url.origin !== center.origin)) throw new TypeError('Invalid server-owned OIDC endpoint');
    return url;
};

export const operationalReadConfigFromEnv = (env = process.env) => ({
    enabled: ['1', 'true'].includes(String(env.SAVANA_SHARED_READ_SETUP_ENABLED || '').toLowerCase()),
    sharedReadsEnabled: ['1', 'true'].includes(String(env.SAVANA_SHARED_PRODUCT_READS_ENABLED || '').toLowerCase()),
    ownerPortalEnabled: ['1', 'true'].includes(String(env.SAVANA_SHARED_READ_OWNER_PORTAL_ENABLED || '').toLowerCase()),
    ownerPortalOrigin: env.SAVANA_SHARED_READ_OWNER_PORTAL_ORIGIN || '',
    centerOrigin: env.SAVANA_CONNECT_URL || 'http://savana-connect:8010',
    platformToken: env.SAVANA_CONNECT_PLATFORM_TOKEN || '',
    oidcIssuer: env.SAVANA_SHARED_READ_OIDC_ISSUER || '',
    oidcClientId: env.SAVANA_SHARED_READ_OIDC_CLIENT_ID || '',
    oidcRedirectUri: env.SAVANA_SHARED_READ_OIDC_REDIRECT_URI || '',
    oidcAuthorizationEndpoint: env.SAVANA_SHARED_READ_OIDC_AUTHORIZATION_ENDPOINT || '',
    oidcTokenEndpoint: env.SAVANA_SHARED_READ_OIDC_TOKEN_ENDPOINT || '',
    oidcJwksUri: env.SAVANA_SHARED_READ_OIDC_JWKS_URI || '',
    oidcUserInfoEndpoint: env.SAVANA_SHARED_READ_OIDC_USERINFO_ENDPOINT || '',
});

export class OperationalReadSetupService {
    constructor({ database, config = {}, store, fetchImpl = globalThis.fetch,
        verifyLocalPrincipal = createSqliteReadPrincipalVerifier(database), now = () => Date.now(),
        readService = null, enrollmentService = null }) {
        this.config = config;
        this.db = database;
        this.store = store;
        this.fetch = fetchImpl;
        this.verify = verifyLocalPrincipal;
        this.now = now;
        this.readService = readService;
        this.enrollmentService = enrollmentService;
        this.endpoints = null;
        if (config.enabled === true) {
            const redirect = validEndpoint(config.oidcRedirectUri, { ...config, centerOrigin: config.oidcRedirectUri }, false);
            if (redirect.pathname !== '/api/portal/integrations/shared-read-setup/callback'
                || !config.oidcClientId || !config.oidcIssuer) throw new TypeError('Explicit OIDC application registration is required');
            this.appOrigin = redirect.origin;
            this.endpoints = {
                authorize: validEndpoint(config.oidcAuthorizationEndpoint, config, false),
                token: validEndpoint(config.oidcTokenEndpoint, config),
                jwks: validEndpoint(config.oidcJwksUri, config),
                userinfo: validEndpoint(config.oidcUserInfoEndpoint, config),
            };
        }
    }
    assertLocal(principal) {
        if (this.config.enabled !== true) fail('shared_read_setup_disabled', 503);
        if (this.verify(principal) !== true) fail('shared_product_read_session_required', 403);
    }
    async request(principal, url, options = {}, { unknownOnNetwork = false } = {}) {
        this.assertLocal(principal);
        let response;
        let payload;
        try {
            response = await this.fetch(String(url), { ...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
            const raw = await response.text();
            if (raw.length > 1_000_000) fail('shared_read_identity_response_invalid', 502);
            payload = JSON.parse(raw);
        } catch (error) {
            this.assertLocal(principal);
            if (error instanceof SharedProductReadError) throw error;
            fail(unknownOnNetwork ? 'shared_read_authorization_unknown' : 'shared_read_identity_unavailable', 503);
        }
        this.assertLocal(principal);
        if (!response.ok) fail('shared_read_identity_rejected', response.status === 401 || response.status === 403 ? response.status : 409);
        return payload;
    }
    async status(principal) {
        if (this.config.enabled !== true) return { enabled: false, ...flags,
            session: { state: 'disconnected' }, read_ready: false, requests: [], options: {}, actions: { authorize: false, disconnect: false, bind_reader: false },
            blockers: [{ code: 'shared_read_setup_disabled', message: 'تهيئة القراءة غير مفعّلة في هذه البيئة؛ يتطلب التفعيل اعتمادًا وإعدادًا خادميًا.' }] };
        this.assertLocal(principal);
        const owner = this.store.ownerSession(principal);
        const summary = this.store.ownerSummary(principal);
        const flow = this.store.flowSummary(principal);
        const state = owner ? 'connected' : ['pending', 'exchanging'].includes(flow?.state) ? 'authorizing'
            : flow?.state === 'unknown' ? 'unknown' : flow?.state === 'expired' ? 'expired' : summary.state;
        const base = { enabled: true, ...flags, session: { ...summary, state }, read_ready: false,
            requests: [], options: {}, actions: { authorize: state !== 'authorizing', enroll_consumer: false, bind_reader: false,
                disconnect: summary.state !== 'disconnected' || ['pending', 'exchanging', 'unknown'].includes(flow?.state) },
            blockers: summary.state === 'unknown' ? [{ code: 'shared_read_identity_credentials_unavailable',
                message: 'تعذر التحقق من بيانات جلسة الهوية المحفوظة؛ أعد الربط أو افصل الجلسة المحلية.' }] : [] };
        if (!owner) return base;
        if (this.enrollmentService) {
            try {
                base.enrollment = await this.enrollmentService.status(principal, owner);
                base.actions.enroll_consumer = base.enrollment.state === 'unregistered';
            }
            catch (failure) {
                if (failure.code?.startsWith('shared_read_identity_') || failure.code === 'shared_product_read_session_required') {
                    base.session.state = 'unknown';
                }
                base.blockers.push({ code: failure instanceof SharedProductReadError ? failure.code : 'consumer_enrollment_unavailable',
                    message: 'تعذر التحقق من تسجيل الخدمة الحالي؛ لا يمنح التسجيل قراءة أو نشرًا.' });
            }
        }
        if (base.session.state === 'connected' && this.readService && this.store.load(principal)) {
            try {
                const ready = await this.readService.readiness(principal);
                if (!this.store.ownerCurrent(principal, owner)) fail('shared_product_read_session_required', 403);
                base.read_ready = true;
                base.read_context = ready.context;
            } catch (failure) {
                base.blockers.push({ code: failure instanceof SharedProductReadError ? failure.code : 'shared_product_verification_unavailable',
                    message: 'تعذر تأكيد منحة القراءة الحالية؛ لا تُستخدم نتائج سابقة.' });
            }
        }
        this.assertLocal(principal);
        if (!this.store.ownerCurrent(principal, owner)) fail('shared_product_read_session_required', 403);
        base.actions.bind_reader = base.session.state === 'connected' && this.config.sharedReadsEnabled === true
            && base.enrollment?.state === 'completed';
        // OIDC is identity/read delegation only. Owner operations stay in the
        // actual ControlCenter cookie BFF, with no OIDC owner proxy here.
        return { ...base,
            blockers: [...base.blockers, { code: 'operational_owner_actions_in_control_center',
                message: 'تُدار الطلبات وموافقاتها من جلسة مركز التحكم الحالية وتفويضات النطاق الصريحة.' }] };
    }
    async authorize(principal) {
        this.assertLocal(principal);
        const verifier = crypto.randomBytes(32).toString('base64url');
        const nonce = crypto.randomBytes(32).toString('base64url');
        // Local disconnect only: this does not revoke a central read grant or
        // rotate/revoke a separate source-publisher key.
        this.store.disconnectOwner(principal);
        const state = this.store.beginFlow(principal, { verifier, nonce, configuration: fingerprint(this.config) });
        const url = new URL(this.endpoints.authorize);
        url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.oidcClientId,
            redirect_uri: this.config.oidcRedirectUri, scope: 'openid profile organization',
            state: state.state, nonce, code_challenge_method: 'S256',
            code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }).toString();
        return { authorization_url: url.href, ...flags };
    }
    verifyToken(token, jwks, { nonce, tokenUse }) {
        const decoded = jwt.decode(token, { complete: true });
        if (decoded?.header?.alg !== 'RS256' || typeof decoded.header.kid !== 'string' || !Array.isArray(jwks.keys)) {
            fail('shared_read_identity_response_invalid', 502);
        }
        const keys = jwks.keys.filter(key => key.kid === decoded.header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig'));
        if (keys.length !== 1) fail('shared_read_identity_response_invalid', 502);
        try {
            const publicKey = crypto.createPublicKey({ key: keys[0], format: 'jwk' });
            const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: this.config.oidcIssuer,
                audience: this.config.oidcClientId, clockTimestamp: Math.floor(this.now() / 1000) });
            if (claims.token_use !== tokenUse || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(this.now() / 1000)
                || typeof claims.sub !== 'string' || !claims.sub
                || typeof claims.organization_id !== 'string' || !claims.organization_id
                || (nonce && claims.nonce !== nonce)) fail('shared_read_identity_response_invalid', 502);
            return claims;
        } catch { fail('shared_read_identity_response_invalid', 502); }
    }
    async identity(principal) {
        this.assertLocal(principal);
        const session = this.store.ownerSession(principal);
        if (!session || !session.actorId || !session.organizationId) fail('shared_product_read_session_required', 403);
        const profile = await this.request(principal, this.endpoints.userinfo,
            { headers: { Authorization: `Bearer ${session.accessToken}` } });
        if (!this.store.ownerCurrent(principal, session) || profile.sub !== session.actorId
            || profile.organization_id !== session.organizationId) fail('shared_product_read_session_required', 403);
        return session;
    }
    async nativeAccount(principal, owner, { allowUnbound = false } = {}) {
        this.assertLocal(principal);
        if (!this.store.ownerCurrent(principal, owner)) fail('shared_product_read_session_required', 403);
        const externalTenant = `wa_savana:tenant:${principal.tenantId}`;
        const url = new URL('/v1/platform-bindings', this.config.centerOrigin);
        url.searchParams.set('external_tenant_id', externalTenant);
        const bindings = await this.request(principal, url, { headers: {
            'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': this.config.platformToken,
        } });
        if (!this.store.ownerCurrent(principal, owner)) fail('shared_product_read_session_required', 403);
        if (allowUnbound && Array.isArray(bindings) && bindings.length === 0) return null;
        if (!Array.isArray(bindings) || bindings.length !== 1) fail('shared_read_native_binding_required', 403);
        const native = bindings[0];
        if (!native || native.platform_code !== 'wa_savana' || native.external_tenant_id !== externalTenant
            || native.organization_id !== owner.organizationId || native.status !== 'active'
            || typeof native.id !== 'string' || !native.id) fail('shared_read_native_binding_required', 403);
        return { id: native.id, organization_id: native.organization_id, platform_code: native.platform_code,
            external_tenant_id: native.external_tenant_id, status: native.status };
    }
    async bindReader(principal, selection) {
        if (this.config.sharedReadsEnabled !== true) fail('shared_product_reads_disabled', 503);
        if (!selection || typeof selection !== 'object' || Array.isArray(selection)
            || Object.keys(selection).some(name => !['consumer_installation_id', 'activity_id', 'branch_id', 'warehouse_id'].includes(name))
            || !['consumer_installation_id', 'activity_id'].every(name => typeof selection[name] === 'string' && selection[name] && selection[name].length <= 255)
            || ['branch_id', 'warehouse_id'].some(name => selection[name] != null && (typeof selection[name] !== 'string' || !selection[name] || selection[name].length > 255))
            || (selection.warehouse_id && !selection.branch_id)) fail('shared_read_setup_request_invalid', 422);
        this.assertLocal(principal);
        const generation = this.store.startReaderSelection(principal);
        const owner = await this.identity(principal);
        // Resolve the native tenant through the existing platform binding HTTP
        // route. Neither account nor organization is accepted from the browser.
        const native = await this.nativeAccount(principal, owner);
        const credentials = { accessToken: owner.accessToken, expiresAt: owner.expiresAt,
            centralActorId: owner.actorId, consumerAccountId: native.id,
            consumerInstallationId: selection.consumer_installation_id,
            scope: { organization_id: owner.organizationId, activity_id: selection.activity_id,
                branch_id: selection.branch_id ?? null, warehouse_id: selection.warehouse_id ?? null } };
        const temporary = new DelegatedReadBindings();
        temporary.bind(principal, credentials);
        const verify = current => this.verify(current) === true && this.store.ownerCurrent(current, owner)
            && this.store.readerSelectionCurrent(current, generation);
        const reader = new CentralProductReadService({ enabled: true, baseUrl: this.config.centerOrigin,
            platformToken: this.config.platformToken, allowLoopback: this.config.allowLoopback === true,
            trustedBindings: temporary, verifyLocalPrincipal: verify, fetchImpl: this.fetch, now: this.now });
        const ready = await reader.readiness(principal);
        if (!verify(principal)) fail('shared_product_read_session_required', 403);
        this.store.completeReaderSelection(principal, generation, credentials);
        return { bound: true, read_ready: true, context: ready.context, ...flags };
    }
    async enrollConsumer(principal) {
        if (!this.enrollmentService) fail('consumer_enrollment_disabled', 503);
        const owner = await this.identity(principal);
        const tenant = this.db.prepare('SELECT name FROM tenants WHERE id=?').get(principal.tenantId);
        if (!tenant?.name) fail('shared_product_read_session_required', 403);
        return this.enrollmentService.enroll(principal, owner, { displayName: tenant.name });
    }
    async callback(principal, { state, code, error }) {
        this.assertLocal(principal);
        const consumed = this.store.consumeFlow(principal, state);
        try {
            if (error || !code || consumed.flow.configuration !== fingerprint(this.config)) fail('shared_read_identity_rejected', 409);
            const token = await this.request(principal, this.endpoints.token, { method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'authorization_code', client_id: this.config.oidcClientId,
                    redirect_uri: this.config.oidcRedirectUri, code, code_verifier: consumed.flow.verifier }).toString(),
            }, { unknownOnNetwork: true });
            if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string' || typeof token.id_token !== 'string') {
                fail('shared_read_identity_response_invalid', 502);
            }
            const jwks = await this.request(principal, this.endpoints.jwks);
            const identity = this.verifyToken(token.id_token, jwks, { nonce: consumed.flow.nonce, tokenUse: 'id' });
            const access = this.verifyToken(token.access_token, jwks, { tokenUse: 'access' });
            if (identity.sub !== access.sub || identity.organization_id !== access.organization_id
                || !String(access.scope || '').split(' ').includes('organization')) fail('shared_read_identity_response_invalid', 502);
            const profile = await this.request(principal, this.endpoints.userinfo,
                { headers: { Authorization: `Bearer ${token.access_token}` } });
            if (profile.sub !== identity.sub || profile.organization_id !== identity.organization_id) fail('shared_read_identity_response_invalid', 502);
            this.assertLocal(principal);
            this.store.completeOwnerFlow(principal, consumed.flowId, { accessToken: token.access_token,
                expiresAt: new Date(access.exp * 1000).toISOString(), actorId: identity.sub, organizationId: identity.organization_id });
            return { redirect: '/portal/integrations?shared_read_setup=connected' };
        } catch (failure) {
            // A concurrent disconnect can already have invalidated this flow.
            // Preserve the original safe error and never recreate its session.
            try { this.store.finishFlow(principal, consumed.flowId, failure.code === 'shared_read_authorization_unknown' ? 'unknown' : 'failed'); }
            catch { /* The flow may already be invalidated; no token is saved. */ }
            throw failure;
        }
    }
    disconnect(principal) {
        this.assertLocal(principal);
        this.store.disconnectOwner(principal);
        return { disconnected: true, central_read_grant_revoked: false, source_publisher_key_revoked: false, ...flags };
    }
}

export const createOperationalReadServices = ({ database, config, fetchImpl = globalThis.fetch, encryption }) => {
    const store = new SqliteDelegatedReadBindings({ database, encryption });
    const verifyLocalPrincipal = createSqliteReadPrincipalVerifier(database);
    const readService = new CentralProductReadService({ enabled: config.sharedReadsEnabled === true,
        baseUrl: config.centerOrigin, platformToken: config.platformToken, allowLoopback: config.allowLoopback === true,
        trustedBindings: store, verifyLocalPrincipal, fetchImpl });
    const setupService = new OperationalReadSetupService({ database, config, store, fetchImpl, verifyLocalPrincipal, readService });
    const enrollmentService = new OperationalConsumerEnrollmentService({ database, encryption, config,
        fetchImpl, verifyLocalPrincipal, verifyOidcSession: async (principal, session) => {
            const current = await setupService.identity(principal);
            return store.ownerCurrent(principal, session) && current.generation === session.generation
                && current.actorId === session.actorId && current.organizationId === session.organizationId;
        } });
    setupService.enrollmentService = enrollmentService;
    const ownerPortalService = new OperationalOwnerPortalService({ database, encryption,
        config: { enabled: config.enabled === true && config.ownerPortalEnabled === true,
            portalOrigin: config.ownerPortalOrigin, allowLoopback: config.allowLoopback === true },
        fetchImpl, verifyLocalPrincipal,
        verifyIdentitySession: principal => setupService.identity(principal),
        resolveNativeAccount: (principal, identity) => setupService.nativeAccount(principal, identity, { allowUnbound: true }),
    });
    return { setupService, readService, store, enrollmentService, ownerPortalService };
};
