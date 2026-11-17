import { ownerChoicesForScope, ownerMutationsHeld, ownerOverviewIsValid, ownerScopeKey, ownerStatusIsValid } from './sharedReadOwnerPresentation.js';

export const READ_SCOPE_ACTIONS = ['read.request', 'read.approve', 'fields.approve', 'read.manage', 'reviews.read', 'operations.inspect'];
export const OWNER_INTENT_STORAGE = 'wa_savana_owner_setup_intent_v1';
const operations = new Set(['scope.create', 'scope.authorize', 'request.create', 'request.edit', 'request.approve', 'request.reject', 'read_grant.revoke']);
const intentStates = new Set(['prepared', 'inflight', 'unknown', 'completed', 'failed']);
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const unique = (value, allowed, max) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(item => allowed.includes(item));
const future = value => typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Date.parse(value) > Date.now();
const demand = value => { if (!value) throw new Error('Current reviewed operation is unavailable'); };
const reason = value => { const result = typeof value === 'string' ? value.trim() : ''; demand(result.length > 0 && result.length <= 1000); return result; };
const centralScope = scope => ({ activity_id: scope.activity_id, branch_id: scope.branch_id, warehouse_id: scope.warehouse_id });

export const ownerAuthorizationEditable = authorization => !authorization || (authorization.native_editable !== false
    && authorization.actions.every(action => READ_SCOPE_ACTIONS.includes(action)));

export const ownerPolicyDiff = (before = {}, after = {}) => ({
    removed_fields: (before.fields || []).filter(field => !(after.fields || []).includes(field)),
    added_fields: (after.fields || []).filter(field => !(before.fields || []).includes(field)),
    removed_readers: (before.reader_account_ids || []).filter(id => !(after.reader_account_ids || []).includes(id)),
    added_readers: (after.reader_account_ids || []).filter(id => !(before.reader_account_ids || []).includes(id)),
});

export const prepareOwnerCommand = (overview, scope, input) => {
    demand(ownerOverviewIsValid(overview) && !ownerMutationsHeld(overview));
    const option = overview.options.scopes.find(item => ownerScopeKey(item.scope) === ownerScopeKey(scope));
    demand(option);
    const choices = ownerChoicesForScope(overview, scope);
    const request = choices.requests.find(item => item.request_id === input.requestId);
    const proposal = () => {
        if (input.kind === 'consumer_registration') {
            const enrollment = overview.options.enrollments.find(item => item.enrollment_id === input.enrollmentId);
            const label = typeof input.installationLabel === 'string' ? input.installationLabel.trim() : '';
            demand(enrollment && label.length > 0 && label.length <= 200);
            return { enrollment_id: enrollment.enrollment_id, enrollment_version: enrollment.version, installation_label: label };
        }
        demand(input.kind === 'read_sharing');
        const source = choices.sources.find(item => item.installation_id === input.sourceId);
        const consumer = choices.consumers.find(item => item.installation_id === input.consumerId);
        demand(source && consumer && unique(input.fields, source.fields, 8) && input.fields.length > 0);
        demand(unique(input.readerIds, overview.options.readers.map(item => item.account_id), 100) && input.readerIds.length > 0 && future(input.expiresAt));
        return { source_installation_id: source.installation_id, consumer_installation_id: consumer.installation_id,
            fields: [...input.fields], reader_account_ids: [...input.readerIds], expires_at: input.expiresAt };
    };
    if (input.operation === 'request.create') {
        demand(input.kind === 'consumer_registration' ? option.actions.request_consumer_registration : input.kind === 'read_sharing' && option.actions.request_read_sharing);
        return { operation: input.operation, body: { kind: input.kind, scope: centralScope(scope), proposal: proposal() } };
    }
    if (input.operation === 'request.edit') {
        demand(request?.actions.edit && input.kind === request.kind);
        return { operation: input.operation, requestId: request.request_id, body: { expected_version: request.version, proposal: proposal() } };
    }
    if (input.operation === 'request.approve' || input.operation === 'request.reject') {
        demand(request && (input.operation === 'request.approve' ? request.actions.approve : request.actions.reject));
        return { operation: input.operation, requestId: request.request_id, body: { expected_version: request.version,
            ...(input.operation === 'request.reject' ? { reason: reason(input.reason) } : {}) } };
    }
    if (input.operation === 'read_grant.revoke') {
        const grant = choices.grants.find(item => item.read_grant_id === input.requestId);
        demand(option.actions.revoke_read_grant && grant?.active);
        return { operation: input.operation, requestId: grant.read_grant_id, body: { expected_revision: grant.revision, reason: reason(input.reason) } };
    }
    if (input.operation === 'scope.authorize') {
        demand(overview.actions.authorize_scope === true && overview.options.readers.some(item => item.account_id === input.targetAccountId));
        const existing = overview.scope_authorizations.find(item => item.actor_id === input.targetAccountId && ownerScopeKey(item.scope) === ownerScopeKey(scope));
        demand(ownerAuthorizationEditable(existing) && unique(input.scopeActions, READ_SCOPE_ACTIONS, 6)
            && (input.expiresAt === null || future(input.expiresAt)));
        return { operation: input.operation, targetAccountId: input.targetAccountId, body: { scope: centralScope(scope),
            actions: [...input.scopeActions], expires_at: input.expiresAt, expected_version: existing?.version ?? 0 } };
    }
    throw new Error('Unsupported owner operation');
};

