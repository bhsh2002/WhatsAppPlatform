import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedResourcePreviewController, sharedResourceBrowserBinding, sharedResourceEnvelopeIsValid, sharedResourceFieldRows,
    sharedResourceListIsValid, sharedResourceOptionsIsValid, sharedResourcePriceOptionIsValid, sharedResourcePreviewResultIsValid,
    sharedResourceRecordIsValid, sharedResourceResponseIsCurrent, sharedResourceValueText } from './sharedResourceReadPresentation.js';

const at = value => new Date(value).toISOString();
const price = overrides => ({ code: 'monthly', process: 'rental', pricing_model: 'fixed', amount: '12.500', currency: 'USD', unit: 'month', ...overrides });
const envelope = overrides => ({ viewKey: 'current-wa-view', valid_until: at(10_000), record: { key: 'wa-resource-ref', resource_kind: 'product',
    sourceLabel: 'Actual catalog account', observed_at: at(500), data: { name: 'Source product', base_unit: { code: 'each', metadata_version: 2 }, price_options: [price()] } },
    mediaCount: 1, previews: [{ key: 'wa-preview-ref', valid_until: at(5_000), content_types: ['image/png'] }], ...overrides });
const clock = () => {
    let time = 1_000, next = 0;
    const jobs = new Map();
    return { now: () => time, schedule: (fn, delay) => { const id = ++next; jobs.set(id, { at: time + delay, fn }); return id; }, cancel: id => jobs.delete(id),
        advance: elapsed => { const target = time + elapsed; while (true) {
            const nextJob = [...jobs.entries()].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!nextJob) break;
            time = nextJob[1].at; jobs.delete(nextJob[0]); nextJob[1].fn();
        } time = target; } };
};
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const preview = (until = 4_500) => ({ blob: png(), valid_until: at(until) });
const controller = (options = {}) => {
    const time = clock(), states = [], created = [], revoked = [];
    const owned = createSharedResourcePreviewController({ ...time, onChange: state => states.push(state),
        createObjectURL: blob => { const url = `blob:owned-${created.length}`; created.push({ url, blob }); return url; },
        revokeObjectURL: url => revoked.push(url), ...options });
    return { ...time, owned, states, created, revoked };
};

test('shared resource views preserve partial offering fields and reject physical or private relation data', () => {
    const offering = { viewKey: 'current-view', valid_until: at(10_000), record: { key: 'wa-offering', resource_kind: 'offering', sourceLabel: 'Actual source', observed_at: at(500),
        data: { kind: 'service', status: 'active', category_key: null, attributes: { capacity: 12, nested: { text: '<b>source text</b>' } } } } };
    assert.equal(sharedResourceEnvelopeIsValid(offering, 1_000), true);
    assert.deepEqual(sharedResourceFieldRows(offering.record, false).map(row => row.key), ['kind', 'status', 'category_key']);
    assert.equal(sharedResourceValueText(null, false), 'Not specified by source');
    for (const extra of [{ sku: 'not-a-service-field' }, { stock: 12 }, { media: [] }, { kind: 'physical_good' }, { attributes: { unsafe: Infinity } }]) {
        assert.equal(sharedResourceRecordIsValid({ ...offering.record, data: { ...offering.record.data, ...extra } }), false);
    }
    assert.equal(sharedResourceEnvelopeIsValid({ ...offering, previews: [{ key: 'asset', valid_until: at(5_000), content_types: ['image/png'] }] }, 1_000), false);
    const physical = envelope();
    assert.equal(sharedResourceEnvelopeIsValid(physical, 1_000), true);
    for (const extra of [{ media: [{ access_reference: 'https://source.invalid/private' }] }, { variant_ref: 'guessed' },
        { conversions: [] }, { base_unit: { code: 'each', metadata_version: 0 } }, { base_unit: { code: 'each', metadata_version: Number.MAX_SAFE_INTEGER + 1 } }]) {
        assert.equal(sharedResourceRecordIsValid({ ...physical.record, data: { ...physical.record.data, ...extra } }), false);
    }
    assert.equal(sharedResourceEnvelopeIsValid({ ...physical, valid_until: at(1_000) }, 1_000), false);
});

