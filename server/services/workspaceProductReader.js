import { SharedProductReadError } from './centralProductRead.js';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { decodeWorkspaceCommandOption } from './workspaceCoreResponses.js';
import { decodeWorkspaceProductRecords } from './workspaceProductRecords.js';

const fail = (code = 'workspace_activity_selection_required', status = 409) => { throw new SharedProductReadError(code, status); };
const sameScope = (left, right) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'].every(key => (left?.[key] ?? null) === (right?.[key] ?? null));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 255;

export const workspaceProductOption = (context, activity, provider, record = null) => {
    const rows = record ? record.available_actions || [] : context.raw.command_options;
    const matches = rows.filter(option => option.action === (record ? 'product.change' : 'product.create')
        && option.activity_id === activity.activity_id && option.provider_ref === provider.provider_ref && option.available === true);
    if (matches.length !== 1) return null;
    const option = decodeWorkspaceCommandOption(matches[0]);
    if (record && (option.record_ref !== record.entity_id || option.record_version !== record.version
        || option.source_installation_id !== record.source.installation_id || !sameScope(record.scope, activity.scope))) fail('workspace_record_response_invalid', 502);
    return option;
};

// Exact published peer GET wire. A verified selection is a selector, while
// Core independently enforces current account/link/read/field permissions.
export class WorkspaceProductReader {
    constructor({ gateway }) { this.gateway = gateway; }
    async read(principal, context, activity, { entityId = null, q = '', cursor = null } = {}) {
        if (!text(context.consumerInstallationId) || !context.selection || !sameScope(context.selection.scope, activity.scope)
            || context.selection.account.provider_ref !== context.identity.coreAccountId || context.selection.account.platform !== 'wa_savana') fail();
        if (typeof q !== 'string' || q.length > 200 || (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 4096))
            || (entityId !== null && (!text(entityId) || !/^[A-Za-z0-9_:.-]+$/.test(entityId) || ['.', '..'].includes(entityId)))) fail('workspace_request_invalid', 422);
        const query = new URLSearchParams({ activity_id: activity.activity_id });
        if (entityId === null) { query.set('q', q); if (cursor !== null) query.set('cursor', cursor); }
        const { payload } = await this.gateway.transport.request(principal, { path: `/v1/integration/workspace/records${entityId === null ? '' : '/' + encodeURIComponent(entityId)}?${query}`,
            expectedIdentity: context.identity, consumerInstallation: context.consumerInstallationId });
        const value = decodeWorkspaceProductRecords(payload, { scope: activity.scope, actorId: context.actorId, consumerPlatform: 'wa_savana',
            consumerAccountId: context.identity.coreAccountId, consumerInstallationId: context.consumerInstallationId }, { detail: entityId !== null, now: this.gateway.now() });
        if (entityId !== null && value.record.entity_id !== entityId) fail('workspace_record_response_invalid', 502);
        const latest = await this.gateway.loadContext(principal);
        if (latest.revision !== context.revision || canonicalWorkspaceJson(latest.identity) !== canonicalWorkspaceJson(context.identity)
            || latest.consumerInstallationId !== context.consumerInstallationId) fail('workspace_context_changed', 403);
        return value;
    }
    search(principal, context, activity, input = {}) { return this.read(principal, context, activity, input); }
    record(principal, context, activity, entityId) { return this.read(principal, context, activity, { entityId }); }
}
