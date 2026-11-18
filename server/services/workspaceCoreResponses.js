import fs from 'node:fs';
import crypto from 'node:crypto';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { SharedProductReadError } from './centralProductRead.js';
import { validateSchemaModel } from './nativeCommandModels.js';
import { validateWorkspaceCoreModel } from './workspaceCoreModels.js';

// Consumer validation only, using exact closed schemas and separately pinned
// owned HTTP receipts: workspace190dd989…, sharingda714a1a…, nativebf8dd5d4….
// Metadata availability and redacted evidence never permit command dispatch.
const invalid = () => { throw new SharedProductReadError('workspace_response_invalid', 502); };
export const WORKSPACE_RESPONSE_OPTIONS_SHA256 = '279a8a48322652f5a1ac19f66b0e7ccafb5ebc996d09860453904c50a516b76c';
export const WORKSPACE_PROVIDER_CONFIRMATION_SHA256 = '424215bd7c1273bb229ceac9a0bcca06692b514a124c90b599b37e26b2766f28';
const published = (name, expected) => {
    const bytes = fs.readFileSync(new URL('../config/' + name, import.meta.url));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new TypeError('Unreviewed workspace response schema');
    return JSON.parse(bytes);
};
const optionDocument = published('peer-owner-workspace-response-options-v3.schema.json', WORKSPACE_RESPONSE_OPTIONS_SHA256);
const optionModels = Object.fromEntries(Object.entries(optionDocument.$defs).map(([name, schema]) => [name, { ...schema, $defs: optionDocument.$defs }]));
const providerModels = { WorkspaceProviderConfirmation: published('workspace-provider-confirmation-v1.schema.json', WORKSPACE_PROVIDER_CONFIRMATION_SHA256) };
const official = (models, name, value) => { try { validateSchemaModel(models, name, value); } catch { invalid(); } };
const check = value => { if (!value) invalid(); };
const clone = raw => { try { return JSON.parse(canonicalWorkspaceJson(raw)); } catch { return invalid(); } };
const text = (value, max = 255, empty = false) => check(typeof value === 'string' && (empty || value.length > 0)
    && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/u.test(value)
    && !value.includes('REDACTED_AUTHENTICATION_VALUE'));
const id = value => text(value);
const label = value => text(value, 1000);
const message = value => text(value, 4000, true);
const bool = value => check(typeof value === 'boolean');
const integer = (value, min = 1) => check(Number.isSafeInteger(value) && value >= min);
const positive = value => integer(value);
const zero = value => integer(value, 0);
const literal = expected => value => check(value === expected);
const one = values => value => check(values.includes(value));
const nullable = validate => value => value === null ? undefined : validate(value);
const list = (validate, max = 1000, distinct = false, min = 0) => value => {
    check(Array.isArray(value) && value.length >= min && value.length <= max);
    value.forEach(validate);
    if (distinct) check(new Set(value.map(item => JSON.stringify(item))).size === value.length);
};
const ids = list(id, 1000, true);
const shape = (value, fields, optional = []) => {
    check(value && typeof value === 'object' && !Array.isArray(value));
    check(Object.keys(value).every(key => Object.hasOwn(fields, key))
        && Object.keys(fields).every(key => optional.includes(key) || Object.hasOwn(value, key)));
    for (const [key, item] of Object.entries(value)) fields[key](item);
    return value;
};
const date = value => {
    text(value, 80);
    check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    check(month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate());
};
const hash = value => check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
const PLATFORM = ['catalog', 'sawemly', 'wa_savana'];
const FIELDS = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media', 'is_visible'];
const OPERATIONS = ['upsert', 'hide', 'unhide', 'archive', 'tombstone', 'restore'];
const ACTIONS = ['source.request', 'source.approve', 'origin.request', 'origin.approve', 'read.request', 'read.approve',
    'fields.approve', 'source.manage', 'read.manage', 'reviews.read', 'operations.inspect',
    'commands.read', 'commands.request', 'commands.approve', 'commands.execute', 'commands.reconcile'];
const STATES = ['available', 'review_available', 'implementation_missing', 'not_supported', 'configuration_required', 'subscription_required',
    'permission_required', 'resource_scope_required', 'provider_selection_required', 'connection_required', 'connection_pending', 'connection_paused',
    'connection_revoked', 'approval_required', 'consent_required', 'balance_required', 'quote_required', 'offline', 'authorization_stale', 'outcome_unknown', 'provider_unavailable'];
