import assert from 'node:assert/strict';
import test from 'node:test';
import { savanaIntegrationMethods } from '../../api/savanaIntegrations.js';

const capture = () => {
    const calls = [];
    return { calls, client: { request: async (...args) => { calls.push(args); return { server: true }; } } };
};

test('workspace review requests forward only named opaque selections and business fields', async () => {
    const { calls, client } = capture();
    const injected = { organization_id: 'browser-org', actor_id: 'browser-actor', expected_version: 99, grants: ['*'], idempotency_key: 'browser-key' };
    await savanaIntegrationMethods.reviewPortalWorkspaceConnection.call(client, { activity: 'opaque-a', purpose: 'opaque-p', provider: 'opaque-account', fields: ['opaque-field'], people: ['opaque-person'], ...injected });
    await savanaIntegrationMethods.reviewPortalWorkspaceProduct.call(client, { activity: 'opaque-a', provider: 'opaque-account', record: 'opaque-record', fields: { price: { amount: '25.500', choice: 'opaque-price' } }, clearFields: ['description'], ...injected });
    assert.deepEqual(JSON.parse(calls[0][1].body), { activity: 'opaque-a', purpose: 'opaque-p', provider: 'opaque-account', fields: ['opaque-field'], people: ['opaque-person'] });
    assert.deepEqual(JSON.parse(calls[1][1].body), { activity: 'opaque-a', provider: 'opaque-account', record: 'opaque-record', fields: { price: { amount: '25.500', choice: 'opaque-price' } }, clearFields: ['description'] });
    for (const [, options] of calls) {
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
        for (const key of Object.keys(injected)) assert.equal(options.body.includes(key), false);
    }
});

test('workspace submission forwards the server review handle without rebuilding a command or retrying', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.submitPortalWorkspaceReview.call(client, 'opaque-server-review');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/api/portal/integrations/workspace/submit');
    assert.deepEqual(JSON.parse(calls[0][1].body), { review: 'opaque-server-review' });
    client.request = async (...args) => { calls.push(args); throw new Error('transport lost'); };
    await assert.rejects(savanaIntegrationMethods.submitPortalWorkspaceReview.call(client, 'same-server-review'), /transport lost/);
    assert.equal(calls.length, 2);
});

test('workspace reads encode opaque references and do not forward browser authority', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.getPortalConnectionsWorkspace.call(client);
    await savanaIntegrationMethods.getPortalWorkspaceRecords.call(client, { activity: 'opaque/a', q: 'قهوة & ماء', cursor: 'opaque/cursor', actor_id: 'do-not-forward' });
    await savanaIntegrationMethods.getPortalWorkspaceRecord.call(client, 'opaque/record', 'opaque/a');
    await savanaIntegrationMethods.getPortalWorkspaceCommands.call(client, 'opaque/a');
    await savanaIntegrationMethods.getPortalWorkspaceCommand.call(client, 'opaque/command');
    await savanaIntegrationMethods.getPortalWorkspaceIntent.call(client, 'opaque/intent');
    await savanaIntegrationMethods.getPortalConnectionsWorkspace.call(client, { activity: 'opaque/a', purpose: 'opaque/p', provider: 'opaque/account', action: 'messaging.send', organization_id: 'do-not-forward' });
    assert.equal(calls[0][0], '/api/portal/integrations/workspace');
    assert.equal(new URL(calls[1][0], 'https://same-origin.test').searchParams.get('q'), 'قهوة & ماء');
    assert.equal(new URL(calls[1][0], 'https://same-origin.test').searchParams.get('actor_id'), null);
    assert.ok(calls[2][0].includes('/records/opaque%2Frecord?activity=opaque%2Fa'));
    assert.ok(calls[4][0].endsWith('/commands/opaque%2Fcommand'));
    assert.ok(calls[5][0].endsWith('/intents/opaque%2Fintent'));
    const selection = new URL(calls[6][0], 'https://same-origin.test').searchParams;
    assert.deepEqual([...selection.keys()], ['activity', 'purpose', 'provider', 'action']);
    assert.equal(selection.get('provider'), 'opaque/account');
    assert.equal(calls.every(([, options]) => options === undefined), true);
});

