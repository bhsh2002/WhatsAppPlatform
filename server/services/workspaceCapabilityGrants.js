import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { validateWorkspaceCoreModel } from './workspaceCoreModels.js';

const BASE = '/v1/integration/workspace';
const OPERATION = 'capability_grant';
const ACTIONS = ['read', 'request', 'approve', 'execute', 'reconcile'];
const ACTION_LABELS = { read: 'قراءة النتائج المسموحة', request: 'إنشاء طلب للمراجعة', approve: 'اعتماد النسخة المراجعة',
    execute: 'تنفيذ النسخة المعتمدة', reconcile: 'فحص نتيجة المحاولة نفسها' };
const POLICY_LABELS = { new_only: 'الموارد الجديدة التي ينشئها الشخص', selected: 'الموارد المحددة فقط', activity: 'الموارد المسموحة ضمن النشاط' };
const fail = (code = 'workspace_grant_choice_changed', status = 409) => { throw new SharedProductReadError(code, status); };
const hash = value => crypto.createHash('sha256').update(canonicalWorkspaceJson(value)).digest('hex');
const text = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/u.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const date = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const choiceFailure = error => {
    if (error instanceof SharedProductReadError && error.code === 'workspace_choice_changed' && error.status === 409) fail();
    throw error;
};
const strict = (value, allowed, required = allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))
        || required.some(key => !Object.hasOwn(value, key))) fail('workspace_request_invalid', 422);
};
const list = (value, max = 100) => {
    if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length
        || value.some(item => !text(item, 16_384))) fail('workspace_request_invalid', 422);
    return value;
};
const pathId = value => {
    if (!text(value) || !/^[A-Za-z0-9_:.-]+$/.test(value) || ['.', '..'].includes(value)) fail();
    return encodeURIComponent(value);
};
const tuple = option => [option.activity_id, option.provider_ref, option.capability_code];
const grantKey = option => hash(['workspace-grant-v1', ...tuple(option)]);
const sameIdentity = (a, b) => ['actorId', 'organizationId', 'nativeAccountId', 'coreAccountId', 'generation', 'expiresAt']
    .every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && new Set(a).size === a.length
    && new Set(b).size === b.length && a.length === b.length && a.every(value => b.includes(value));
const currentTuple = (activity, option, person) => {
    const rows = activity.capability_grants.filter(row => row.person_ref === person && row.provider_ref === option.provider_ref
        && row.capability_code === option.capability_code);
    if (rows.length > 1) fail('workspace_response_invalid', 502);
    return rows[0] || null;
};
const authorityAvailable = resource => resource.authority_assignable === true && integer(resource.authority_epoch);

// Root's fresh decoded Core context supplies the facts. These server-only
// logical keys become encrypted display choices, never authority claims.
export const workspaceGrantChoices = (raw, revision) => {
    if (!Array.isArray(raw?.capability_grant_options) || !text(revision, 1024)) fail('workspace_response_invalid', 502);
    const result = { grants: [], grant_fields: [], grant_resources: [] };
    const seen = new Set();
    for (const option of raw.capability_grant_options) {
        const key = grantKey(option);
        if (seen.has(key) || !Array.isArray(option.fields) || !Array.isArray(option.resources)
            || !Array.isArray(option.resource_policies)) fail('workspace_response_invalid', 502);
        seen.add(key);
        const provider = raw.providers.find(row => row.provider_ref === option.provider_ref && row.activity_id === option.activity_id);
        if (!provider || !text(provider.label, 1000) || !text(option.label, 1000)) fail('workspace_response_invalid', 502);
        result.grants.push({ key, label: `${provider.label} — ${option.label}`, version: revision, selectable: true, data: option });
        for (const [kind, rows, id] of [['grant_fields', option.fields, 'value'], ['grant_resources', option.resources, 'resource_ref']]) {
            const unique = new Set();
            for (const row of rows) {
                if (!text(row[id]) || !text(row.label, 1000) || unique.has(row[id])) fail('workspace_response_invalid', 502);
                unique.add(row[id]);
                result[kind].push({ key: hash([kind, key, row[id]]), label: row.label, version: revision, selectable: true,
                    data: { grantKey: key, value: row[id], resource: kind === 'grant_resources' ? row : null } });
            }
        }
        if (Object.values(result).reduce((sum, rows) => sum + rows.length, 0) > 10_000) fail('workspace_response_invalid', 502);
    }
    return result;
};

