import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerFixtureOverview } from '../../../browser-tests/sharedReadOwnerFixture.js';
import { savanaIntegrationMethods } from '../../api/savanaIntegrations.js';
import { ownerAttemptContext, ownerAuthorizationEditable, ownerIntentIsValid, ownerKnownPreDispatchRejection, ownerPolicyDiff, persistOwnerAttempt, prepareOwnerCommand, restoreOwnerAttempt } from './sharedReadOwnerOperations.js';

const model = () => { const overview = ownerFixtureOverview(); return { overview, scope: overview.options.scopes[0].scope }; };
const future = () => new Date(Date.now() + 60_000).toISOString();

test('consumer request derives enrollment version and exact scope without browser organization or actor authority', () => {
    const { overview, scope } = model();
    const command = prepareOwnerCommand(overview, scope, { operation: 'request.create', kind: 'consumer_registration',
        enrollmentId: 'synthetic-public-enrollment', installationLabel: ' Native WA ', enrollmentVersion: 999, actor_id: 'browser-owner' });
    assert.deepEqual(command.body, { kind: 'consumer_registration', scope: { activity_id: scope.activity_id, branch_id: null, warehouse_id: null },
        proposal: { enrollment_id: 'synthetic-public-enrollment', enrollment_version: 1, installation_label: 'Native WA' } });
    assert.throws(() => prepareOwnerCommand(overview, scope, { operation: 'request.create', kind: 'consumer_registration', enrollmentId: 'other-account', installationLabel: 'Native WA' }));
});

test('sharing accepts only exact-scope source fields, current members and timezone-aware future expiry', () => {
    const { overview, scope } = model();
    const input = { operation: 'request.create', kind: 'read_sharing', sourceId: 'synthetic-catalog-installation', consumerId: 'synthetic-wa-installation', fields: ['name'], readerIds: ['synthetic-reader-account'], expiresAt: future() };
    assert.equal(prepareOwnerCommand(overview, scope, input).body.proposal.fields[0], 'name');
    for (const change of [{ fields: ['media'] }, { fields: ['name', 'name'] }, { readerIds: ['inactive-account'] }, { expiresAt: '2030-01-01T12:00:00' }, { expiresAt: '2000-01-01T12:00:00Z' }]) {
        assert.throws(() => prepareOwnerCommand(overview, scope, { ...input, ...change }));
    }
    assert.throws(() => prepareOwnerCommand(overview, overview.options.scopes[1].scope, input));
});

test('request approval/rejection and grant revocation pin current exact versions with bounded reasons', () => {
    const { overview, scope } = model();
    const approve = prepareOwnerCommand(overview, scope, { operation: 'request.approve', requestId: 'synthetic-read-sharing-request' });
    assert.deepEqual(approve, { operation: 'request.approve', requestId: 'synthetic-read-sharing-request', body: { expected_version: 2 } });
    const revoke = prepareOwnerCommand(overview, scope, { operation: 'read_grant.revoke', requestId: 'synthetic-read-grant', reason: ' Explicit reason ' });
    assert.deepEqual(revoke, { operation: 'read_grant.revoke', requestId: 'synthetic-read-grant', body: { expected_revision: 1, reason: 'Explicit reason' } });
    assert.throws(() => prepareOwnerCommand(overview, scope, { operation: 'request.reject', requestId: 'synthetic-read-sharing-request', reason: 'x'.repeat(1001) }));
    assert.throws(() => prepareOwnerCommand(overview, scope, { operation: 'publisher.rotate', requestId: 'synthetic-read-grant' }));
});

test('scope authorization preserves unsupported native authority and does not infer admin from ownership', () => {
    const { overview, scope } = model();
    const input = { operation: 'scope.authorize', targetAccountId: 'synthetic-reader-account', scopeActions: [], expiresAt: null };
    const command = prepareOwnerCommand(overview, scope, input);
    assert.equal(command.body.expected_version, 0);
    assert.equal(Object.hasOwn(command.body.scope, 'organization_id'), false);
    assert.throws(() => prepareOwnerCommand({ ...overview, actions: { ...overview.actions, authorize_scope: false }, local_role: 'owner' }, scope, input));
    const existing = { actor_id: input.targetAccountId, scope, actions: ['read.request'], version: 8, expires_at: null, native_editable: false };
    assert.equal(ownerAuthorizationEditable(existing), false);
    assert.throws(() => prepareOwnerCommand({ ...overview, scope_authorizations: [existing] }, scope, input));
    assert.equal(ownerAuthorizationEditable({ ...existing, native_editable: true, actions: ['source.manage', 'read.request'] }), false);
});