test('native options, preview and sealed command review use the agreed scoped facade without actor claims', async () => {
    const { calls, client } = capture();
    const input = { activity_ref: 'opaque-activity', channel: 'sms', account_ref: 'opaque-account', recipient_ref: 'opaque-person', actor_id: 'do-not-forward' };
    await savanaIntegrationMethods.getPortalCollaborativeOptions.call(client, input);
    await savanaIntegrationMethods.getPortalCollaborativeConsents.call(client, input);
    await savanaIntegrationMethods.previewPortalCollaborativeAction.call(client, { ...input, capability: 'messaging.send', action: 'messaging.send', parameters: { message: 'نص عادي' } });
    await savanaIntegrationMethods.reviewPortalWorkspaceNativeAction.call(client, { activity: 'opaque-activity', provider: 'opaque-provider', capability: 'messaging.send', action: 'messaging.send', parameters: { message: 'نص عادي', resource_fingerprint: 'a'.repeat(64) }, actor_id: 'do-not-forward' });
    assert.deepEqual([...new URL(calls[0][0], 'https://same-origin.test').searchParams.keys()], ['activity_ref', 'channel', 'account_ref']);
    assert.deepEqual([...new URL(calls[1][0], 'https://same-origin.test').searchParams.keys()], ['activity_ref', 'channel', 'account_ref', 'recipient_ref']);
    for (const [, options] of calls.slice(2)) {
        assert.deepEqual(options.headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
        assert.equal(JSON.parse(options.body).actor_id, undefined);
    }
    assert.equal(calls[3][0], '/api/portal/integrations/workspace/actions/review');
});

test('connection and command lifecycle methods retain version-bound opaque selectors and omit browser versions', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.getPortalWorkspaceRequests.call(client, 'opaque/activity');
    await savanaIntegrationMethods.getPortalWorkspaceRequest.call(client, 'opaque/request');
    await savanaIntegrationMethods.approvePortalWorkspaceRequest.call(client, 'opaque/request', 'preissued-request-intent');
    await savanaIntegrationMethods.reviewPortalWorkspaceRequestEdit.call(client, 'opaque/request', { activity: 'a', purpose: 'p', provider: 'source', fields: ['name'], people: ['person'], expected_version: 999, actor_id: 'injected' });
    await savanaIntegrationMethods.reviewPortalWorkspaceRequestRejection.call(client, 'opaque/request', 'الغرض غير مناسب');
    await savanaIntegrationMethods.reviewPortalWorkspaceReadGrantRevocation.call(client, 'opaque/grant', 'انتهت الحاجة إلى الوصول');
    await savanaIntegrationMethods.reviewPortalWorkspaceCommandEdit.call(client, 'opaque/command', { fields: { name: 'اسم جديد' }, clearFields: ['description'], expected_version: 999 });
    await savanaIntegrationMethods.reviewPortalWorkspaceCommandRejection.call(client, 'opaque/command', 'تغيرت الحاجة');
    assert.ok(calls[0][0].endsWith('/requests?activity=opaque%2Factivity'));
    assert.ok(calls[1][0].endsWith('/requests/opaque%2Frequest'));
    assert.ok(calls[2][0].endsWith('/requests/opaque%2Frequest/approve'));
    assert.deepEqual(JSON.parse(calls[2][1].body), { intent: 'preissued-request-intent' });
    assert.ok(calls[5][0].endsWith('/read-grants/opaque%2Fgrant/revoke/review'));
    for (const [, options] of calls.slice(2)) {
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
        if (options.body) { assert.equal(options.body.includes('expected_version'), false); assert.equal(options.body.includes('actor_id'), false); }
    }
    assert.deepEqual(JSON.parse(calls[6][1].body), { fields: { name: 'اسم جديد' }, clearFields: ['description'] });
});

