import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createOwnerJourneyConsumerEvidence } from '../test-support/ownerJourneyConsumerEvidence.js';

const at = Date.parse('2026-11-18T12:00:00Z');
const principal = { tenantId: 1, userId: 2, sessionId: 'private-native-session', authVersion: 1, sessionExpiresAt: Math.floor(at / 1000) + 3600 };
const identity = { actorId: 'private-core-owner', organizationId: 'private-org', nativeAccountId: 'wa_savana:tenant:1', coreAccountId: 'private-bound-account', generation: 'private-generation', expiresAt: new Date(at + 3600_000).toISOString() };
const scope = { organization_id: identity.organizationId, activity_id: 'private-activity', branch_id: null, warehouse_id: null };
const provider = { provider_ref: 'private-catalog-provider', platform: 'catalog', activity_id: scope.activity_id, label: 'اسم مصدر خاص',
    installations: [{ installation_id: 'private-source-installation', activity_id: scope.activity_id }],
    policy_choices: { unit_codes: [{ value: 'each', label: 'قطعة' }], currencies: [{ value: 'LYD', label: 'دينار' }],
        price_lists: [{ value: 'private-price-list', label: 'تجزئة' }], channels: [{ value: 'private-channel', label: 'المتجر' }] } };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const representation = (value = { records: [{ name: 'private customer value' }] }, mime = 'application/json') => {
    const bytes = Buffer.from(mime === 'application/json' ? JSON.stringify(value) : value);
    return { bytes, sha256: hash(bytes), contentType: mime };
};
const command = (capability = 'customers.manage', action = 'customer.read') => ({ command_id: 'private-command-id', organization_id: identity.organizationId,
    activity_id: scope.activity_id, provider_ref: provider.provider_ref, capability, action, payload: { payload_type: 'native_action', parameters: { fields: ['name'] } },
    version: 2, state: 'source_applied', requested_by: identity.actorId, projection_state: 'not_required', available_actions: [], updated_at: new Date(at).toISOString(),
    source_result: { local_entity_id: 'private-source-record', source_revision: 3, result_reference: 'private-source-receipt' } });
const resultInput = (raw = command(), rendered = representation()) => ({ principal,
    before: { command: structuredClone(raw), identity: structuredClone(identity), provider: structuredClone(provider), scope: structuredClone(scope) },
    after: { command: structuredClone(raw), identity: structuredClone(identity), provider: structuredClone(provider), scope: structuredClone(scope) }, representation: rendered });
const rowsInput = () => {
    const record = { entity_id: 'private-product-id', version: 1, scope, source: { installation_id: 'private-source-installation' }, freshness: 'current',
        data: { base_unit: 'each', price: { amount: '12.300', currency: 'LYD', unit_code: 'each', price_list_id: 'private-price-list', channel: 'private-channel' },
            media: [{ asset_id: 'private-asset-id', access_reference: 'private-access-attestation', rights_reference: 'private-rights-attestation' }] },
        fields: ['base_unit', 'price', 'media'].map(key => ({ key, authoritative: true, freshness: 'current' })) };
    const document = { key: 'private-opaque-record-key', label: 'private product name', sourceLabel: provider.label, freshnessLabel: 'بيانات حديثة',
        fields: [{ key: 'base_unit', displayValue: 'قطعة' }, { key: 'price', displayValue: '12.300 دينار / قطعة / تجزئة / المتجر' },
            { key: 'media', displayValue: 'ملفات مرفقة مشتركة: 1 — عرض المحتوى غير متاح من هنا' }].map(row => ({ ...row, sourceLabel: provider.label, authoritative: true })) };
    return { principal, identity, provider, scope, record, document };
};
const fixture = t => {
    const db = new Database(':memory:'); t.after(() => db.close());
    return { db, service: createOwnerJourneyConsumerEvidence({ database: db, runId: 'owned-run', now: () => at }) };
};

