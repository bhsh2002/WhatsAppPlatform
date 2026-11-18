import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import tenantPortalRouter from '../routes/tenantPortal.js';
import webhooksRouter, { configureCollaborativeWebhookEvidence, configureNativeMessengerProfileTransport } from '../routes/webhooks.js';
import { createConnectCallbacksRouter, createTenantIntegrationsRouter } from '../routes/savanaIntegrations.js';
import { createOperationalReadSetupRouter } from '../routes/operationalReadSetup.js';
import { createOperationalWorkspaceRouter } from '../routes/operationalWorkspace.js';
import { createSharedProductReadsRouter } from '../routes/sharedProductReads.js';
import { createTenantSmsGatewayRouter } from '../routes/tenantSmsGateway.js';
import { createSmsGatewayWebhookRouter } from '../routes/smsGatewayWebhook.js';
import { createSmsGatewayProvisioningRouter } from '../routes/smsGatewayProvisioning.js';
import { createTenantMetaOnboardingRouter } from '../routes/tenantMetaOnboarding.js';
import { createTenantFacebookMessagingRouter } from '../routes/tenantFacebookMessaging.js';
import { createTenantTemplatesRouter } from '../routes/tenantTemplates.js';
import { createFacebookContentStudioRouter } from '../routes/facebookContentStudio.js';
import { createOperationalReadServices } from '../services/operationalReadSetup.js';
import { createOperationalCollaboration } from '../services/operationalCollaboration.js';
import { createNativeCollaborativeDependencies } from '../services/nativeCollaborativeDependencies.js';
import { SavanaIntegrationService } from '../services/savanaIntegration.js';
import { SmsGatewayService, createSmsGatewayRequest } from '../services/smsGateway.js';
import { getTenantCredentials, getAccessToken } from '../services/credentials.js';
import { resolveFacebookPageCredentials } from '../services/nativeFacebookContentPublisher.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { SmsApiRequestStore, reconcileSmsMessageBilling, reconcileSmsUssdBilling } from '../services/smsApiRequests.js';
import * as billingModule from '../services/billing.js';
import eventBus from '../services/eventBus.js';
import { markBotHandoffForConversation } from '../services/messengerBot.js';
import { readMetaResponse } from '../services/metaHttp.js';
import { FACEBOOK_OAUTH_SCOPES, FACEBOOK_WEBHOOK_FIELDS, buildMetaReviewReadiness, listMetaReviewSnapshots, saveMetaReviewSnapshot } from '../services/metaReadiness.js';
import { ownerJourneyRouteTemplates } from './ownerJourneyRouteTemplates.js';
import { GuidedWhatsAppSetupService } from '../services/guidedWhatsAppSetup.js';
import { createGuidedWhatsAppSetupRouter } from '../routes/guidedWhatsAppSetup.js';
import { createSqliteReadPrincipalVerifier, SharedProductReadError } from '../services/centralProductRead.js';
import { createOwnerJourneyCapabilityProofs } from './ownerJourneyCapabilityProofs.js';
import { createOwnerJourneyConsumerEvidence } from './ownerJourneyConsumerEvidence.js';
import { createOwnerJourneyProviderFault } from './ownerJourneyProviderFault.js';
import { createOwnerJourneyResultDelivery } from './ownerJourneyResultDelivery.js';
import { matchOwnerJourneyResultBinding } from './ownerJourneyResultBinding.js';
import { createOwnerJourneyResultBindingCapture } from './ownerJourneyResultBindingCapture.js';

const fail = code => { const error = new Error(code); error.code = code; throw error; };