test('workspace prepare, approval and reconciliation actions use explicit current-page intent', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.selectPortalWorkspaceActivity.call(client, 'opaque-activity');
    await savanaIntegrationMethods.reviewPortalWorkspaceActivity.call(client, 'متجر المدينة');
    await savanaIntegrationMethods.reviewPortalWorkspaceProvider.call(client, 'opaque-provider');
    await savanaIntegrationMethods.approvePortalWorkspaceCommand.call(client, 'opaque/command', 'preissued-command-intent');
    await savanaIntegrationMethods.reconcilePortalWorkspaceCommand.call(client, 'opaque/command');
    await savanaIntegrationMethods.reconcilePortalWorkspaceIntent.call(client, 'opaque/intent');
    assert.deepEqual(calls.slice(0, 3).map(([, options]) => JSON.parse(options.body)), [{ activity: 'opaque-activity' }, { name: 'متجر المدينة' }, { provider: 'opaque-provider' }]);
    for (const [, options] of calls) {
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
    }
    assert.ok(calls[3][0].endsWith('/commands/opaque%2Fcommand/approve'));
    assert.deepEqual(JSON.parse(calls[3][1].body), { intent: 'preissued-command-intent' });
    assert.ok(calls[4][0].endsWith('/commands/opaque%2Fcommand/reconcile'));
    assert.ok(calls[5][0].endsWith('/intents/opaque%2Fintent/reconcile'));
});

test('native account binding is a sealed review request with no browser account/org claims', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.reviewPortalWorkspaceBinding.call(client, { organization_id: 'do-not-forward', account_id: 'do-not-forward' });
    assert.equal(calls[0][0], '/api/portal/integrations/workspace/binding/review');
    assert.deepEqual(calls[0][1], { method: 'POST', headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: '{}' });
});

test('native recipient search forwards only ordinary search text and opaque server cursor', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.getPortalCollaborativeOptions.call(client, { activity_ref: 'opaque/activity', capability: 'messaging.send', channel: 'whatsapp', account_ref: 'opaque/account',
        recipient_q: 'سارة +218', recipient_cursor: 'opaque/cursor', actor_id: 'do-not-forward', recipient_ids: ['injected'] });
    const query = new URL(calls[0][0], 'https://same-origin.test').searchParams;
    assert.deepEqual([...query.keys()], ['activity_ref', 'capability', 'channel', 'account_ref', 'recipient_q', 'recipient_cursor']);
    assert.equal(query.get('recipient_q'), 'سارة +218'); assert.equal(query.get('recipient_cursor'), 'opaque/cursor');
});

test('approval without the reviewed current preissued intent never falls back to an empty mutation', async () => {
    const { calls, client } = capture();
    for (const intent of [undefined, '', null, { key: 'browser-intent' }]) {
        await assert.rejects(savanaIntegrationMethods.approvePortalWorkspaceCommand.call(client, 'opaque-command', intent), TypeError);
        await assert.rejects(savanaIntegrationMethods.approvePortalWorkspaceRequest.call(client, 'opaque-request', intent), TypeError);
    }
    assert.equal(calls.length, 0);
});

test('typed business options/preview forward scoped choices and ordinary values without browser authority', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.getPortalCollaborativeBusinessOptions.call(client, { activity_ref: 'opaque/activity', capability: 'customers.manage',
        contact_q: 'سارة', contact_cursor: 'opaque/contact-page', operation_cursor: 'opaque/operation-page', actor_id: 'do-not-forward' });
    const query = new URL(calls[0][0], 'https://same-origin.test').searchParams;
    assert.deepEqual([...query.keys()], ['activity_ref', 'capability', 'contact_q', 'contact_cursor', 'operation_cursor']);
    await savanaIntegrationMethods.previewPortalCollaborativeBusinessAction.call(client, { activity_ref: 'opaque/activity', capability: 'customers.manage', action: 'contacts.change',
        parameters: { label: 'عميل دائم' }, organization_id: 'do-not-forward' });
    assert.equal(calls[1][0], '/api/portal/integrations/collaborative/business/preview');
    assert.deepEqual(JSON.parse(calls[1][1].body), { activity_ref: 'opaque/activity', capability: 'customers.manage', action: 'contacts.change', parameters: { label: 'عميل دائم' } });
    assert.deepEqual(calls[1][1].headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
});

