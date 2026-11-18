import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WorkspaceProductReader, workspaceProductOption } from '../services/workspaceProductReader.js';

const sample = JSON.parse(fs.readFileSync(new URL('../test-fixtures/owner-peer-record-grant-http-v1.json', import.meta.url))).examples[1].response;
const fixture = () => {
    // WA-shaped synthetic adaptation of the actual peer DTO. The unmodified
    // Saw-owned producer bytes are separately tested; this is not joint proof.
    const value = structuredClone(sample); value.context.consumer_platform = 'wa_savana';
    const identity = { actorId: value.context.actor_id, organizationId: value.context.scope.organization_id,
        coreAccountId: value.context.consumer_account_id, nativeAccountId: 'wa_savana:tenant:1', generation: 'owned-generation', expiresAt: value.context.valid_until };
    const context = { actorId: identity.actorId, revision: 'owned-current-revision', identity, consumerInstallationId: value.context.consumer_installation_id,
        selection: { scope: value.context.scope, account: { provider_ref: identity.coreAccountId, platform: 'wa_savana' } } };
    let latest = context; const calls = [];
    const gateway = { now: () => Date.parse(value.context.checked_at) + 1, loadContext: async () => latest,
        transport: { request: async (_principal, input) => { calls.push(input); return { payload: structuredClone(value) }; } } };
    return { reader: new WorkspaceProductReader({ gateway }), gateway, context, value, calls,
        activity: { activity_id: value.context.scope.activity_id, scope: value.context.scope }, change: next => { latest = next; } };
};

test('peer detail requires the actual current selection and sends no query-selected consumer or legacy fallback', async () => {
    const f = fixture(); const result = await f.reader.record({}, f.context, f.activity, f.value.record.entity_id);
    assert.deepEqual(result, f.value); assert.equal(f.calls.length, 1);
    const request = f.calls[0], url = new URL(request.path, 'https://owned-core.invalid');
    assert.equal(request.consumerInstallation, f.context.consumerInstallationId); assert.deepEqual(request.expectedIdentity, f.context.identity);
    assert.equal(url.pathname, '/v1/integration/workspace/records/' + f.value.record.entity_id);
    assert.deepEqual([...url.searchParams.keys()], ['activity_id']);
    await assert.rejects(f.reader.record({}, { ...f.context, consumerInstallationId: null }, f.activity, f.value.record.entity_id), { code: 'workspace_activity_selection_required' });
    await assert.rejects(f.reader.record({}, { ...f.context, selection: { ...f.context.selection, scope: { ...f.activity.scope, activity_id: 'foreign' } } }, f.activity, f.value.record.entity_id),
        { code: 'workspace_activity_selection_required' });
    assert.equal(f.calls.length, 1);
});

test('a changed current grant, native binding or consumer after the read withholds the whole record', async () => {
    for (const update of [context => ({ ...context, revision: 'withdrawn-grant' }),
        context => ({ ...context, identity: { ...context.identity, coreAccountId: 'rebound-account' } }),
        context => ({ ...context, consumerInstallationId: 'different-consumer' })]) {
        const f = fixture(); f.change(update(f.context));
        await assert.rejects(f.reader.record({}, f.context, f.activity, f.value.record.entity_id), { code: 'workspace_context_changed' });
        assert.equal(f.calls.length, 1);
    }
});

test('only exact record-specific change options enable editing; a global create/change row cannot substitute', () => {
    const f = fixture(), row = f.value.record, action = row.available_actions[0];
    const provider = { provider_ref: action.provider_ref };
    const context = { raw: { command_options: [action, { ...action, action: 'product.create' }] } };
    assert.equal(workspaceProductOption(context, f.activity, provider, row).record_ref, row.entity_id);
    assert.equal(workspaceProductOption(context, f.activity, provider, { ...row, available_actions: [] }), null);
    assert.throws(() => workspaceProductOption(context, f.activity, provider, { ...row, version: row.version + 1 }), { code: 'workspace_record_response_invalid' });
});
