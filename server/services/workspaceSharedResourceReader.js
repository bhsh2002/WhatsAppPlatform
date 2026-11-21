import { SharedProductReadError } from './centralProductRead.js';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { validateSharedResourceModel, decodeSharedResourceRead, decodeSharedResourceSearch,
    decodeSharedMediaPreview } from './workspaceSharedResourceModels.js';

const BASE = '/v1/integration/workspace/resources';
const OFFERING_FIELDS = ['name', 'description', 'kind', 'status', 'category_key', 'attribute_schema_key', 'attributes'];
const PRODUCT_FIELDS = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price_options', 'media', 'variant_ref'];
const productGrantField = field => ({ price_options: 'price', variant_ref: 'base_unit' }[field] || field);
const fail = (code = 'workspace_resource_scope_invalid', status = 403) => { throw new SharedProductReadError(code, status); };
const text = (value, max = 255) => typeof value === 'string' && value.length > 0 && [...value].length <= max;
const sameScope = (a, b) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id']
    .every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
const json = value => canonicalWorkspaceJson(value, 4_194_304);
const clone = value => { try { return JSON.parse(json(value)); } catch { fail('workspace_request_invalid', 422); } };
const pathId = value => {
    if (!text(value) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) fail('workspace_request_invalid', 422);
    return value;
};
const future = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
const fieldMask = (kind, fields) => {
    const declared = kind === 'product' ? PRODUCT_FIELDS : kind === 'offering' ? OFFERING_FIELDS : [];
    if (!Array.isArray(fields) || !fields.length || fields.length > declared.length
        || new Set(fields).size !== fields.length || fields.some(field => !declared.includes(field))) fail('workspace_request_invalid', 422);
    return [...fields];
};
const contextStamp = context => json({ identity: context.identity, revision: context.revision,
    consumerInstallationId: context.consumerInstallationId, selection: context.selection, raw: context.raw });

