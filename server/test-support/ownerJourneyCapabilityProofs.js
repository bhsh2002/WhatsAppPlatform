import crypto from 'node:crypto';
import { validateNativeCommandModel } from '../services/nativeCommandModels.js';
import { nativeCommandJson } from '../services/nativeCommandProtocol.js';
import { canonicalWorkspaceJson } from '../services/workspaceIntents.js';
import { smsApiRequestHash } from '../services/smsApiRequests.js';

const codes = new Set(['messaging.send', 'campaigns.execute', 'content.publish', 'customers.manage',
    'measurement.read', 'measurement.export', 'owner.operations', 'media.manage',
    'messaging.review', 'campaigns.review', 'content.review']);
const reads = new Set(['contacts.read', 'measurement.summary', 'measurement.export', 'owner.operation_status', 'media.asset.inspect']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => nativeCommandJson(a) === nativeCommandJson(b);
const scope = value => ({ organization_id: value.organization_id, activity_id: value.activity_id,
    branch_id: value.branch_id ?? null, warehouse_id: value.warehouse_id ?? null });
const parse = value => JSON.parse(value);
const registered = adapter => adapter?.qualified === true && ['validate', 'prepare', 'execute', 'reconcile', 'configured']
    .every(key => typeof adapter[key] === 'function');
const binding = row => sha(canonicalWorkspaceJson([row.id, row.tenant_id, row.user_id, row.session_hash, row.auth_version,
    row.native_role, row.native_expires_at, row.central_actor_id, row.organization_id, row.native_account_id,
    row.identity_generation, row.identity_expires_at, row.operation, row.input_sha256, row.request_sha256]));
const open = (decrypt, row, purpose, ciphertext) => {
    const envelope = parse(decrypt(ciphertext));
    if (envelope.purpose !== purpose || envelope.binding !== binding(row)) throw new Error('Unproven workspace envelope');
    return envelope.payload;
};

const createNativeEffectConfirmation = ({ database, decrypt }) => {
    const factFor = (command, effect) => {
        const fact = database.prepare('SELECT * FROM savana_native_action_facts WHERE tenant_id=? AND native_idempotency_key=?')
            .get(effect.tenant_id, effect.native_idempotency_key);
        if (!fact || fact.action !== command.action || fact.request_sha256 !== sha(nativeCommandJson(command))
            || !same(scope(parse(fact.scope_json)), scope(command.scope))) return null;
        const data = parse(decrypt(fact.encrypted_result));
        if (command.action === 'media.asset.inspect') return data.state === 'uploaded' ? fact : null;
        return data.fact_id === fact.id && data.tenant_id === fact.tenant_id && data.action === fact.action
            && data.resource_ref === fact.resource_ref
            && (!command.capability.endsWith('.review') || data.execution_authorized === false && data.state === 'recorded') ? fact : null;
    };
    const effectConfirmed = (command, effect) => {
        if (effect.state !== 'accepted' || !effect.native_id || !effect.receipt_json) return false;
        const receipt = parse(effect.receipt_json);
        if (receipt.accepted !== true || receipt.native_id !== effect.native_id || receipt.native_kind !== effect.native_kind) return false;
        if (['native_contact', 'native_measurement', 'native_operation_snapshot', 'native_review_draft'].includes(effect.native_kind)) {
            const fact = factFor(command, effect);
            return !!fact && receipt.fact_id === fact.id && receipt.native_id === fact.resource_ref
                && (receipt.source_revision ?? null) === fact.source_revision;
        }
        if (effect.native_kind === 'whatsapp_media_asset') {
            const asset = database.prepare('SELECT * FROM savana_native_media_assets WHERE tenant_id=? AND id=?')
                .get(effect.tenant_id, receipt.native_id.replace(/^native_media:/, ''));
            if (!asset || asset.state !== 'uploaded' || !asset.provider_media_id || receipt.provider_id !== asset.provider_media_id
                || asset.provider_receipt_sha256 !== sha(nativeCommandJson({ id: asset.provider_media_id }))
                || !same(scope(parse(asset.scope_json)), scope(command.scope))) return false;
            return command.action === 'media.asset.upload' ? asset.upload_effect_id === effect.id
                : !!factFor(command, effect);
        }
        if (!receipt.provider_id) return false;
        if (effect.native_kind === 'sms_message') return !!database.prepare(`SELECT 1 FROM sms_messages
            WHERE tenant_id=? AND id=? AND gateway_message_id=? AND direction='outgoing' AND status IN ('sent','delivered','read')`)
            .get(effect.tenant_id, receipt.native_id, receipt.provider_id);
        if (effect.native_kind === 'whatsapp_message') return !!database.prepare(`SELECT 1 FROM messages
            WHERE tenant_id=? AND id=? AND wamid=? AND direction='outgoing' AND status IN ('sent','delivered','read')`)
            .get(effect.tenant_id, receipt.native_id, receipt.provider_id);
        if (effect.native_kind === 'messenger_message') return !!database.prepare(`SELECT 1 FROM fb_messages
            WHERE tenant_id=? AND id=? AND mid=? AND direction='outgoing'`).get(effect.tenant_id, receipt.native_id, receipt.provider_id);
        if (effect.native_kind === 'facebook_publication') return !!database.prepare(`SELECT 1 FROM facebook_content_publications
            WHERE tenant_id=? AND id=? AND collaborative_execution_id=? AND status='published' AND meta_post_id=?`)
            .get(effect.tenant_id, receipt.native_id, effect.execution_id, receipt.provider_id);
        return false;
    };
    return effectConfirmed;
};

// Factory diagnostics only: no handlers, provider calls, default database or
// permission grants. Missing/unmeasured evidence produces no capability row.
export const createOwnerJourneyCapabilityProofs = ({ database, decrypt, nativeAdapters, readDiscovery }) => {
    if (!database || typeof decrypt !== 'function' || !nativeAdapters || typeof readDiscovery !== 'function') {
        throw new TypeError('Owned capability proofs require explicit source evidence readers');
    }
    const effectConfirmed = createNativeEffectConfirmation({ database, decrypt });
    const ownerForms = (command, tenantId) => {
        let count = 0;
        const rows = database.prepare(`SELECT intent.* FROM savana_workspace_intents intent
            JOIN savana_workspace_review_fences review ON review.tenant_id=intent.tenant_id
                AND review.central_actor_id=intent.central_actor_id AND review.organization_id=intent.organization_id
                AND review.idempotency_key=intent.idempotency_key AND review.user_id=intent.user_id
                AND review.native_account_id=intent.native_account_id AND review.input_sha256=intent.input_sha256
                AND review.operation=intent.operation AND review.state='claimed'
            WHERE intent.tenant_id=? AND intent.organization_id=? AND intent.state='completed'
                AND intent.operation IN ('command_create','command_edit') AND intent.claimed_at IS NOT NULL`).all(tenantId, command.scope.organization_id);
        for (const row of rows) try {
            const request = open(decrypt, row, 'workspace_request', row.encrypted_request);
            if (sha(canonicalWorkspaceJson(request, 4_194_304)) !== row.request_sha256) continue;
            const result = validateNativeCommandModel('CommandResponse', open(decrypt, row, 'workspace_result', row.encrypted_result));
            if (result.command_id !== command.command_id || result.version !== command.version
                || result.organization_id !== command.scope.organization_id || result.activity_id !== command.scope.activity_id
                || result.provider_ref !== command.provider_ref || result.capability !== command.capability || result.action !== command.action
                || result.requested_by !== row.central_actor_id || !same(result.payload, command.payload)) continue;
            const body = parse(request.bodyJson);
            if (!same(body.payload, command.payload)) continue;
            if (row.operation === 'command_create' ? request.method !== 'POST' || request.path !== '/v1/integration/workspace/commands'
                || body.capability !== command.capability || body.action !== command.action || body.provider_ref !== command.provider_ref
                || body.activity_id !== command.scope.activity_id
                : request.method !== 'PATCH' || request.path !== `/v1/integration/workspace/commands/${encodeURIComponent(command.command_id)}`
                    || body.expected_version + 1 !== command.version) continue;
            count++;
        } catch { /* A malformed/unbound/undecryptable hint proves no form request. */ }
        return count;
    };
    return { collect: async ({ resultFetchRows } = {}) => {
        if (!Array.isArray(resultFetchRows)) return [];
        const required = ['savana_collaborative_command_receipts', 'savana_collaborative_executions',
            'savana_collaborative_effects', 'savana_native_action_facts', 'savana_native_media_assets',
            'savana_workspace_intents', 'savana_workspace_review_fences'];
        if (required.some(name => !database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))) return [];
        const grouped = new Map();
        const rows = database.prepare(`SELECT receipt.*,execution.state AS execution_state,execution.source_command_id,
            execution.source_command_version,execution.source_fingerprint,execution.capability_code
            FROM savana_collaborative_command_receipts receipt JOIN savana_collaborative_executions execution
                ON execution.id=receipt.execution_id AND execution.tenant_id=receipt.tenant_id`).all();
        for (const row of rows) try {
            const command = validateNativeCommandModel('AdapterCommand', parse(row.command_json));
            const executionContext = validateNativeCommandModel('ExecutionContext', parse(row.context_json));
            if (!codes.has(command.capability) || row.capability_code !== command.capability
                || row.command_id !== command.command_id || row.version !== command.version || row.fingerprint !== command.fingerprint
                || row.source_command_id !== command.command_id || row.source_command_version !== command.version
                || row.source_fingerprint !== command.fingerprint || executionContext.external_tenant_id !== command.external_tenant_id
                || executionContext.actor_id !== command.actor_id || !same(scope(executionContext.scope), scope(command.scope))) continue;
            const adapter = nativeAdapters[`${command.capability}:${command.payload.parameters?.channel}`];
            const context = { ...scope(executionContext.scope), actor_id: executionContext.actor_id, external_tenant_id: executionContext.external_tenant_id };
            for (const key of ['grant_approved_by', 'native_authority_revision', 'capability_grant_revision',
                'authorization_revision', 'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs',
                'authority_domain', 'ownership_epoch', 'namespace_installation_id', 'namespace_epoch', 'namespace_version']) {
                if (executionContext[key] != null) context[key] = executionContext[key];
            }
            const discovery = validateNativeCommandModel('AdapterDiscovery', await readDiscovery({ tenantId: row.tenant_id, command, context }));
            const providers = discovery.providers.filter(provider => provider.organization_id === command.scope.organization_id
                && provider.external_tenant_id === command.external_tenant_id);
            if (discovery.platform !== 'wa_savana' || providers.length !== 1) continue;
            const capabilities = providers[0].capabilities.filter(cap => cap.capability === command.capability && cap.actions.includes(command.action));
            if (capabilities.length !== 1) continue;
            const handler = registered(adapter) && capabilities[0].handler_registered === true;
            const configured = handler && providers[0].actor_access === true && providers[0].subscription_active === true && capabilities[0].configured === true
                && await adapter.configured({ tenantId: row.tenant_id, parameters: command.payload.parameters }) === true;
            const fetches = new Map();
            for (const observed of resultFetchRows) try {
                if (!['string','number'].includes(typeof observed.id) || observed.status !== 200 || fetches.has(String(observed.id))) continue;
                const result = validateNativeCommandModel('NativeResult', observed.result);
                if (result.command_id !== command.command_id || result.version !== command.version || result.fingerprint !== command.fingerprint
                    || result.provider_ref !== command.provider_ref || !same(scope(result.scope), scope(command.scope))) continue;
                const bytes = result.format === 'csv' ? result.text : nativeCommandJson(result.data);
                if (typeof bytes !== 'string' || sha(bytes) !== result.content_sha256) continue;
                fetches.set(String(observed.id), result);
            } catch { /* A generic HTTP success or wrong tuple proves no result fetch. */ }
            const effects = database.prepare('SELECT *,? AS tenant_id FROM savana_collaborative_effects WHERE execution_id=?')
                .all(row.tenant_id, row.execution_id);
            const expected = command.capability === 'campaigns.execute' ? command.payload.parameters.recipients?.length : 1;
            const receipt = row.receipt_json ? validateNativeCommandModel('AdapterReceipt', parse(row.receipt_json)) : null;
            const confirmed = row.state === 'applied' && row.execution_state === 'completed' && receipt?.outcome === 'applied'
                && receipt.command_id === command.command_id && receipt.version === command.version && receipt.fingerprint === command.fingerprint
                && receipt.source_result?.local_entity_id && effects.length === expected && effects.every(effect => effectConfirmed(command, effect))
                && (!reads.has(command.action) || [...fetches.values()].some(result => result.format === 'json'
                    ? Array.isArray(result.data?.records) && result.data.records.some(record => record && Object.keys(record).length > 0)
                    : result.text?.includes('\r\n')));
            const key = `${command.capability}:${command.action}`;
            const proof = grouped.get(key) || { capability_code: command.capability, operation: command.action, service: 'wa_savana',
                handler_registered: handler, configured, owner_form_requests: 0, confirmed_native_results: 0, result_fetches: 0 };
            proof.handler_registered &&= handler; proof.configured &&= configured;
            proof.owner_form_requests += ownerForms(command, row.tenant_id);
            proof.confirmed_native_results += confirmed ? 1 : 0; proof.result_fetches += fetches.size;
            grouped.set(key, proof);
        } catch { /* Unknown source/configuration/schema state is omitted, never a fabricated zero. */ }
        return [...grouped.values()].sort((a, b) => `${a.capability_code}:${a.operation}`.localeCompare(`${b.capability_code}:${b.operation}`));
    } };
};