test('observer starts without invented zero facts; actual presented source semantics arm only measured counters', t => {
    const { service } = fixture(t);
    assert.deepEqual(service.snapshot().facts, {});
    assert.deepEqual(service.snapshot().resultFetchRows, []);
    assert.equal(service.recordRows(rowsInput()).recorded, true);
    assert.deepEqual(service.snapshot().facts, { authorized_media_reads: 1, price_list_consumer_reads: 1, price_list_semantic_losses: 0,
        unauthorized_media_exposures: 0, unit_variant_consumer_reads: 1, unit_variant_semantic_losses: 0 });
    assert.equal(Object.hasOwn(service.snapshot().facts, 'unauthorized_customer_fields'), false);
    assert.equal(Object.hasOwn(service.snapshot().facts, 'blind_unknown_outcome_retries'), false);
});

test('actual unit/full price mismatch records loss, while unknown policy and unauthorized scope remain unmeasured', t => {
    const { service } = fixture(t), input = rowsInput();
    input.document.fields[0].displayValue = 'kilogram'; input.document.fields[1].displayValue = '12.3 دينار';
    input.document.fields = input.document.fields.filter(row => row.key !== 'media');
    service.recordRows(input);
    assert.deepEqual(service.snapshot().facts, { price_list_semantic_losses: 1, unit_variant_semantic_losses: 1 });
    const unknown = rowsInput(); unknown.provider = { ...provider, policy_choices: {} }; unknown.document.fields = [];
    assert.equal(service.recordRows(unknown).recorded, true);
    assert.deepEqual(service.snapshot().facts, { price_list_semantic_losses: 1, unit_variant_semantic_losses: 1 });
    const foreign = rowsInput(); foreign.scope = { ...scope, organization_id: 'different-org' };
    assert.equal(service.recordRows(foreign).recorded, false);
});

test('only exact authorized media metadata count proves exposure zero; rendered source references are recorded as exposure', t => {
    const { service } = fixture(t), input = rowsInput();
    input.record.data = { media: input.record.data.media }; input.record.fields = [input.record.fields[2]];
    input.document.fields = [{ ...input.document.fields[2], displayValue: 'https://unapproved.invalid/private-access-attestation' }];
    service.recordRows(input);
    assert.deepEqual(service.snapshot().facts, { unauthorized_media_exposures: 1 });
    input.document.fields[0].displayValue = 'صورة واحدة'; service.recordRows(input);
    assert.deepEqual(service.snapshot().facts, { unauthorized_media_exposures: 1 });
    assert.equal(service.snapshot().facts.authorized_media_reads, undefined);
});

test('full current command/identity/provider correlation and exact MIME+SHA bytes qualify typed reads and per-code/action fetch rows', t => {
    const { service } = fixture(t);
    for (const [capability, action] of [['customers.manage', 'customer.read'], ['units.variants', 'unit.define'], ['prices.manage', 'price.set'], ['media.manage', 'media.replace']]) {
        assert.equal(service.recordResult(resultInput(command(capability, action))).recorded, true);
    }
    assert.equal(service.recordResult(resultInput(command(), representation('name\r\nprivate customer value\r\n', 'text/csv'))).recorded, true);
    const snapshot = service.snapshot();
    assert.deepEqual(snapshot.facts, { authorized_customer_reads: 2, authorized_media_reads: 1, price_list_consumer_reads: 1, same_identity_result_fetches: 5, unit_variant_consumer_reads: 1 });
    assert.deepEqual(snapshot.resultFetchRows.find(row => row.operation === 'customer.read'), { source_platform: 'catalog', capability_code: 'customers.manage', operation: 'customer.read', result_fetches: 2, json_fetches: 1, csv_fetches: 1 });
    assert.equal(Object.hasOwn(snapshot.facts, 'unit_variant_semantic_losses'), false);
    assert.equal(Object.hasOwn(snapshot.facts, 'price_list_semantic_losses'), false);
    assert.equal(Object.hasOwn(snapshot.facts, 'unauthorized_customer_fields'), false);
});