// Actual application assembly inside the factory's private owned environment.
// The runtime has already installed the socket guard and opened its migrated
// database. Only the ordinary native login user/tenant is initially present.
export const createOwnerJourneyApplication = async ({ app, database, stateRoot, runId, urls, serviceCredentials,
    nativeOwner, observe, oidc, peers }) => {
    if (database.name !== `${stateRoot}/platform.db` || oidc.issuer !== urls.portal || oidc.api_base_url !== urls.portal
        || peers.wa_savana?.command_adapter_path !== '/api/savana/command-adapter/v1'
        || !Number.isSafeInteger(nativeOwner.tenantId)) fail('owned_application_context_invalid');
    database.exec(`CREATE TABLE IF NOT EXISTS owner_journey_observations(
        id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,service TEXT NOT NULL,method TEXT NOT NULL,
        path_template TEXT NOT NULL,status INTEGER NOT NULL,observed_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_journey_outbound_observations(
        id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,service TEXT NOT NULL,method TEXT NOT NULL,
        path_template TEXT NOT NULL,status INTEGER NOT NULL,observed_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_journey_counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_journey_native_result_fetches(
        id TEXT PRIMARY KEY,run_id TEXT NOT NULL,status INTEGER NOT NULL,encrypted_result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_journey_consumer_result_contexts(
        context_key TEXT PRIMARY KEY,run_id TEXT NOT NULL,encrypted_context TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_journey_processes(pid INTEGER PRIMARY KEY,run_id TEXT NOT NULL,opened_at TEXT NOT NULL);`);
    const bump = name => database.prepare('INSERT INTO owner_journey_counters(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1').run(name);
    const previous = database.prepare('SELECT COUNT(*) n FROM owner_journey_processes WHERE run_id=? AND pid<>?').get(runId, process.pid).n;
    database.prepare('INSERT OR IGNORE INTO owner_journey_processes VALUES(?,?,?)').run(process.pid, runId, new Date().toISOString());
    if (previous && database.prepare('SELECT COUNT(*) n FROM users WHERE id=? AND tenant_id=?').get(nativeOwner.userId, nativeOwner.tenantId).n === 1) bump('persisted_resume_checks');
    const record = observation => {
        if (!['wa_savana', 'wa_frontend'].includes(observation.service || 'wa_savana')) fail('owned_server_observation_invalid');
        observe(observation);
        database.prepare('INSERT INTO owner_journey_observations(run_id,service,method,path_template,status,observed_at) VALUES(?,?,?,?,?,?)')
            .run(runId, observation.service || 'wa_savana', observation.method, observation.path_template, observation.status, new Date().toISOString());
    };
    const recordOutbound = observation => database.prepare('INSERT INTO owner_journey_outbound_observations(run_id,service,method,path_template,status,observed_at) VALUES(?,?,?,?,?,?)')
        .run(runId, observation.service, observation.method, observation.path_template, observation.status, new Date().toISOString());
    const servicesByOrigin = new Map(Object.entries(urls).map(([service, value]) => [new URL(value).origin, service]));
    const pathTemplate = pathname => pathname
        .replace(/^\/v25\.0\/[^/]+\/(messages|phone_numbers|subscribed_apps|owned_whatsapp_business_accounts|media|feed|photos|posts|message_templates|permissions)$/, '/v25.0/:account/$1')
        .replace(/^\/v25\.0\/(?!me$|debug_token$)[^/]+$/, '/v25.0/:object')
        .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:id')
        .replace(/\/[0-9a-f]{32,}(?=\/|$)/gi, '/:id')
        .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
        .replace(/\/(?:wa_savana:tenant:)[^/]+/g, '/:account');
    const providerFault = createOwnerJourneyProviderFault({ database, runId, providerOrigin: new URL(urls.message_provider).origin });
    const resultBindings = createOwnerJourneyResultBindingCapture({ coreOrigin: new URL(oidc.api_base_url).origin });
    const fetchImpl = providerFault.wrapFetch(resultBindings.wrapFetch(async (input, options = {}) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        const service = servicesByOrigin.get(url.origin);
        if (!service || service === 'catalog_domain_proxy') fail('undeclared_application_outbound');
        const method = options.method || 'GET';
        const response = await globalThis.fetch(input, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(5000) });
        const template = pathTemplate(url.pathname);
        // This is evidence of a WA outbound request, not an independent
        // observation served by the target Core/provider application.
        recordOutbound({ service, method, path_template: template, status: response.status });
        if (response.ok && url.pathname.startsWith('/v1/integration/data/')) bump('provenance_reads');
        const messageEffect = service === 'message_provider' && method === 'POST'
            && (url.pathname === '/services/v1/messages.php' || /^\/v25\.0\/[^/]+\/messages$/.test(url.pathname));
        const contentEffect = service === 'message_provider' && method === 'POST' && /^\/v25\.0\/[^/]+\/(?:feed|photos)$/.test(url.pathname);
        const mediaEffect = service === 'message_provider' && method === 'POST' && /^\/v25\.0\/[^/]+\/media$/.test(url.pathname);
        if (messageEffect || contentEffect || mediaEffect) {
            let body; try { body = typeof options.body === 'string' ? JSON.parse(options.body) : null; } catch { body = null; }
            const headers = new Headers(options.headers || {});
            const key = headers.get('idempotency-key');
            const token = body?.biz_opaque_callback_data || body?.message?.metadata;
            let execution;
            if (key) execution = database.prepare(`SELECT execution.capability_code FROM savana_collaborative_effects effect
                JOIN savana_collaborative_executions execution ON execution.id=effect.execution_id WHERE effect.native_idempotency_key=?`).get(key);
            if (token && typeof token === 'string') execution = database.prepare(`SELECT execution.capability_code
                FROM savana_collaborative_correlations correlation JOIN savana_collaborative_effects effect ON effect.id=correlation.effect_id
                JOIN savana_collaborative_executions execution ON execution.id=effect.execution_id WHERE correlation.token_sha256=?`)
                .get(crypto.createHash('sha256').update(token).digest('hex'));
            if (contentEffect) bump('owned_content_http_requests');
            else if (execution?.capability_code === 'campaigns.execute') bump('owned_campaign_http_requests');
            else if (execution?.capability_code === 'messaging.send') bump('owned_message_http_requests');
        }
        return response;
    }));
    const billing = { ...billingModule, operations: billingModule.BILLING_OPERATIONS, database };
    const requestStore = new SmsApiRequestStore({ database });
    const providerOrigin = new URL(urls.message_provider).origin;
    const smsService = new SmsGatewayService({ database,
        outboundUrlValidator: async value => { const url = new URL(value); if (url.origin !== providerOrigin || url.username || url.password || url.hash) fail('owned_provider_url_required'); return url.href; },
        gatewayRequest: createSmsGatewayRequest({ fetchImpl: async (url, options = {}) => {
            const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(5000) });
            const reader = response.body?.getReader(); if (!reader) fail('owned_provider_response_invalid');
            const chunks = []; let size = 0;
            try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
                if (size > 1_048_576) { await reader.cancel(); fail('owned_provider_response_invalid'); } chunks.push(Buffer.from(next.value)); }
            } finally { reader.releaseLock(); }
            return { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.concat(chunks).toString('utf8') };
        }, decryptToken: decrypt }),
        messageBillingReconciler: message => reconcileSmsMessageBilling({ database, billing, requestStore, message }),
        ussdBillingReconciler: request => reconcileSmsUssdBilling({ database, billing, request, requestStore }) });
    const integrationService = new SavanaIntegrationService({ database, fetchImpl, config: { enabled: true,
        connectUrl: oidc.api_base_url, connectPlatformToken: serviceCredentials.platform_token,
        callbackUrl: `${urls.wa_savana}/api/integrations/connect/events`, callbackToken: serviceCredentials.callback_token,
        subscriptionsUrl: urls.subscriptions, subscriptionsPlatformToken: serviceCredentials.subscriptions_platform_token,
        subscriptionsSigningSecret: serviceCredentials.subscription_signing, subscriptionsMode: 'central',
        publicAppUrl: urls.wa_frontend, timeoutMs: 5000, outboxMaxAttempts: 1 } });
    const readServices = createOperationalReadServices({ database, encryption: { encrypt, decrypt }, fetchImpl, config: {
        enabled: true, sharedReadsEnabled: true, ownerPortalEnabled: false, centerOrigin: oidc.api_base_url,
        platformToken: serviceCredentials.platform_token, allowLoopback: true, oidcIssuer: oidc.issuer,
        oidcClientId: oidc.client_id, oidcRedirectUri: oidc.redirect_uri, oidcAuthorizationEndpoint: oidc.authorization_endpoint,
        oidcTokenEndpoint: oidc.token_endpoint, oidcJwksUri: oidc.jwks_uri, oidcUserInfoEndpoint: oidc.userinfo_endpoint } });
    const metaAppSecret = crypto.createHmac('sha256', serviceCredentials.callback_token).update(`owned-meta:${runId}`).digest('hex');
    const metaAppId = 'owned-native-meta-app';
    const nativeDependencies = createNativeCollaborativeDependencies({ database, encryption: { encrypt, decrypt }, smsService, billing,
        whatsappCredentials: getTenantCredentials, contentCredentials: resolveFacebookPageCredentials,
        settleWhatsAppStatus: billingModule.updateMetaChargeFromStatus, recordMessageCost: billingModule.recordMetaMessageCost,
        markMessengerHandoff: markBotHandoffForConversation, eventBus, fetchImpl, metaApiBase: `${urls.message_provider}/v25.0` });
    const runtime = createOperationalCollaboration({ database, encryption: { encrypt, decrypt }, readServices, integrationService,
        nativeDependencies, fetchImpl, config: { callbackToken: serviceCredentials.callback_token, signaturePathPrefix: '', metaAppSecret, metaAppId } });
    if (!runtime.native) fail('actual_native_runtime_unavailable');
    const consumerEvidence = createOwnerJourneyConsumerEvidence({ database, runId });
    const consumerReads = new AsyncLocalStorage();
    const gateway = runtime.workspace;
    const originalPresentRecord = gateway.presentRecord.bind(gateway);
    gateway.presentRecord = async (principal, context, raw) => {
        const document = await originalPresentRecord(principal, context, raw);
        consumerReads.getStore()?.push({ principal, identity: context.identity, provider: gateway.sourceFor(context, raw),
            scope: raw.scope, document, record: raw, viewKey: gateway.metadata(context).viewKey });
        return document;
    };
    for (const method of ['records', 'record']) {
        const read = gateway[method].bind(gateway);
        gateway[method] = async (principal, input) => {
            const pending = [];
            const value = await consumerReads.run(pending, () => read(principal, input));
            const current = await gateway.loadContext(principal);
            if (value.viewKey !== gateway.metadata(current).viewKey) fail('owned_consumer_read_changed');
            for (const event of pending) {
                if (event.viewKey !== value.viewKey || JSON.stringify(event.identity) !== JSON.stringify(current.identity)) fail('owned_consumer_read_changed');
                consumerEvidence.recordRows(event);
            }
            return value;
        };
    }
    const consumerContext = value => ({ command: value.raw, identity: value.context.identity,
        provider: value.context.raw.providers.find(row => row.provider_ref === value.raw.provider_ref && row.activity_id === value.raw.activity_id), scope: value.activity.scope });
    const contextKey = (identity, commandId) => crypto.createHash('sha256').update(JSON.stringify([runId,
        identity.actorId, identity.organizationId, identity.nativeAccountId, identity.coreAccountId, identity.generation, commandId])).digest('hex');
    const resultDelivery = createOwnerJourneyResultDelivery({ onDelivered: event => {
        gateway.setup.assertLocal(event.principal);
        if (!gateway.setup.store.ownerCurrent(event.principal, event.after.identity)) return;
        const recorded = consumerEvidence.recordResult(event);
        if (recorded.recorded === true) database.prepare('INSERT INTO owner_journey_consumer_result_contexts VALUES(?,?,?) ON CONFLICT(context_key) DO UPDATE SET encrypted_context=excluded.encrypted_context')
            .run(contextKey(event.after.identity, event.after.command.command_id), runId, encrypt(JSON.stringify(event.after)));
    } });
    const originalResult = gateway.result.bind(gateway);
    gateway.result = async (principal, input) => {
        let before;
        try {
            before = consumerContext(await gateway.commandRead(principal, input.command));
            const { value: representation, header } = await resultBindings.run(before.command.command_id,
                () => originalResult(principal, input));
            const after = consumerContext(await gateway.commandRead(principal, input.command));
            const initialBinding = matchOwnerJourneyResultBinding({ header, runId, ...before, representation });
            const finalBinding = matchOwnerJourneyResultBinding({ header, runId, ...after, representation });
            if (initialBinding && finalBinding) {
                // The same authenticated Core result header owns its frozen
                // command scope. Keep current activity scopes separate for the
                // existing pre/post context fence; never infer an installation.
                before.sourceInstallationId = initialBinding.sourceInstallationId;
                before.resultScope = initialBinding.scope;
                after.sourceInstallationId = finalBinding.sourceInstallationId;
                after.resultScope = finalBinding.scope;
            }
            resultDelivery.capture({ principal, before, after, representation });
            return representation;
        } catch (error) {
            if (error instanceof SharedProductReadError && error.code === 'workspace_rejected' && error.status === 403) {
                try {
                    const reference = await gateway.refs.resolve(principal, input.command, 'command');
                    const current = await gateway.loadContext(principal);
                    if (['actorId', 'organizationId', 'nativeAccountId', 'generation'].some(key => current.identity[key] !== reference.identity[key])) {
                        throw new Error('owned_consumer_identity_changed');
                    }
                    const prior = database.prepare('SELECT encrypted_context FROM owner_journey_consumer_result_contexts WHERE context_key=? AND run_id=?')
                        .get(contextKey(current.identity, reference.key), runId);
                    if (prior) consumerEvidence.recordResultDenied({ principal, ...JSON.parse(decrypt(prior.encrypted_context)), identity: current.identity, status: 403,
                        pathTemplate: '/v1/integration/workspace/commands/:command/result' });
                } catch { /* Missing current identity/evidence is not a measured purpose denial. */ }
            }
            throw error;
        }
    };
    const capabilityEvidence = createOwnerJourneyCapabilityProofs({ database, decrypt, nativeAdapters: runtime.native.nativeAdapters,
        readDiscovery: ({ context }) => runtime.native.discovery.discovery(context) });
    configureCollaborativeWebhookEvidence(runtime.native.effectEvidence);
    configureNativeMessengerProfileTransport({ database, fetchImpl, apiBase: `${urls.message_provider}/v25.0`, allowLoopback: true });
    const traced = prefix => (req, res, next) => {
        req.ownerJourneyTracePrefix = prefix;
        if (req.ownerJourneyTraceInstalled) return next();
        req.ownerJourneyTraceInstalled = true;
        res.once('finish', () => {
            if (typeof req.route?.path !== 'string' || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) return;
            const path = `${req.ownerJourneyTracePrefix}${req.route.path}`;
            if (/^[A-Za-z0-9_:/{}.-]+$/.test(path)) record({ service: 'wa_savana', method: req.method, path_template: path, status: res.statusCode });
        }); next();
    };
    const httpRouteTemplates = [];
    const mount = (prefix, ...handlers) => {
        if (prefix.startsWith('/api/portal') || prefix === '/api/integrations/connect') {
            for (const router of handlers) httpRouteTemplates.push(...ownerJourneyRouteTemplates({ router, publicPrefix: prefix }));
        }
        return app.use(prefix, traced(prefix), ...handlers);
    };
    mount('/api/integrations/connect', createConnectCallbacksRouter({ service: integrationService }));
    mount('/api/savana/command-adapter/v1', (req, res, next) => {
        if (req.method === 'GET' && /^\/commands\/[^/]+\/result$/.test(req.path)) {
            let returned;
            const send = res.send;
            res.send = function (body) {
                if (typeof body === 'string' || Buffer.isBuffer(body)) returned = Buffer.from(body);
                return send.call(this, body);
            };
            res.once('finish', () => {
                if (res.statusCode !== 200 || !res.get('X-Savana-Command-Signature') || !returned) return;
                // Actual completed signed HTTP response, retained privately for
                // semantic diagnostics; no row is seeded from a descriptor.
                database.prepare('INSERT INTO owner_journey_native_result_fetches VALUES(?,?,?,?)')
                    .run(crypto.randomUUID(), runId, res.statusCode, encrypt(returned.toString('utf8')));
            });
        }
        next();
    }, runtime.native.nativeRouter);
    mount('/api/webhook', webhooksRouter);
    mount('/api/integrations/sms-gateway/events', createSmsGatewayWebhookRouter({ service: smsService, eventBus }));
    mount('/api/integrations/sms-gateway/provision', createSmsGatewayProvisioningRouter({ service: smsService }));
    mount('/api/portal/integrations', authMiddleware, tenantMiddleware, resultDelivery.middleware,
        createOperationalWorkspaceRouter({ service: runtime.workspace, appOrigin: urls.wa_frontend }),
        createOperationalReadSetupRouter({ service: readServices.setupService }),
        createSharedProductReadsRouter({ service: readServices.readService }), runtime.native.ownerRouter,
        createTenantIntegrationsRouter({ database, service: integrationService }));
    // Mount the same real native SMS router with the explicitly owned HTTP
    // transport before the normal portal router's production-default instance.
    mount('/api/portal/sms-gateway', authMiddleware, tenantMiddleware,
        createTenantSmsGatewayRouter({ service: smsService, billing, allowManualConfiguration: true }));
    const requestMeta = async (url, options = {}) => {
        const requested = new URL(url);
        if (requested.origin !== new URL(urls.message_provider).origin) fail('owned_meta_provider_required');
        return readMetaResponse(await fetchImpl(requested.href, options));
    };
    mount('/api/portal', authMiddleware, tenantMiddleware, createTenantMetaOnboardingRouter({ database,
        encryptToken: encrypt, decryptToken: decrypt, requestMeta, buildReadiness: buildMetaReviewReadiness,
        listSnapshots: listMetaReviewSnapshots, saveSnapshot: saveMetaReviewSnapshot,
        authorizationEndpoint: `${urls.message_provider}/v25.0/dialog/oauth`, allowLoopbackAuthorizationEndpoint: true,
        config: { apiBase: `${urls.message_provider}/v25.0`, appId: metaAppId, appSecret: metaAppSecret,
            apiVersion: 'v25.0', redirectUri: `${urls.wa_frontend}/auth/facebook/callback`, reviewScopes: FACEBOOK_OAUTH_SCOPES,
            webhookFields: FACEBOOK_WEBHOOK_FIELDS, whatsappConfigId: 'owned-native-signup' } }));
    const guidedWhatsAppSetup = new GuidedWhatsAppSetupService({ database, encryption: { encrypt, decrypt },
        verifyLocalPrincipal: createSqliteReadPrincipalVerifier(database), fetchImpl,
        config: { appId: metaAppId, appSecret: metaAppSecret, apiVersion: 'v25.0', redirectUri: `${urls.wa_frontend}/auth/facebook/callback`,
            apiBase: `${urls.message_provider}/v25.0`, authorizationEndpoint: `${urls.message_provider}/v25.0/dialog/oauth`, allowLoopback: true } });
    mount('/api/portal', authMiddleware, tenantMiddleware, createGuidedWhatsAppSetupRouter({ service: guidedWhatsAppSetup, appOrigin: urls.wa_frontend }));
    const requestFixedMeta = async (url, options = {}) => {
        const target = new URL(url);
        if (target.origin !== 'https://graph.facebook.com') fail('owned_meta_route_target_invalid');
        return requestMeta(new URL(target.pathname + target.search, urls.message_provider).href, options);
    };
    mount('/api/portal', authMiddleware, tenantMiddleware, createTenantFacebookMessagingRouter({ database, decryptToken: decrypt,
        requestMeta: requestFixedMeta, billing, markHandoff: markBotHandoffForConversation, broadcast: eventBus.broadcast.bind(eventBus) }));
    mount('/api/portal', authMiddleware, tenantMiddleware, createTenantTemplatesRouter({ database, accessTokenForTenant: getAccessToken,
        requestMeta, apiBase: `${urls.message_provider}/v25.0` }));
    mount('/api/portal/content-studio', authMiddleware, tenantMiddleware, createFacebookContentStudioRouter({ database }));
    mount('/api/portal', authMiddleware, tenantMiddleware, tenantPortalRouter);
    const diagnostics = async () => {
        const facts = Object.fromEntries(database.prepare('SELECT name,value FROM owner_journey_counters').all().map(row => [row.name, row.value]));
        facts.verified_owner_accounts = database.prepare('SELECT COUNT(DISTINCT user_id) n FROM savana_operational_owner_sessions WHERE revoked_at IS NULL AND expires_at>?').get(new Date().toISOString()).n;
        for (const [capability, prefix] of [['messaging.send', 'message'], ['campaigns.execute', 'campaign'], ['content.publish', 'content']]) {
            facts[`reviewed_${prefix}_requests`] = database.prepare('SELECT COUNT(*) n FROM savana_collaborative_executions WHERE capability_code=?').get(capability).n;
            facts[`confirmed_${prefix}_results`] = database.prepare("SELECT COUNT(*) n FROM savana_collaborative_executions WHERE capability_code=? AND state='completed'").get(capability).n;
        }
        facts.authoritative_media_effects = database.prepare("SELECT COUNT(*) n FROM savana_native_media_assets WHERE state='uploaded' AND provider_media_id IS NOT NULL AND provider_receipt_sha256 IS NOT NULL").get().n;
        facts.lookup_reconciliations = database.prepare("SELECT COUNT(*) n FROM savana_workspace_intent_audit WHERE action='workspace_reconciled_completed'").get().n;
        const consumer = consumerEvidence.snapshot();
        Object.assign(facts, consumer.facts);
        const resultFetchRows = database.prepare('SELECT id,status,encrypted_result FROM owner_journey_native_result_fetches WHERE run_id=? ORDER BY id').all(runId)
            .map(row => ({ id: row.id, status: row.status, result: JSON.parse(decrypt(row.encrypted_result)) }));
        return { facts, capability_proofs: await capabilityEvidence.collect({ resultFetchRows }), catalog_result_reads: consumer.catalog_result_reads,
            observations: database.prepare("SELECT service,method,path_template,status,observed_at FROM owner_journey_observations WHERE run_id=? AND service IN ('wa_savana','wa_frontend') ORDER BY id LIMIT 10000").all(runId) };
    };
    return { diagnostics, checkpoint: diagnostics, httpRouteTemplates,
        fault: input => providerFault.control(input),
        privateBrowserContext: { base_url: urls.message_provider, meta_api_base: `${urls.message_provider}/v25.0`, meta_app_id: metaAppId, meta_app_secret: metaAppSecret,
            webhook_verify_token: process.env.WEBHOOK_VERIFY_TOKEN, webhook_url: `${urls.wa_savana}/api/webhook`, oauth_redirect_uri: `${urls.wa_frontend}/auth/facebook/callback` },
        close: async () => { configureCollaborativeWebhookEvidence(null); configureNativeMessengerProfileTransport(null); } };
};