test('actual price models retain nullable amounts and never invent currency, list, channel or conversion values', () => {
    for (const option of [price(), price({ pricing_model: 'starting_from' }), price({ pricing_model: 'free', amount: null, currency: null, unit: null }),
        price({ pricing_model: 'free', amount: '0.000' }), price({ pricing_model: 'quote', amount: null }), price({ pricing_model: 'negotiated', amount: null })]) {
        const before = structuredClone(option);
        assert.equal(sharedResourcePriceOptionIsValid(option), true);
        assert.deepEqual(option, before);
    }
    for (const change of [{ amount: null }, { amount: '01.20' }, { amount: '1e2' }, { currency: ['USD'] },
        { pricing_model: 'free', amount: '1' }, { pricing_model: 'quote', amount: '0' }, { process: 'stock' },
        { price_list_id: 'fake-list' }, { channel: 'invented' }, { option_ref: 'private-source-ref' }]) {
        assert.equal(sharedResourcePriceOptionIsValid(price(change)), false);
    }
});

test('published text limits count Unicode code points for valid astral source names', () => {
    const record = envelope().record;
    assert.equal(sharedResourceRecordIsValid({ ...record, data: { name: '🌿'.repeat(200) } }), true);
    assert.equal(sharedResourceRecordIsValid({ ...record, data: { name: '🌿'.repeat(201) } }), false);
    assert.equal(sharedResourceRecordIsValid({ ...record, resource_kind: 'offering', data: { attributes: { ['🌿'.repeat(120)]: 'actual' } } }), true);
    assert.equal(sharedResourceRecordIsValid({ ...record, resource_kind: 'offering', data: { attributes: { ['🌿'.repeat(121)]: 'actual' } } }), false);
});

test('browser reads are fenced by actual auth session, activity, product selection and source options', () => {
    const context = { verified: true, viewKey: 'current-wa-view', native_reference: 'current-native-context', valid_until: at(10_000) };
    const auth = { loading: false, user: { id: 12, tenant_id: 7, role: 'tenant' }, tenant: { id: 7 }, sessionRevision: 2 };
    const view = { context, activity: 'wa-activity', auth };
    const initial = sharedResourceBrowserBinding(view, 1_000);
    assert.equal(typeof initial, 'string');
    for (const changed of [{ auth: { ...auth, loading: true } }, { auth: { ...auth, user: null } }, { context: { ...context, verified: false } }]) {
        assert.equal(sharedResourceBrowserBinding({ ...view, ...changed }, 1_000), null);
    }
    assert.equal(sharedResourceBrowserBinding(view, 10_000), null);
    for (const changed of [{ activity: 'another-activity' }, { productRecord: 'wa-product' }, { context: { ...context, native_reference: 'another-context' } },
        { auth: { ...auth, sessionRevision: 3 } }, { auth: { ...auth, user: { ...auth.user, id: 13 } } }, { auth: { ...auth, tenant: { id: 8 } } }]) {
        assert.notEqual(sharedResourceBrowserBinding({ ...view, ...changed }, 1_000), initial);
    }
    const options = { providers: [{ value: 'wa-provider', label: 'Actual source', enabled: true }], browseAction: { enabled: true, label: 'Read source' } };
    assert.equal(sharedResourceOptionsIsValid(options), true);
    assert.equal(sharedResourceOptionsIsValid({ ...options, providers: [...options.providers, options.providers[0]] }), false);
    assert.equal(sharedResourceOptionsIsValid({ ...options, providers: [{ ...options.providers[0], href: '/private' }] }), false);
});

test('offering list publication rejects expired, overlong and other-context grants even before expiry callbacks run', () => {
    const context = { viewKey: 'current-wa-view', valid_until: at(10_000) };
    const offering = { ...envelope().record, resource_kind: 'offering', data: { name: 'Actual offering', kind: 'service' } };
    const list = { viewKey: context.viewKey, valid_until: at(3_000), records: [offering], cursor: null };
    assert.equal(sharedResourceListIsValid(list, context, 2_999), true);
    assert.equal(sharedResourceListIsValid(list, context, 3_000), false);
    for (const changed of [{ viewKey: 'other-view' }, { valid_until: at(10_001) }, { records: [offering, offering] }, { records: [envelope().record] }]) {
        assert.equal(sharedResourceListIsValid({ ...list, ...changed }, context, 1_000), false);
    }
    assert.equal(sharedResourceResponseIsCurrent(envelope({ valid_until: at(3_000) }), context, 3_000), false);
});