test('replacement policy diff explicitly identifies removed fields and reader accounts', () => {
    assert.deepEqual(ownerPolicyDiff({ fields: ['name', 'price'], reader_account_ids: ['old', 'retained'] }, { fields: ['name', 'media'], reader_account_ids: ['retained', 'new'] }),
        { removed_fields: ['price'], added_fields: ['media'], removed_readers: ['old'], added_readers: ['new'] });
});

test('retained attempt storage keeps only opaque blocking metadata and the original key', () => {
    const values = new Map();
    const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key), removeItem: key => values.delete(key) };
    const record = { idempotencyKey: 'stable-original-key', id: null, operation: 'request.approve', state: 'unknown', native_reference: 'b'.repeat(64), actor_id: 'synthetic-owner', organization_id: 'synthetic-org', password: 'DO_NOT_PERSIST', proposal: { private: true } };
    assert.equal(persistOwnerAttempt(storage, record), true);
    assert.equal([...values.values()][0].includes('DO_NOT_PERSIST'), false);
    assert.equal([...values.values()][0].includes('proposal'), false);
    assert.equal(restoreOwnerAttempt(storage, record).idempotencyKey, 'stable-original-key');
    assert.equal(restoreOwnerAttempt(storage, record).state, 'unknown');
    assert.equal(ownerIntentIsValid({ id: 'server-intent', operation: record.operation, state: 'unknown', request_sha256: 'a'.repeat(64), created_at: future(), updated_at: future() }), true);
});

test('blocking attempt partitions preserve old contexts without blocking a different native user, actor or organization', () => {
    const values = new Map();
    const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key), removeItem: key => values.delete(key) };
    const { overview } = model();
    const first = ownerAttemptContext(overview);
    const record = { ...first, idempotencyKey: 'original-context-key', id: null, operation: 'request.approve', state: 'unknown' };
    assert.equal(persistOwnerAttempt(storage, record), true);
    for (const context of [{ ...first, native_reference: 'c'.repeat(64) }, { ...first, actor_id: 'another-actor' }, { ...first, organization_id: 'another-organization' }]) {
        assert.equal(restoreOwnerAttempt(storage, context), null);
        assert.equal(persistOwnerAttempt(storage, null, context), true);
        assert.equal(restoreOwnerAttempt(storage, first).idempotencyKey, 'original-context-key');
    }
    assert.equal(restoreOwnerAttempt(storage, null), null);
    assert.equal(restoreOwnerAttempt(storage, ownerAttemptContext({ ...overview, native_reference: 'b'.repeat(64) })).idempotencyKey, 'original-context-key');
});

test('intent lookup is read-only by original key and native reader binding forwards no grants or tokens', async () => {
    const calls = [];
    const client = { request: (...args) => { calls.push(args); return {}; } };
    await savanaIntegrationMethods.getPortalSharedReadOwnerIntentByKey.call(client, 'original/key');
    await savanaIntegrationMethods.bindPortalSharedReadConsumer.call(client, { consumer_installation_id: 'own-consumer', activity_id: 'own-activity', actor_id: 'injected', organization_id: 'injected', fields: ['*'], token: 'secret' });
    assert.deepEqual(calls[0], ['/api/portal/integrations/shared-read-setup/owner/intents/by-key/original%2Fkey']);
    assert.deepEqual(JSON.parse(calls[1][1].body), { consumer_installation_id: 'own-consumer', activity_id: 'own-activity', branch_id: null, warehouse_id: null });
    assert.deepEqual(calls[1][1].headers, { 'X-Savana-Owner-Intent': 'shared-read-setup-v1' });
});

test('only explicit pre-dispatch validation rejection plus fresh unheld status may release a local hold', () => {
    const { overview } = model();
    const error = { status: 422, data: { error: { code: 'owner_portal_request_invalid' } } };
    assert.equal(ownerKnownPreDispatchRejection(error, overview), true);
    for (const rejected of [{ ...error, status: 403 }, { ...error, status: 409 }, { status: 422, data: { code: 'unresolved_intent' } }, { status: 404 }]) {
        assert.equal(ownerKnownPreDispatchRejection(rejected, overview), false);
    }
    assert.equal(ownerKnownPreDispatchRejection(error, { ...overview, intents: { unknown_count: 1, inflight_count: 0, mutations_blocked: true } }), false);
    assert.equal(ownerKnownPreDispatchRejection(error, { ...overview, context: { ...overview.context, valid_until: '2000-01-01T00:00:00Z' } }), false);
});