export const ownerIntentIsValid = value => Boolean(value && nonEmpty(value.id) && operations.has(value.operation) && intentStates.has(value.state)
    && /^[0-9a-f]{64}$/.test(value.request_sha256) && Number.isFinite(Date.parse(value.created_at)) && Number.isFinite(Date.parse(value.updated_at)));

export const ownerKnownPreDispatchRejection = (error, fresh) => error?.status === 422
    && (error?.data?.error?.code || error?.data?.code) === 'owner_portal_request_invalid'
    && ownerOverviewIsValid(fresh) && !ownerMutationsHeld(fresh);

export const ownerAttemptContext = value => ownerStatusIsValid(value) && value.enabled && nonEmpty(value.session.actor_id)
    && nonEmpty(value.session.organization_id) ? { native_reference: value.native_reference, actor_id: value.session.actor_id,
        organization_id: value.session.organization_id } : null;
export const ownerAttemptStorageKey = context => context && /^[0-9a-f]{64}$/.test(context.native_reference)
    && nonEmpty(context.actor_id) && nonEmpty(context.organization_id)
    ? `${OWNER_INTENT_STORAGE}:${context.native_reference}:${encodeURIComponent(context.actor_id)}:${encodeURIComponent(context.organization_id)}` : null;

export const restoreOwnerAttempt = (storage, context) => {
    try {
        const key = ownerAttemptStorageKey(context);
        if (!key) return null;
        const value = JSON.parse(storage.getItem(key) || 'null');
        if (!value || !nonEmpty(value.idempotencyKey) || value.idempotencyKey.length > 255 || !operations.has(value.operation)
            || !intentStates.has(value.state) || !nonEmpty(value.actor_id) || !nonEmpty(value.organization_id)
            || !(value.id === null || nonEmpty(value.id)) || ownerAttemptStorageKey(value) !== key) return null;
        return { idempotencyKey: value.idempotencyKey, id: value.id, operation: value.operation, state: value.state,
            native_reference: value.native_reference, actor_id: value.actor_id, organization_id: value.organization_id };
    } catch { return null; }
};
export const persistOwnerAttempt = (storage, value, context = value) => {
    try {
        const key = ownerAttemptStorageKey(context);
        if (!key || (value && ownerAttemptStorageKey(value) !== key)) return false;
        if (!value) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify({ idempotencyKey: value.idempotencyKey, id: value.id,
            operation: value.operation, state: value.state, native_reference: value.native_reference, actor_id: value.actor_id, organization_id: value.organization_id }));
        return true;
    } catch { return false; }
};
