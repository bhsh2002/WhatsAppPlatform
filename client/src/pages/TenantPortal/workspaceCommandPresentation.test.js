import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceCommandResultActions, workspaceCommandStatus } from './workspaceCommandPresentation.js';

test('source application and shared projection cannot substitute for one another', () => {
    const receipt = { confirmed: true, source_revision: 1 };
    const pendingProjection = workspaceCommandStatus({ state: 'source_applied', source_result: receipt, projection_state: 'pending' }, 'en');
    assert.equal(pendingProjection.sourceConfirmed, true);
    assert.equal(pendingProjection.fullyConfirmed, false);
    assert.equal(pendingProjection.projectionLabel, 'Shared view update pending');
    const noReceipt = workspaceCommandStatus({ state: 'source_applied', projection_state: 'current' }, 'en');
    assert.equal(noReceipt.sourceConfirmed, false);
    assert.equal(noReceipt.fullyConfirmed, false);
    assert.equal(workspaceCommandStatus({ state: 'source_applied', source_result: {}, projection_state: 'current' }).fullyConfirmed, false);
    const current = workspaceCommandStatus({ state: 'source_applied', source_result: receipt, projection_state: 'current' }, 'en');
    assert.equal(current.fullyConfirmed, true);
    assert.equal(workspaceCommandStatus({ state: 'approved', source_result: {}, projection_state: 'current' }).sourceConfirmed, false);
    assert.equal(workspaceCommandStatus({ state: 'source_applied', source_result: { result_reference: 'raw-receipt', local_entity_id: 'private-entity', source_revision: 1 }, projection_state: 'current' }).sourceConfirmed, false);
    assert.equal(workspaceCommandStatus({ action: 'product.create', state: 'source_applied', source_result: { confirmed: true, source_revision: null }, projection_state: 'current' }).sourceConfirmed, false);
    assert.equal(workspaceCommandStatus({ action: 'product.change', state: 'source_applied', source_result: { confirmed: true, source_revision: 0 }, projection_state: 'current' }).sourceConfirmed, false);
});

test('Core-confirmed native receipts need no invented product revision and remain separate from projection state', () => {
    for (const action of ['messaging.send', 'campaigns.execute', 'content.publish', 'measurement.summary', 'measurement.export', 'owner.operation_status']) {
        const command = { action, state: 'source_applied', source_result: { confirmed: true, source_revision: null }, projection_state: 'pending' };
        const pending = workspaceCommandStatus(command, 'en');
        assert.equal(pending.sourceConfirmed, true);
        assert.equal(pending.fullyConfirmed, false);
        assert.equal(pending.stateLabel, ['measurement.summary', 'measurement.export', 'owner.operation_status'].includes(action)
            ? 'The data result was prepared by the source' : 'Executor reports the operation accepted');
        assert.equal(pending.projectionLabel, 'Shared view update pending');
        assert.equal(workspaceCommandStatus({ ...command, projection_state: 'current' }).fullyConfirmed, true);
        assert.equal(workspaceCommandStatus({ ...command, source_result: { source_revision: null } }).sourceConfirmed, false);
        assert.equal(workspaceCommandStatus({ ...command, source_result: { confirmed: true, source_revision: -1 } }).sourceConfirmed, false);
        assert.equal(workspaceCommandStatus({ ...command, state: 'outcome_unknown' }).sourceConfirmed, false);
    }
    assert.equal(workspaceCommandStatus({ action: 'contacts.read', state: 'source_applied', source_result: { confirmed: true, source_revision: null } }).sourceConfirmed, false);
});

test('review receipts confirm only an actual positive draft version and never imply execution permission', () => {
    for (const action of ['messaging.review', 'campaigns.review', 'content.review']) {
        const command = { action, state: 'source_applied', projection_state: 'not_required', source_result: { confirmed: true, source_revision: 1 } };
        const result = workspaceCommandStatus(command, 'en');
        assert.equal(result.sourceConfirmed, true); assert.equal(result.fullyConfirmed, true);
        assert.equal(result.stateLabel, 'The activity review draft was recorded');
        assert.ok(result.sourceLabel.includes('Later execution requires a separate request and permission'));
        assert.equal(workspaceCommandStatus({ ...command, source_result: { confirmed: true, source_revision: null } }).sourceConfirmed, false);
    }
});

