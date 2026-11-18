import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { OWNER_JOURNEY_RESULT_BINDING_HEADER, decodeOwnerJourneyResultBinding, matchOwnerJourneyResultBinding } from '../test-support/ownerJourneyResultBinding.js';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const encodedText = value => Buffer.from(value).toString('base64url');
const fixture = (operation = 'inventory.read', mime = 'application/json') => {
    const bytes = Buffer.from(mime === 'application/json' ? '{"quantity":1.0,"adjustment":-0.0,"label":"دفتر المصدر"}' : 'quantity,label\r\n1,دفتر المصدر\r\n');
    const scope = { organization_id: 'owned-org', activity_id: 'owned-activity', branch_id: 'owned-branch', warehouse_id: 'owned-warehouse' };
    const binding = { format: 'savana-owner-fixture-result-binding/1', run_id: 'owned-run', command_id: 'actual-command', version: 2,
        approval_fingerprint: 'a'.repeat(64), provider_ref: 'actual-catalog-provider', source_installation_id: 'actual-source-installation',
        scope, capability_code: operation === 'inventory.read' ? 'inventory.read' : 'inventory.count', operation,
        source_result: { local_entity_id: 'actual-ledger-fact', source_revision: 3, result_reference: '/owner/actual-receipt' },
        content_type: mime, byte_length: bytes.length, content_sha256: sha(bytes) };
    const command = { command_id: binding.command_id, version: binding.version, organization_id: scope.organization_id, activity_id: scope.activity_id,
        approval_fingerprint: binding.approval_fingerprint, provider_ref: binding.provider_ref, capability: binding.capability_code, action: binding.operation,
        source_result: structuredClone(binding.source_result), state: 'source_applied', projection_state: 'not_required', available_actions: [],
        payload: { payload_type: 'native_action', parameters: {} }, requested_by: 'actual-owner', updated_at: '2026-11-18T12:00:00Z' };
    const input = { header: encode(binding), runId: binding.run_id, command, scope: structuredClone(scope),
        provider: { provider_ref: binding.provider_ref, platform: 'catalog', activity_id: scope.activity_id,
            installations: [{ installation_id: binding.source_installation_id, activity_id: scope.activity_id }] },
        representation: { bytes, contentType: mime, sha256: sha(bytes) } };
    return { binding, input };
};

test('closed fixture header decodes only metadata and matcher returns actual immutable installation/full scope for both published pairs', () => {
    assert.equal(OWNER_JOURNEY_RESULT_BINDING_HEADER, 'x-savana-owner-fixture-result-binding');
    for (const [operation, mime] of [['inventory.read', 'application/json'], ['inventory.count_delta', 'text/csv']]) {
        const { binding, input } = fixture(operation, mime);
        assert.deepEqual(decodeOwnerJourneyResultBinding(input.header), binding);
        assert.deepEqual(matchOwnerJourneyResultBinding(input), { sourceInstallationId: binding.source_installation_id, scope: binding.scope });
        assert.equal(Object.keys(matchOwnerJourneyResultBinding(input)).length, 2);
        assert.equal(Object.isFrozen(decodeOwnerJourneyResultBinding(input.header).scope), true);
    }
});

test('both actual published Core/Portal JSON+CSV wire headers decode exactly without manufacturing unpublished result bodies', () => {
    const captured = JSON.parse(fs.readFileSync(new URL('../test-support/ownerJourneyResultBinding.core-http-example.json', import.meta.url), 'utf8'));
    assert.equal(captured.provenance.source_sha256, '614a1bc267923f041ebc3c6d2826ae60dc9a969adc76a7e1dcd5f78d414145de');
    assert.equal(captured.provenance.response_body_published, false);
    assert.deepEqual(captured.examples.map(row => row.decoded.content_type), ['application/json', 'text/csv']);
    for (const example of captured.examples) {
        assert.deepEqual(Object.keys(example), ['wire_header', 'decoded']);
        assert.deepEqual(decodeOwnerJourneyResultBinding(example.wire_header), example.decoded);
    }
});