const CODE = ['campaigns.execute', 'campaigns.review', 'collections.manage', 'content.publish', 'content.review', 'customers.manage',
    'inventory.count', 'inventory.facts', 'inventory.read', 'inventory.transfer', 'measurement.export', 'measurement.read', 'media.manage',
    'messaging.review', 'messaging.send', 'offerings.manage', 'orders.fulfil', 'orders.request', 'owner.operations', 'prices.manage',
    'products.read', 'products.write', 'services.reserve', 'shelves.read', 'units.variants'];
const choice = value => shape(value, { value: id, label });
const choices = list(choice, 1000);
const organization = value => shape(value, { id, name: label });
const rootActivity = value => shape(value, { activity_id: id, label });
const scope = value => shape(value, { organization_id: id, activity_id: id, branch_id: nullable(id), warehouse_id: nullable(id) }, ['branch_id', 'warehouse_id']);
const bindScope = (value, identity, expected) => {
    scope(value); check(value.organization_id === identity.organizationId);
    if (expected) check(['organization_id', 'activity_id', 'branch_id', 'warehouse_id'].every(key => (value[key] ?? null) === (expected[key] ?? null)));
};
const url = (value, policy = {}) => {
    text(value, 4096); check(!/[\\\s]/u.test(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(value));
    if (value.startsWith('/')) { check(!value.startsWith('//') && !/%2f/i.test(value)); return; }
    let parsed; try { parsed = new URL(value); } catch { invalid(); }
    const loopback = policy.allowLoopback === true && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port;
    check((parsed.protocol === 'https:' || loopback) && !parsed.username && !parsed.password);
    if (policy.allowedOrigins) check(policy.allowedOrigins.includes(parsed.origin));
};
const ownerOrigins = (value, policy = {}) => {
    // These origins came from the authenticated Core response's operator-
    // validated registry, not from a browser claim. Validate safety separately
    // from the consumer's Core/WA allowlist before admitting exact native hosts.
    list(origin => {
        url(origin, { allowLoopback: policy.allowLoopback === true });
        let parsed; try { parsed = new URL(origin); } catch { invalid(); }
        check(parsed.origin === origin);
    }, 100, true)(value);
    return value;
};
const withOwnerOrigins = (policy, origins) => ({ ...policy,
    ...(policy.allowedOrigins ? { allowedOrigins: [...new Set([...policy.allowedOrigins, ...origins])] } : {}) });
const next = (value, policy, hasCode = true) => shape(value, { ...(hasCode ? { code: id } : {}), label, href: v => url(v, policy) });
const availability = (value, policy = {}) => shape(value, { state: one(policy.allowLegacyProviderSetup ? [...STATES, 'setup_required'] : STATES),
    reason_code: id, message, next_action: v => next(v, policy) });
export const decodeWorkspaceAvailability = (raw, options = {}) => { const value = clone(raw); availability(value, options); return value; };
const policyChoices = value => shape(value, { unit_codes: choices, currencies: choices, price_lists: choices, channels: choices }, ['unit_codes', 'currencies', 'price_lists', 'channels']);
const proposalFields = {
    source_registration: { enrollment_id: id, enrollment_version: positive, installation_label: label, fields: list(one(FIELDS), 8, true, 1),
        allowed_operations: list(one(OPERATIONS), 6, true, 1), expires_at: date, allow_restore: bool, unit_codes: ids, currencies: ids, price_list_ids: ids, channels: ids },
    consumer_registration: { enrollment_id: id, enrollment_version: positive, installation_label: label },
    read_sharing: { source_installation_id: id, consumer_installation_id: id, fields: list(one(FIELDS), 8, true, 1), reader_account_ids: list(id, 1000, true, 1), expires_at: date },
    native_origin: { source_installation_id: id, approval_reference: id, local_product_id: id, kind: literal('goods'), initially_visible: bool },
};
const origin = value => shape(value, { evidence_id: id, enrollment_id: id, enrollment_version: positive, kind: literal('goods'), local_product_id: id,
    origin_reference: id, provenance: literal('native_created'), scope, source_evidence_sha256: hash, service_signature_verified: literal(true) });
const effective = (kind, value) => {
    if (value === null) return;
    const managed = { active: bool, superseded_by_request: id };
    if (kind === 'source_registration') shape(value, { publisher_grant_id: id, installation_id: id, ownership_epoch: positive,
        fields: list(one(FIELDS), 8, true), allowed_operations: list(one(OPERATIONS), 6, true), revision: positive, expires_at: date, delivery_id: id, ...managed }, Object.keys(managed));
    else if (kind === 'consumer_registration') shape(value, { installation_id: id, enrollment_id: id });
    else if (kind === 'read_sharing') shape(value, { ...proposalFields.read_sharing, read_grant_id: id, revision: positive, ...managed }, Object.keys(managed));
    else shape(value, { ...proposalFields.native_origin, entity_id: id, origin_evidence: origin });
};
const requestValue = (value, identity, options = {}) => {
    check(Object.hasOwn(proposalFields, value?.kind));
    shape(value, { request_id: id, organization_id: id, scope, version: positive, state: one(['pending', 'approved', 'rejected']), requested_by: id,
        reviewed_by: nullable(id), effective_version: nullable(positive), reason: nullable(message), updated_at: date, approval_policy: message,
        kind: one(Object.keys(proposalFields)), proposal: v => shape(v, proposalFields[value.kind]), effective_resource: v => effective(value.kind, v),
        activity_id: id, title: label, selection: workspaceSelectionInput, summary: list(v => shape(v, { label, value: message }), 100) },
    ['activity_id', 'title', 'selection', 'summary']);
    check(value.organization_id === identity.organizationId); bindScope(value.scope, identity, options.scope);
    if (value.activity_id) check(value.activity_id === value.scope.activity_id);
    if (value.selection) check(value.selection.activity_id === value.scope.activity_id && value.selection.kind === value.kind);
    check((value.effective_version === null) === (value.effective_resource === null));
    if (value.effective_version !== null) check(value.effective_version <= value.version);
    if (value.state === 'pending') check(value.reviewed_by === null && (value.effective_version === null || value.effective_version < value.version));
    if (value.state === 'approved') check(value.reviewed_by !== null && value.effective_version === value.version && value.effective_resource !== null);
    if (value.kind === 'source_registration') check(value.proposal.allowed_operations.includes('restore') === value.proposal.allow_restore);
    // An edited pending/rejected proposal may retain a prior effective policy.
    // Its independent typed version is history/current access, not approval of
    // the new proposal. Only a current approval must equal its current proposal.
    if (value.effective_resource && value.state === 'approved' && value.effective_version === value.version) {
        const sameSet = (a, b) => a.length === b.length && a.every(item => b.includes(item));
        const effective = value.effective_resource;
        if (value.kind === 'read_sharing') {
            for (const key of ['source_installation_id', 'consumer_installation_id']) check(effective[key] === value.proposal[key]);
            for (const key of ['fields', 'reader_account_ids']) check(sameSet(effective[key], value.proposal[key]));
        } else if (value.kind === 'source_registration') {
            for (const key of ['fields', 'allowed_operations']) check(sameSet(effective[key], value.proposal[key]));
        } else if (value.kind === 'consumer_registration') check(effective.enrollment_id === value.proposal.enrollment_id);
        else {
            bindScope(effective.origin_evidence.scope, identity, value.scope);
            for (const key of Object.keys(proposalFields.native_origin)) check(effective[key] === value.proposal[key]);
            check(effective.origin_evidence.evidence_id === value.proposal.approval_reference
                && effective.origin_evidence.local_product_id === value.proposal.local_product_id);
        }
        if (value.proposal.expires_at) check(Date.parse(effective.expires_at) === Date.parse(value.proposal.expires_at));
    }
    return value;
};
const workspaceSelectionInput = value => shape(value, { activity_id: id, kind: one(Object.keys(proposalFields)), provider_ref: nullable(id),
    source_installation_ref: nullable(id), consumer_installation_ref: nullable(id), native_product_ref: nullable(id), fields: list(one(FIELDS), 8, true),
    people_refs: ids, allowed_operations: list(one(OPERATIONS), 6, true), expires_at: nullable(date), allow_restore: bool,
    policy_choices: v => shape(v, { unit_codes: ids, currencies: ids, price_list_ids: ids, channels: ids }) });
const grantFields = { person_ref: id, provider_ref: id, capability_code: one(CODE), actions: list(one(['read', 'request', 'approve', 'execute', 'reconcile']), 5, true),
    allowed_fields: ids, resource_refs: ids, resource_policy: one(['new_only', 'selected', 'activity']), expires_at: date, version: positive };
const namespace = (value, identity, options = {}) => {
    shape(value, { spec_version: literal('1.0'), namespace_id: id, organization_id: id, scope, provider_ref: id, platform: one(PLATFORM), external_tenant_id: id,
        label, source_installation_id: id, enrollment_id: id, enrollment_version: positive, authority_domain: literal('native.service_namespace'),
        ownership_epoch: positive, version: positive, state: one(['active', 'revoked']), expires_at: date, native_authority_revision: id,
        grants_created: literal(false), product_credentials_created: literal(false), resource_authority_created: literal(false), activity_id: id }, ['activity_id']);
    check(value.organization_id === identity.organizationId); bindScope(value.scope, identity, options.scope);
    if (value.activity_id) check(value.activity_id === value.scope.activity_id);
    for (const [option, key] of [['providerRef', 'provider_ref'], ['externalTenantId', 'external_tenant_id']]) if (options[option]) check(value[key] === options[option]);
    return value;
};
export const decodeWorkspaceNamespace = (raw, identity, options = {}) => namespace(clone(raw), identity, options);
export const decodeWorkspaceRequest = (raw, identity, options = {}) => requestValue(clone(raw), identity, options);
export const decodeWorkspaceSelection = (raw, identity, options = {}) => {
    const value = clone(raw);
    shape(value, { spec_version: literal('1.0'), selection_id: id, selection_revision: hash, version: positive, organization, activity: rootActivity, scope,
        account: v => shape(v, { provider_ref: id, platform: one(PLATFORM), label, external_tenant_id: id }), consumer_installation_id: nullable(id),
        current_scoped_actions: list(one(ACTIONS), 16, true), grants_created: literal(false), next_action: v => next(v, options, false) });
    check(value.organization.id === identity.organizationId && value.activity.activity_id === value.scope.activity_id);
    bindScope(value.scope, identity, options.scope);
    check(value.account.external_tenant_id === (options.externalTenantId || identity.nativeAccountId));
    return value;
};
export const decodeWorkspaceActivity = (raw, _identity, options = {}) => {
    const value = clone(raw); shape(value, { activity_id: id, label, version: literal(1), grants_created: literal(false), next_action: v => next(v, options, false) }); return value;
};
export const decodeWorkspaceProviderPrepare = (raw, _identity, options = {}) => {
    const value = clone(raw);
    official(providerModels, 'WorkspaceProviderConfirmation', value);
    id(value.provider_ref); id(value.activity_id); text(value.label, 200); positive(value.enrollment_version);
    bindScope(value.scope, _identity, options.scope); check(value.activity_id === value.scope.activity_id);
    const enrollment = value.enrollment;
    id(enrollment.enrollment_id); id(enrollment.external_tenant_id); text(enrollment.display_name, 200);
    check(enrollment.organization_id === _identity.organizationId && enrollment.version === value.enrollment_version);
    check(new Set(enrollment.accepted_scopes).size === enrollment.accepted_scopes.length);
    if (options.providerRef) check(value.provider_ref === options.providerRef);
    if (options.activityId) check(value.activity_id === options.activityId);
    for (const [option, key] of [['platformCode', 'platform'], ['externalTenantId', 'external_tenant_id'],
        ['enrollmentId', 'enrollment_id'], ['publicKeyFingerprint', 'public_key_fingerprint']]) {
        if (options[option] !== undefined) check(enrollment[key] === options[option]);
    }
    if (options.enrollmentVersion !== undefined) check(enrollment.version === options.enrollmentVersion);
    if (options.status !== undefined) check(value.status === options.status);
    if (options.acceptedScopes !== undefined) check(Array.isArray(options.acceptedScopes)
        && enrollment.accepted_scopes.length === options.acceptedScopes.length
        && enrollment.accepted_scopes.every(item => options.acceptedScopes.includes(item)));
    return value;
};
export const decodeWorkspaceProviderConfirmation = decodeWorkspaceProviderPrepare;
export const decodeWorkspaceServiceShare = raw => {
    const value = clone(raw);
    try { validateWorkspaceCoreModel('ServiceShareResponse', value); } catch { invalid(); }
    for (const key of ['share_id', 'activity_id', 'source_provider_ref', 'consumer_provider_ref', 'reason_code']) id(value[key]);
    one(CODE)(value.capability_code); positive(value.version); date(value.expires_at);
    label(value.source_label); label(value.consumer_label);
    list(id, 100, true, 1)(value.people_refs); list(id, 100, true, 1)(value.allowed_fields); list(id, 100, true)(value.resource_refs);
    list(one(['read', 'request', 'approve', 'execute', 'reconcile']), 5, true, 1)(value.actions);
    list(person => shape(person, { person_ref: id, label }), 100)(value.people);
    check(new Set(value.people.map(person => person.person_ref)).size === value.people.length
        && value.people.length === value.people_refs.length && value.people.every(person => value.people_refs.includes(person.person_ref)));
    check(value.source_provider_ref !== value.consumer_provider_ref);
    if (value.resource_policy === 'selected') check(value.resource_refs.length > 0);
    if (value.effective) check(value.state === 'active' && value.source_approved && value.consumer_approved);
    return value;
};
export const decodeWorkspaceBinding = (raw, identity, options = {}) => {
    const value = clone(raw);
    shape(value, { id, platform_code: one(PLATFORM), external_tenant_id: id, status: one(['pending', 'approved', 'rejected', 'expired']), organization_id: id,
        created_at: date, expires_at: date, decided_at: nullable(date), display_name: label, redirect_uri: v => url(v, options),
        created_by_actor: id, decided_by_actor: nullable(id), organization_name: label, authorization_url: v => url(v, options) },
    ['display_name', 'redirect_uri', 'created_by_actor', 'decided_by_actor', 'organization_name', 'authorization_url']);
    check(value.organization_id === identity.organizationId && value.platform_code === (options.platformCode || 'wa_savana')
        && value.external_tenant_id === (options.externalTenantId || identity.nativeAccountId));
    if (value.created_by_actor) check(value.created_by_actor === identity.actorId);
    return value;
};
const resource = value => {
    official(optionModels, 'WorkspaceGrantResourceChoice', value);
    id(value.resource_ref); label(value.label);
    if (value.scope != null) scope(value.scope);
    if (value.authority_epoch != null) zero(value.authority_epoch);
    for (const key of ['authority_matches_provider', 'authority_assignable']) if (value[key] != null) bool(value[key]);
    if (value.authority_source_label != null) message(value.authority_source_label);
};
const commandOption = value => {
    official(optionModels, 'WorkspaceProductCommandOption', value);
    shape(value, { activity_id: id, provider_ref: id, capability: literal('products.write'), action: one(['product.create', 'product.change']),
        available: bool, allowed_fields: list(one(FIELDS), 8, true), authorization_revision: nullable(hash), source_installation_id: nullable(id),
        reason_code: nullable(id), message, record_ref: nullable(id), record_version: nullable(positive) }, ['record_ref', 'record_version']);
    // validateSchemaModel intentionally has no allOf/if/then/else support. These
    // are the exact two published conditional rules, enforced explicitly here.
    if (value.available) {
        check(value.authorization_revision !== null && value.source_installation_id !== null && value.allowed_fields.length > 0 && value.reason_code === null);
        if (value.action === 'product.change') check(typeof value.record_ref === 'string' && Number.isSafeInteger(value.record_version));
    } else check(value.authorization_revision === null && value.source_installation_id === null);
    return value;
};
export const decodeWorkspaceCommandOption = raw => commandOption(clone(raw));
const capabilityGrantOption = value => {
    official(optionModels, 'WorkspaceCapabilityGrantOption', value);
    shape(value, { activity_id: id, provider_ref: id, capability_code: one(CODE), label, fields: choices, resources: list(resource),
        resource_policies: list(one(['new_only', 'selected', 'activity']), 3, true), source_authority_required: bool,
        current_authority_epoch: nullable(zero), current_authority_label: nullable(message) }, ['current_authority_epoch', 'current_authority_label']);
    return value;
};
export const decodeWorkspaceCapabilityGrantOption = raw => capabilityGrantOption(clone(raw));
const serviceShareOption = value => {
    official(optionModels, 'WorkspaceServiceShareOption', value);
    shape(value, { activity_id: id, source_provider_ref: id, source_label: label, capability_code: one(CODE), label,
        fields: choices, resources: list(resource), resource_policies: list(one(['new_only', 'selected', 'activity']), 3, true),
        people: list(person => shape(person, { person_ref: id, label,
            actions: list(one(['read', 'request', 'approve', 'execute', 'reconcile']), 5, true),
            allowed_fields: ids, resource_refs: ids, resource_policy: one(['new_only', 'selected', 'activity']) })),
        consumers: list(consumer => shape(consumer, { provider_ref: id, label })) });
    for (const [rows, key] of [[value.fields, 'value'], [value.resources, 'resource_ref'], [value.people, 'person_ref'], [value.consumers, 'provider_ref']]) {
        check(new Set(rows.map(row => row[key])).size === rows.length);
    }
    check(value.consumers.every(consumer => consumer.provider_ref !== value.source_provider_ref));
    return value;
};
export const decodeWorkspaceServiceShareOption = raw => serviceShareOption(clone(raw));
const nativeCommandOption = (value, identity, policy, origins) => {
    official(optionModels, 'WorkspaceNativeCommandOption', value);
    shape(value, { activity_id: id, provider_ref: id, capability: v => { one(CODE)(v); check(v !== 'products.write'); },
        action: v => text(v, 100), label, validator_version: v => text(v, 100), permission_contract: one(['parameters_v1', 'semantic_effects_v1']), creates_resource: bool,
        fields: list(choice, 100), resources: list(item => {
            official(optionModels, 'WorkspaceNativeResourceChoice', item);
            id(item.resource_ref); label(item.label);
            if (item.scope != null) { bindScope(item.scope, identity); check(item.scope.activity_id === value.activity_id); }
            if (item.authority_epoch != null) positive(item.authority_epoch);
            if (item.authority_matches_provider != null) bool(item.authority_matches_provider);
        }, 500), resource_policy: nullable(one(['new_only', 'selected', 'activity'])), resource_refs: list(id, 500, true),
        authorization_revision: nullable(hash), source_installation_id: nullable(id), capability_grant_revision: nullable(positive),
        availability: item => availability(item, policy), owner_action_url: nullable(item => url(item, policy)) },
    ['resource_policy', 'resource_refs', 'authorization_revision', 'source_installation_id', 'capability_grant_revision', 'owner_action_url']);
    for (const [rows, key] of [[value.fields, 'value'], [value.resources, 'resource_ref']]) check(new Set(rows.map(row => row[key])).size === rows.length);
    const ready = ['available', 'review_available'].includes(value.availability.state);
    if (ready) {
        hash(value.authorization_revision); id(value.source_installation_id); positive(value.capability_grant_revision);
        one(['new_only', 'selected', 'activity'])(value.resource_policy); list(id, 500, true)(value.resource_refs);
        url(value.owner_action_url, policy);
        let target; try { target = new URL(value.owner_action_url); } catch { invalid(); }
        check(origins.includes(target.origin) && value.owner_action_url === value.availability.next_action.href);
        if (value.resource_policy === 'selected') check(value.resource_refs.length > 0
            && value.resources.every(item => value.resource_refs.includes(item.resource_ref)));
        for (const item of value.resources) if (item.resource_kind === 'warehouse') {
            check(item.scope != null && Number.isSafeInteger(item.authority_epoch) && item.authority_epoch > 0 && item.authority_matches_provider === true);
        }
    } else {
        check(value.fields.length === 0 && value.resources.length === 0 && (value.resource_refs || []).length === 0);
        for (const key of ['resource_policy', 'authorization_revision', 'source_installation_id', 'capability_grant_revision', 'owner_action_url']) check(value[key] == null);
    }
    return value;
};
export const decodeWorkspaceNativeCommandOption = (raw, identity, options = {}) => {
    const origins = ownerOrigins(options.ownerActionOrigins || [], options);
    return nativeCommandOption(clone(raw), identity, withOwnerOrigins(options, origins), origins);
};
export const decodeWorkspaceCurrentCapabilityGrant = raw => {
    const value = clone(raw); official(optionModels, 'WorkspaceCurrentCapabilityGrant', value); shape(value, grantFields); return value;
};
export const decodeWorkspaceContext = (raw, identity, options = {}) => {
    const value = clone(raw);
    const origins = ownerOrigins(value.owner_action_origins, options);
    const urlPolicy = withOwnerOrigins(options, origins);
    shape(value, { spec_version: literal('1.0'), organization, actor: v => shape(v, { account_id: id, display_name: label }),
        activities: list(v => { shape(v, { activity_id: id, label, scope, version: positive, my_actions: list(one(ACTIONS), 16, true), can_manage_people: bool,
            permissions: list(p => shape(p, { person_ref: id, version: positive, actions: list(one(ACTIONS), 16, true), expires_at: nullable(date) })),
            capability_grants: list(g => { official(optionModels, 'WorkspaceCurrentCapabilityGrant', g); shape(g, grantFields); }) }); bindScope(v.scope, identity); check(v.activity_id === v.scope.activity_id); }),
        providers: list(v => { shape(v, { provider_ref: id, tenant_ref: id, external_tenant_id: id, platform: one(PLATFORM), label, activity_id: nullable(id),
            availability: a => availability(a, { ...urlPolicy, allowLegacyProviderSetup: true }), enrollment_id: id, enrollment_version: positive,
            collaboration_prepared: bool, namespace_version: zero, namespace_id: id,
            installations: list(i => shape(i, { installation_id: id, activity_id: id, label })), policy_choices: policyChoices },
        ['enrollment_id', 'enrollment_version', 'collaboration_prepared', 'namespace_version', 'namespace_id']); check(v.provider_ref === v.tenant_ref); }),
        people: list(v => shape(v, { person_ref: id, display_name: label })), can_create_activity: bool,
        command_options: list(commandOption),
        capability_grant_options: list(capabilityGrantOption),
        service_registrations: list(v => namespace(v, identity)), owner_action_origins: v => ownerOrigins(v, options),
        service_shares: list(v => decodeWorkspaceServiceShare(v)),
        // Closed V2 selectable metadata is distinct from a ServiceShareResponse.
        // Its named actions/choices are never a unilateral approval or grant.
        service_share_options: list(serviceShareOption),
        native_command_options: list(v => nativeCommandOption(v, identity, urlPolicy, origins)),
        capabilities: list(v => shape(v, { activity_id: id, provider_ref: id, provider_label: label, code: one(CODE), label,
            availability: a => availability(a, urlPolicy) }, ['provider_ref', 'provider_label'])),
        policies: v => shape(v, { fields: choices, operations: choices, unit_codes: choices, currencies: choices, price_lists: choices, channels: choices }),
        existing: v => shape(v, { requests: list(r => requestValue(r, identity)), grants: list(g => decodeGrant(g, identity)), origin_evidence: list(e => {
            const base = Object.fromEntries(Object.entries(e).filter(([key]) => !['native_product_ref', 'product_label', 'source_installation_ref', 'activity_id'].includes(key)));
            origin(base); shape(e, { ...Object.fromEntries(Object.keys(base).map(key => [key, () => {}])), native_product_ref: id, product_label: label,
                source_installation_ref: nullable(id), activity_id: id }); bindScope(e.scope, identity); check(e.native_product_ref === e.evidence_id && e.activity_id === e.scope.activity_id);
        }) }), selection_revision: hash, approval_policy: message }, ['native_command_options']);
    check(value.organization.id === identity.organizationId && value.actor.account_id === identity.actorId);
    const activities = new Set(value.activities.map(item => item.activity_id)); check(activities.size === value.activities.length);
    const providers = new Set(value.providers.map(item => `${item.activity_id}:${item.provider_ref}`)); check(providers.size === value.providers.length);
    for (const [rows, key] of [[value.people, row => row.person_ref],
        [value.command_options, row => `${row.activity_id}:${row.provider_ref}:${row.action}`],
        [value.capability_grant_options, row => `${row.activity_id}:${row.provider_ref}:${row.capability_code}`],
        [value.service_share_options, row => `${row.activity_id}:${row.source_provider_ref}:${row.capability_code}`],
        [value.native_command_options || [], row => `${row.activity_id}:${row.provider_ref}:${row.capability}:${row.action}`],
        [value.capabilities, row => `${row.activity_id}:${row.code}`]]) check(new Set(rows.map(key)).size === rows.length);
    for (const row of [...value.providers, ...value.capabilities, ...value.command_options, ...value.capability_grant_options, ...value.service_registrations]) {
        const activityId = row.activity_id ?? row.scope?.activity_id;
        if (row.activity_id !== null) check(activities.has(activityId));
        if (row.provider_ref && !value.providers.includes(row)) check(providers.has(`${activityId}:${row.provider_ref}`));
    }
    for (const row of value.providers) {
        check(Object.hasOwn(row, 'enrollment_id') === Object.hasOwn(row, 'enrollment_version'));
        if (row.availability.state === 'available') check(row.enrollment_id && row.enrollment_version);
    }
    for (const row of value.command_options) {
        if (row.available) {
            check(row.reason_code === null && row.allowed_fields.length > 0 && (row.action !== 'product.create' || row.allowed_fields.includes('name')));
            const provider = value.providers.find(item => item.provider_ref === row.provider_ref && item.activity_id === row.activity_id);
            check(provider.installations.some(item => item.installation_id === row.source_installation_id && item.activity_id === row.activity_id));
        }
        else check(row.reason_code !== null);
    }
    for (const row of value.capability_grant_options) for (const item of row.resources) if (item.scope !== null && item.scope !== undefined) {
        bindScope(item.scope, identity); check(item.scope.activity_id === row.activity_id);
    }
    const people = new Set(value.people.map(row => row.person_ref));
    for (const row of value.service_share_options) {
        check(activities.has(row.activity_id) && providers.has(`${row.activity_id}:${row.source_provider_ref}`));
        check(row.consumers.every(consumer => providers.has(`${row.activity_id}:${consumer.provider_ref}`)));
        check(row.people.every(person => people.has(person.person_ref)));
        for (const item of row.resources) if (item.scope !== null && item.scope !== undefined) {
            bindScope(item.scope, identity); check(item.scope.activity_id === row.activity_id);
        }
    }
    check(new Set(value.service_shares.map(row => row.share_id)).size === value.service_shares.length);
    for (const row of value.service_shares) {
        check(activities.has(row.activity_id));
        for (const key of ['source_provider_ref', 'consumer_provider_ref']) check(providers.has(`${row.activity_id}:${row[key]}`));
    }
    for (const row of value.native_command_options || []) {
        check(activities.has(row.activity_id) && providers.has(`${row.activity_id}:${row.provider_ref}`));
        if (['available', 'review_available'].includes(row.availability.state)) {
            const provider = value.providers.find(item => item.provider_ref === row.provider_ref && item.activity_id === row.activity_id);
            check(provider.installations.some(item => item.installation_id === row.source_installation_id && item.activity_id === row.activity_id));
            const activity = value.activities.find(item => item.activity_id === row.activity_id);
            const grants = activity.capability_grants.filter(grant => grant.person_ref === identity.actorId && grant.provider_ref === row.provider_ref && grant.capability_code === row.capability);
            check(activity.my_actions.includes('commands.request') && grants.length === 1);
            const grant = grants[0];
            check(grant.actions.includes('request') && grant.version === row.capability_grant_revision
                && row.fields.every(field => grant.allowed_fields.includes(field.value)));
            if (grant.resource_policy === 'selected') check(row.resource_policy === 'selected' && row.resource_refs.every(ref => grant.resource_refs.includes(ref)));
        }
    }
    return value;
};
const decodeGrant = (value, identity) => {
    const publisher = value.type === 'publisher'; check(publisher || value.type === 'read');
    const fields = { id, request_id: id, scope, revision: positive, active: bool, expires_at: date, expired: bool,
        policy: p => shape(p, proposalFields[publisher ? 'source_registration' : 'read_sharing']), grant_ref: id,
        type: one(['publisher', 'read']), activity_id: id, source_label: label, consumer_label: label, fields: list(one(FIELDS), 8, true),
        ...(publisher ? { installation_id: id, enrollment_id: id, publisher_grant_id: id } : { source_installation_id: id, consumer_installation_id: id, read_grant_id: id }) };
    shape(value, fields); bindScope(value.scope, identity); check(value.activity_id === value.scope.activity_id
        && value.grant_ref === value.id && value.id === value[publisher ? 'publisher_grant_id' : 'read_grant_id']);
    return value;
};
