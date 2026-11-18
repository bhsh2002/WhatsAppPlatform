import { evaluateLocalIntegrationCapabilities, LOCAL_REQUEST_CAPABILITIES, projectScopedCapabilityActions, SCOPED_CAPABILITY_CODES } from './integrationCapabilities.js';

export class IntegrationAvailabilityError extends Error {
    constructor(code, statusCode = 403) {
        super(code);
        this.name = 'IntegrationAvailabilityError';
        this.code = code;
        this.statusCode = statusCode;
        this.status = statusCode;
    }
}
const principalKeys = ['userId', 'tenantId', 'sessionId', 'authVersion', 'role', 'issuedAt', 'sessionExpiresAt'];
const identity = principal => JSON.stringify(principalKeys.map(key => principal?.[key] ?? null));
const copyPrincipal = principal => Object.freeze(Object.fromEntries(principalKeys.map(key => [key, principal?.[key]])));
const safeChannel = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value);
const factChecks = ['handler_registered', 'handler_qualified', 'deployment_ready', 'actor_authorized',
    'review_authorized', 'resource_authorized', 'provider_selected', 'provider_ready', 'recipient_ready',
    'content_ready', 'consent_confirmed', 'budget_sufficient', 'outcome_clear', 'data_fresh'];
const tri = value => typeof value === 'boolean' ? value : null;

// Dependencies read authoritative facts; this service performs no provider call,
// billing reservation, approval, dispatch, cache write or grant creation.
export const createIntegrationAvailabilityService = ({
    verifyPrincipal, loadPlatformFacts, getRegistry, getCapabilityFacts, now = () => Date.now(),
} = {}) => {
    for (const dependency of [verifyPrincipal, loadPlatformFacts, getRegistry, getCapabilityFacts, now]) {
        if (typeof dependency !== 'function') throw new TypeError('Availability requires explicit server fact readers');
    }
    return {
        async forPlatform(principal, platformCode, { requestId = null, selection = null } = {}) {
            if (!['pos', 'catalog', 'sawemly'].includes(platformCode)) {
                throw new IntegrationAvailabilityError('availability_platform_unsupported', 422);
            }
            const snapshot = copyPrincipal(principal);
            const originalIdentity = identity(principal);
            if (snapshot.userId == null || snapshot.tenantId == null || !snapshot.sessionId
                || !Number.isSafeInteger(snapshot.authVersion)) {
                throw new IntegrationAvailabilityError('availability_principal_required');
            }
            const assertCurrent = async () => {
                let verified = false;
                try { verified = await verifyPrincipal(snapshot); } catch { /* Return only a fixed native identity error. */ }
                if (identity(principal) !== originalIdentity || verified !== true
                    || identity(principal) !== originalIdentity) {
                    throw new IntegrationAvailabilityError('availability_principal_changed');
                }
            };
            const context = Object.freeze({ principal: snapshot, platformCode, requestId,
                selection: selection == null ? null : structuredClone(selection) });
            await assertCurrent();
            let platformFacts;
            try { platformFacts = await loadPlatformFacts(context); }
            catch { platformFacts = { platformDiscovery: { error: true }, subscription: { error: true } }; }
            await assertCurrent();
            let registry = []; let registryError = false;
            try {
                registry = await getRegistry(context);
                if (!Array.isArray(registry)) throw new TypeError('Invalid implementation registry');
                const seen = new Set();
                for (const row of registry) {
                    const descriptor = LOCAL_REQUEST_CAPABILITIES.find(item => item.capability_id === row?.capability_id);
                    if (!descriptor) continue;
                    if (seen.has(row.capability_id) || row.request_kind !== descriptor.request_kind
                        || row.canonical_capability_id !== descriptor.capability_code
                        || row.review_capability_id !== descriptor.review_capability_code
                        || !Array.isArray(row.channels) || row.channels.length > 12
                        || row.channels.some(channel => !safeChannel(channel))
                        || new Set(row.channels).size !== row.channels.length) throw new TypeError('Invalid implementation registry');
                    seen.add(row.capability_id);
                }
            } catch { registry = []; registryError = true; }
            await assertCurrent();
            let loaded = {}; let lookupFailed = false;
            try {
                loaded = await getCapabilityFacts(context);
                if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new TypeError('Invalid readiness facts');
            } catch { lookupFailed = true; }
            await assertCurrent();
            const capabilityFacts = Object.fromEntries(LOCAL_REQUEST_CAPABILITIES.map(descriptor => {
                const raw = loaded[descriptor.capability_id] || {};
                const row = registry.find(item => item.capability_id === descriptor.capability_id);
                const channel = safeChannel(raw.channel) ? raw.channel : null;
                const channelMatchesSelection = !selection?.channel || channel === selection.channel;
                const registered = !registryError && row?.implemented === true && row.channels.length > 0;
                return [descriptor.capability_id, {
                    ...Object.fromEntries(factChecks.map(key => [key, tri(raw[key])])),
                    handler_registered: registryError ? null : registered && raw.handler_registered === true,
                    handler_registry_error: registryError, lookup_failed: lookupFailed,
                    execution_readiness: raw.execution_readiness || row?.execution_readiness,
                    review_readiness: raw.review_readiness || row?.review_readiness,
                    channel, channel_implemented: registered && raw.handler_registered === true
                        && channelMatchesSelection && channel != null && row.channels.includes(channel),
                    checked_at: typeof raw.checked_at === 'string' ? raw.checked_at : null,
                    valid_until: typeof raw.valid_until === 'string' ? raw.valid_until : null,
                }];
            }));
            return evaluateLocalIntegrationCapabilities({ ...platformFacts, sourcePlatform: platformCode,
                capabilityFacts, now: now() });
        },
    };
};

export const createScopedCapabilityAvailabilityService = ({ verifyPrincipal, loadActions, now = () => Date.now() } = {}) => {
    if ([verifyPrincipal, loadActions, now].some(value => typeof value !== 'function')) {
        throw new TypeError('Scoped availability requires explicit server action readers');
    }
    return {
        async forCapabilities(principal, { selection = null } = {}) {
            const snapshot = copyPrincipal(principal); const initial = identity(principal);
            if (snapshot.userId == null || snapshot.tenantId == null || !snapshot.sessionId
                || !Number.isSafeInteger(snapshot.authVersion)) throw new IntegrationAvailabilityError('availability_principal_required');
            const current = async () => {
                let valid = false;
                try { valid = await verifyPrincipal(snapshot); } catch { /* Fixed identity failure only. */ }
                if (valid !== true || identity(principal) !== initial) throw new IntegrationAvailabilityError('availability_principal_changed');
            };
            await current();
            let loaded;
            try { loaded = await loadActions({ principal: snapshot, selection: selection == null ? null : structuredClone(selection) }); }
            catch { await current(); throw new IntegrationAvailabilityError('availability_verification_unavailable', 503); }
            await current();
            if (!Array.isArray(loaded) || loaded.length > 5 || new Set(loaded.map(row => row?.capability_code)).size !== loaded.length) {
                throw new IntegrationAvailabilityError('availability_response_invalid', 503);
            }
            try {
                if (loaded.some(row => !SCOPED_CAPABILITY_CODES.includes(row?.capability_code))) throw new TypeError('Unknown scoped capability');
                return SCOPED_CAPABILITY_CODES.map(code => {
                    const row = loaded.find(item => item.capability_code === code);
                    return projectScopedCapabilityActions({ capability_code: code, actions: row?.actions || [], now: now() });
                });
            }
            catch { throw new IntegrationAvailabilityError('availability_response_invalid', 503); }
        },
    };
};