export class WorkspaceCapabilityGrants {
    constructor({ gateway }) {
        if (!gateway?.db || !gateway.receipts || !gateway.choices || !gateway.transport
            || ['selected', 'loadContext', 'metadata', 'issue', 'review', 'now'].some(key => typeof gateway[key] !== 'function')) {
            throw new TypeError('Capability grant UI requires the actual current workspace gateway');
        }
        this.g = gateway;
    }
    async selected(principal, input) {
        let selected;
        try { selected = await this.g.selected(principal, { activity: input.activity }); } catch (error) { choiceFailure(error); }
        const { context, activity } = selected;
        if (!activity || activity.data.can_manage_people !== true) fail('workspace_grant_management_forbidden', 403);
        if (!date(context.validUntil) || Date.parse(context.validUntil) <= this.g.now()) fail();
        return selected;
    }
    async resolve(principal, token, kind, context, grant = null) {
        let resolved;
        try { resolved = await this.g.choices.resolve(principal, token, kind); } catch (error) { choiceFailure(error); }
        if (resolved.context.revision !== context.revision || !sameIdentity(resolved.context.identity, context.identity)
            || this.g.metadata(resolved.context).viewKey !== this.g.metadata(context).viewKey
            || (grant && resolved.option.data.grantKey !== grant.key)) fail();
        return resolved.option;
    }
    issue(principal, context, kind, option) {
        const meta = this.g.metadata(context);
        const binding = hash([principal.tenantId, principal.userId, principal.sessionId, principal.authVersion, principal.role,
            principal.sessionExpiresAt, context.identity, meta.viewKey, kind, option.key, option.version ?? null]);
        return this.g.db.transaction(() => {
            const saved = this.g.receipts.read(principal, context.identity, 'grant_choice', binding);
            if (saved && saved.expiresAt > this.g.now() && saved.viewKey === meta.viewKey && saved.kind === kind
                && saved.optionKey === option.key && saved.version === (option.version ?? null)
                && text(saved.token, 16_384)) return saved.token;
            const token = this.g.issue(principal, context, kind, option);
            const expiresAt = Math.min(Date.parse(context.validUntil), principal.sessionExpiresAt * 1000,
                this.g.now() + (this.g.choices.ttlMs || 300_000));
            this.g.receipts.save(principal, context.identity, 'grant_choice', binding, { token, expiresAt,
                viewKey: meta.viewKey, kind, optionKey: option.key, version: option.version ?? null });
            return token;
        }).immediate();
    }
    names(option, grant, kind) {
        if (!grant) return 'لا يوجد';
        const values = grant[kind === 'fields' ? 'allowed_fields' : 'resource_refs'];
        const rows = option[kind]; const property = kind === 'fields' ? 'value' : 'resource_ref';
        return values.map((value, index) => rows.find(row => row[property] === value)?.label
            || `${kind === 'fields' ? 'حقل سابق' : 'مورد سابق'} لم يعد ضمن الخيارات الحالية (${index + 1})`).join('، ') || 'لا يوجد';
    }
    summary(option, grant) {
        return [{ label: 'الخطوات المسموحة', value: grant?.actions.map(value => ACTION_LABELS[value]).join('، ') || 'لا توجد خطوات مسموحة' },
            { label: 'الحقول', value: this.names(option, grant, 'fields') }, { label: 'الموارد', value: this.names(option, grant, 'resources') },
            { label: 'نطاق الموارد', value: grant ? POLICY_LABELS[grant.resource_policy] : 'لا توجد صلاحية محفوظة' },
            { label: 'انتهاء الصلاحية', value: grant?.expires_at || 'لم يُحدّد بعد' }];
    }
    async options(principal, input = {}) {
        strict(input, ['activity', 'grant', 'person'], ['activity']);
        const { context, activity } = await this.selected(principal, input);
        const grants = context.choices.grants.filter(row => row.data.activity_id === activity.key);
        const selection = { grant: input.grant || '', person: input.person || '' };
        const grant = input.grant ? await this.resolve(principal, input.grant, 'grants', context) : null;
        const person = input.person ? await this.resolve(principal, input.person, 'people', context) : null;
        const choiceRows = (kind, rows) => rows.map(option => ({ value: kind === 'grants' && option.key === grant?.key ? input.grant
            : kind === 'people' && option.key === person?.key ? input.person : this.issue(principal, context, kind, option), label: option.label, enabled: true }));
        if (grant && grant.data.activity_id !== activity.key) fail();
        let editor = null;
        if (grant && person) {
            const option = grant.data;
            const current = currentTuple(activity.data, option, person.key);
            const fields = context.choices.grant_fields.filter(row => row.data.grantKey === grant.key);
            const resources = context.choices.grant_resources.filter(row => row.data.grantKey === grant.key);
            const eligible = option.resources.filter(authorityAvailable);
            const policies = option.resource_policies.map(value => ({ value, label: POLICY_LABELS[value], enabled: true }));
            if (current && !option.resource_policies.includes(current.resource_policy)) policies.push({
                value: current.resource_policy, label: POLICY_LABELS[current.resource_policy], enabled: false });
            editor = { fields: choiceRows('grant_fields', fields),
                resources: resources.map(row => ({ ...choiceRows('grant_resources', [row])[0], sourceAuthorityAvailable: authorityAvailable(row.data.resource) })),
                actions: ACTIONS.map(value => ({ value, label: ACTION_LABELS[value], enabled: true })), policies,
                currentSelection: { actions: current?.actions || [],
                    fields: fields.filter(row => current?.allowed_fields.includes(row.data.value)).map(row => this.issue(principal, context, 'grant_fields', row)),
                    resources: resources.filter(row => current?.resource_refs.includes(row.data.value)).map(row => this.issue(principal, context, 'grant_resources', row)),
                    resourcePolicy: current?.resource_policy || '', expiresAt: current?.expires_at || '', assignSourceAuthority: false },
                currentSummary: this.summary(option, current), sourceAuthority: { enabled: eligible.length > 0,
                    reason: eligible.length ? `يمكن تغيير المصدر صراحةً لهذه الموارد فقط: ${eligible.map(row => row.label).join('، ')}`
                        : 'لا تتوفر موارد ذات حالة مصدر قابلة للتغيير ونسخة متحققة حاليًا.',
                    label: 'تعيين هذا الحساب مصدرًا مسؤولًا عن الموارد المختارة',
                    currentLabel: option.current_authority_label || 'لم يُعرض اسم مصدر حالي متحقق' } };
        }
        const fresh = await this.g.loadContext(principal);
        if (fresh.revision !== context.revision || !sameIdentity(fresh.identity, context.identity)
            || this.g.metadata(fresh).viewKey !== this.g.metadata(context).viewKey
            || fresh.raw.activities.find(row => row.activity_id === activity.key)?.can_manage_people !== true) fail();
        return { ...this.g.metadata(context), choices: { grants: choiceRows('grants', grants), people: choiceRows('people', context.choices.people) }, selection, editor };
    }
    async review(principal, input) {
        strict(input, ['activity', 'grant', 'person', 'actions', 'fields', 'resources', 'resourcePolicy', 'expiresAt', 'assignSourceAuthority']);
        list(input.actions, 5); list(input.fields); list(input.resources);
        if (input.actions.some(action => !ACTIONS.includes(action)) || typeof input.assignSourceAuthority !== 'boolean'
            || !date(input.expiresAt) || Date.parse(input.expiresAt) <= this.g.now()) fail('workspace_request_invalid', 422);
        const { context, activity } = await this.selected(principal, input);
        const grant = await this.resolve(principal, input.grant, 'grants', context);
        const person = await this.resolve(principal, input.person, 'people', context);
        const option = grant.data;
        if (option.activity_id !== activity.key || !option.resource_policies.includes(input.resourcePolicy)) fail();
        const resolveRows = async (tokens, kind) => {
            const result = [];
            for (const token of tokens) result.push(await this.resolve(principal, token, kind, context, grant));
            return result;
        };
        const fields = await resolveRows(input.fields, 'grant_fields');
        const resources = await resolveRows(input.resources, 'grant_resources');
        if (new Set(fields.map(row => row.data.value)).size !== fields.length
            || new Set(resources.map(row => row.data.value)).size !== resources.length) fail('workspace_request_invalid', 422);
        if ((input.resourcePolicy !== 'selected' && resources.length)
            || (input.resourcePolicy === 'selected' && input.actions.length && !resources.length)) fail('workspace_request_invalid', 422);
        if (input.assignSourceAuthority && (input.resourcePolicy !== 'selected' || !resources.length
            || !input.actions.length || resources.some(row => !authorityAvailable(row.data.resource)))) fail('workspace_source_authority_unverified', 409);
        const current = currentTuple(activity.data, option, person.key);
        const payload = { activity_id: activity.key, person_ref: person.key, provider_ref: option.provider_ref,
            capability_code: option.capability_code, actions: [...input.actions], allowed_fields: fields.map(row => row.data.value),
            resource_policy: input.resourcePolicy, resource_refs: resources.map(row => row.data.value),
            expires_at: new Date(input.expiresAt).toISOString(), expected_version: current?.version || 0,
            assign_source_authority: input.assignSourceAuthority, expected_authority_epochs: input.assignSourceAuthority
                ? Object.fromEntries(resources.map(row => [row.data.value, row.data.resource.authority_epoch])) : {},
            ...(integer(option.current_authority_epoch) ? { expected_authority_epoch: option.current_authority_epoch } : {}) };
        validateWorkspaceCoreModel('WorkspaceCapabilityGrant', Object.fromEntries(Object.entries(payload).filter(([key]) => !['activity_id', 'person_ref'].includes(key))));
        const next = { actions: payload.actions, allowed_fields: payload.allowed_fields, resource_refs: payload.resource_refs,
            resource_policy: payload.resource_policy, expires_at: payload.expires_at };
        const removedFields = (current?.allowed_fields || []).filter(field => !payload.allowed_fields.includes(field));
        const removedResources = (current?.resource_refs || []).filter(ref => !payload.resource_refs.includes(ref));
        const removed = { actions: (current?.actions || []).filter(action => !payload.actions.includes(action)),
            allowed_fields: removedFields, resource_refs: removedResources, resource_policy: current?.resource_policy, expires_at: current?.expires_at };
        const summary = [{ label: 'الصلاحية', value: grant.label }, { label: 'الشخص', value: person.label },
            ...this.summary(option, current).map(row => ({ label: `قبل التغيير: ${row.label}`, value: row.value })),
            ...this.summary(option, next).map(row => ({ label: `بعد التغيير: ${row.label}`, value: row.value })),
            { label: 'الخطوات المسحوبة', value: removed.actions.map(action => ACTION_LABELS[action]).join('، ') || 'لا توجد' },
            { label: 'الحقول المسحوبة', value: this.names(option, removed, 'fields') },
            { label: 'الموارد المسحوبة', value: this.names(option, removed, 'resources') },
            { label: 'المصدر المسؤول', value: input.assignSourceAuthority
                ? 'طلب تغيير المصدر صراحةً للموارد المختارة بنسخها الحالية؛ صلاحية الشخص منفصلة عن ملكية المصدر.'
                : 'لن يُطلب نقل مسؤولية المصدر؛ تُحدّث صلاحية الشخص فقط.' }];
        const before = { ...(current || {}), scope: activity.data.scope, authority_resources: option.resources.map(resource => ({
            resource_ref: resource.resource_ref, authority_epoch: resource.authority_epoch ?? null,
            authority_matches_provider: resource.authority_matches_provider ?? null, authority_assignable: resource.authority_assignable ?? null })),
        current_authority_epoch: option.current_authority_epoch ?? null };
        try { return await this.g.review(principal, context, OPERATION, payload, summary, {}, before); }
        catch (error) { choiceFailure(error); }
    }
    expected(principal, identity, idempotencyKey) {
        const expected = this.g.receipts.read(principal, identity, 'operation_expected', idempotencyKey);
        if (expected?.operation !== OPERATION || expected.payloadHash !== hash(expected.payload)) fail('workspace_receipt_unverified', 403);
        return expected;
    }
    acknowledge(raw, payload) {
        let response;
        try { response = JSON.parse(canonicalWorkspaceJson(raw)); } catch { fail('workspace_response_invalid', 502); }
        const keys = ['person_ref', 'provider_ref', 'capability_code', 'actions', 'allowed_fields', 'resource_policy', 'resource_refs',
            'expires_at', 'version', 'assign_source_authority', 'expected_authority_epoch', 'expected_authority_epochs'];
        try { strict(response, keys); }
        catch { fail('workspace_response_invalid', 502); }
        if (response.person_ref !== payload.person_ref || response.version !== payload.expected_version + 1
            || ['provider_ref', 'capability_code', 'resource_policy', 'assign_source_authority'].some(key => response[key] !== payload[key])
            || !['actions', 'allowed_fields', 'resource_refs'].every(key => sameSet(response[key], payload[key]))
            || !date(response.expires_at) || Date.parse(response.expires_at) !== Date.parse(payload.expires_at)
            || hash(response.expected_authority_epochs) !== hash(payload.expected_authority_epochs)
            || (Object.hasOwn(payload, 'expected_authority_epoch') ? response.expected_authority_epoch !== payload.expected_authority_epoch
                : response.expected_authority_epoch !== 0 || (payload.assign_source_authority && (!payload.resource_refs.length
                    || !sameSet(Object.keys(payload.expected_authority_epochs), payload.resource_refs)
                    || !Object.values(payload.expected_authority_epochs).every(integer))))) fail('workspace_response_invalid', 502);
        return response;
    }
    request(payload) {
        const body = Object.fromEntries(Object.entries(payload).filter(([key]) => !['activity_id', 'person_ref'].includes(key)));
        validateWorkspaceCoreModel('WorkspaceCapabilityGrant', body);
        return { method: 'PUT', path: `${BASE}/activities/${pathId(payload.activity_id)}/capability-grants/${pathId(payload.person_ref)}`, body };
    }
    planner() {
        return { includeConsumer: false,
            request: async reviewed => {
                const payload = reviewed.payload;
                const activity = reviewed.context.raw.activities.find(row => row.activity_id === payload.activity_id);
                if (activity?.can_manage_people !== true) fail('workspace_grant_management_forbidden', 403);
                return this.request(payload);
            },
            result: async ({ principal, reviewed, request, response }) => {
                const expected = this.expected(principal, reviewed.context.identity, reviewed.idempotencyKey);
                if (request && hash(request) !== hash(this.request(expected.payload))) fail('workspace_receipt_unverified', 403);
                return this.acknowledge(response, expected.payload);
            } };
    }
    async recover(input, expected, correlation) {
        const unknown = () => ({ state: 'unknown', correlation });
        if (expected?.operation !== OPERATION || expected.payloadHash !== input.inputHash
            || expected.payloadHash !== hash(expected.payload) || expected.payload.assign_source_authority) return unknown();
        try {
            const planned = this.request(expected.payload);
            if (input.request?.method !== planned.method || input.request.path !== planned.path
                || hash(JSON.parse(input.request.bodyJson)) !== hash(planned.body)) return unknown();
            const context = await this.g.loadContext(input.principal);
            if (!sameIdentity(context.identity, input.identity)) return unknown();
            const payload = expected.payload;
            const activity = context.raw.activities.find(row => row.activity_id === payload.activity_id);
            if (activity?.can_manage_people !== true) return unknown();
            const rows = activity.capability_grants.filter(row => row.person_ref === payload.person_ref
                && row.provider_ref === payload.provider_ref && row.capability_code === payload.capability_code);
            const row = rows.length === 1 ? rows[0] : null;
            if (!row || row.version !== payload.expected_version + 1 || row.resource_policy !== payload.resource_policy
                || !['actions', 'allowed_fields', 'resource_refs'].every(key => sameSet(row[key], payload[key]))
                || !date(row.expires_at) || Date.parse(row.expires_at) !== Date.parse(payload.expires_at)) return unknown();
            return { state: 'completed', result: row, correlation };
        } catch { return unknown(); }
    }
}