test('using a named activity prepares a sealed review and never forwards installation or scope claims', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.reviewPortalWorkspaceSelection.call(client, 'opaque-current-activity', { consumer_installation_id: 'not-accepted', organization_id: 'not-accepted' });
    assert.deepEqual(calls, [['/api/portal/integrations/workspace/selection/review', { method: 'POST',
        headers: { 'X-Savana-Owner-Intent': 'connections-data-v1' }, body: JSON.stringify({ activity: 'opaque-current-activity' }) }]]);
    assert.equal(calls.some(([path]) => path.endsWith('/workspace/selection')), false);
});

test('dispatch and cancellation only prepare exact opaque-command reviews and never directly execute or replace intent keys', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.reviewPortalWorkspaceCommandDispatch.call(client, 'opaque/command');
    await savanaIntegrationMethods.reviewPortalWorkspaceCommandCancellation.call(client, 'opaque/command', 'انتهت الحاجة إلى التنفيذ');
    assert.deepEqual(calls.map(([path]) => path), ['/api/portal/integrations/workspace/commands/opaque%2Fcommand/dispatch/review',
        '/api/portal/integrations/workspace/commands/opaque%2Fcommand/cancel/review']);
    assert.deepEqual(calls.map(([, options]) => JSON.parse(options.body)), [{}, { reason: 'انتهت الحاجة إلى التنفيذ' }]);
    for (const [, options] of calls) assert.deepEqual(options.headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
});

test('guided WhatsApp setup forwards only one current choice or callback and never provider IDs, credentials or SDK claims', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.getPortalGuidedWhatsAppSetup.call(client);
    await savanaIntegrationMethods.startPortalGuidedWhatsAppSetup.call(client, { phone_number_id: 'not-forwarded' });
    await savanaIntegrationMethods.completePortalGuidedWhatsAppSetup.call(client, 'single-use-code', 'server-state');
    await savanaIntegrationMethods.choosePortalGuidedWhatsAppSetup.call(client, 'opaque-business-choice');
    await savanaIntegrationMethods.connectPortalGuidedWhatsAppSetup.call(client, 'opaque-phone-choice', true);
    await savanaIntegrationMethods.cancelPortalGuidedWhatsAppSetup.call(client);
    assert.deepEqual(calls.map(([path]) => path), ['/api/portal/whatsapp/setup', '/api/portal/whatsapp/setup/start', '/api/portal/whatsapp/setup/complete',
        '/api/portal/whatsapp/setup/choose', '/api/portal/whatsapp/setup/connect', '/api/portal/whatsapp/setup/cancel']);
    assert.deepEqual(calls.slice(1).map(([, options]) => JSON.parse(options.body)), [{}, { code: 'single-use-code', state: 'server-state' },
        { choice: 'opaque-business-choice' }, { choice: 'opaque-phone-choice', setDefault: true }, {}]);
    for (const [, options] of calls.slice(1)) assert.deepEqual(options.headers, { 'X-Savana-Owner-Intent': 'guided-whatsapp-setup-v1' });
    client.request = async (...args) => { calls.push(args); throw new Error('lost acknowledgement'); };
    await assert.rejects(savanaIntegrationMethods.connectPortalGuidedWhatsAppSetup.call(client, 'opaque-phone-choice', false));
    assert.equal(calls.length, 7);
});

