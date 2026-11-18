import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateAdapterCommand, validateEffectAuthorization, validateExecutionContext, validateSchemaModel, validateNativeCommandModel, assertNativeParameterContract } from './nativeCommandModels.js';
import { NativeCommandProtocolError, nativeCommandJson } from './nativeCommandProtocol.js';

const fail = code => { throw new NativeCommandProtocolError(code, 403); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 255;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const scope = value => ({ organization_id: value.organization_id, activity_id: value.activity_id,
    branch_id: value.branch_id ?? null, warehouse_id: value.warehouse_id ?? null });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const delegationFields = ['grant_approved_by', 'native_authority_revision', 'capability_grant_revision',
    'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs'];
const namespaceFields = ['namespace_installation_id', 'namespace_epoch', 'namespace_version'];
const namespaceModels = JSON.parse(fs.readFileSync(new URL('../config/native-service-namespace-v1.json', import.meta.url), 'utf8')).models;
const namespacePins = value => {
    const count = namespaceFields.filter(key => value?.[key] != null).length;
    if (count === 0) return null;
    if (count !== 3 || !text(value.namespace_installation_id) || !Number.isSafeInteger(value.namespace_epoch)
        || value.namespace_epoch < 1 || !Number.isSafeInteger(value.namespace_version) || value.namespace_version < 1) fail('native_namespace_proof_invalid');
    return Object.fromEntries(namespaceFields.map(key => [key, value[key]]));
};
const enrollmentScopes = value => Array.isArray(value) && value.length >= 1 && value.length <= 2
    && new Set(value).size === value.length && value.every(item => ['savana.products.sync', 'savana.collaboration.v1'].includes(item));
const viewerDelegation = context => {
    const result = { ...context };
    for (const key of ['allowed_fields', 'resource_refs', 'scope_epochs']) {
        if (typeof result[key] === 'string') {
            if (result[key].length > 65_536) fail('native_viewer_delegation_invalid');
            try { result[key] = JSON.parse(result[key]); } catch { fail('native_viewer_delegation_invalid'); }
        }
        if (key === 'scope_epochs' && result[key] === undefined) result[key] = [];
        if (!Array.isArray(result[key]) || result[key].length > 100) fail('native_viewer_delegation_invalid');
    }
    if (typeof result.capability_grant_revision === 'string' && /^[1-9][0-9]*$/.test(result.capability_grant_revision)) {
        result.capability_grant_revision = Number(result.capability_grant_revision);
    }
    if (!text(result.grant_approved_by) || !text(result.native_authority_revision)
        || !Number.isSafeInteger(result.capability_grant_revision) || result.capability_grant_revision < 1
        || !['new_only', 'selected', 'activity'].includes(result.resource_policy)
        || result.allowed_fields.some(value => !text(value)) || result.resource_refs.some(value => !text(value))) fail('native_viewer_delegation_invalid');
    return result;
};

// This callback is used only behind authenticated NativeCommandProtocol routes.
// Core owns current member/delegation checks for the signed viewer. Native
// account, retained enrollment, resources and effect policy are checked here;
// an approved execution also receives a fresh signed authorize-effect proof.
export const createNativeCommandContextVerifier = ({ database, encryption, authorizationClient,
    platformToken, getNativePolicy, resolveNativeNamespace = null, fetchImpl = globalThis.fetch, now = () => Date.now(), allowLoopback = false }) => {
    if (!database || typeof encryption?.decrypt !== 'function' || typeof authorizationClient?.authorize !== 'function'
        || typeof getNativePolicy !== 'function' || typeof fetchImpl !== 'function'
        || typeof platformToken !== 'string' || !platformToken
        || (resolveNativeNamespace !== null && typeof resolveNativeNamespace !== 'function')) throw new TypeError('Native context requires real account, enrollment, authorization and policy readers');
    const origin = authorizationClient.origin;
    if (typeof origin !== 'string' || new URL(origin).origin !== origin) throw new TypeError('Use the verified Core authorization client origin');
    const core = new URL(origin);
    const privateCore = core.protocol === 'http:' && core.hostname === 'savana-connect' && core.port === '8010';
    const loopback = allowLoopback === true && core.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(core.hostname);
    if (!(core.protocol === 'https:' || privateCore || loopback)) throw new TypeError('Native context requires a trusted Core service origin');
    const own = (context, expectedScope) => {
        if (!context || !text(context.actor_id) || !text(context.organization_id) || !text(context.activity_id)
            || (context.session_version !== undefined && !/^(?:[1-9][0-9]*)$/.test(String(context.session_version)))
            || !/^wa_savana:tenant:[1-9][0-9]*$/.test(context.external_tenant_id || '')) fail('native_viewer_context_invalid');
        const tenantId = Number(context.external_tenant_id.slice('wa_savana:tenant:'.length));
        if (!Number.isSafeInteger(tenantId) || (expectedScope && (expectedScope.organization_id !== context.organization_id
            || expectedScope.activity_id !== context.activity_id))) fail('native_viewer_context_changed');
        const tenant = database.prepare('SELECT id,status FROM tenants WHERE id=?').get(tenantId);
        if (!['Active', 'Warning'].includes(tenant?.status)) fail('native_account_inactive');
        const enrollment = database.prepare('SELECT * FROM savana_operational_consumer_enrollments WHERE tenant_id=?').get(tenantId);
        if (!enrollment || enrollment.state !== 'completed' || enrollment.organization_id !== context.organization_id
            || enrollment.external_tenant_id !== context.external_tenant_id || enrollment.center_origin !== origin) fail('native_enrollment_required');
        try {
            const envelope = JSON.parse(encryption.decrypt(enrollment.encrypted_private_key));
            const request = JSON.parse(enrollment.request_json); const response = JSON.parse(enrollment.response_json);
            const sameAcceptedScopes = enrollmentScopes(request.accepted_scopes) && enrollmentScopes(response.accepted_scopes)
                && same([...response.accepted_scopes].sort(), [...request.accepted_scopes].sort());
            const extendedAcceptedScopes = same(request.accepted_scopes, ['savana.products.sync'])
                && enrollmentScopes(response.accepted_scopes) && response.accepted_scopes.length === 2 && response.version >= 2
                && database.prepare(`SELECT 1 FROM savana_native_enrollment_service_audit WHERE enrollment_id=? AND tenant_id=?
                    AND organization_id=? AND action='registration_extended' AND state='completed' LIMIT 1`)
                    .get(enrollment.id, tenantId, context.organization_id);
            const privateKey = crypto.createPrivateKey(envelope.private_key_pem);
            const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
            if (envelope.purpose !== 'wa_consumer_enrollment_key' || envelope.enrollment_id !== enrollment.id
                || envelope.tenant_id !== tenantId || envelope.organization_id !== context.organization_id
                || privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048
                || publicKey !== request.public_key_pem || sha(publicKey) !== enrollment.public_key_fingerprint
                || request.organization_id !== context.organization_id || request.external_tenant_id !== context.external_tenant_id
                || !enrollmentScopes(request.accepted_scopes)
                || sha(enrollment.request_json) !== enrollment.request_sha256
                || !text(response.enrollment_id) || response.organization_id !== context.organization_id
                || response.platform !== 'wa_savana' || response.external_tenant_id !== context.external_tenant_id
                || response.display_name !== request.display_name || !Number.isSafeInteger(response.version) || response.version < 1
                || (!sameAcceptedScopes && !extendedAcceptedScopes)
                || response.public_key_fingerprint !== enrollment.public_key_fingerprint) throw new Error();
            return { nativeTenantId: tenantId, enrollmentId: response.enrollment_id, enrollmentVersion: response.version,
                acceptedScopes: response.accepted_scopes,
                identity: [tenantId, enrollment.id, response.enrollment_id, response.version, response.accepted_scopes,
                    enrollment.public_key_fingerprint, enrollment.request_sha256] };
        } catch { fail('native_enrollment_key_unavailable'); }
    };
    const namespace = async ({ command, context, action, initial, policy, nativeBinding }) => {
        const originalPins = namespacePins(command);
        const currentPins = action === 'execute' ? originalPins : namespacePins(context) || originalPins;
        if (!currentPins) return null;
        if (originalPins && currentPins.namespace_installation_id !== originalPins.namespace_installation_id) fail('native_namespace_installation_changed');
        if (!resolveNativeNamespace || !initial.acceptedScopes.includes('savana.collaboration.v1')) fail('native_namespace_lookup_required');
        let response;
        try {
            response = await resolveNativeNamespace({ namespaceInstallationId: currentPins.namespace_installation_id,
                nativeTenantId: initial.nativeTenantId, scope: command.scope ? scope(command.scope) : scope(context),
                providerRef: command.provider_ref || context.provider_ref || null, externalTenantId: context.external_tenant_id,
                action, ...(action === 'validate' ? { validationOnly: true } : {}), enrollmentId: initial.enrollmentId, enrollmentVersion: initial.enrollmentVersion,
                nativeAuthorityRevision: policy.nativeAuthorityRevision, nativeBindingId: nativeBinding });
            validateSchemaModel(namespaceModels, 'NamespaceResponse', response);
        } catch { fail('native_namespace_unverified'); }
        const expected = command.scope ? scope(command.scope) : scope(context);
        if (!text(response.namespace_id) || response.platform !== 'wa_savana' || response.authority_domain !== 'native.service_namespace'
            || response.organization_id !== expected.organization_id
            || (action === 'validate' ? response.scope.organization_id !== expected.organization_id
                || response.scope.activity_id !== expected.activity_id : !same(scope(response.scope), expected))
            || response.external_tenant_id !== context.external_tenant_id
            || response.source_installation_id !== currentPins.namespace_installation_id
            || (command.provider_ref && response.provider_ref !== command.provider_ref)
            || response.enrollment_id !== initial.enrollmentId
            || response.grants_created !== false || response.product_credentials_created !== false || response.resource_authority_created !== false) fail('native_namespace_binding_changed');
        if (['execute', 'validate'].includes(action) && (response.state !== 'active' || Date.parse(response.expires_at) <= now()
            || response.ownership_epoch !== currentPins.namespace_epoch || response.version !== currentPins.namespace_version
            || response.enrollment_version !== initial.enrollmentVersion
            || response.native_authority_revision !== policy.nativeAuthorityRevision)) fail('native_namespace_execution_stale');
        return JSON.parse(nativeCommandJson(response));
    };
    const binding = async context => {
        const url = new URL('/v1/platform-bindings', origin);
        url.searchParams.set('external_tenant_id', context.external_tenant_id);
        let rows;
        try {
            const response = await fetchImpl(url.href, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
                headers: { 'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': platformToken } });
            const raw = await response.text();
            if (!response.ok || Buffer.byteLength(raw) > 1_048_576) throw new Error();
            rows = JSON.parse(raw);
        } catch { fail('native_platform_binding_unavailable'); }
        if (!Array.isArray(rows) || rows.length !== 1 || !text(rows[0]?.id) || rows[0].platform_code !== 'wa_savana'
            || rows[0].external_tenant_id !== context.external_tenant_id || rows[0].organization_id !== context.organization_id
            || rows[0].status !== 'active') fail('native_platform_binding_changed');
        return rows[0].id;
    };
    return async ({ command, context, action, resourceSelection = null }) => {
        if (!['execute', 'validate', 'reconcile', 'result'].includes(action)) fail('native_context_action_invalid');
        if (action !== 'validate') validateAdapterCommand(command);
        if (action === 'validate') validateNativeCommandModel('NativeValidationContext', context);
        if (action === 'execute') assertNativeParameterContract(command);
        if (['consumer_authorization_revision', 'allowed_value_contexts', 'semantic_value_keys'].some(key => Object.hasOwn(context || {}, key))) fail('native_viewer_context_invalid');
        const authority=action==='execute'?command:context;
        if(authority?.authority_domain==='native.service_namespace'&&!namespacePins(authority))fail('native_namespace_proof_invalid');
        if(action==='execute'&&['authority_domain','ownership_epoch'].some(key=>(command[key]??null)!==(context[key]??null)))fail('native_command_authorization_changed');
        const viewerSnapshot = nativeCommandJson(context); const commandSnapshot = nativeCommandJson(command);
        const assertUnchanged = () => { if (nativeCommandJson(context) !== viewerSnapshot
            || nativeCommandJson(command) !== commandSnapshot) fail('native_viewer_context_changed'); };
        const expectedScope = action === 'validate' ? null : command.scope;
        const delegation = action === 'execute' ? command : viewerDelegation(context);
        const initial = own(context, expectedScope); const nativeBinding = await binding(context);
        assertUnchanged();
        if (!same(initial.identity, own(context, expectedScope).identity)) fail('native_viewer_context_changed');
        let effectiveScope = expectedScope ? scope(expectedScope) : scope(context);
        if (action === 'validate' && namespacePins(context)) {
            const scoped = await namespace({ command, context: delegation, action, initial,
                policy: { nativeAuthorityRevision: delegation.native_authority_revision }, nativeBinding });
            effectiveScope = scope(scoped.scope);
            assertUnchanged();
        }
        const policy = await getNativePolicy({ command, nativeTenantId: initial.nativeTenantId, resourceSelection, action,
            scope: effectiveScope, actorId: context.actor_id, delegation });
        assertUnchanged();
        if (policy?.verified !== true || policy.nativeTenantId !== initial.nativeTenantId
            || !Number.isFinite(Date.parse(policy.validUntil)) || Date.parse(policy.validUntil) <= now()
            || policy.nativeAuthorityRevision !== delegation.native_authority_revision
            || (['execute', 'validate'].includes(action) && !/^[a-f0-9]{64}$/.test(policy.resourceFingerprint || ''))) fail('native_policy_unverified');
        const initialNamespace = await namespace({ command, context: delegation, action, initial, policy, nativeBinding });
        if (action === 'validate' && initialNamespace && !same(scope(initialNamespace.scope), effectiveScope)) fail('native_namespace_changed_during_authorization');
        let currentNamespace = initialNamespace;
        assertUnchanged();
        let authorization;
        if (action === 'execute') {
            if (command.actor_id !== context.actor_id || command.external_tenant_id !== context.external_tenant_id) fail('native_viewer_context_changed');
            authorization = validateEffectAuthorization(await authorizationClient.authorize(command));
            assertUnchanged();
            if (['command_id', 'version', 'fingerprint', 'attempt_id', 'authorization_revision'].some(key => authorization[key] !== command[key])) fail('native_command_authorization_changed');
            if (delegationFields.some(key => !Object.hasOwn(command, key)
                || nativeCommandJson(authorization[key]) !== nativeCommandJson(command[key]))) fail('native_command_authorization_changed');
            if ([...namespaceFields,'authority_domain','ownership_epoch'].some(key => (authorization[key] ?? null) !== (command[key] ?? null))) fail('native_namespace_authorization_changed');
            for (const key of ['effect_fields', 'effect_resources', 'creates_resource', 'effect_values']) {
                if (nativeCommandJson(authorization[key] ?? null) !== nativeCommandJson(command[key] ?? null)) fail('native_command_authorization_changed');
            }
            if (command.validation_revision !== policy.resourceFingerprint || Date.parse(command.validation_valid_until) <= now()) fail('native_validation_changed');
        }
        const current = own(context, expectedScope);
        const currentBinding = await binding(context);
        assertUnchanged();
        if (!same(initial.identity, current.identity) || nativeBinding !== currentBinding
            || !same(initial.identity, own(context, expectedScope).identity) || Date.parse(policy.validUntil) <= now()) fail('native_viewer_context_changed');
        if (authorization && Date.parse(authorization.valid_until) <= now()) fail('native_command_authorization_changed');
        if (action === 'execute' && Date.parse(command.validation_valid_until) <= now()) fail('native_validation_changed');
        if (initialNamespace) {
            const finalNamespace = await namespace({ command, context: delegation, action, initial: current, policy, nativeBinding: currentBinding });
            currentNamespace = finalNamespace;
            assertUnchanged();
            if (!same(initial.identity, own(context, expectedScope).identity)
                || initialNamespace.namespace_id !== finalNamespace.namespace_id
                || initialNamespace.source_installation_id !== finalNamespace.source_installation_id
                || (['execute', 'validate'].includes(action) && !same(initialNamespace, finalNamespace))) fail('native_namespace_changed_during_authorization');
        }
        if (authorization && Date.parse(authorization.valid_until) <= now()) fail('native_command_authorization_changed');
        const validUntil = new Date(Math.min(now() + 30_000, Date.parse(policy.validUntil),
            ['execute', 'validate'].includes(action) && currentNamespace ? Date.parse(currentNamespace.expires_at) : Infinity,
            authorization ? Math.min(Date.parse(authorization.valid_until), Date.parse(command.validation_valid_until)) : Infinity)).toISOString();
        const result = { verified: true, localPolicyVerified: true, nativeTenantId: current.nativeTenantId,
            resourceSelection: policy.resourceSelection ?? resourceSelection, resourceFingerprint: policy.resourceFingerprint ?? null };
        if (action !== 'execute') return { ...result, viewer: { scope: effectiveScope,
            actorId: context.actor_id, validUntil, allowedFields: delegation.allowed_fields,
            resourcePolicy: delegation.resource_policy, resourceRefs: delegation.resource_refs } };
        const executionContext = validateExecutionContext({ actor_id: command.actor_id, scope: scope(command.scope),
            provider_ref: command.provider_ref, provider_platform: 'wa_savana', provider_installation_id: command.provider_installation_id,
            external_tenant_id: command.external_tenant_id, authorization_revision: authorization.authorization_revision,
            valid_until: validUntil, allowed_fields: authorization.allowed_fields, ownership_epoch: command.ownership_epoch ?? null,
            authority_domain:command.authority_domain??null,
            grant_approved_by: authorization.grant_approved_by, native_authority_revision: authorization.native_authority_revision,
            capability_grant_revision: authorization.capability_grant_revision, resource_policy: authorization.resource_policy,
            resource_refs: authorization.resource_refs, scope_epochs: authorization.scope_epochs,
            validation_revision: command.validation_revision, validation_valid_until: command.validation_valid_until,
            namespace_installation_id: command.namespace_installation_id ?? null, namespace_epoch: command.namespace_epoch ?? null,
            namespace_version: command.namespace_version ?? null,
            source_local_id: command.source_local_id ?? null, expected_source_revision: command.expected_source_revision ?? null });
        return { ...result, executionContext };
    };
};
