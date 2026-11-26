import { createSqliteReadPrincipalVerifier } from './centralProductRead.js';
import { NativeCommandProtocol, NativeCommandProtocolError } from './nativeCommandProtocol.js';
import { NativeCommandAuthorizationClient } from './nativeCommandAuthorization.js';
import { createNativeCommandContextVerifier } from './nativeCommandContext.js';
import { CollaborativeExecutionService } from './collaborativeExecution.js';
import { CollaborativeConsentService } from './collaborativeConsents.js';
import { createCollaborativeNativeAdapters, createCollaborativeNativePolicy } from './collaborativeNativeAdapters.js';
import { createCollaborativeNativeDiscovery } from './collaborativeNativeDiscovery.js';
import { CollaborativeNativeOwnerService } from './collaborativeNativeOwner.js';
import { createNativeCommandAdapterRouter } from '../routes/nativeCommandAdapter.js';
import { createCollaborativeNativeRouter } from '../routes/collaborativeNative.js';
import { CollaborativeEffectEvidence } from './collaborativeEffectEvidence.js';
import { createCollaborativeNativeBusinessAdapters } from './collaborativeNativeBusiness.js';
import {CollaborativeNativeBusinessOwnerService} from './collaborativeNativeBusinessOwner.js';
import {createCollaborativeNativeReviewAdapters} from './collaborativeNativeReviews.js';
import {CollaborativeNativeMediaService} from './collaborativeNativeMedia.js';

const statuses = new Set(['active', 'trialing', 'past_due']);
const unknownSubscription = (bound = null) => ({ verified: false, entitled: null, bound, validUntil: null, error: true });

// A native WA license is its actual signed WA platform snapshot. A connection
// to another app or an integration descriptor is not a native subscription.
export const loadNativeSubscriptionFacts = async ({ integrationService, nativeTenantId, organizationId, now = () => Date.now() }) => {
    if (!Number.isSafeInteger(nativeTenantId) || nativeTenantId < 1 || typeof organizationId !== 'string' || !organizationId
        || typeof integrationService?.subscriptionContext !== 'function' || typeof integrationService?.verifyEntitlement !== 'function') {
        throw new TypeError('Native subscription facts require actual scoped subscription readers');
    }
    try {
        const context = await integrationService.subscriptionContext(nativeTenantId);
        if (context?.managed_centrally !== true) return unknownSubscription();
        if (context.bound === false) return unknownSubscription(false);
        const account = context.platform_tenant;
        if (context.bound !== true || !account || typeof account.id !== 'string' || !account.id
            || account.organization_id !== organizationId || account.platform_code !== 'wa_savana'
            || account.external_tenant_id !== `wa_savana:tenant:${nativeTenantId}` || account.status !== 'active'
            || (context.organization?.id && context.organization.id !== organizationId)) return unknownSubscription();
        const verified = integrationService.verifyEntitlement(organizationId, context.entitlement_snapshot);
        const payload = verified?.payload;
        if (!payload || payload.organization_id !== organizationId || payload.platform_code !== 'wa_savana'
            || !Number.isFinite(Date.parse(payload.valid_until)) || Date.parse(payload.valid_until) <= now()
            || typeof payload.subscription_status !== 'string') return unknownSubscription(true);
        return { verified: true, entitled: statuses.has(payload.subscription_status), bound: true,
            validUntil: payload.valid_until, error: false };
    } catch { return unknownSubscription(); }
};

