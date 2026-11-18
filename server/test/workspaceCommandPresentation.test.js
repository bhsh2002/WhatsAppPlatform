import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createWorkspaceCommandPresenter } from '../services/workspaceCommandPresentation.js';
import { WorkspaceReferences } from '../services/workspaceReferences.js';

const START = Date.parse('2026-11-18T12:00:00Z');
const fields = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'];
const cipher = () => {
    const key = crypto.randomBytes(32);
    return { encrypt(raw) { const iv = crypto.randomBytes(12), aes = crypto.createCipheriv('aes-256-gcm', key, iv);
        const body = Buffer.concat([aes.update(raw), aes.final()]); return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64'); },
    decrypt(raw) { const bytes = Buffer.from(raw, 'base64'), aes = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        aes.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([aes.update(bytes.subarray(28)), aes.final()]).toString(); } };
};
const command = extra => ({ command_id: 'private-command', organization_id: 'private-organization', activity_id: 'private-activity',
    provider_ref: 'private-provider', capability: 'products', action: 'product.change', payload: { entity_id: 'private-product',
        expected_record_version: 3, fields: { name: 'زيت زيتون', description: '', barcodes: ['123456789'] }, clear_fields: ['sku'] },
    version: 7, state: 'pending_review', requested_by: 'private-actor', projection_state: 'not_applied',
    available_actions: ['edit', 'approve', 'reject'], updated_at: '2026-11-18T11:59:59Z', ...extra });
const native = extra => command({ capability: 'messaging', action: 'messaging.send', payload: { payload_type: 'native_action',
    resource_ref: 'private-conversation', parameters: { account_ref: 'private-account', recipient_ref: 'private-recipient',
        message: 'مرحبًا', resource_fingerprint: 'a'.repeat(64) } }, ...extra });
const descriptor = (key, extra = {}) => ({ key, label: key === 'approve' ? 'اعتماد الطلب' : 'إجراء على الطلب',
    enabled: true, effect: key === 'reconcile' ? 'read' : 'write', handler: () => { throw new Error('Presentation must not execute'); }, ...extra });
const fixture = (options = {}) => {
    let clock = START, permission = true; const calls = { verify: 0, intents: [], issues: [] };
    const principal = { tenantId: 1, userId: 2, sessionId: 'synthetic-session', authVersion: 0, role: 'tenant',
        issuedAt: START / 1000 - 10, sessionExpiresAt: START / 1000 + 600 };
    const identity = { actorId: 'private-actor', organizationId: 'private-organization', nativeAccountId: 'private-native-account',
        generation: 'synthetic-generation', expiresAt: new Date(START + 300_000).toISOString() };
    const scope = { organization_id: identity.organizationId, activity_id: 'private-activity', branch_id: null, warehouse_id: null };
    const context = { viewKey: 'current-view', validUntil: new Date(START + 30_000).toISOString(),
        memberVerified: true, canRead: true, allowedProductFields: [...fields] };
    const refs = new WorkspaceReferences({ encryption: cipher(), verifyLocalPrincipal: () => permission,
        currentIdentity: async () => identity, now: () => clock });
    const presenter = createWorkspaceCommandPresenter({ refs: { issue(...args) { calls.issues.push(args[2]); return refs.issue(...args); } },
        verifyCurrent: async args => { calls.verify++; return permission && (options.verifyCurrent ? await options.verifyCurrent(args) : true); },
        issueIntentRef: async args => { calls.intents.push(args); return refs.issue(principal, identity, { type: 'intent', key: 'server-preissued-approve' }); },
        now: () => clock, ...options });
    return { refs, calls, principal, identity, scope, context, revoke: () => { permission = false; }, setClock: value => { clock = value; },
        present: (extra = {}) => presenter({ principal, identity, scope, context, raw: command(), sourceLabel: 'كتالوج النشاط',
            actionDescriptors: [descriptor('approve')], language: 'en', ...extra }) };
};
const approve = row => row.command.actions.find(action => action.key === 'approve');

test('actual product changes and clear operations have human review, encrypted version-bound selectors and preissued approval intent', async () => {
    const f = fixture(); const result = await f.present();
    assert.deepEqual(result.command.summary, [{ label: 'Product name', value: 'زيت زيتون' }, { label: 'Description', value: 'Empty text' },
        { label: 'Barcodes', value: '123456789' }, { label: 'Product code', value: 'Clear the value at source' }]);
    assert.equal(approve(result).enabled, true);
    assert.deepEqual((await f.refs.resolve(f.principal, result.command.key, 'command')).version, 7);
    assert.equal((await f.refs.resolve(f.principal, approve(result).intentKey, 'intent')).key, 'server-preissued-approve');
    assert.equal(f.calls.intents[0].command.version, 7); assert.equal(f.calls.intents[0].action, 'approve');
    assert.equal(f.calls.intents[0].commandKey, result.command.key);
    const shown = JSON.stringify(result); for (const hidden of ['private-command', 'private-organization', 'private-provider', 'private-product', 'private-actor']) {
        assert.equal(shown.includes(hidden), false);
    }
    assert.equal(Object.hasOwn(result.command, 'version'), false);
    const changed = await f.present({ raw: command({ version: 8 }) });
    assert.equal((await f.refs.resolve(f.principal, changed.command.key, 'command')).version, 8);
    assert.equal(result.valid_until, f.context.validUntil);
});

test('strict actual Core model, positive safe version and human source label are required', async () => {
    for (const raw of [command({ invented: true }), command({ version: 0 }), command({ version: Number.MAX_SAFE_INTEGER + 1 }),
        command({ payload: { fields: { price: { amount: '1e3', currency: 'LYD', unit_code: 'piece', price_list_id: 'retail', channel: 'web' } } } })]) {
        await assert.rejects(fixture().present({ raw }), { code: 'workspace_command_response_invalid', status: 502 });
    }
    await assert.rejects(fixture().present({ sourceLabel: 'private-provider' }), { code: 'workspace_command_labels_unavailable' });
});

test('organization/activity/current membership and field-read proof fence the whole row before selectors or intents', async t => {
    const cases = [f => { f.identity.organizationId = 'other'; }, f => { f.scope.activity_id = 'other'; },
        f => { f.context.memberVerified = false; }, f => { f.context.canRead = false; },
        f => { f.context.allowedProductFields = ['name']; }, f => { f.context.allowedProductFields = fields.filter(field => field !== 'sku'); },
        f => { f.scope.warehouse_id = 'warehouse-without-branch'; }, f => { f.context.validUntil = new Date(START).toISOString(); }];
    for (const [index, change] of cases.entries()) await t.test(String(index), async () => {
        const f = fixture(); change(f);
        await assert.rejects(f.present(), { code: 'workspace_command_read_forbidden' });
        assert.equal(f.calls.issues.length, 0); assert.equal(f.calls.intents.length, 0);
    });
    await assert.rejects(fixture({ verifyCurrent: async () => false }).present(), { code: 'workspace_command_read_forbidden' });
    await assert.rejects(fixture().present({ context: undefined }), { code: 'workspace_command_read_forbidden' });
});

test('state and role cannot supply missing Core action, registered callable, explicit permission or summary', async () => {
    for (const [raw, action] of [[command({ available_actions: [] }), descriptor('approve')],
        [command(), descriptor('approve', { enabled: false })], [command(), descriptor('approve', { handler: undefined })],
        [command({ state: 'approved' }), descriptor('approve')], [command({ state: 'outcome_unknown' }), descriptor('approve')]]) {
        const f = fixture(); f.principal.role = 'owner';
        const result = await f.present({ raw, actionDescriptors: [action] });
        assert.equal(approve(result).enabled, false); assert.equal(f.calls.intents.length, 0);
        assert.equal(Object.hasOwn(approve(result), 'intentKey'), false);
    }
    assert.equal(approve(await fixture({ issueIntentRef: null }).present()).enabled, false);
    // Explicit Core rights permit self-approval; browser role and actor inequality are not grants.
    assert.equal(approve(await fixture().present()).enabled, true);
});

test('requester-only edit/cancel and lifecycle constraints intersect exact Core actions without executing handlers', async () => {
    const actions = ['edit', 'approve', 'reject', 'dispatch', 'cancel', 'reconcile'].map(key => descriptor(key));
    const f = fixture();
    const row = await f.present({ raw: command({ requested_by: 'different-requester', available_actions: actions.map(action => action.key) }), actionDescriptors: actions });
    assert.deepEqual(row.command.actions.filter(action => action.enabled).map(action => action.key), ['approve', 'reject']);
    for (const state of ['source_pending', 'cancel_requested', 'source_partially_applied']) {
        const result = await f.present({ raw: native({ state, available_actions: ['reconcile', 'cancel'] }), actionDescriptors: [descriptor('reconcile'), descriptor('cancel')] });
        assert.equal(result.command.actions[0].enabled, true);
        assert.equal(result.command.actions[1].enabled, state === 'source_pending');
    }
});

test('native opaque parameters never become a review; technical/JSON summaries cannot enable approval', async () => {
    for (const summary of [undefined, [], [{ label: 'Account', value: 'private-account' }],
        [{ label: 'Message', value: '{"account_ref":"other"}' }], [{ label: 'Recipient', value: 'Recipient: private-recipient' }],
        [{ label: 'Resource', value: 'a'.repeat(64) }]]) {
        const f = fixture(); const raw = native(summary === undefined ? {} : { summary }); const result = await f.present({ raw });
        assert.equal(approve(result).enabled, false); assert.deepEqual(result.command.summary, []); assert.equal(f.calls.intents.length, 0);
        assert.equal(JSON.stringify(result).includes('private-account'), false);
    }
});

test('strict Core human native summary or source-verified summary callback can enable review without exposing parameters', async () => {
    const summary = [{ label: 'المستلم', value: 'عميل المتجر' }, { label: 'الغرض', value: 'الرد على استفسار العميل' }, { label: 'الرسالة', value: 'مرحبًا' }];
    for (const f of [fixture(), fixture({ summarizeNative: async () => summary })]) {
        const result = await f.present({ raw: native(f.calls.verify === 0 && !f.calls.intents.length ? { summary } : {}) });
        assert.equal(approve(result).enabled, true); assert.deepEqual(result.command.summary, summary);
        assert.equal(JSON.stringify(result).includes('parameters'), false);
    }
    const callback = fixture({ summarizeNative: async () => summary });
    assert.deepEqual((await callback.present({ raw: native() })).command.summary, summary);
});

test('unit/price/media references need verified policy names and exact decimal human values, never raw reference fallback', async () => {
    const raw = command({ payload: { fields: { name: 'زيت', base_unit: 'private-unit', price: { amount: '10.125', currency: 'LYD',
        unit_code: 'private-unit', price_list_id: 'private-price-list', channel: 'private-sales-channel' },
        media: [{ asset_id: 'private-asset', access_reference: 'private-access', rights_reference: 'private-rights' }] } } });
    const missing = await fixture().present({ raw }); assert.equal(approve(missing).enabled, false);
    assert.deepEqual(missing.command.summary, [{ label: 'Product name', value: 'زيت' }]);
    for (const value of ['private-unit', 'Selected private-price-list', 'Image private-asset', 'Access private-access']) {
        assert.equal(approve(await fixture({ formatProductField: async () => value }).present({ raw })).enabled, false);
    }
    const formatted = await fixture({ formatProductField: async ({ field, value }) => ({ base_unit: 'زجاجة',
        price: `${value.amount} دينار ليبي · سعر التجزئة · زجاجة`, media: 'صورة زيت الزيتون · حق الاستخدام متحقق' }[field]) }).present({ raw });
    assert.equal(approve(formatted).enabled, true);
    assert.equal(formatted.command.summary.find(row => row.label === 'Price').value, '10.125 دينار ليبي · سعر التجزئة · زجاجة');
    for (const hidden of ['private-unit', 'private-price-list', 'private-asset', 'private-access', 'private-rights']) assert.equal(JSON.stringify(formatted).includes(hidden), false);
});

test('receipt confirmation requires source_applied, strict actual receipt, action-specific revision and injected source correlation', async t => {
    const source_result = { local_entity_id: 'private-durable-effect', result_reference: 'private-receipt', source_revision: null };
    for (const action of ['messaging.send', 'campaigns.execute', 'content.publish', 'measurement.summary', 'measurement.export', 'owner.operation_status']) await t.test(action, async () => {
        let checks = 0; const f = fixture({ verifySourceReceipt: async args => { checks++; assert.equal(args.sourceResult, source_result); return true; } });
        const result = await f.present({ raw: native({ action, state: 'source_applied', source_result, projection_state: 'not_required' }) });
        assert.deepEqual(result.command.source_result, { confirmed: true, source_revision: null }); assert.equal(checks, 1);
        assert.equal(result.command.projection_state, 'not_required'); assert.equal(JSON.stringify(result).includes('private-receipt'), false);
    });
    for (const [raw, verifySourceReceipt] of [[native({ state: 'source_applied', source_result }), null],
        [native({ state: 'source_applied', source_result }), async () => false], [native({ state: 'source_pending', source_result }), async () => true],
        [native({ state: 'source_applied' }), async () => true], [command({ state: 'source_applied', source_result }), async () => true],
        [native({ action: 'contacts.read', state: 'source_applied', source_result }), async () => true],
        [native({ action: 'messaging.review', state: 'source_applied', source_result }), async () => true],
        [command({ state: 'source_applied', source_result: { ...source_result, source_revision: 0 } }), async () => true]]) {
        assert.equal((await fixture({ verifySourceReceipt }).present({ raw })).command.source_result.confirmed, false);
    }
    const product = await fixture({ verifySourceReceipt: async () => true }).present({ raw: command({ state: 'source_applied',
        source_result: { ...source_result, source_revision: 4 }, projection_state: 'pending' }) });
    assert.deepEqual(product.command.source_result, { confirmed: true, source_revision: 4 }); assert.equal(product.command.projection_state, 'pending');
});

test('actual queued/partial progress is aggregate only and never treated as terminal receipt confirmation', async () => {
    const result = await fixture().present({ raw: native({ state: 'source_pending', native_pending: { job_ref: 'private-job',
        accepted_at: '2026-11-18T11:59:59Z', scheduled_for: '2026-11-19T12:00:00Z' }, native_progress: { total: 3, completed: 1, failed: 0, pending: 1, unknown: 1 } }) });
    assert.deepEqual(result.command.progress, { total: 3, completed: 1, failed: 0, pending: 1, unknown: 1 });
    assert.deepEqual(result.command.pending, { accepted_at: '2026-11-18T11:59:59Z', scheduled_for: '2026-11-19T12:00:00Z' });
    assert.equal(result.command.source_result.confirmed, false); assert.equal(JSON.stringify(result).includes('private-job'), false);
});

test('permission/field/context/identity mutation or expiry during asynchronous review discards complete output', async t => {
    for (const mutation of ['permission', 'field', 'context', 'identity', 'expiry', 'command']) await t.test(mutation, async () => {
        let f; const raw = native();
        f = fixture({ summarizeNative: async () => {
            if (mutation === 'permission') f.revoke();
            if (mutation === 'field') f.context.allowedProductFields.pop();
            if (mutation === 'context') f.context.viewKey = 'other';
            if (mutation === 'identity') f.identity.generation = 'renewed';
            if (mutation === 'expiry') f.setClock(START + 30_000);
            if (mutation === 'command') raw.version++;
            return [{ label: 'Message', value: 'Hello' }];
        } });
        await assert.rejects(f.present({ raw }), error => ['workspace_command_context_changed', 'workspace_command_read_forbidden'].includes(error.code));
        assert.equal(f.calls.issues.length, 0); assert.equal(f.calls.intents.length, 0);
    });
    let f; f = fixture({ issueIntentRef: async () => { f.context.canRead = false; return 'opaque-intent'; } });
    await assert.rejects(f.present(), { code: 'workspace_command_context_changed' });
    let g; g = fixture({ verifySourceReceipt: async () => { g.revoke(); return true; } });
    await assert.rejects(g.present({ raw: native({ state: 'source_applied', source_result: { local_entity_id: 'private-effect', result_reference: 'private-result' } }) }),
        { code: 'workspace_command_read_forbidden' });
});

test('formatted field authorization failures are discarded, safe formatter unavailability only disables approval', async () => {
    const raw = command({ payload: { fields: { price: { amount: '12.000', currency: 'LYD', unit_code: 'piece', price_list_id: 'private-list', channel: 'web' } } } });
    await assert.rejects(fixture({ formatProductField: async () => { throw Object.assign(new Error('private error'), { status: 403 }); } }).present({ raw }),
        { code: 'workspace_command_read_forbidden' });
    const result = await fixture({ formatProductField: async () => { throw new Error('private upstream detail'); } }).present({ raw });
    assert.equal(approve(result).enabled, false); assert.equal(JSON.stringify(result).includes('private upstream'), false);
});