// Observe the real native reconciliation response, not an owner click or a
// workspace mutation ACK. This table belongs only to the isolated factory.
export const createOwnerJourneyReconciliationEvidence = ({ database, runId, encrypt, decrypt, protocol }) => {
    if (!database?.prepare || !/^[A-Za-z0-9_-]{1,200}$/.test(runId || '')
        || typeof encrypt !== 'function' || typeof decrypt !== 'function'
        || typeof protocol?.token !== 'string' || !protocol.token || typeof protocol.pathPrefix !== 'string') {
        throw new TypeError('Owned reconciliation evidence requires explicit native protocol and state');
    }
    database.exec(`CREATE TABLE IF NOT EXISTS owner_journey_native_reconciliations(
        evidence_key TEXT PRIMARY KEY,run_id TEXT NOT NULL,encrypted_evidence TEXT NOT NULL,observed_at TEXT NOT NULL);`);
    const effectConfirmed = createNativeEffectConfirmation({ database, decrypt });
    const required = ['savana_collaborative_command_receipts', 'savana_collaborative_executions',
        'savana_collaborative_effects', 'owner_journey_provider_faults', 'savana_collaborative_nonces'];
    const ready = () => required.every(name => database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const equalSecret = (left, right) => typeof left === 'string' && typeof right === 'string'
        && Buffer.byteLength(left) === Buffer.byteLength(right)
        && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
    const mac = parts => `v1=${crypto.createHmac('sha256', protocol.token).update(parts.join('\n')).digest('hex')}`;
    const evidenceKey = command => sha(nativeCommandJson([runId, command.command_id, command.version, command.fingerprint, command.attempt_id]));
    const effectIdentity = effect => ({ id: effect.id, effect_key: effect.effect_key, native_kind: effect.native_kind,
        native_idempotency_sha256: sha(effect.native_idempotency_key) });
    const snapshot = command => {
        if (!ready() || !['messaging.send', 'campaigns.execute'].includes(command.capability)) return null;
        const row = database.prepare(`SELECT receipt.*,execution.state AS execution_state,execution.source_command_id,
            execution.source_command_version,execution.source_fingerprint,execution.capability_code
            FROM savana_collaborative_command_receipts receipt JOIN savana_collaborative_executions execution
                ON execution.id=receipt.execution_id AND execution.tenant_id=receipt.tenant_id
            WHERE receipt.command_id=? AND receipt.version=?`).get(command.command_id, command.version);
        if (!row || row.command_json !== nativeCommandJson(command) || row.attempt_id !== command.attempt_id
            || row.fingerprint !== command.fingerprint || row.source_command_id !== command.command_id
            || row.source_command_version !== command.version || row.source_fingerprint !== command.fingerprint
            || row.capability_code !== command.capability) return null;
        const context = validateNativeCommandModel('ExecutionContext', parse(row.context_json));
        if (context.actor_id !== command.actor_id || context.external_tenant_id !== command.external_tenant_id
            || context.provider_platform !== 'wa_savana' || context.provider_ref !== command.provider_ref
            || context.provider_installation_id !== command.provider_installation_id
            || context.authorization_revision !== command.authorization_revision
            || !same(scope(context.scope), scope(command.scope))) return null;
        const effects = database.prepare('SELECT *,? AS tenant_id FROM savana_collaborative_effects WHERE execution_id=? ORDER BY id')
            .all(row.tenant_id, row.execution_id);
        for (const key of ['id', 'effect_key', 'native_idempotency_key']) {
            if (new Set(effects.map(effect => effect[key])).size !== effects.length) return null;
        }
        return { row, effects, identity: effects.map(effectIdentity) };
    };
    const faultEffects = state => {
        const faults = new Set(database.prepare("SELECT effect_sha256 FROM owner_journey_provider_faults WHERE run_id=? AND state='applied' AND receipt_sha256 IS NOT NULL AND applied_at IS NOT NULL")
            .all(runId).map(row => row.effect_sha256));
        return state.effects.filter(effect => faults.has(sha(effect.id)));
    };
    const providerConfirmed = (command, effect) => {
        const receipt = parse(effect.receipt_json);
        if (['whatsapp_message', 'messenger_message'].includes(effect.native_kind)) {
            const correlation = database.prepare('SELECT channel,tenant_id,account_ref FROM savana_collaborative_correlations WHERE effect_id=?').get(effect.id);
            const expectedChannel = effect.native_kind === 'whatsapp_message' ? 'whatsapp' : 'messenger';
            return correlation?.channel === expectedChannel && correlation.tenant_id === effect.tenant_id
                && correlation.account_ref === command.payload.parameters.account_ref
                && !!database.prepare(`SELECT 1 FROM savana_collaborative_provider_evidence WHERE effect_id=? AND provider_id=?
                    AND provider_status IN ('sent','delivered','read') AND length(webhook_sha256)=64`).get(effect.id, receipt.provider_id);
        }
        if (effect.native_kind === 'sms_message' && receipt.evidence_kind === 'native_gateway_history') {
            const message = database.prepare('SELECT * FROM sms_messages WHERE tenant_id=? AND id=? AND gateway_message_id=?')
                .get(effect.tenant_id, effect.native_id, receipt.provider_id);
            const request = database.prepare('SELECT * FROM sms_api_requests WHERE tenant_id=? AND idempotency_key=?')
                .get(effect.tenant_id, effect.native_idempotency_key);
            return message && request && message.sms_account_id === request.sms_account_id
                && String(message.external_id || '') === effect.native_idempotency_key
                && request.request_hash === smsApiRequestHash({ smsAccountSelector: request.sms_account_id,
                    recipient: message.recipient, message: message.content ?? message.message });
        }
        return false;
    };
    const proven = (command, before, receipt, after) => {
        if (!after || before.receipt_state !== 'unknown' || before.execution_state !== 'unknown'
            || before.execution_id !== after.row.execution_id || before.tenant_id !== after.row.tenant_id
            || after.row.state !== 'applied' || after.row.execution_state !== 'completed'
            || !same(before.effects, after.identity) || !after.effects.length
            || receipt.outcome !== 'applied' || receipt.command_id !== command.command_id || receipt.version !== command.version
            || receipt.fingerprint !== command.fingerprint || !same(receipt, parse(after.row.receipt_json))) return false;
        const affected = faultEffects(after);
        return affected.length > 0 && Array.isArray(before.fault_effects) && before.fault_effects.length === affected.length
            && new Set(before.fault_effects).size === affected.length
            && affected.every(effect => effectConfirmed(command, effect) && providerConfirmed(command, effect))
            && before.fault_effects.every(hash => affected.some(effect => sha(effect.id) === hash));
    };
    const middleware = (req, res, next) => {
        let command, before, request;
        try {
            const path = /^\/commands\/([^/]+)\/reconcile$/.exec(req.path);
            const raw = req.rawBody;
            if (req.method !== 'POST' || !path || !Buffer.isBuffer(raw) || raw.length > 1_048_576) return next();
            const { context: _context, ...body } = parse(raw.toString('utf8'));
            command = validateNativeCommandModel('AdapterCommand', body);
            if (decodeURIComponent(path[1]) !== command.command_id) return next();
            const timestamp = req.headers['x-savana-command-timestamp'], nonce = req.headers['x-savana-command-nonce'];
            const publicPath = protocol.pathPrefix + req.originalUrl;
            if (!/^[0-9]{10,12}$/.test(timestamp || '') || !/^[a-f0-9]{32}$/.test(nonce || '')
                || !equalSecret(req.headers['x-savana-callback-token'], protocol.token)
                || !equalSecret(req.headers['x-savana-command-signature'], mac(['savana-command-request-v1', 'POST', publicPath, timestamp, nonce, sha(raw)]))) return next();
            const state = snapshot(command);
            if (!state || state.row.state !== 'unknown' || state.row.execution_state !== 'unknown') return next();
            const affected = faultEffects(state);
            if (!affected.length) return next();
            before = { receipt_state: state.row.state, execution_state: state.row.execution_state,
                execution_id: state.row.execution_id, tenant_id: state.row.tenant_id, effects: state.identity,
                fault_effects: affected.map(effect => sha(effect.id)) };
            request = { path: publicPath, nonce, body_sha256: sha(raw) };
        } catch { return next(); }
        let returned;
        const send = res.send;
        res.send = function (body) {
            if (typeof body === 'string' || Buffer.isBuffer(body)) {
                const bytes = Buffer.from(body);
                if (bytes.length <= 1_048_576) returned = bytes;
            }
            return send.call(this, body);
        };
        res.once('finish', () => {
            try {
                if (res.statusCode !== 200 || !returned || res.get('X-Savana-Command-Nonce') !== request.nonce) return;
                const timestamp = res.get('X-Savana-Command-Timestamp');
                if (!/^[0-9]{10,12}$/.test(timestamp || '') || !equalSecret(res.get('X-Savana-Command-Signature'),
                    mac(['savana-command-response-v1', 'POST', request.path, timestamp, request.nonce, request.body_sha256, '200', sha(returned)]))) return;
                if (database.prepare('SELECT request_sha256 FROM savana_collaborative_nonces WHERE nonce=?').get(request.nonce)?.request_sha256 !== request.body_sha256) return;
                const receipt = validateNativeCommandModel('AdapterReceipt', parse(returned.toString('utf8')));
                if (!proven(command, before, receipt, snapshot(command))) return;
                const key = evidenceKey(command);
                const evidence = nativeCommandJson({ key, run_id: runId, command, before, receipt });
                const encrypted = encrypt(evidence);
                if (typeof encrypted !== 'string' || encrypted === evidence || decrypt(encrypted) !== evidence) return;
                database.prepare('INSERT OR IGNORE INTO owner_journey_native_reconciliations VALUES(?,?,?,?)')
                    .run(key, runId, encrypted, new Date().toISOString());
            } catch { /* An incomplete/unbound response is not a reconciliation observation. */ }
        });
        next();
    };
    return { middleware, count: () => {
        if (!ready()) return 0;
        let count = 0;
        for (const row of database.prepare('SELECT * FROM owner_journey_native_reconciliations WHERE run_id=?').all(runId)) try {
            const evidence = parse(decrypt(row.encrypted_evidence));
            const command = validateNativeCommandModel('AdapterCommand', evidence.command);
            const receipt = validateNativeCommandModel('AdapterReceipt', evidence.receipt);
            if (evidence.run_id === runId && evidence.key === row.evidence_key && evidenceKey(command) === row.evidence_key
                && proven(command, evidence.before, receipt, snapshot(command))) count++;
        } catch { /* Malformed private evidence cannot raise the measured count. */ }
        return count;
    } };
};