export const createCollaborativeRuntime = ({ database, encryption, config, nativeOwnerProofs, integrationService,
    nativeEnrollmentService, verifyOwnerContext = null, verifySourceEvidence = null, ownerActions = {}, nativeDependencies,
    resolveNativeNamespace = null,
    verifyLocalPrincipal = createSqliteReadPrincipalVerifier(database), fetchImpl = globalThis.fetch, now = () => Date.now() }) => {
    if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
        || typeof nativeOwnerProofs?.authority !== 'function' || !integrationService
        || typeof nativeEnrollmentService?.read !== 'function' || typeof nativeEnrollmentService?.enroll !== 'function'
        || !nativeDependencies || !config || typeof config.appOrigin !== 'string'
        || new URL(config.appOrigin).origin !== config.appOrigin
        || (verifyOwnerContext !== null && typeof verifyOwnerContext !== 'function')) {
        throw new TypeError('Collaborative runtime requires explicit owned services, origin and authority readers');
    }
    const ownerApiReady = typeof verifyOwnerContext === 'function';
    const getNativeAuthority = nativeOwnerProofs.authority.bind(nativeOwnerProofs);
    const consents = new CollaborativeConsentService({ database, encryption, verifyLocalPrincipal, now,
        verifySourceEvidence, verifyOwnerAuthority: async input => {
            if (!ownerApiReady) throw new NativeCommandProtocolError('native_owner_api_configuration_required', 503);
            const verified = await verifyOwnerContext(input);
            if (!verified?.verified || verified.localPolicyVerified !== true
                || verified.nativeTenantId !== input.principal.tenantId || verified.nativeUserId !== input.principal.userId) {
                throw new NativeCommandProtocolError('native_owner_authority_unverified', 403);
            }
            return { verified: true, canManageConsent: verified.canManageConsent === true,
                nativeTenantId: verified.nativeTenantId, nativeUserId: verified.nativeUserId,
                actorId: verified.viewer?.actorId, scope: verified.viewer?.scope, validUntil: verified.viewer?.validUntil };
        } });
    const effectEvidence = config.metaAppSecret ? new CollaborativeEffectEvidence({ database, encryption,
        billing: nativeDependencies.billing, settleWhatsAppStatus: nativeDependencies.settleWhatsAppStatus,
        appSecret: config.metaAppSecret, appId: config.metaAppId || null, now }) : null;
    const nativeAdapters = {...createCollaborativeNativeAdapters({ ...nativeDependencies, database, consents, effectEvidence, now }),
        ...createCollaborativeNativeBusinessAdapters({database,encryption,consents,now})};
    for (const [key, adapter] of Object.entries(nativeAdapters)) {
        const channel = key.split(':')[1];
        if (!['whatsapp', 'messenger'].includes(channel)) continue;
        const nativeConfigured = adapter.configured;
        adapter.configurationReason = ({ tenantId, parameters }) => {
            if (!effectEvidence?.ready(channel)) return 'native_provider_evidence_configuration_required';
            if (channel === 'messenger') {
                const page = database.prepare('SELECT webhook_subscribed,subscribed_fields FROM tenant_pages WHERE tenant_id=? AND id=?')
                    .get(tenantId, Number(String(parameters.account_ref).replace('facebook_page:', '')));
                let subscribed; try { subscribed = JSON.parse(page?.subscribed_fields || '[]'); } catch { subscribed = []; }
                if (page?.webhook_subscribed !== 1 || !subscribed.includes('message_echoes')) return 'native_messenger_echo_subscription_required';
            }
            return null;
        };
        adapter.configured = async input => !adapter.configurationReason(input) && await nativeConfigured(input) === true;
    }
    Object.assign(nativeAdapters,createCollaborativeNativeReviewAdapters({database,encryption,nativeAdapters,now}));
    const mediaOwnerService=typeof nativeDependencies.mediaTransport?.upload==='function'&&typeof nativeDependencies.mediaTransport?.read==='function'
        &&typeof nativeDependencies.whatsappCredentials==='function'?new CollaborativeNativeMediaService({database,encryption,
            credentials:nativeDependencies.whatsappCredentials,transport:nativeDependencies.mediaTransport,verifyOwnerContext,verifyLocalPrincipal,now}):null;
    if(mediaOwnerService)nativeAdapters['media.manage:whatsapp']=mediaOwnerService.adapter();
    const getNativePolicy = createCollaborativeNativePolicy({ database, nativeAdapters, getNativeAuthority, now });
    const authorizationClient = new NativeCommandAuthorizationClient({ centerOrigin: config.centerOrigin,
        platformToken: config.platformToken, allowLoopback: config.allowLoopback === true, fetchImpl, now });
    const verifyNativeContext = createNativeCommandContextVerifier({ database, encryption, authorizationClient,
        platformToken: config.platformToken, getNativePolicy, resolveNativeNamespace, fetchImpl, now, allowLoopback: config.allowLoopback === true });
    const service = new CollaborativeExecutionService({ database, nativeAdapters, verifyNativeContext,
        authorizeEffect: command => authorizationClient.authorize(command), now });
    const protocol = new NativeCommandProtocol({ database, callbackToken: config.callbackToken,
        signaturePathPrefix: config.signaturePathPrefix || '', now });
    const discovery = createCollaborativeNativeDiscovery({ database, nativeAdapters, consents, getNativeAuthority,
        ownerActions: ownerApiReady ? ownerActions : {}, now,
        loadSubscriptionFacts: input => loadNativeSubscriptionFacts({ ...input, integrationService, now }) });
    const nativeRouter = createNativeCommandAdapterRouter({ protocol, service, discovery: discovery.discovery,
        products: discovery.products, enrollments: { read: context => typeof nativeEnrollmentService.readForCore === 'function'
            ? nativeEnrollmentService.readForCore(context) : nativeEnrollmentService.read(context),
            enroll: (context, options) => nativeEnrollmentService.enroll(context, options) } });
    const ownerService = ownerApiReady ? new CollaborativeNativeOwnerService({ database, nativeAdapters, consents,
        verifyOwnerContext, verifyLocalPrincipal, now }) : null;
    const businessOwnerService=ownerApiReady?new CollaborativeNativeBusinessOwnerService({database,nativeAdapters,consents,verifyOwnerContext,verifyLocalPrincipal,now}):null;
    if(ownerService&&mediaOwnerService){const options=ownerService.options.bind(ownerService);const preview=ownerService.preview.bind(ownerService);
        ownerService.options=(principal,input)=>input?.capability==='media.manage'?mediaOwnerService.options(principal,input):options(principal,input);
        ownerService.preview=(principal,input)=>input?.capability==='media.manage'?mediaOwnerService.preview(principal,input):preview(principal,input);}
    const ownerRouter = ownerService ? createCollaborativeNativeRouter({ service: ownerService,businessService:businessOwnerService,mediaService:mediaOwnerService, appOrigin: config.appOrigin }) : null;
    return { service, nativeAdapters, getNativePolicy, consents, authorizationClient, protocol,
        verifyNativeContext, discovery, nativeRouter, ownerService,businessOwnerService,mediaOwnerService, ownerRouter, ownerApiReady, effectEvidence,
        getRegistry: () => service.getRegistry() };
};