test('unknown and dispatching results remain unresolved without exposing receipt references', () => {
    for (const state of ['dispatching', 'outcome_unknown']) {
        const view = workspaceCommandStatus({ state, source_result: { result_reference: 'private-reference' }, projection_state: 'not_applied' }, 'en');
        assert.equal(view.unresolved, true);
        assert.equal(view.sourceConfirmed, false);
        assert.equal(JSON.stringify(view).includes('private-reference'), false);
    }
    assert.equal(workspaceCommandStatus({ state: 'approved' }, 'en').stateLabel, 'Approved; execution not confirmed yet');
    assert.equal(workspaceCommandStatus({ state: 'invented-complete', projection_state: 'invented-current' }, 'en').stateLabel, 'Request state unverified');
});

test('queued, cancellation-pending and partial native results preserve truthful nonterminal outcomes', () => {
    for (const state of ['source_pending', 'cancel_requested']) {
        const status = workspaceCommandStatus({ action: 'campaigns.execute', state, projection_state: 'not_required', source_result: { confirmed: true, source_revision: null } }, 'en');
        assert.equal(status.unresolved, true); assert.equal(status.sourceConfirmed, false); assert.equal(status.fullyConfirmed, false);
        assert.equal(status.projectionLabel, 'This operation does not require a shared data update');
    }
    const partial = workspaceCommandStatus({ action: 'campaigns.execute', state: 'source_partially_applied', projection_state: 'not_required' }, 'en');
    assert.equal(partial.sourceConfirmed, false); assert.equal(partial.fullyConfirmed, false);
    assert.equal(partial.stateLabel, 'Part of the request was applied; review individual outcomes');
    const completed = workspaceCommandStatus({ action: 'content.publish', state: 'source_applied', projection_state: 'not_required', source_result: { confirmed: true, source_revision: null } }, 'en');
    assert.equal(completed.sourceConfirmed, true); assert.equal(completed.fullyConfirmed, true);
    assert.equal(workspaceCommandStatus({ action: 'product.create', state: 'source_applied', projection_state: 'not_required', source_result: { confirmed: true, source_revision: 3 } }).fullyConfirmed, false);
});

test('confirmed result downloads use only the exact local version-bound command route, never arbitrary destinations', () => {
    const key = 'wr1.opaque-command';
    const action = format => ({ format, label: format === 'csv' ? 'تنزيل الجدول' : 'تنزيل الإيصال',
        href: `/api/portal/integrations/workspace/commands/${encodeURIComponent(key)}/result?format=${format}` });
    const command = { key, action: 'messaging.send', state: 'source_applied', source_result: { confirmed: true, source_revision: null }, resultActions: [action('json'), action('csv')] };
    assert.deepEqual(workspaceCommandResultActions(command), command.resultActions);
    for (const bad of [{ ...action('json'), href: 'https://outside.invalid/result' }, { ...action('json'), href: '//outside.invalid/result' },
        { ...action('json'), href: action('json').href + '&token=not-allowed' }, { ...action('json'), href: action('json').href.replace(key, 'different-command') },
        { ...action('json'), label: 'a'.repeat(64) }, { ...action('json'), format: 'html' }]) {
        assert.deepEqual(workspaceCommandResultActions({ ...command, resultActions: [bad] }), []);
    }
    assert.deepEqual(workspaceCommandResultActions({ ...command, state: 'source_pending' }), []);
    assert.deepEqual(workspaceCommandResultActions({ ...command, source_result: { confirmed: false, source_revision: null } }), []);
    assert.deepEqual(workspaceCommandResultActions({ ...command, action: 'product.change' }), []);
});

test('media requires an actual positive asset revision and verified receipt without inventing a shared-data projection', () => {
    for (const action of ['media.asset.upload', 'media.asset.inspect']) {
        const command = { action, state: 'source_applied', projection_state: 'not_required', source_result: { confirmed: true, source_revision: 3 } };
        const current = workspaceCommandStatus(command, 'en');
        assert.equal(current.sourceConfirmed, true); assert.equal(current.fullyConfirmed, true);
        assert.equal(current.stateLabel, action === 'media.asset.inspect' ? 'The data result was prepared by the source' : 'Source reports the file upload accepted into the channel library');
        for (const source_revision of [null, 0, -1, '3']) assert.equal(workspaceCommandStatus({ ...command, source_result: { confirmed: true, source_revision } }).sourceConfirmed, false);
        assert.equal(workspaceCommandStatus({ ...command, source_result: { confirmed: false, source_revision: 3 } }).fullyConfirmed, false);
        assert.equal(workspaceCommandStatus({ ...command, state: 'outcome_unknown' }).fullyConfirmed, false);
    }
});