test('header transport rejects multiple/non-ASCII/padded/oversized/noncanonical base64url and invalid UTF8/BOM', () => {
    const { input } = fixture();
    for (const header of [undefined, null, [], [input.header], {}, '', ' ', 'é', input.header + ',' + input.header,
        input.header + '=', '+' + input.header, '/' + input.header, 'A'.repeat(8193), 'A', input.header + '\n']) {
        assert.equal(decodeOwnerJourneyResultBinding(header), null);
    }
    const json = Buffer.from(input.header, 'base64url').toString('utf8');
    assert.equal(decodeOwnerJourneyResultBinding(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json)]).toString('base64url')), null);
    const malformed = Buffer.concat([Buffer.from('{"format":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
    assert.equal(decodeOwnerJourneyResultBinding(malformed.toString('base64url')), null);
    let original = input.header;
    while (original.length % 4 === 0) original = encodedText(Buffer.from(original, 'base64url').toString('utf8') + ' ');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const altered = original.slice(0, -1) + alphabet[alphabet.indexOf(original.at(-1)) ^ 1];
    assert.deepEqual(Buffer.from(altered, 'base64url'), Buffer.from(original, 'base64url'));
    assert.equal(decodeOwnerJourneyResultBinding(altered), null);
});

test('strict JSON detects duplicate escaped keys at every object depth and rejects float/exponent integer tokens', () => {
    const raw = JSON.stringify(fixture().binding);
    for (const json of [
        raw.replace('"version":2', '"version":2,"version":2'),
        raw.replace('"version":2', '"version":2,"vers\\u0069on":2'),
        raw.replace('"warehouse_id":"owned-warehouse"', '"warehouse_id":"owned-warehouse","warehouse_id":"owned-warehouse"'),
        raw.replace('"source_revision":3', '"source_revision":3,"source\\u005frevision":3'),
        raw.replace('"version":2', '"version":2.0'), raw.replace('"version":2', '"version":2e0'),
        raw.replace('"source_revision":3', '"source_revision":3.0'),
        raw.replace(/"byte_length":([0-9]+)/, '"byte_length":$1.0'),
        raw + '{}', raw.replace('"version":2', '"version":true'), raw.replace('"version":2', '"version":02'),
        raw.replace('"version":2', '"version":+2'), raw.slice(0, -1) + ',}', '[' + raw + ']',
        raw.replace('"scope":{', '"scope":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":null}}}}}}}}},'),
    ]) assert.equal(decodeOwnerJourneyResultBinding(encodedText(json)), null);
    // Escaped spelling is legitimate JSON when it is not a duplicate key.
    assert.notEqual(decodeOwnerJourneyResultBinding(encodedText(raw.replace('"version":2', '"vers\\u0069on":2'))), null);
});

test('closed nested shapes enforce bounds/types, exact pairs and warehouse/branch relationship without extra claims', () => {
    for (const mutate of [
        value => { value.actor = 'not-authority'; }, value => { value.observed_at = '2026-11-18T00:00:00Z'; },
        value => { value.scope.extra = 'outside-contract'; }, value => { delete value.scope.warehouse_id; },
        value => { value.source_result.extra = 'outside-contract'; }, value => { delete value.source_installation_id; },
        value => { value.format = 'other'; }, value => { value.run_id = 'r'.repeat(201); },
        value => { value.command_id = 'c'.repeat(256); }, value => { value.provider_ref = ' \t'; },
        value => { value.source_installation_id = 'source\0wrong'; }, value => { value.version = Number.MAX_SAFE_INTEGER + 1; },
        value => { value.source_result.source_revision = 0; }, value => { value.source_result.result_reference = 'r'.repeat(1001); },
        value => { value.byte_length = 0; }, value => { value.byte_length = 4_194_305; },
        value => { value.approval_fingerprint = 'A'.repeat(64); }, value => { value.content_sha256 = 'short'; },
        value => { value.approval_fingerprint += '\n'; }, value => { value.content_sha256 += '\n'; },
        value => { value.content_type = 'text/html'; }, value => { value.scope.branch_id = null; },
        value => { value.capability_code = 'inventory.read'; value.operation = 'inventory.count_delta'; },
        value => { value.capability_code = 'orders.fulfil'; value.operation = 'order.read'; },
    ]) {
        const { binding } = fixture(); mutate(binding); assert.equal(decodeOwnerJourneyResultBinding(encode(binding)), null);
    }
    const { binding } = fixture(); binding.scope.branch_id = binding.scope.warehouse_id = null;
    binding.version = Number.MAX_SAFE_INTEGER;
    assert.notEqual(decodeOwnerJourneyResultBinding(encode(binding)), null);
    const bounded = fixture().binding;
    bounded.source_result.result_reference = '😀'.repeat(1000);
    assert.equal([...bounded.source_result.result_reference].length, 1000);
    assert.equal(encode(bounded).length > 8192, false);
    assert.notEqual(decodeOwnerJourneyResultBinding(encode(bounded)), null);
    bounded.command_id = '😀'.repeat(255); bounded.provider_ref = '😀'.repeat(255);
    assert.equal(encode(bounded).length > 8192, true);
    assert.equal(decodeOwnerJourneyResultBinding(encode(bounded)), null);
});

test('matcher pins actual immutable command, receipt, current Catalog provider and installation with no sole-install fallback', () => {
    for (const mutate of [
        value => { value.runId = 'another-run'; }, value => { value.command.command_id = 'other-command'; },
        value => { value.command.version += 1; }, value => { value.command.approval_fingerprint = 'b'.repeat(64); },
        value => { value.command.provider_ref = 'other-provider'; }, value => { value.command.organization_id = 'other-org'; },
        value => { value.command.activity_id = 'other-activity'; }, value => { value.command.state = 'approved'; },
        value => { value.command.action = 'inventory.count_delta'; }, value => { value.command.source_result.source_revision += 1; },
        value => { value.command.source_result.local_entity_id = 'other-fact'; },
        value => { value.command.source_result.result_reference = '/other/receipt'; },
        value => { value.provider.platform = 'wa_savana'; }, value => { value.provider.provider_ref = 'another-provider'; },
        value => { value.provider.activity_id = 'another-activity'; }, value => { value.provider.installations = []; },
        value => { value.provider.installations[0].installation_id = 'sole-but-unrelated-installation'; },
        value => { value.provider.installations[0].activity_id = 'another-activity'; },
    ]) { const { input } = fixture(); mutate(input); assert.equal(matchOwnerJourneyResultBinding(input), null); }
    assert.equal(matchOwnerJourneyResultBinding(), null);
});

test('broader current activity scope preserves frozen header scope while explicit current branch/warehouse conflicts deny', () => {
    const { input, binding } = fixture();
    input.scope.branch_id = input.scope.warehouse_id = null;
    assert.deepEqual(matchOwnerJourneyResultBinding(input), { sourceInstallationId: binding.source_installation_id, scope: binding.scope });
    input.scope.branch_id = binding.scope.branch_id;
    assert.notEqual(matchOwnerJourneyResultBinding(input), null);
    for (const scope of [{ ...input.scope, organization_id: 'another-org' }, { ...input.scope, activity_id: 'another-activity' },
        { ...input.scope, branch_id: 'different-branch' }, { ...input.scope, warehouse_id: 'different-warehouse' }]) {
        assert.equal(matchOwnerJourneyResultBinding({ ...input, scope }), null);
    }
});

test('matcher hashes actual producer-formatted filtered bytes without rewriting Python floats/Unicode and denies MIME/size/SHA tamper', () => {
    const { input } = fixture();
    const bytes = input.representation.bytes;
    assert.notEqual(sha(bytes), sha(Buffer.from(JSON.stringify(JSON.parse(bytes.toString('utf8'))))));
    assert.notEqual(matchOwnerJourneyResultBinding(input), null);
    assert.equal(input.representation.bytes, bytes);
    for (const mutate of [
        value => { value.representation.contentType = 'text/csv'; }, value => { value.representation.sha256 = 'b'.repeat(64); },
        value => { value.representation.sha256 += '\n'; },
        value => { value.representation.bytes = Buffer.from(value.representation.bytes.toString('utf8').replace('1.0', '2.0')); },
        value => { value.representation.bytes = Buffer.concat([value.representation.bytes, Buffer.from(' ')]); },
        value => { value.representation.bytes = new Uint8Array(value.representation.bytes); },
    ]) { const current = fixture().input; mutate(current); assert.equal(matchOwnerJourneyResultBinding(current), null); }
    const malformedApproval = fixture(); malformedApproval.binding.approval_fingerprint += '\n';
    malformedApproval.input.command.approval_fingerprint = malformedApproval.binding.approval_fingerprint;
    malformedApproval.input.header = encode(malformedApproval.binding);
    assert.equal(matchOwnerJourneyResultBinding(malformedApproval.input), null);
    for (const [mime, body] of [['application/json', '{"n":1e999}'], ['application/json', '{broken'], ['text/csv', Buffer.from([0xc3, 0x28])]]) {
        const { input: current, binding } = fixture();
        const bytes = Buffer.from(body); binding.content_type = mime; binding.content_sha256 = sha(bytes); binding.byte_length = bytes.length;
        current.header = encode(binding); current.representation = { bytes, contentType: mime, sha256: sha(bytes) };
        assert.equal(matchOwnerJourneyResultBinding(current), null);
    }
});