// Exact server-owned Core GETs only. Callers choose explicit projection fields
// from current grants; Core independently reauthorizes the actual live source.
export class WorkspaceSharedResourceReader {
    constructor({ gateway }) {
        if (typeof gateway?.transport?.request !== 'function' || typeof gateway.loadContext !== 'function' || typeof gateway.now !== 'function') {
            throw new TypeError('Shared resource reads require the current workspace gateway');
        }
        this.gateway = gateway;
    }
    #binding(context, activity, provider, { resourceKind, resourceRef = null, fields, expectedRecord = null, source = null }) {
        const now = this.gateway.now();
        if (!future(context.validUntil, now) || !future(context.identity?.expiresAt, now)) fail('workspace_resource_read_expired');
        if (!text(context.revision, 1024) || !text(context.identity.actorId) || !text(context.identity.coreAccountId)
            || context.actorId !== context.identity.actorId || context.identity.organizationId !== activity.scope?.organization_id
            || !text(context.consumerInstallationId) || !context.selection
            || context.selection.consumer_installation_id !== context.consumerInstallationId
            || !sameScope(context.selection.scope, activity.scope)
            || context.selection.account?.provider_ref !== context.identity.coreAccountId || context.selection.account?.platform !== 'wa_savana') fail();
        const activities = context.raw?.activities?.filter(row => row.activity_id === activity.activity_id && sameScope(row.scope, activity.scope)) || [];
        const providers = context.raw?.providers?.filter(row => row.activity_id === activity.activity_id && row.provider_ref === provider.provider_ref) || [];
        if (activities.length !== 1 || providers.length !== 1 || activity.activity_id !== activity.scope.activity_id) fail();
        const current = providers[0];
        if (!['catalog', 'sawemly', 'wa_savana'].includes(current.platform)
            || current.platform !== provider.platform || current.external_tenant_id !== provider.external_tenant_id
            || provider.activity_id !== activity.activity_id) fail();
        fields = fieldMask(resourceKind, fields);
        const sourceInstallationId = provider.sourceInstallationId || expectedRecord?.source?.installation_id || source?.installation_id;
        if (!text(sourceInstallationId)) fail();
        if (source && (source.installation_id !== sourceInstallationId || source.platform !== current.platform
            || source.external_tenant_id !== current.external_tenant_id)) fail();
        if (resourceKind === 'offering') {
            // Service namespaces are independent of physical-goods installations.
            const namespaces = context.raw.service_registrations?.filter(row => row.authority_domain === 'native.service_namespace'
                && row.state === 'active' && future(row.expires_at, now) && sameScope(row.scope, activity.scope)
                && row.provider_ref === current.provider_ref && row.platform === current.platform
                && row.external_tenant_id === current.external_tenant_id && row.source_installation_id === sourceInstallationId) || [];
            if (namespaces.length !== 1) fail();
            const grants = activities[0].capability_grants?.filter(grant => grant.person_ref === context.identity.actorId
                && grant.provider_ref === current.provider_ref && grant.capability_code === 'offerings.manage'
                && future(grant.expires_at, now) && grant.actions.includes('read')
                && (grant.resource_policy === 'activity' || grant.resource_policy === 'selected'
                    && (resourceRef === null || grant.resource_refs.includes(resourceRef)))) || [];
            const allowed = new Set(grants.flatMap(grant => grant.allowed_fields));
            if (fields.some(field => !allowed.has(field))) fail('workspace_read_grant_required');
        } else {
            if (!current.installations?.some(row => row.installation_id === sourceInstallationId && row.activity_id === activity.activity_id)) fail();
            if (expectedRecord && (expectedRecord.entity_id !== resourceRef || !Number.isSafeInteger(expectedRecord.version) || expectedRecord.version < 1
                || !sameScope(expectedRecord.scope, activity.scope) || expectedRecord.source?.installation_id !== sourceInstallationId
                || !text(expectedRecord.source.local_entity_id))) fail();
            const grants = context.raw.existing?.grants?.filter(grant => grant.type === 'read' && grant.active === true && grant.expired === false
                && future(grant.expires_at, now) && sameScope(grant.scope, activity.scope)
                && grant.source_installation_id === sourceInstallationId && grant.consumer_installation_id === context.consumerInstallationId
                && grant.policy?.reader_account_ids?.includes(context.identity.actorId)) || [];
            const allowed = new Set(grants.flatMap(grant => grant.fields.filter(field => grant.policy.fields.includes(field))));
            if (fields.some(field => !allowed.has(productGrantField(field)))) fail('workspace_read_grant_required');
        }
        return { scope: clone(activity.scope), providerRef: current.provider_ref, sourcePlatform: current.platform,
            sourceInstallationId, sourceExternalTenantId: current.external_tenant_id, principalKind: 'native_oidc',
            consumerInstallationId: context.consumerInstallationId, consumerPlatform: 'wa_savana', allowedFields: fields,
            resourceKind, ...(resourceRef === null ? {} : { resourceRef }),
            ...(expectedRecord ? { sourceLocalId: expectedRecord.source.local_entity_id }
                : resourceKind === 'offering' && resourceRef !== null ? { sourceLocalId: resourceRef } : {}) };
    }
    async #current(principal, context, stamp, activity, provider, input) {
        const fresh = await this.gateway.loadContext(principal);
        if (contextStamp(fresh) !== stamp) fail('workspace_context_changed');
        this.#binding(fresh, activity, provider, input);
        if (!future(context.validUntil, this.gateway.now())) fail('workspace_resource_read_expired');
    }
    async #fetch(principal, context, activity, provider, input, path, model) {
        const stamp = contextStamp(context);
        const expected = this.#binding(context, activity, provider, input);
        await this.#current(principal, context, stamp, activity, provider, input);
        const { payload } = await this.gateway.transport.request(principal, { path, expectedIdentity: clone(context.identity),
            consumerInstallation: context.consumerInstallationId, sharedResourceModel: model });
        await this.#current(principal, context, stamp, activity, provider, input);
        return { payload, expected };
    }
    async search(principal, context, activity, provider, { fields, q = '', cursor = null } = {}) {
        context = clone(context); activity = clone(activity); provider = clone(provider);
        fields = fieldMask('offering', fields);
        if (typeof q !== 'string' || [...q].length > 200 || cursor !== null && !text(cursor, 8192)) fail('workspace_request_invalid', 422);
        const query = new URLSearchParams({ activity_id: activity.activity_id, provider_ref: provider.provider_ref,
            resource_kind: 'offering', fields: fields.join(',') });
        if (q) query.set('q', q);
        if (cursor !== null) query.set('cursor', cursor);
        const { payload, expected } = await this.#fetch(principal, context, activity, provider,
            { resourceKind: 'offering', fields }, `${BASE}?${query}`, 'SharedResourceSearchView');
        return decodeSharedResourceSearch(payload, expected, { now: this.gateway.now() });
    }
    async record(principal, context, activity, provider, { resourceKind, resourceRef, fields, expectedRecord = null } = {}) {
        context = clone(context); activity = clone(activity); provider = clone(provider);
        fields = fieldMask(resourceKind, fields);
        if (resourceKind === 'product' && !expectedRecord) fail();
        const input = { resourceKind, resourceRef, fields, expectedRecord: expectedRecord === null ? null : clone(expectedRecord) };
        const query = new URLSearchParams({ activity_id: activity.activity_id, provider_ref: provider.provider_ref,
            resource_kind: resourceKind, fields: fields.join(',') });
        const { payload, expected } = await this.#fetch(principal, context, activity, provider, input,
            `${BASE}/${pathId(resourceRef)}?${query}`, 'SharedResourceReadView');
        return decodeSharedResourceRead(payload, expected, { now: this.gateway.now() });
    }
    #previewPath(detail, descriptor, activity, provider) {
        const pathname = `${BASE}/${pathId(detail.resource_ref)}/media/${pathId(descriptor.asset_id)}/preview`;
        const href = descriptor.href;
        if (typeof href !== 'string' || [...href].length > 8192 || /[\\#\u0000-\u0020\u007f]/.test(href)
            || href.split('?')[0] !== pathname || href.indexOf('?') < 0) fail('workspace_resource_media_invalid', 502);
        const url = new URL(href, 'https://fixed-core.invalid');
        const keys = ['activity_id', 'provider_ref', 'resource_kind', 'ticket'];
        if (url.origin !== 'https://fixed-core.invalid' || url.pathname !== pathname || url.searchParams.size !== keys.length
            || keys.some(key => url.searchParams.getAll(key).length !== 1) || [...url.searchParams.keys()].some(key => !keys.includes(key))
            || url.searchParams.get('activity_id') !== activity.activity_id || url.searchParams.get('provider_ref') !== provider.provider_ref
            || url.searchParams.get('resource_kind') !== 'product' || !text(url.searchParams.get('ticket'), 8192)
            || /[\u0000-\u0020\u007f]/.test(url.searchParams.get('ticket'))) fail('workspace_resource_media_invalid', 502);
        return `${pathname}?${new URLSearchParams({ activity_id: activity.activity_id, provider_ref: provider.provider_ref,
            resource_kind: 'product', ticket: url.searchParams.get('ticket') })}`;
    }
    async preview(principal, context, activity, provider, { detail, descriptor } = {}) {
        context = clone(context); activity = clone(activity); provider = clone(provider);
        detail = validateSharedResourceModel('SharedResourceReadView', detail);
        descriptor = validateSharedResourceModel('MediaPreviewDescriptor', descriptor);
        if (detail.resource_kind !== 'product' || !detail.authorization.allowed_fields.includes('media')
            || !detail.media_previews?.some(row => json(row) === json(descriptor))) fail('workspace_resource_media_invalid', 502);
        const input = { resourceKind: 'product', resourceRef: detail.resource_ref,
            fields: detail.authorization.allowed_fields, source: detail.record.source };
        const expected = this.#binding(context, activity, provider, input);
        detail = decodeSharedResourceRead(detail, expected, { now: this.gateway.now() });
        const media = detail.record.data.media?.filter(row => row.asset_id === descriptor.asset_id && row.rights_reference === descriptor.rights_reference) || [];
        if (media.length !== 1 || !future(descriptor.valid_until, this.gateway.now())) fail('workspace_resource_read_expired');
        const path = this.#previewPath(detail, descriptor, activity, provider);
        const result = await this.#fetch(principal, context, activity, provider, input, path, 'SharedMediaPreviewView');
        const actual = validateSharedResourceModel('SharedMediaPreviewView', result.payload);
        if (!actual.authorization.allowed_fields.includes('media')) fail();
        this.#binding(context, activity, provider, { ...input, fields: actual.authorization.allowed_fields });
        // Preview authorization may use a different projection mask/revision
        // from detail. Its actual current mask must independently be granted.
        const { allowedFields: _fields, ...previewExpected } = result.expected;
        const decoded = decodeSharedMediaPreview(actual, { ...previewExpected, sourceLocalId: detail.record.source_local_id,
            nativeRevision: detail.record.native_revision, assetId: descriptor.asset_id, accessReference: media[0].access_reference,
            rightsReference: descriptor.rights_reference,
            validUntil: new Date(Math.min(Date.parse(context.validUntil), Date.parse(context.identity.expiresAt),
                Date.parse(detail.authorization.valid_until), Date.parse(descriptor.valid_until))).toISOString() },
        { now: this.gateway.now() });
        if (decoded.contentType !== null && !descriptor.content_types.includes(decoded.contentType)) fail('workspace_resource_media_invalid', 502);
        return decoded;
    }
}
