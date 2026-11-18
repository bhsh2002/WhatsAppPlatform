import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { presentWorkspaceRequest } from '../services/workspaceRequestPresentation.js';
import { WorkspaceReferences } from '../services/workspaceReferences.js';
import { WorkspaceChoices } from '../services/workspaceChoices.js';
import { canonicalWorkspaceJson } from '../services/workspaceIntents.js';

const START = Date.parse('2026-11-18T12:00:00Z');
const scope = { organization_id: 'private-org', activity_id: 'private-activity', branch_id: null, warehouse_id: null };
const proposal = () => ({ source_installation_id: 'private-source-installation', consumer_installation_id: 'private-consumer-installation',
    fields: ['name'], reader_account_ids: ['private-sara'], expires_at: '2026-12-18T12:00:00Z' });
const request = extra => ({ request_id: 'private-sharing-request', organization_id: scope.organization_id, scope: { ...scope }, version: 2,
    kind: 'read_sharing', state: 'pending', requested_by: 'private-owner', reviewed_by: null, reason: null,
    effective_version: 1, effective_resource: { ...proposal(), fields: ['name', 'price'], reader_account_ids: ['private-sara', 'private-ali'],
        read_grant_id: 'private-grant', revision: 3, active: true }, proposal: proposal(),
    updated_at: '2026-11-18T11:59:59Z', approval_policy: 'explicit current scoped approval', ...extra });