test('media staging uses one multipart file and business fields; status lookup never resubmits bytes', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.getPortalCollaborativeMediaOptions.call(client, { activity_ref: 'opaque/activity', account_ref: 'named-account', actor_id: 'not-forwarded' });
    const file = new File(['synthetic bytes'], 'sample.txt', { type: 'text/plain' });
    const fields = { activity_ref: 'opaque/activity', channel: 'whatsapp', account_ref: 'named-account', purpose: 'channel_content', evidence_reference: 'license12',
        rights_note: 'Actual source-owned license evidence', rights_recorded_at: '2026-11-18T10:00:00Z', rights_valid_until: '2026-11-19T10:00:00Z', idempotency_key: 'original-stage-key' };
    await savanaIntegrationMethods.stagePortalCollaborativeMedia.call(client, file, { ...fields, actor_id: 'not-forwarded', provider_id: 'not-forwarded' });
    const options = calls[1][1];
    assert.equal(options.body instanceof FormData, true);
    assert.deepEqual([...options.body.keys()], [...Object.keys(fields), 'file']);
    assert.equal(options.body.get('file').name, file.name);
    assert.equal(options.headers['Content-Type'], undefined);
    assert.deepEqual(options.headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
    await savanaIntegrationMethods.lookupPortalCollaborativeMediaStage.call(client, 'opaque/activity', 'original-stage-key');
    assert.equal(calls[2][1], undefined);
    assert.equal(new URL(calls[2][0], 'https://own.test').searchParams.get('idempotency_key'), 'original-stage-key');
    await savanaIntegrationMethods.previewPortalCollaborativeMedia.call(client, { activity_ref: 'opaque/activity', capability: 'media.manage', action: 'media.asset.upload', parameters: { asset_ref: 'named-asset' }, actor_id: 'not-forwarded' });
    assert.deepEqual(JSON.parse(calls[3][1].body), { activity_ref: 'opaque/activity', capability: 'media.manage', action: 'media.asset.upload', parameters: { asset_ref: 'named-asset' } });
    client.request = async (...args) => { calls.push(args); throw new Error('lost staging ACK'); };
    await assert.rejects(savanaIntegrationMethods.stagePortalCollaborativeMedia.call(client, file, fields));
    assert.equal(calls.length, 5);
});

test('named grant options/review expose no browser version/epoch/actor authority and preserve explicit withdrawal arrays', async () => {
    const { calls, client } = capture();
    await savanaIntegrationMethods.getPortalWorkspaceGrantOptions.call(client, { activity: 'opaque/activity', grant: 'opaque/grant', person: 'opaque/person', expected_version: 9, actor_id: 'not-forwarded' });
    const query = new URL(calls[0][0], 'https://own.test').searchParams;
    assert.deepEqual([...query.keys()], ['activity', 'grant', 'person']); assert.equal(query.get('grant'), 'opaque/grant');
    const input = { activity: 'opaque/activity', grant: 'opaque/grant', person: 'opaque/person', actions: [], fields: [], resources: [], resourcePolicy: 'selected', expiresAt: '2030-01-01T00:00:00Z', assignSourceAuthority: false };
    await savanaIntegrationMethods.reviewPortalWorkspaceGrant.call(client, { ...input, expected_version: 9, expected_authority_epoch: 99, actor_id: 'not-forwarded', organization_id: 'not-forwarded' });
    assert.equal(calls[1][0], '/api/portal/integrations/workspace/grants/review'); assert.deepEqual(JSON.parse(calls[1][1].body), input);
    assert.deepEqual(calls[1][1].headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
    await savanaIntegrationMethods.reviewPortalWorkspaceProviderRefresh.call(client, 'opaque/current-provider');
    assert.equal(calls[2][0], '/api/portal/integrations/workspace/provider/refresh/review'); assert.deepEqual(JSON.parse(calls[2][1].body), { provider: 'opaque/current-provider' });
    assert.deepEqual(calls[2][1].headers, { 'X-Savana-Owner-Intent': 'connections-data-v1' });
});
