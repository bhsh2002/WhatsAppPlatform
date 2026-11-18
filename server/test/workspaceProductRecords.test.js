import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeWorkspaceProductRecords } from '../services/workspaceProductRecords.js';

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
