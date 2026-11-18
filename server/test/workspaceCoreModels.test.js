import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { validateWorkspaceCoreModel, WORKSPACE_MODELS_SHA256 } from '../services/workspaceCoreModels.js';

test('runtime delegated workspace request schemas retain the exact published source identity', () => {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../config/peer-owner-workspace-models-v4.json', import.meta.url))).digest('hex'), WORKSPACE_MODELS_SHA256);
});

test('binding derives owner context from authentication and requires persisted native correlation/revision', () => {
    const binding = { external_tenant_id: 'wa_savana:tenant:1', display_name: 'الحساب الحالي',
        redirect_uri: 'https://wa.invalid/api/portal/integrations/workspace/binding/callback', state: 'a'.repeat(32), expected_selection_revision: 'b'.repeat(64) };
    assert.equal(validateWorkspaceCoreModel('WorkspaceBindingRequest', binding), binding);
    for (const extra of [{ actor_id: 'browser-owner' }, { organization_id: 'browser-org' }, { permissions: ['*'] }]) {
        assert.throws(() => validateWorkspaceCoreModel('WorkspaceBindingRequest', { ...binding, ...extra }), { code: 'workspace_request_invalid' });
    }
    assert.throws(() => validateWorkspaceCoreModel('WorkspaceBindingRequest', { ...binding, state: 'short' }), { code: 'workspace_request_invalid' });
    assert.throws(() => validateWorkspaceCoreModel('WorkspaceBindingRequest', { ...binding, expected_selection_revision: 'old' }), { code: 'workspace_request_invalid' });
});

test('selection and sharing preserve exact revision/fields/people/idempotency and reject supplied authority', () => {
    const selection = { activity_id: 'verified-activity', provider_ref: 'verified-provider', external_tenant_id: 'wa_savana:tenant:1',
        expected_selection_revision: 'b'.repeat(64), idempotency_key: 'same-server-request' };
    assert.equal(validateWorkspaceCoreModel('WorkspaceSelectionRequest', selection), selection);
    const sharing = { activity_id: 'verified-activity', kind: 'read_sharing', source_installation_ref: 'source',
        consumer_installation_ref: 'consumer', fields: ['name', 'price'], people_refs: ['person'], idempotency_key: 'same-server-request' };
    assert.equal(validateWorkspaceCoreModel('WorkspaceRequestCreate', sharing), sharing);
    for (const value of [{ ...sharing, fields: ['private_access_token'] }, { ...sharing, scope: { organization_id: 'browser-org' } },
        { ...sharing, approved: true }, { ...sharing, idempotency_key: 'short' }]) {
        assert.throws(() => validateWorkspaceCoreModel('WorkspaceRequestCreate', value), { code: 'workspace_request_invalid' });
    }
});

test('activity/provider/edits/capability grants retain published native constraints without role bypass', () => {
    assert.throws(() => validateWorkspaceCoreModel('WorkspaceActivityCreate', { name: 'x', idempotency_key: 'same-key-123' }), { code: 'workspace_request_invalid' });
    assert.throws(() => validateWorkspaceCoreModel('WorkspaceProviderPrepare', { activity_id: 'activity', role: 'owner' }), { code: 'workspace_request_invalid' });
    assert.throws(() => validateWorkspaceCoreModel('WorkspaceRequestEdit', { activity_id: 'activity', kind: 'read_sharing', expected_version: 0 }), { code: 'workspace_request_invalid' });
    const grant = { provider_ref: 'provider', capability_code: 'products.write', actions: ['request'], resource_policy: 'new_only',
        expires_at: '2026-11-19T12:00:00Z', expected_version: 0 };
    assert.equal(validateWorkspaceCoreModel('WorkspaceCapabilityGrant', grant), grant);
    assert.throws(() => validateWorkspaceCoreModel('WorkspaceCapabilityGrant', { ...grant, actions: ['*'] }), { code: 'workspace_request_invalid' });
});
