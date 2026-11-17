export const ownerFixtureStatus = (state = 'disconnected', held = false) => ({
    enabled: state !== 'disabled', read_only: true, execution_ready: false, pricing_use_allowed: false,
    native_reference: state === 'disabled' ? null : 'b'.repeat(64),
    session: { state: state === 'disabled' ? 'disconnected' : state,
        actor_id: state === 'connected' ? 'synthetic-owner-account' : null,
        organization_id: state === 'connected' ? 'synthetic-organization' : null,
        expires_at: state === 'connected' ? new Date(Date.now() + 300_000).toISOString() : null },
    actions: { login: !['disabled', 'connected'].includes(state) && !held, disconnect: state === 'connected' && !held, overview: state === 'connected' },
    intents: { unknown_count: held ? 1 : 0, inflight_count: 0, mutations_blocked: held },
});

export const ownerFixtureOverview = (held = false) => {
    const status = ownerFixtureStatus('connected', held);
    const scope = { organization_id: 'synthetic-organization', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
    const secondScope = { ...scope, activity_id: 'synthetic-other-activity' };
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    const proposal = { source_installation_id: 'synthetic-catalog-installation', consumer_installation_id: 'synthetic-wa-installation',
        fields: ['name', 'price'], reader_account_ids: ['synthetic-reader-account', 'synthetic-owner-account'], expires_at: expires };
    return { ...status, actions: { ...status.actions, create_scope: !held, authorize_scope: !held },
        context: { actor_id: status.session.actor_id, organization_id: scope.organization_id, checked_at: new Date().toISOString(), valid_until: expires },
        options: {
            scopes: [scope, secondScope].map((item, index) => ({ scope: item, label: index ? 'Synthetic second activity' : 'Synthetic current activity',
                actions: { request_consumer_registration: !held, request_read_sharing: !held, approve_consumer_registration: !held, approve_read_sharing: !held, review: true, revoke_read_grant: !held } })),
            enrollments: [{ enrollment_id: 'synthetic-public-enrollment', version: 1, platform: 'wa_savana', organization_id: scope.organization_id }],
            consumer_installations: [{ installation_id: 'synthetic-wa-installation', enrollment_id: 'synthetic-public-enrollment', scope, label: 'Synthetic WA consumer', platform: 'wa_savana' }],
            source_installations: [{ installation_id: 'synthetic-catalog-installation', enrollment_id: 'synthetic-catalog-enrollment', scope, label: 'Synthetic Catalog source', platform: 'catalog', fields: ['name', 'price'] }],
            readers: [{ account_id: 'synthetic-reader-account', display_name: 'Synthetic permitted reader' }, { account_id: 'synthetic-owner-account', display_name: 'Synthetic current owner' }],
        },
        requests: [{ request_id: 'synthetic-read-sharing-request', kind: 'read_sharing', scope, proposal, version: 2, state: 'pending',
            effective_version: 1, effective_resource: { read_grant_id: 'synthetic-read-grant', revision: 1, ...proposal, fields: ['name'] },
            requested_by: 'synthetic-owner-account', reviewed_by: null, reason: null, updated_at: new Date().toISOString(),
            actions: { edit: !held, approve: !held, reject: !held } }],
        scope_authorizations: [],
        read_grants: [{ read_grant_id: 'synthetic-read-grant', scope, ...proposal, fields: ['name'], revision: 1, active: true, expired: false }],
    };
};

export const createOwnerOperationFixture = () => {
    let model = ownerFixtureOverview();
    const ledger = new Map();
    let sequence = 0;
    const envelope = intent => ({ enabled: true, read_only: true, execution_ready: false, pricing_use_allowed: false, intent });
    const unavailable = status => Object.assign(new Error('Synthetic owner operation unavailable'), { status });
    return {
        held: () => [...ledger.values()].some(intent => ['inflight', 'unknown', 'prepared'].includes(intent.state)),
        overview: held => {
            const fresh = ownerFixtureOverview(held);
            return { ...fresh, options: { ...fresh.options, consumer_installations: model.options.consumer_installations },
                requests: model.requests.map(request => ({ ...request, actions: { edit: !held, approve: !held && request.state !== 'approved', reject: !held && request.state === 'pending' } })),
                scope_authorizations: model.scope_authorizations, read_grants: model.read_grants };
        },
        lookup: selector => {
            const intent = ledger.get(selector) || [...ledger.values()].find(item => item.id === selector);
            if (!intent) throw unavailable(404);
            return envelope({ ...intent, result: null });
        },
        bind: body => {
            const consumer = model.options.consumer_installations.find(item => item.installation_id === body.consumer_installation_id);
            const granted = consumer && model.read_grants.some(grant => grant.active && !grant.expired && grant.consumer_installation_id === consumer.installation_id
                && grant.reader_account_ids.includes('synthetic-owner-account') && body.activity_id === consumer.scope.activity_id
                && body.branch_id === consumer.scope.branch_id && body.warehouse_id === consumer.scope.warehouse_id);
            if (!granted) throw unavailable(403);
            return { bound: true, read_only: true, execution_ready: false, pricing_use_allowed: false };
        },
        dispatch: (command, scenario = 'success') => {
            if (ledger.has(command.idempotencyKey)) return envelope({ ...ledger.get(command.idempotencyKey), result: null });
            if (scenario === 'not-found') throw unavailable(503);
            if (scenario === 'stale-review') {
                const changed = model.requests.find(item => item.request_id === command.requestId);
                if (changed) { changed.version += 1; changed.state = 'pending'; }
                throw Object.assign(unavailable(422), { data: { error: { code: 'owner_portal_request_invalid' } } });
            }
            const now = new Date().toISOString();
            const intent = { id: `synthetic-owner-intent-${++sequence}`, operation: command.operation, state: scenario === 'unknown' ? 'unknown' : 'completed',
                request_sha256: 'a'.repeat(64), created_at: now, updated_at: now, result: null };
            ledger.set(command.idempotencyKey, intent);
            if (scenario === 'unknown') return envelope(intent);
            const scope = { organization_id: 'synthetic-organization', ...command.body.scope };
            let request = model.requests.find(item => item.request_id === command.requestId);
            if (command.operation === 'request.create') {
                request = { request_id: `synthetic-created-request-${sequence}`, kind: command.body.kind, scope, proposal: command.body.proposal,
                    version: 1, state: 'pending', effective_version: null, effective_resource: null, requested_by: 'synthetic-owner-account', reviewed_by: null,
                    reason: null, updated_at: now, actions: { edit: true, approve: true, reject: true } };
                model.requests.push(request);
            } else if (command.operation === 'request.edit') {
                if (!request || request.version !== command.body.expected_version) throw unavailable(409);
                request.version += 1; request.proposal = command.body.proposal; request.state = 'pending'; request.reason = null;
            } else if (command.operation === 'request.approve') {
                if (!request || request.version !== command.body.expected_version) throw unavailable(409);
                request.state = 'approved'; request.effective_version = request.version; request.reviewed_by = 'synthetic-owner-account';
                if (request.kind === 'consumer_registration') {
                    const installation_id = `synthetic-created-consumer-${sequence}`;
                    request.effective_resource = { installation_id, enrollment_id: request.proposal.enrollment_id };
                    model.options.consumer_installations.push({ ...request.effective_resource, scope: request.scope, label: request.proposal.installation_label, platform: 'wa_savana' });
                } else {
                    const existing = model.read_grants.find(grant => grant.consumer_installation_id === request.proposal.consumer_installation_id);
                    const grant = { read_grant_id: existing?.read_grant_id || `synthetic-created-read-grant-${sequence}`, scope: request.scope,
                        ...request.proposal, revision: (existing?.revision || 0) + 1, active: true, expired: false };
                    if (existing) Object.assign(existing, grant); else model.read_grants.push(grant);
                    request.effective_resource = { ...grant }; delete request.effective_resource.scope; delete request.effective_resource.expired;
                }
            } else if (command.operation === 'request.reject') {
                if (!request || request.version !== command.body.expected_version) throw unavailable(409);
                request.state = 'rejected'; request.reason = command.body.reason; request.reviewed_by = 'synthetic-owner-account';
            } else if (command.operation === 'read_grant.revoke') {
                const grant = model.read_grants.find(item => item.read_grant_id === command.requestId);
                if (!grant || grant.revision !== command.body.expected_revision) throw unavailable(409);
                grant.active = false; grant.revision += 1;
                model.requests.forEach(item => { if (item.effective_resource?.read_grant_id === grant.read_grant_id) Object.assign(item.effective_resource, { active: false, revision: grant.revision }); });
                intent.result = { read_grant: { read_grant_id: grant.read_grant_id, revision: grant.revision, active: false } };
            } else if (command.operation === 'scope.authorize') {
                const existing = model.scope_authorizations.find(item => item.actor_id === command.targetAccountId && JSON.stringify(item.scope) === JSON.stringify(scope));
                const authorization = { actor_id: command.targetAccountId, scope, actions: command.body.actions, expires_at: command.body.expires_at,
                    version: (existing?.version || 0) + 1, native_editable: true };
                if (existing) Object.assign(existing, authorization); else model.scope_authorizations.push(authorization);
                intent.result = { ...authorization, target_account_id: command.targetAccountId };
            } else throw unavailable(422);
            if (request) { request.updated_at = now; intent.result = { request }; }
            return envelope(intent);
        },
    };
};
