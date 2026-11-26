import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeWorkspaceProductRecords } from '../services/workspaceProductRecords.js';
import { workspaceProductOption } from '../services/workspaceProductReader.js';

const examples = JSON.parse(fs.readFileSync(new URL('../test-fixtures/peer-owner-workspace-responses-v4.json', import.meta.url))).examples;
const expectedFor = value => ({ scope: value.context.scope, actorId: value.context.actor_id, consumerPlatform: value.context.consumer_platform,
    consumerAccountId: value.context.consumer_account_id, consumerInstallationId: value.context.consumer_installation_id });
const invalid = { code: 'workspace_record_response_invalid', status: 502 };

test('actual public peer record HTTP examples use the same closed body and current consumer semantics', () => {
    const document = JSON.parse(fs.readFileSync(new URL('../test-fixtures/owner-peer-record-grant-http-v1.json', import.meta.url)));
    for (const sample of document.examples.filter(row => row.method === 'GET')) {
        const raw = sample.response;
        assert.deepEqual(decodeWorkspaceProductRecords(raw, expectedFor(raw), { detail: !!raw.record, now: Date.parse(raw.context.checked_at) + 1 }), raw);
    }
});

test('actual published enriched record/search DTOs are closed and bound to the current reader, without declaring a peer transport', () => {
    for (const [name, detail] of [['portal_records_search_for_saw_consumer', false], ['portal_record_detail_for_saw_consumer', true]]) {
        const value = examples[name], now = Date.parse(value.context.checked_at) + 1;
        const parsed = decodeWorkspaceProductRecords(value, expectedFor(value), { detail, now });
        assert.deepEqual(parsed, value); assert.notEqual(parsed, value);
        for (const key of ['actorId', 'consumerPlatform', 'consumerAccountId', 'consumerInstallationId']) {
            assert.throws(() => decodeWorkspaceProductRecords(value, { ...expectedFor(value), [key]: 'foreign' }, { detail, now }), invalid);
        }
        assert.throws(() => decodeWorkspaceProductRecords(value, expectedFor(value), { detail, now: Date.parse(value.context.valid_until) }), invalid);
    }
});

test('a record-specific change hint cannot substitute another record, source installation, field value or reader scope', () => {
    const value = examples.portal_record_detail_for_saw_consumer, expected = expectedFor(value), now = Date.parse(value.context.checked_at) + 1;
    const rejects = mutate => { const copy = structuredClone(value); mutate(copy); assert.throws(() => decodeWorkspaceProductRecords(copy, expected, { detail: true, now }), invalid); };
    for (const key of ['record_ref', 'source_installation_id']) rejects(copy => { copy.record.available_actions[0][key] = 'foreign'; });
    rejects(copy => { copy.record.available_actions[0].record_version += 1; });
    rejects(copy => { copy.record.available_actions[0].approved = true; });
    rejects(copy => { copy.record.scope.branch_id = 'other-branch'; });
    rejects(copy => { copy.record.data.private_access_token = 'must-not-return'; });
    rejects(copy => { copy.record.fields[0].value = 'value-not-in-current-record'; });
    rejects(copy => { copy.record.fields[0].authoritative = false; });
    rejects(copy => { copy.context.permissions = []; });
});

test('a shared record remains readable when Core returns an unavailable product change', () => {
    const value = structuredClone(examples.portal_record_detail_for_saw_consumer);
    const enabled = value.record.available_actions[0];
    const action = { activity_id: enabled.activity_id, provider_ref: enabled.provider_ref, capability: 'products.write',
        action: 'product.change', available: false, allowed_fields: [], authorization_revision: null,
        source_installation_id: null, reason_code: 'workspace_capability_permission_required', message: 'تلزم صلاحية تعديل المنتج.' };
    value.record.available_actions = [action];
    const expected = { ...expectedFor(value), providerRef: enabled.provider_ref };
    const options = { detail: true, now: Date.parse(value.context.checked_at) + 1 };
    const parsed = decodeWorkspaceProductRecords(value, expected, options);
    assert.deepEqual(parsed, value);
    assert.equal(workspaceProductOption({}, { activity_id: action.activity_id, scope: value.record.scope },
        { provider_ref: action.provider_ref }, parsed.record), null);
    for (const change of [{ activity_id: 'different-activity' }, { provider_ref: 'different-provider' }, { action: 'product.create' },
        { allowed_fields: ['name'] }, { authorization_revision: 'a'.repeat(64) }, { record_ref: null },
        { source_installation_id: value.record.source.installation_id }, { record_version: value.record.version }]) {
        const invalidValue = structuredClone(value);
        Object.assign(invalidValue.record.available_actions[0], change);
        assert.throws(() => decodeWorkspaceProductRecords(invalidValue, expected, options), invalid);
    }
});