test('preview props reject Core hrefs, unsupported MIME, oversized bytes and expired access', () => {
    const current = envelope(), descriptor = current.previews[0];
    assert.equal(sharedResourcePreviewResultIsValid(preview(), current, descriptor, 1_000), true);
    assert.equal(sharedResourceEnvelopeIsValid({ ...current, previews: [{ ...descriptor, href: '/v1/private?ticket=secret' }] }, 1_000), false);
    assert.equal(sharedResourceEnvelopeIsValid({ ...current, previews: [{ ...descriptor, content_types: ['image/svg+xml'] }] }, 1_000), false);
    for (const result of [{ blob: new Blob(['html'], { type: 'text/html' }), valid_until: at(4_000) },
        { blob: new Blob([new Uint8Array(524_289)], { type: 'image/png' }), valid_until: at(4_000) }, preview(1_000), { ...preview(), ticket: 'private' }]) {
        assert.equal(sharedResourcePreviewResultIsValid(result, current, descriptor, 1_000), false);
    }
});

test('preview owns a transient Blob URL only until the earliest actual access deadline', async () => {
    const f = controller({ onPreview: async () => preview() });
    f.owned.setEnvelope(envelope());
    assert.equal(await f.owned.load('wa-preview-ref'), true);
    assert.equal(f.states.at(-1).status, 'available'); assert.equal(f.states.at(-1).valid_until, at(4_500));
    f.advance(3_499); assert.equal(f.revoked.length, 0);
    f.advance(1); assert.equal(f.states.at(-1).status, 'expired'); assert.deepEqual(f.revoked, ['blob:owned-0']);
    f.owned.dispose(); assert.equal(f.revoked.length, 1);
});

test('preview expiry aborts pending bytes and a late result cannot create a URL or extend the ticket deadline', async () => {
    const pending = deferred(); let signal;
    const f = controller({ onPreview: (_key, options) => { signal = options.signal; return pending.promise; } });
    const current = envelope({ previews: [{ key: 'wa-preview-ref', valid_until: at(3_000), content_types: ['image/png'] }] });
    f.owned.setEnvelope(current);
    const loading = f.owned.load('wa-preview-ref');
    f.owned.setEnvelope(structuredClone(current));
    f.advance(2_000); assert.equal(signal.aborted, true);
    pending.resolve(preview(8_000)); assert.equal(await loading, false);
    assert.equal(f.created.length, 0); assert.equal(f.states.at(-1).status, 'expired');
    f.owned.dispose();
});

test('context replacement, close and disposal discard previews and never revive old bytes', async () => {
    const pending = deferred(); let signal, first = true;
    const f = controller({ onPreview: (_key, options) => { if (first) { first = false; signal = options.signal; return pending.promise; } return Promise.resolve(preview()); } });
    f.owned.setEnvelope(envelope());
    const loading = f.owned.load('wa-preview-ref');
    f.owned.setEnvelope(envelope({ viewKey: 'different-current-principal' }));
    assert.equal(signal.aborted, true);
    pending.resolve(preview()); assert.equal(await loading, false); assert.equal(f.created.length, 0);
    assert.equal(await f.owned.load('wa-preview-ref'), true);
    f.owned.close(); assert.deepEqual(f.revoked, ['blob:owned-0']); assert.equal(f.states.at(-1).url, null);
    assert.equal(await f.owned.load('wa-preview-ref'), true);
    f.owned.setEnvelope(null); assert.deepEqual(f.revoked, ['blob:owned-0', 'blob:owned-1']);
    f.owned.dispose();
});

test('a denied or malformed replacement clears the previous image without a cached fallback', async () => {
    let deny = false, invalidations = 0;
    const f = controller({ onPreview: async () => { if (deny) throw Object.assign(new Error('withdrawn'), { status: 403 }); return preview(); }, onInvalidated: () => { invalidations += 1; } });
    f.owned.setEnvelope(envelope()); assert.equal(await f.owned.load('wa-preview-ref'), true);
    deny = true; assert.equal(await f.owned.load('wa-preview-ref'), false);
    assert.deepEqual(f.revoked, ['blob:owned-0']); assert.equal(f.states.at(-1).status, 'unavailable'); assert.equal(f.states.at(-1).url, null);
    assert.equal(invalidations, 1); f.owned.dispose();
});
