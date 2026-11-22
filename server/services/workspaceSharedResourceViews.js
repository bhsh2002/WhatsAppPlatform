import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';
import { canonicalWorkspaceJson } from './workspaceIntents.js';

const OFFERING_FIELDS = ['name', 'description', 'kind', 'status', 'category_key', 'attribute_schema_key', 'attributes'];
const PRODUCT_FIELDS = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price_options', 'media', 'variant_ref'];
const fail = (code = 'workspace_resource_scope_invalid', status = 403) => { throw new SharedProductReadError(code, status); };
const text = (value, maximum = 255) => typeof value === 'string' && value.length > 0 && [...value].length <= maximum;
const json = value => canonicalWorkspaceJson(value, 4_194_304);
const clone = value => JSON.parse(json(value));
const sameScope = (a, b) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id']
    .every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
const same = (a, b) => json(a) === json(b);
const hash = value => crypto.createHash('sha256').update(json(value)).digest('hex');
const future = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
const currentStamp = context => hash([context.identity, context.revision, context.consumerInstallationId, context.selection, context.raw]);
const sourceTuple = record => ({ source: record.source, sourceLocalId: record.source_local_id, nativeRevision: record.native_revision });

// Opt-in BFF presentation only. Encrypted selectors locate current resources;
// they never grant access or retain an old image, source ticket or result.
export class WorkspaceSharedResourceViews {
    constructor({ gateway, enabled = false }) {
        if (!gateway?.refs || !gateway.receipts || typeof gateway.selected !== 'function' || typeof gateway.loadContext !== 'function'
            || typeof gateway.metadata !== 'function' || typeof gateway.now !== 'function') throw new TypeError('Shared resource views require the workspace gateway');
        this.gateway = gateway; this.enabled = enabled === true;
    }
    #enabled() { if (!this.enabled) fail('workspace_resource_contract_unavailable', 503); }
    #until(context, ...deadlines) {
        const values = [context.validUntil, context.identity.expiresAt, ...deadlines].map(value => Date.parse(value));
        if (values.some(value => !Number.isFinite(value)) || Math.min(...values) <= this.gateway.now()) fail('workspace_resource_read_expired');
        return new Date(Math.min(...values)).toISOString();
    }
    #provider(context, activity, candidate) {
        const rows = context.raw.providers.filter(row => row.activity_id === activity.activity_id && row.provider_ref === candidate.provider_ref);
        if (rows.length !== 1 || rows[0].platform !== candidate.platform || rows[0].external_tenant_id !== candidate.external_tenant_id
            || !text(candidate.sourceInstallationId) || !text(rows[0].label, 1000)) fail();
        return { provider_ref: rows[0].provider_ref, activity_id: activity.activity_id, platform: rows[0].platform,
            external_tenant_id: rows[0].external_tenant_id, sourceInstallationId: candidate.sourceInstallationId, label: rows[0].label };
    }
    #offeringFields(context, activity, provider, resourceRef = null) {
        const current = context.raw.activities.find(row => row.activity_id === activity.activity_id && sameScope(row.scope, activity.scope));
        const grants = current?.capability_grants.filter(row => row.person_ref === context.identity.actorId
            && row.provider_ref === provider.provider_ref && row.capability_code === 'offerings.manage'
            && future(row.expires_at, this.gateway.now()) && row.actions.includes('read')
            && (row.resource_policy === 'activity' || row.resource_policy === 'selected'
                && (resourceRef === null || row.resource_refs.includes(resourceRef)))) || [];
        const allowed = new Set(grants.flatMap(row => row.allowed_fields));
        const fields = OFFERING_FIELDS.filter(field => allowed.has(field));
        if (!fields.length) fail('workspace_read_grant_required');
        return { fields, expiresAt: this.#until(context, ...grants.map(row => row.expires_at)) };
    }
    #productFields(context, activity, provider) {
        const grants = context.raw.existing.grants.filter(row => row.type === 'read' && row.active === true && row.expired === false
            && future(row.expires_at, this.gateway.now()) && sameScope(row.scope, activity.scope)
            && row.source_installation_id === provider.sourceInstallationId && row.consumer_installation_id === context.consumerInstallationId
            && row.policy.reader_account_ids.includes(context.identity.actorId));
        const allowed = new Set(grants.flatMap(row => row.fields.filter(field => row.policy.fields.includes(field))));
        const fields = PRODUCT_FIELDS.filter(field => allowed.has(({ price_options: 'price', variant_ref: 'base_unit' })[field] || field));
        if (!fields.length) fail('workspace_read_grant_required');
        return { fields, expiresAt: this.#until(context, ...grants.map(row => row.expires_at)) };
    }
    async #selected(principal, input) {
        this.#enabled();
        const { context, activity } = await this.gateway.selected(principal, { activity: input.activity });
        if (!activity?.data || !sameScope(activity.data.scope, context.selection?.scope)) fail('workspace_activity_selection_required', 409);
        this.#until(context);
        return { context: clone(context), activity: clone(activity.data) };
    }
    async #fresh(principal, context, ...deadlines) {
        const stamp = currentStamp(context), viewKey = this.gateway.metadata(context).viewKey;
        const latest = await this.gateway.loadContext(principal);
        if (currentStamp(latest) !== stamp || this.gateway.metadata(latest).viewKey !== viewKey) fail('workspace_context_changed');
        return { viewKey, valid_until: this.#until(context, latest.validUntil, ...deadlines) };
    }
    #save(principal, context, activity, kind, type, role, validUntil, payload) {
        const key = crypto.randomBytes(16).toString('hex');
        const stored = { format: 1, role, revision: context.revision, viewKey: this.gateway.metadata(context).viewKey,
            identityProof: hash(context.identity), activityId: activity.activity_id, scope: clone(activity.scope),
            validUntil: this.#until(context, validUntil), ...clone(payload) };
        this.gateway.receipts.save(principal, context.identity, kind, key, stored);
        return this.gateway.refs.issue(principal, context.identity, { type, key });
    }
    async #open(principal, context, activity, reference, kind, type, role) {
        const resolved = await this.gateway.refs.resolve(principal, reference, type);
        if (!/^[a-f0-9]{32}$/.test(resolved.key) || ['actorId', 'organizationId', 'nativeAccountId', 'generation', 'expiresAt']
            .some(key => resolved.identity[key] !== context.identity[key])) fail('workspace_context_changed');
        const value = this.gateway.receipts.read(principal, context.identity, kind, resolved.key);
        if (!value || value.format !== 1 || value.role !== role || value.revision !== context.revision
            || value.viewKey !== this.gateway.metadata(context).viewKey || value.identityProof !== hash(context.identity)
            || value.activityId !== activity.activity_id || !sameScope(value.scope, activity.scope)) fail();
        this.#until(context, value.validUntil);
        return value;
    }
    #publicData(record) {
        const data = {};
        for (const [field, value] of Object.entries(record.data)) {
            if (!(record.resource_kind === 'product' ? PRODUCT_FIELDS : OFFERING_FIELDS).includes(field) || field === 'media') continue;
            data[field] = field === 'price_options' ? value.map(option => Object.fromEntries(
                ['code', 'process', 'pricing_model', 'amount', 'currency', 'unit'].map(key => [key, option[key]]))) : clone(value);
        }
        return data;
    }
    #present(principal, context, activity, provider, view, validUntil, canonical = null) {
        const key = this.#save(principal, context, activity, 'shared_resource', 'resource', `${view.resource_kind}_record`, validUntil,
            { provider, resourceRef: view.resource_ref, tuple: sourceTuple(view.record), canonical });
        const result = { record: { key, resource_kind: view.resource_kind, sourceLabel: provider.label,
            observed_at: view.record.observed_at, data: this.#publicData(view.record) }, previews: [] };
        // This is the retained source field's own provenance. In particular,
        // an older field observation is never replaced by this read's time.
        if (view.central_publication != null) result.record.central_publication = clone(view.central_publication);
        if (view.resource_kind === 'product' && Object.hasOwn(view.record.data, 'media')) {
            result.mediaCount = view.record.data.media.length;
            for (const descriptor of view.media_previews || []) {
                const media = view.record.data.media.find(row => row.asset_id === descriptor.asset_id && row.rights_reference === descriptor.rights_reference);
                if (!media || !canonical) fail();
                const until = this.#until(context, validUntil, descriptor.valid_until);
                const preview = this.#save(principal, context, activity, 'shared_preview', 'media_preview', 'product_preview', until,
                    { provider, canonical, tuple: sourceTuple(view.record), media });
                result.previews.push({ key: preview, valid_until: until, content_types: [...descriptor.content_types] });
            }
        }
        return result;
    }
    async options(principal, context, activity) {
        this.#enabled(); activity = activity?.data || activity;
        if (!activity) return { providers: [] };
        context = clone(context); activity = clone(activity);
        const candidates = [];
        for (const namespace of context.raw.service_registrations) {
            if (namespace.authority_domain !== 'native.service_namespace' || namespace.state !== 'active'
                || !future(namespace.expires_at, this.gateway.now()) || !sameScope(namespace.scope, activity.scope)) continue;
            const source = context.raw.providers.find(row => row.activity_id === activity.activity_id && row.provider_ref === namespace.provider_ref
                && row.platform === namespace.platform && row.external_tenant_id === namespace.external_tenant_id);
            if (!source || !text(namespace.label, 1000)) continue;
            const provider = this.#provider(context, activity, { ...source, sourceInstallationId: namespace.source_installation_id });
            let policy;
            try { policy = this.#offeringFields(context, activity, provider); }
            catch (error) { if (error instanceof SharedProductReadError && error.code === 'workspace_read_grant_required') continue; throw error; }
            candidates.push({ provider, label: `${provider.label} — ${namespace.label}`,
                validUntil: this.#until(context, namespace.expires_at, policy.expiresAt) });
        }
        await this.#fresh(principal, context);
        return { providers: candidates.map(candidate => ({ value: this.#save(principal, context, activity, 'shared_resource', 'resource',
            'offering_provider', candidate.validUntil, { provider: candidate.provider }), label: candidate.label, enabled: true })) };
    }
    async offerings(principal, input = {}) {
        const { context, activity } = await this.#selected(principal, input);
        const lease = await this.#open(principal, context, activity, input.provider, 'shared_resource', 'resource', 'offering_provider');
        const provider = this.#provider(context, activity, lease.provider), policy = this.#offeringFields(context, activity, provider);
        const q = input.q ?? '';
        if (typeof q !== 'string' || [...q].length > 200) fail('workspace_request_invalid', 422);
        let cursor = null;
        if (input.cursor) {
            const saved = await this.#open(principal, context, activity, input.cursor, 'shared_cursor', 'resource_cursor', 'offering_cursor');
            if (!same(saved.provider, provider) || !same(saved.fields, policy.fields) || saved.q !== q) fail();
            cursor = saved.cursor;
        }
        const view = await this.gateway.sharedResourceReader.search(principal, context, activity, provider, { fields: policy.fields, q, cursor });
        const metadata = await this.#fresh(principal, context, lease.validUntil, policy.expiresAt, view.authorization.valid_until);
        const records = view.records.map(record => this.#present(principal, context, activity, provider,
            { resource_kind: 'offering', resource_ref: record.source_local_id, record,
                ...(Object.hasOwn(view.central_publications || {}, record.source_local_id)
                    ? { central_publication: view.central_publications[record.source_local_id] } : {}) }, metadata.valid_until).record);
        const next = view.next_cursor ? this.#save(principal, context, activity, 'shared_cursor', 'resource_cursor', 'offering_cursor', metadata.valid_until,
            { provider, fields: policy.fields, q, cursor: view.next_cursor }) : null;
        return { ...metadata, records, cursor: next };
    }
    async offering(principal, input = {}) {
        const { context, activity } = await this.#selected(principal, input);
        const lease = await this.#open(principal, context, activity, input.resource, 'shared_resource', 'resource', 'offering_record');
        const provider = this.#provider(context, activity, lease.provider), policy = this.#offeringFields(context, activity, provider, lease.resourceRef);
        const view = await this.gateway.sharedResourceReader.record(principal, context, activity, provider,
            { resourceKind: 'offering', resourceRef: lease.resourceRef, fields: policy.fields });
        if (!same(view.record.source, lease.tuple.source) || view.record.source_local_id !== lease.tuple.sourceLocalId) fail();
        const metadata = await this.#fresh(principal, context, lease.validUntil, policy.expiresAt, view.authorization.valid_until);
        return { ...metadata, ...this.#present(principal, context, activity, provider, view, metadata.valid_until) };
    }
    async #productMapping(principal, context, activity, canonical) {
        const value = await this.gateway.products.record(principal, context, activity, canonical.key);
        const record = value.record;
        if (record.entity_id !== canonical.key || record.version !== canonical.version || !sameScope(record.scope, activity.scope)) fail();
        const sources = context.raw.providers.filter(row => row.activity_id === activity.activity_id
            && row.installations.some(installation => installation.installation_id === record.source.installation_id && installation.activity_id === activity.activity_id));
        if (sources.length !== 1) fail();
        const provider = this.#provider(context, activity, { ...sources[0], sourceInstallationId: record.source.installation_id });
        const policy = this.#productFields(context, activity, provider);
        return { record, provider, policy, validUntil: value.context.valid_until };
    }
    async product(principal, input = {}) {
        const { context, activity } = await this.#selected(principal, input);
        const resolved = await this.gateway.refs.resolve(principal, input.record, 'record');
        if (['actorId', 'organizationId', 'nativeAccountId', 'generation', 'expiresAt'].some(key => resolved.identity[key] !== context.identity[key])) fail('workspace_context_changed');
        const canonical = { key: resolved.key, version: resolved.version };
        const mapping = await this.#productMapping(principal, context, activity, canonical);
        const view = await this.gateway.sharedResourceReader.record(principal, context, activity, mapping.provider,
            { resourceKind: 'product', resourceRef: canonical.key, fields: mapping.policy.fields, expectedRecord: mapping.record });
        const metadata = await this.#fresh(principal, context, mapping.validUntil, mapping.policy.expiresAt, view.authorization.valid_until);
        return { ...metadata, ...this.#present(principal, context, activity, mapping.provider, view, metadata.valid_until, canonical) };
    }
    async preview(principal, input = {}) {
        const { context, activity } = await this.#selected(principal, input);
        const lease = await this.#open(principal, context, activity, input.preview, 'shared_preview', 'media_preview', 'product_preview');
        const mapping = await this.#productMapping(principal, context, activity, lease.canonical);
        if (!same(mapping.provider, lease.provider) || !mapping.policy.fields.includes('media')) fail();
        const detail = await this.gateway.sharedResourceReader.record(principal, context, activity, mapping.provider,
            { resourceKind: 'product', resourceRef: lease.canonical.key, fields: mapping.policy.fields, expectedRecord: mapping.record });
        if (!same(sourceTuple(detail.record), lease.tuple)) fail();
        const media = detail.record.data.media?.filter(row => row.asset_id === lease.media.asset_id
            && row.access_reference === lease.media.access_reference && row.rights_reference === lease.media.rights_reference
            && row.parent_source_local_id === lease.media.parent_source_local_id) || [];
        const descriptors = detail.media_previews?.filter(row => row.asset_id === lease.media.asset_id && row.rights_reference === lease.media.rights_reference) || [];
        if (media.length !== 1 || descriptors.length !== 1) fail();
        const result = await this.gateway.sharedResourceReader.preview(principal, context, activity, mapping.provider, { detail, descriptor: descriptors[0] });
        if (result.bytes === null || result.contentType === null) fail('workspace_resource_media_unavailable', 404);
        const metadata = await this.#fresh(principal, context, lease.validUntil, mapping.validUntil, mapping.policy.expiresAt,
            detail.authorization.valid_until, descriptors[0].valid_until, result.validUntil);
        return { bytes: result.bytes, contentType: result.contentType,
            sha256: result.bytes === null ? null : crypto.createHash('sha256').update(result.bytes).digest('hex'), validUntil: metadata.valid_until };
    }
}