test('HTTP-shaped success alone, changed context/command, bad hash, empty result and invalid MIME never manufacture proof', t => {
    const { service } = fixture(t);
    for (const mutate of [
        value => { value.after.command.version += 1; }, value => { value.after.command.payload.parameters.fields = ['phone']; },
        value => { value.after.identity.generation = 'new-generation'; }, value => { value.after.provider.provider_ref = 'foreign'; },
        value => { value.after.scope.activity_id = 'different-activity'; }, value => { value.before.command.state = value.after.command.state = 'approved'; },
        value => { value.representation.sha256 = 'a'.repeat(64); }, value => { value.representation = representation({}); },
        value => { value.representation = representation([]); }, value => { value.representation = representation('  ', 'text/csv'); },
        value => { value.representation.contentType = 'text/html'; }, value => { value.representation = { status: 200 }; },
    ]) { const input = resultInput(); mutate(input); assert.equal(service.recordResult(input).recorded, false); }
    assert.deepEqual(service.snapshot().facts, {}); assert.deepEqual(service.snapshot().resultFetchRows, []);
    const zero = command(); zero.source_result.source_revision = 0;
    assert.equal(service.recordResult(resultInput(zero)).recorded, false);
    const native = resultInput(command('messaging.send', 'messaging.send'));
    native.before.provider.platform = native.after.provider.platform = 'wa_savana';
    native.before.command.source_result.source_revision = native.after.command.source_result.source_revision = null;
    assert.equal(service.recordResult(native).recorded, true);
    assert.deepEqual(service.snapshot().facts, { same_identity_result_fetches: 1 });
});

test('published Catalog inventory and order results count authorized result reads without inventing stock effects or deficit semantics', t => {
    const { service } = fixture(t);
    const resource = '11111111-1111-4111-8111-111111111111';
    const line = { product_ref: resource, quantity: 1, unit_code: 'each', currency: 'LYD', unit_price: '12.345' };
    const fact = { source_event_id: 'source-event-private', occurred_at: new Date(at).toISOString(), movement_type: 'sale', reason: 'private evidence', lines: [line] };
    const operations = [
        ['inventory.read', 'inventory.read', { limit: 20, cursor: 0 }],
        ['inventory.facts', 'inventory.fact', fact],
        ['inventory.transfer', 'inventory.transfer', { ...fact, movement_type: 'transfer', destination_warehouse_ref: resource }],
        ['inventory.count', 'inventory.count_delta', { ...fact, movement_type: 'adjustment', direction: 'in' }],
        ['orders.request', 'order.request', { quantity: '1', note: 'private order' }],
        ['orders.request', 'order.cancel', { reason: 'private order reason' }],
        ['orders.fulfil', 'order.transition', { transition: 'fulfill' }],
        ['orders.fulfil', 'order.read', { fields: ['state'] }],
    ];
    for (const [index, [capability, action, parameters]] of operations.entries()) {
        const raw = command(capability, action);
        raw.command_id = `private-${action}`;
        raw.payload = { payload_type: 'native_action', resource_ref: resource, parameters };
        // NativeResult.data has no published inventory/order body contract. These
        // bytes prove a scoped result read, not the names/values inside them.
        const bytes = index % 2 ? representation('permitted_field\r\nprivate source value\r\n', 'text/csv')
            : representation({ permitted_field: 'private source value', deficit: 999, reconciled: true });
        assert.equal(service.recordResult(resultInput(raw, bytes)).recorded, true);
    }
    const snapshot = service.snapshot();
    assert.deepEqual(snapshot.facts, { catalog_ledger_reads: 1, native_order_result_reads: 4, same_identity_result_fetches: 8 });
    assert.equal(snapshot.resultFetchRows.length, 8);
    for (const [capability, action] of operations) {
        const row = snapshot.resultFetchRows.find(value => value.capability_code === capability && value.operation === action);
        assert.equal(row.source_platform, 'catalog'); assert.equal(row.result_fetches, 1);
        assert.equal(row.json_fetches + row.csv_fetches, 1);
    }
    for (const name of ['observed_catalog_deficits', 'requested_catalog_reconciliations', 'wa_owned_inventory_ledgers',
        'native_sale_effects', 'native_order_fulfilments', 'native_order_cancellations', 'duplicate_order_effects']) {
        assert.equal(Object.hasOwn(snapshot.facts, name), false);
    }
    assert.match(snapshot.observer.deficit_and_reconciliation, /Unmeasured/);
});