const encryption = () => {
    const key = crypto.randomBytes(32);
    return { encrypt(raw) { const iv = crypto.randomBytes(12), aes = crypto.createCipheriv('aes-256-gcm', key, iv);
        const body = Buffer.concat([aes.update(raw), aes.final()]); return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64'); },
    decrypt(raw) { const bytes = Buffer.from(raw, 'base64'), aes = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        aes.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([aes.update(bytes.subarray(28)), aes.final()]).toString(); } };
};
const option = (key, label, data) => ({ key, label, selectable: true, version: 'current-revision', ...(data ? { data } : {}) });
const fixture = () => {
    let clock = START, permission = true, reviewHook = async () => {};
    const cipher = encryption(); const reviews = [];
    const principal = { tenantId: 1, userId: 2, sessionId: 'synthetic-jti', authVersion: 0, role: 'tenant', sessionExpiresAt: START / 1000 + 600 };
    const identity = { actorId: 'private-owner', organizationId: scope.organization_id, nativeAccountId: 'private-wa-account',
        generation: 'synthetic-identity-generation', expiresAt: new Date(START + 300_000).toISOString() };
    const activity = { activity_id: scope.activity_id, label: 'متجر المدينة', scope: { ...scope }, my_actions: ['read.request', 'read.approve', 'read.manage', 'reviews.read'] };
    const source = { provider_ref: 'private-catalog-account', activity_id: scope.activity_id, label: 'كتالوج المتجر', enrollment_id: 'private-catalog-enrollment', enrollment_version: 1,
        installations: [{ installation_id: 'private-source-installation', activity_id: scope.activity_id, label: 'منتجات المتجر' }] };
    const consumer = { provider_ref: 'private-wa-account', activity_id: scope.activity_id, label: 'رسائل المتجر', enrollment_id: 'private-wa-enrollment', enrollment_version: 4,
        installations: [{ installation_id: 'private-consumer-installation', activity_id: scope.activity_id, label: 'قراءة موظفي الرسائل' }] };
    const context = { actorId: identity.actorId, organizationId: identity.organizationId, nativeAccountId: identity.nativeAccountId,
        identityGeneration: identity.generation, revision: 'current-revision', validUntil: new Date(START + 30_000).toISOString(), identity,
        choices: { activities: [option(activity.activity_id, activity.label)], purposes: [option('read_sharing', 'قراءة المنتجات'), option('consumer_registration', 'تجهيز القراءة')],
            providers: [option('private-source-choice', source.label, { ...source, selectedInstallation: 'private-source-installation' }),
                option('private-consumer-choice', consumer.label, { ...consumer, selectedInstallation: 'private-consumer-installation' })],
            fields: [option('name', 'اسم المنتج'), option('price', 'السعر')], people: [option('private-sara', 'سارة'), option('private-ali', 'علي')] },
        raw: { providers: [source, consumer], existing: { grants: [{ request_id: 'private-sharing-request', type: 'read', scope: { ...scope },
            grant_ref: 'private-grant', revision: 3, active: true, expired: false, expires_at: proposal().expires_at }] } } };
    const refs = new WorkspaceReferences({ encryption: cipher, verifyLocalPrincipal: () => permission, currentIdentity: async () => identity, now: () => clock });
    const choices = new WorkspaceChoices({ encryption: cipher, verifyLocalPrincipal: () => permission, loadContext: async () => context, now: () => clock });
    const present = extra => presentWorkspaceRequest({ principal, context, activity, raw: request(), refs, now: () => clock,
        verifyCurrent: async () => permission, issueChoice: (kind, item) => choices.issue(principal, context, { kind, key: item.key }),
        issueReview: async (operation, payload, summary) => {
            reviews.push({ operation, payload, summary }); await reviewHook();
            return { review: { key: choices.issueReview(principal, context, { operation, payload }),
                intentKey: refs.issue(principal, identity, { type: 'intent', key: 'private-server-approval-intent' }), canSubmit: true } };
        }, ...extra });
    return { principal, context, activity, identity, refs, choices, reviews, present, revoke: () => { permission = false; },
        setClock: value => { clock = value; }, duringReview: value => { reviewHook = value; } };
};
const action = (row, key) => row.request.actions.find(item => item.key === key);

test('pending revision preserves full prior effective fields/readers, removed names and exact version-bound review', async () => {
    const f = fixture(); const result = await f.present(); const row = result.request;
    assert.equal(row.changedSinceEffective, true); assert.equal(row.state, 'pending');
    assert.equal(row.proposedSummary.find(item => item.label === 'البيانات').value, 'اسم المنتج');
    assert.equal(row.effectiveSummary.find(item => item.label === 'البيانات').value, 'اسم المنتج، السعر');
    assert.equal(row.proposedSummary.find(item => item.label === 'الأشخاص').value, 'سارة');
    assert.equal(row.effectiveSummary.find(item => item.label === 'الأشخاص').value, 'سارة، علي');
    assert.deepEqual(row.removedFields, ['السعر']); assert.deepEqual(row.removedPeople, ['علي']);
    assert.equal(action(result, 'approve').enabled, true); assert.equal(action(result, 'edit').enabled, true); assert.equal(action(result, 'revoke').enabled, true);
    assert.equal((await f.refs.resolve(f.principal, row.key, 'request')).version, 2);
    assert.equal((await f.refs.resolve(f.principal, row.grant, 'read_grant')).version, 3);
    await assert.rejects(f.refs.resolve(f.principal, row.key, 'read_grant'));
    assert.equal((await f.choices.resolve(f.principal, row.selection.people[0], 'people')).option.label, 'سارة');
    const sealed = await f.choices.resolveReview(f.principal, result.approval.reviewKey, 'request_approve');
    assert.deepEqual(sealed.payload, { target: request().request_id, expected_version: 2 });
    assert.equal(f.reviews[0].summary.find(item => item.label === 'الأشخاص الذين سيُسحب وصولهم').value, 'علي');
    assert.equal(result.approval.requestHash, crypto.createHash('sha256').update(canonicalWorkspaceJson(request())).digest('hex'));
    for (const id of ['private-sharing-request', 'private-source-installation', 'private-consumer-installation', 'private-sara', 'private-ali', 'private-grant']) {
        assert.equal(JSON.stringify(row).includes(id), false);
    }
});

test('current names and explicit scope rights are required; requester or role alone cannot enable approval', async () => {
    for (const kind of ['proposal-reader', 'prior-reader', 'source', 'permission']) {
        const f = fixture();
        if (kind === 'proposal-reader') f.context.choices.people = f.context.choices.people.filter(row => row.key !== 'private-sara');
        if (kind === 'prior-reader') f.context.choices.people = f.context.choices.people.filter(row => row.key !== 'private-ali');
        if (kind === 'source') f.context.raw.providers = f.context.raw.providers.filter(row => row.provider_ref !== 'private-catalog-account');
        if (kind === 'permission') { f.activity.my_actions = ['reviews.read']; f.principal.role = 'owner'; }
        const result = await f.present();
        assert.equal(action(result, 'approve').enabled, false); assert.equal(result.approval, undefined); assert.equal(f.reviews.length, 0);
        assert.equal(JSON.stringify(result.request).includes('private-sara'), false);
    }
});

test('consumer registration prefill names current enrollment and never adds fields/people or new grants', async () => {
    const f = fixture(); const raw = request({ kind: 'consumer_registration', version: 1, effective_version: null, effective_resource: null,
        proposal: { enrollment_id: 'private-wa-enrollment', enrollment_version: 4, installation_label: 'قراءة رسائل المتجر' } });
    const result = await f.present({ raw });
    assert.equal(action(result, 'approve').enabled, true); assert.deepEqual(result.request.selection.fields, []); assert.deepEqual(result.request.selection.people, []);
    assert.equal(result.request.proposedSummary.find(item => item.label === 'الخدمة').value, 'رسائل المتجر');
    const stale = await f.present({ raw: { ...raw, proposal: { ...raw.proposal, enrollment_version: 3 } } });
    assert.equal(action(stale, 'approve').enabled, false); assert.equal(action(stale, 'edit').enabled, false);
});

test('rejected/approved requests do not masquerade as pending and a revoked/expired prior grant remains nonrevocable', async () => {
    for (const kind of ['rejected', 'approved', 'revoked', 'expired']) {
        const f = fixture(); let raw = request();
        if (kind === 'rejected') raw = request({ state: 'rejected', reviewed_by: 'private-reviewer' });
        if (kind === 'approved') raw = request({ state: 'approved', reviewed_by: 'private-reviewer', version: 1, effective_version: 1, proposal: request().effective_resource });
        if (kind === 'approved') { const { read_grant_id, revision, active, ...policy } = raw.proposal; void read_grant_id; void revision; void active; raw.proposal = policy; }
        if (kind === 'revoked') f.context.raw.existing.grants[0].active = false;
        if (kind === 'expired') f.context.raw.existing.grants[0].expired = true;
        const result = await f.present({ raw });
        if (['rejected', 'approved'].includes(kind)) { assert.equal(action(result, 'approve').enabled, false); assert.equal(action(result, 'edit').enabled, false); }
        else { assert.equal(action(result, 'revoke').enabled, false); assert.ok(result.request.effectiveStateLabel.includes(kind === 'revoked' ? 'سُحبت' : 'انتهت')); }
        assert.equal(JSON.stringify(result.request).includes('private-grant'), false);
    }
});

test('strict raw response scope and fresh before/after review proof reject the entire row after changes', async () => {
    for (const kind of ['scope', 'extra', 'context', 'rights', 'expiry']) {
        const f = fixture(); let raw = request();
        if (kind === 'scope') raw = request({ scope: { ...scope, branch_id: 'other-branch' } });
        if (kind === 'extra') raw = request({ invented: true });
        if (kind === 'context') f.duringReview(async () => { f.context.identity.generation = 'changed'; });
        if (kind === 'rights') f.duringReview(async () => { f.revoke(); });
        if (kind === 'expiry') f.duringReview(async () => { f.setClock(START + 30_000); });
        await assert.rejects(f.present({ raw }), error => error instanceof Error && ['workspace_request_response_invalid', 'workspace_request_read_forbidden', 'workspace_request_review_unavailable'].includes(error.code));
    }
});

test('ambiguous installation or missing opaque choice cannot invent a provider prefill or approvable source', async () => {
    const f = fixture(); f.context.raw.providers.push({ ...f.context.raw.providers[0], provider_ref: 'private-other-source', label: 'مصدر آخر' });
    const ambiguous = await f.present(); assert.equal(ambiguous.request.selection, null); assert.equal(action(ambiguous, 'approve').enabled, false);
    const g = fixture(); g.context.choices.providers = [];
    const missingChoice = await g.present(); assert.equal(missingChoice.request.selection, null); assert.equal(action(missingChoice, 'edit').enabled, false);
    assert.equal(JSON.stringify(missingChoice.request).includes('private-source-choice'), false);
});