test('new inventory/order facts require the exact Catalog action and unchanged current positive source receipt', t => {
    const { service } = fixture(t);
    for (const [capability, action] of [['inventory.read', 'inventory.read'], ['orders.fulfil', 'order.read']]) {
        for (const mutate of [
            value => { value.before.command.source_result.source_revision = value.after.command.source_result.source_revision = null; },
            value => { value.before.command.source_result.result_reference = value.after.command.source_result.result_reference = ''; },
            value => { value.after.command.source_result.source_revision += 1; },
            value => { value.after.identity.coreAccountId = 'other-current-core-account'; },
            value => { value.representation.sha256 = '0'.repeat(64); },
        ]) {
            const input = resultInput(command(capability, action)); mutate(input);
            assert.equal(service.recordResult(input).recorded, false);
        }
    }
    assert.deepEqual(service.snapshot().facts, {});
    for (const [capability, action] of [['inventory.facts', 'inventory.read'], ['orders.request', 'order.read'], ['services.reserve', 'reservation.request']]) {
        assert.equal(service.recordResult(resultInput(command(capability, action))).recorded, true);
    }
    const own = resultInput(command('orders.fulfil', 'order.read'));
    own.before.provider.platform = own.after.provider.platform = 'wa_savana';
    assert.equal(service.recordResult(own).recorded, true);
    assert.deepEqual(service.snapshot().facts, { same_identity_result_fetches: 4 });
});

test('customer denial requires actual Core403 after prior same-owner/run/command/version qualified customer.read, never WA-native substitution', t => {
    const { service, db } = fixture(t), raw = command();
    const denied = { principal, command: raw, identity, provider, scope, status: 403, pathTemplate: '/v1/integration/workspace/commands/:command/result' };
    assert.equal(service.recordResultDenied(denied).recorded, false);
    service.recordResult(resultInput(raw));
    for (const change of [{ status: 401 }, { command: { ...raw, command_id: 'different-command' } }, { command: { ...raw, version: 3 } },
        { identity: { ...identity, actorId: 'another-owner' } }, { pathTemplate: '/api/portal/contacts/:id' }]) assert.equal(service.recordResultDenied({ ...denied, ...change }).recorded, false);
    assert.equal(service.recordResultDenied(denied).recorded, true);
    assert.equal(service.snapshot().facts.withdrawn_purpose_denials, 1);
    const anotherRun = createOwnerJourneyConsumerEvidence({ database: db, runId: 'other-run', now: () => at });
    assert.equal(anotherRun.recordResultDenied(denied).recorded, false);
    const own = resultInput(); own.before.provider.platform = own.after.provider.platform = 'wa_savana';
    assert.equal(anotherRun.recordResult(own).recorded, true);
    assert.equal(anotherRun.snapshot().facts.authorized_customer_reads, undefined);
});

test('persisted ledger survives observer recreation and contains no source values, identity refs, payloads, URLs or result bytes', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-consumer-owned-')); const filename = path.join(dir, 'evidence.sqlite');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let db = new Database(filename);
    let service = createOwnerJourneyConsumerEvidence({ database: db, runId: 'owned-restart-run', now: () => at });
    service.recordRows(rowsInput()); service.recordResult(resultInput()); db.close();
    db = new Database(filename); t.after(() => db.close());
    service = createOwnerJourneyConsumerEvidence({ database: db, runId: 'owned-restart-run', now: () => at + 1000 });
    assert.equal(service.snapshot().facts.authorized_customer_reads, 1);
    assert.equal(service.snapshot().facts.unit_variant_semantic_losses, 0);
    const stored = JSON.stringify(db.prepare('SELECT * FROM owner_journey_consumer_events').all());
    for (const secret of ['private customer value', 'private product name', 'private-core-owner', 'private-native-session', 'private-command-id',
        'private-access-attestation', 'private-rights-attestation', 'private-price-list', provider.label]) assert.equal(stored.includes(secret), false);
    assert.equal(JSON.stringify(service.snapshot()).includes('private customer value'), false);
});
