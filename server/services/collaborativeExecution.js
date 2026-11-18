import crypto from 'node:crypto';
import { assertEgressAvailable } from '../runtime/egressMaintenance.js';
import { nativeCommandJson } from './nativeCommandProtocol.js';
import { validateNativeCommandModel, assertEffectAuthorizationForCommand, assertNativeParameterContract } from './nativeCommandModels.js';

export const COLLABORATIVE_CAPABILITIES = Object.freeze([
    { capability_id: 'wa_savana.notifications.send', capability_code: 'messaging.send', review_capability_code: 'messaging.review', request_kind: 'notification_request' },
    { capability_id: 'wa_savana.campaigns.send', capability_code: 'campaigns.execute', review_capability_code: 'campaigns.review', request_kind: 'campaign_request' },
    { capability_id: 'wa_savana.content.publish', capability_code: 'content.publish', review_capability_code: 'content.review', request_kind: 'content_publication' },
    { capability_id: 'wa_savana.customers.manage', capability_code: 'customers.manage', review_capability_code: 'customers.manage', request_kind: 'native_customer_action' },
    { capability_id: 'wa_savana.measurement.read', capability_code: 'measurement.read', review_capability_code: 'measurement.read', request_kind: 'native_measurement' },
    { capability_id: 'wa_savana.measurement.export', capability_code: 'measurement.export', review_capability_code: 'measurement.export', request_kind: 'native_measurement' },
    { capability_id: 'wa_savana.owner.operations', capability_code: 'owner.operations', review_capability_code: 'owner.operations', request_kind: 'native_operation_snapshot' },
    { capability_id: 'wa_savana.media.manage', capability_code: 'media.manage', review_capability_code: 'media.manage', request_kind: 'native_media_action' },
    { capability_id: 'wa_savana.messaging.review', capability_code: 'messaging.review', review_capability_code: 'messaging.review', request_kind: 'native_review_draft' },
    { capability_id: 'wa_savana.campaigns.review', capability_code: 'campaigns.review', review_capability_code: 'campaigns.review', request_kind: 'native_review_draft' },
    { capability_id: 'wa_savana.content.review', capability_code: 'content.review', review_capability_code: 'content.review', request_kind: 'native_review_draft' },
]);
const hash = value => crypto.createHash('sha256').update(nativeCommandJson(value)).digest('hex');
const parse = value => value ? JSON.parse(value) : null;
const same = (a, b) => nativeCommandJson(a) === nativeCommandJson(b);
const scope = value => ({ organization_id: value.organization_id, activity_id: value.activity_id,
    branch_id: value.branch_id ?? null, warehouse_id: value.warehouse_id ?? null });
const family = code => code === 'content.publish' ? 'publication' : ['messaging.send', 'campaigns.execute'].includes(code) ? 'communication' : code;
const overlaps = (left, right) => {
    if (!left || !right || left.channel !== right.channel || left.nativeAccountRef !== right.nativeAccountRef) return false;
    if (left.contentRef && right.contentRef && left.recipients?.length === 0 && right.recipients?.length === 0) return left.contentRef === right.contentRef;
    return (left.recipients || []).some(a => (right.recipients || []).some(b =>
        a.deliveryFingerprint && b.deliveryFingerprint ? a.deliveryFingerprint === b.deliveryFingerprint : a.ref === b.ref));
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const publicValue = value => {
    if (Array.isArray(value)) return value.every(publicValue);
    if (plain(value)) return Object.entries(value).every(([key, item]) =>
        !/(?:password|secret|access.?token|authorization|api.?key|cookie)/i.test(key) && publicValue(item));
    return value === null || ['string', 'boolean'].includes(typeof value)
        || (typeof value === 'number' && Number.isFinite(value));
};
export class CollaborativeExecutionError extends Error {
    constructor(code, status = 409) { super(code); this.name = 'CollaborativeExecutionError'; this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new CollaborativeExecutionError(code, status); };

// Core owns command approval. This ledger owns actual native effects and never
// turns transport ambiguity into permission to repeat a business mutation.
export class CollaborativeExecutionService {
    constructor({ database, nativeAdapters, verifyNativeContext, authorizeEffect, now = () => Date.now() }) {
        if (!database || !nativeAdapters || typeof verifyNativeContext !== 'function'
            || typeof authorizeEffect !== 'function') throw new TypeError('Native command execution requires verified binding and actual effect authorization');
        this.db = database; this.adapters = nativeAdapters; this.verifyContext = verifyNativeContext;
        this.authorizeEffect = authorizeEffect; this.now = now;
        this.activeExecutions = new Set();
    }
    getRegistry() {
        return COLLABORATIVE_CAPABILITIES.map(capability => ({ ...capability,
            canonical_capability_id: capability.capability_code, review_capability_id: capability.review_capability_code,
            channels: Object.entries(this.adapters).filter(([key, adapter]) =>
                key.startsWith(`${capability.capability_code}:`) && this.registered(adapter))
                .map(([key]) => key.slice(capability.capability_code.length + 1)) }));
    }
    registered(adapter) {
        return adapter?.qualified === true && ['validate', 'prepare', 'execute', 'reconcile', 'configured']
            .every(name => typeof adapter[name] === 'function');
    }
    adapter(capability, parameters) {
        const adapter = this.adapters[`${capability}:${parameters?.channel}`];
        if (!this.registered(adapter)) fail('collaborative_channel_unavailable', 422);
        return adapter;
    }
    async binding(command, context, action, resourceSelection = null) {
        const bound = await this.verifyContext({ command, context, action, resourceSelection });
        if (!bound || bound.verified !== true || bound.localPolicyVerified !== true
            || !Number.isSafeInteger(Number(bound.nativeTenantId)) || Number(bound.nativeTenantId) < 1) fail('native_command_binding_unverified', 403);
        if (action !== 'execute') {
            if (!bound.viewer || typeof bound.viewer.actorId !== 'string' || !bound.viewer.actorId
                || !Number.isFinite(Date.parse(bound.viewer.validUntil)) || Date.parse(bound.viewer.validUntil) <= this.now()
                || !same(scope(bound.viewer.scope || {}), scope(command.scope))) fail('native_command_binding_changed', 403);
            return { ...bound, nativeTenantId: Number(bound.nativeTenantId) };
        }
        const verified = assertNativeParameterContract(validateNativeCommandModel('ExecutionContext', bound.executionContext));
        if (Date.parse(verified.valid_until) <= this.now() || verified.provider_platform !== 'wa_savana'
            || !same(scope(verified.scope), scope(command.scope))
            || ['provider_ref', 'provider_installation_id', 'external_tenant_id', 'ownership_epoch','authority_domain']
                .some(key => ['ownership_epoch','authority_domain'].includes(key) ? (verified[key] ?? null) !== (command[key] ?? null) : verified[key] !== command[key])
            || verified.actor_id !== command.actor_id
            || verified.authorization_revision !== command.authorization_revision) fail('native_command_binding_changed', 403);
        return { ...bound, nativeTenantId: Number(bound.nativeTenantId), executionContext: verified };
    }
    row(command) {
        return this.db.prepare('SELECT * FROM savana_collaborative_command_receipts WHERE command_id = ? AND version = ?')
            .get(command.command_id, command.version);
    }
    assertIdentity(command, row) {
        if (!row || row.fingerprint !== command.fingerprint || row.command_json !== nativeCommandJson(command)) {
            fail('native_command_identity_conflict');
        }
    }
    execution(row) { return this.db.prepare('SELECT * FROM savana_collaborative_executions WHERE id = ?').get(row.execution_id); }
    receipt(command, outcome, sourceResult = null, reason = null, extra = {}) {
        return validateNativeCommandModel('AdapterReceipt', { spec_version: '1.0', command_id: command.command_id,
            version: command.version, fingerprint: command.fingerprint, outcome, source_result: sourceResult, reason_code: reason, ...extra });
    }
    receiptForRow(row, command) {
        this.assertIdentity(command, row);
        return parse(row.receipt_json) || this.receipt(command, row.state === 'executing' ? 'unknown' : row.state,
            null, row.state === 'executing' ? 'native_execution_inflight' : 'native_outcome_unresolved');
    }
    async validate(input, viewerContext) {
        const { capability, action, payload } = input || {};
        const adapter = this.adapter(capability, payload?.parameters);
        const command = { capability, action, payload };
        // Preview authority is resolved from the authenticated viewer, never
        // manufactured from the unapproved proposal's actor/scope fields.
        const bound = await this.verifyContext({ command, context: viewerContext, action: 'validate' });
        if (!bound?.verified || !bound.localPolicyVerified || !Number.isSafeInteger(Number(bound.nativeTenantId))
            || !bound.viewer?.scope || typeof bound.viewer.actorId !== 'string'
            || !Number.isFinite(Date.parse(bound.viewer.validUntil))
            || Date.parse(bound.viewer.validUntil) <= this.now()) fail('native_command_binding_unverified', 403);
        const normalized = adapter.validate(payload, action);
        const prepared = await adapter.prepare({ tenantId: Number(bound.nativeTenantId),
            scope: bound.viewer.scope, parameters: normalized.parameters, command, authority: bound, preview: true });
        if (await adapter.configured({ tenantId: Number(bound.nativeTenantId), parameters: normalized.parameters }) !== true) fail('native_provider_configuration_required', 422);
        return validateNativeCommandModel('AdapterValidation', { spec_version: '1.0', capability, action, valid: true,
            normalized_payload: { ...normalized, parameters: prepared.parameters }, validation_revision: prepared.resourceFingerprint,
            valid_until: new Date(Math.min(this.now() + 30000, Date.parse(bound.viewer.validUntil))).toISOString(),
            allowed_fields: Object.keys(prepared.parameters).filter(field=>field!=='resource_fingerprint'), errors: [],
            action_label: ({'messaging.send':'إرسال رسالة','campaigns.execute':'تنفيذ حملة','content.publish':'نشر محتوى',
                'messaging.review':'حفظ طلب مراجعة للرسالة','campaigns.review':'حفظ طلب مراجعة للحملة','content.review':'حفظ طلب مراجعة للمحتوى',
                'customers.manage':'إدارة جهة اتصال','measurement.read':'عرض نشاط الرسائل','measurement.export':'تصدير نشاط الرسائل','owner.operations':'عرض نتيجة عملية أصلية','media.manage':'إدارة ملف القناة'})[capability]||'مراجعة العملية الأصلية',
            summary: [{ label: 'الحساب', value: prepared.account?.label || 'الحساب المحدد' },
                ...(prepared.selections || []).map(selected => ({ label: 'المستلم', value: selected.label })),
                ...(prepared.template ? [{ label: 'القالب', value: prepared.template.name }] : []),
                ...(prepared.content ? [{ label: 'المحتوى', value: prepared.content.title }] : [])] });
    }
    claim(command, bound, prepared) {
        return this.db.transaction(() => {
            const existing = this.row(command);
            if (existing) { this.assertIdentity(command, existing); return { row: existing, claimed: false }; }
            if (this.db.prepare(`SELECT 1 FROM savana_collaborative_command_receipts WHERE command_id = ?
                AND state IN ('executing', 'pending', 'unknown', 'applied') LIMIT 1`).get(command.command_id)) {
                fail('native_command_previous_effect_unresolved');
            }
            const prior = this.db.prepare(`SELECT id,state,capability_code,resources_json FROM savana_collaborative_executions
                WHERE tenant_id=? AND source_command_id IS NOT NULL AND state IN ('executing','unknown')`).all(bound.nativeTenantId);
            const blockedReason = prior.some(old => family(old.capability_code) === family(command.capability) && old.state === 'unknown')
                ? 'native_previous_outcome_unresolved' : prior.some(old => family(old.capability_code) === family(command.capability)
                    && overlaps(parse(old.resources_json), prepared.resourceSelection)) ? 'native_resource_execution_inflight' : null;
            const id = crypto.randomUUID(); const at = new Date(this.now()).toISOString();
            this.db.prepare(`INSERT INTO savana_collaborative_executions
                (id,tenant_id,source_command_id,source_command_version,source_fingerprint,capability_code,request_hash,
                 selection_hash,selection_json,resources_json,authorization_json,principal_json,state,idempotency_key,execution_hash,
                 started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'executing',?,?,?,?,?)`)
                .run(id, bound.nativeTenantId, command.command_id, command.version, command.fingerprint, command.capability,
                    hash(command), prepared.resourceFingerprint, nativeCommandJson(prepared.parameters), nativeCommandJson(prepared.resourceSelection),
                    nativeCommandJson(bound.executionContext), nativeCommandJson({ actor_id: bound.executionContext.actor_id }),
                    `command:${command.command_id}:${command.version}`, hash(command), at, at, at);
            this.db.prepare(`INSERT INTO savana_collaborative_command_receipts
                (command_id,version,fingerprint,attempt_id,tenant_id,execution_id,command_json,context_json,state,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,'executing',?,?)`).run(command.command_id, command.version, command.fingerprint,
                    command.attempt_id, bound.nativeTenantId, id, nativeCommandJson(command), nativeCommandJson(bound.executionContext), at, at);
            return { row: this.row(command), claimed: true, blockedReason };
        }).immediate();
    }
    async beforeEffect(command, context, row, adapter, prepared) {
        if (command.validation_revision !== prepared.resourceFingerprint
            || Date.parse(command.validation_valid_until) <= this.now()) fail('native_validation_review_expired');
        const fresh = await this.binding(command, context, 'execute', prepared.resourceSelection);
        if (fresh.nativeTenantId !== row.tenant_id) fail('native_command_binding_changed', 403);
        const current = await adapter.prepare({ tenantId: row.tenant_id, scope: command.scope,
            parameters: prepared.parameters, command, authority: fresh, preview: false });
        if (current.resourceFingerprint !== prepared.resourceFingerprint) fail('native_command_resources_changed');
        const authorization = await this.authorizeEffect(command);
        const last = await this.binding(command, context, 'execute', current.resourceSelection);
        assertEffectAuthorizationForCommand(command, last.executionContext, authorization, { now: this.now() });
        if (last.nativeTenantId !== row.tenant_id) fail('native_command_binding_changed', 403);
        const refreshed = await adapter.prepare({ tenantId: row.tenant_id, scope: command.scope,
            parameters: prepared.parameters, command, authority: last, preview: false });
        if (refreshed.resourceFingerprint !== prepared.resourceFingerprint) fail('native_command_resources_changed');
        assertEffectAuthorizationForCommand(command, last.executionContext, authorization, { now: this.now() });
        assertEgressAvailable();
        return { prepared: refreshed, validUntil: Math.min(Date.parse(authorization.valid_until), Date.parse(last.executionContext.valid_until)) };
    }
    async effect(command, context, row, adapter, prepared, { key, kind, run }) {
        if (typeof key !== 'string' || !key || key.length > 255 || typeof kind !== 'string' || typeof run !== 'function') fail('native_effect_contract_invalid', 500);
        const old = this.db.prepare('SELECT * FROM savana_collaborative_effects WHERE execution_id = ? AND effect_key = ?')
            .get(row.execution_id, key);
        if (old) {
            if (old.state === 'accepted' || old.state === 'rejected') return parse(old.receipt_json);
            fail('native_effect_outcome_unresolved');
        }
        const checkpoint = await this.beforeEffect(command, context, row, adapter, prepared);
        const id = crypto.randomUUID(); const at = new Date(this.now()).toISOString();
        const nativeKey = `collaborative:${row.execution_id}:${hash(key).slice(0, 24)}`;
        this.db.transaction(() => {
            const current = this.row(command); this.assertIdentity(command, current);
            if (current.state !== 'executing') fail('native_execution_not_active');
            this.db.prepare(`INSERT INTO savana_collaborative_effects (id,execution_id,effect_key,native_kind,
                native_idempotency_key,state,started_at,created_at,updated_at) VALUES (?,?,?,?,?,'dispatching',?,?,?)`)
                .run(id, row.execution_id, key, kind, nativeKey, at, at, at);
        }).immediate();
        let result;
        try {
            result = await run({ effectId: id, idempotencyKey: nativeKey, assertEffectLease: () => {
                if (checkpoint.validUntil <= this.now()) {
                    const error = new CollaborativeExecutionError('native_effect_authorization_expired', 403);
                    error.dispatched = false;
                    throw error;
                }
                return true;
            } });
            if (!plain(result) || !publicValue(result) || typeof result.accepted !== 'boolean'
                || (result.accepted && (typeof result.native_id !== 'string' || !result.native_id))) {
                const error = new Error('Native receipt unavailable'); error.deliveryUncertain = true; throw error;
            }
            this.db.prepare(`UPDATE savana_collaborative_effects SET state = ?,native_id = ?,billing_usage_id = ?,
                receipt_json = ?,finished_at = ?,updated_at = ? WHERE id = ? AND state = 'dispatching'`).run(
                    result.accepted ? 'accepted' : 'rejected', result.native_id || null, result.billing_usage_id || null,
                    nativeCommandJson(result), new Date(this.now()).toISOString(), new Date(this.now()).toISOString(), id);
            return result;
        } catch (error) {
            const recovered = this.db.prepare('SELECT state,receipt_json FROM savana_collaborative_effects WHERE id=?').get(id);
            if (recovered?.state === 'accepted' && recovered.receipt_json) return parse(recovered.receipt_json);
            const definitive = error?.dispatched === false || (error?.confirmedFailure === true && !error?.deliveryUncertain);
            const state = definitive ? 'rejected' : 'unknown';
            const rejection = { native_kind: kind, native_id: '', accepted: false,
                reason_code: definitive ? 'native_effect_rejected' : 'native_effect_outcome_unknown' };
            this.db.prepare(`UPDATE savana_collaborative_effects SET state = ?,receipt_json = ?,error_code = ?,
                finished_at = ?,updated_at = ? WHERE id = ?`).run(state, nativeCommandJson(rejection),
                    rejection.reason_code, new Date(this.now()).toISOString(), new Date(this.now()).toISOString(), id);
            if (definitive) return rejection;
            const uncertain = new CollaborativeExecutionError('native_effect_outcome_unknown'); uncertain.deliveryUncertain = true; throw uncertain;
        }
    }
    finish(command, row, result = null, forcedUnknown = false, noEffectReason = null) {
        return this.db.transaction(() => {
            const persisted = this.row(command);
            if (persisted?.receipt_json && ['applied','not_applied','rejected','conflict'].includes(persisted.state)) return parse(persisted.receipt_json);
            const effects = this.db.prepare('SELECT * FROM savana_collaborative_effects WHERE execution_id = ? ORDER BY created_at,id').all(row.execution_id);
            const uncertain = forcedUnknown || effects.some(effect => ['dispatching', 'unknown'].includes(effect.state));
            const accepted = effects.filter(effect => effect.state === 'accepted');
            const outcome = uncertain ? 'unknown' : accepted.length ? 'applied' : 'not_applied';
            const sourceRevision = result?.source_revision ?? parse(accepted[0]?.receipt_json)?.source_revision;
            const sourceResult = accepted.length ? { local_entity_id: result?.local_entity_id || accepted[0].native_id,
                source_revision: Number.isSafeInteger(sourceRevision) && sourceRevision >= 0 ? sourceRevision : null,
                result_reference: `/savana/command-adapter/v1/commands/${encodeURIComponent(command.command_id)}/result` } : null;
            const at = new Date(this.now()).toISOString();
            const reason = uncertain ? 'native_outcome_unresolved' : accepted.length ? null : noEffectReason || 'native_effect_not_applied';
            const execution = this.execution(row);
            const parameters = parse(execution.selection_json);
            const total = command.capability === 'campaigns.execute' ? parameters.recipients.length : 1;
            const unknown = effects.filter(effect => ['dispatching','unknown'].includes(effect.state)).length;
            const failed = effects.filter(effect => effect.state === 'rejected').length + Math.max(0, total-effects.length);
            const receipt = this.receipt(command, outcome, sourceResult, reason, {
                ...(command.capability === 'campaigns.execute' ? { progress: {total,completed:accepted.length,failed,pending:0,unknown} } : {}),
                ...(outcome === 'not_applied' ? { no_effect_proof: { record_ref: row.execution_id, checked_at: at,
                    reason_code: reason, execution_fenced: true } } : {}),
            });
            const details = { command_id: command.command_id, capability: command.capability, outcome,
                native_entity: result?.local_entity_id || null,
                effects: effects.map(effect => ({ key: effect.effect_key, state: effect.state, receipt: parse(effect.receipt_json) })) };
            this.db.prepare(`UPDATE savana_collaborative_executions SET state = ?,result_json = ?,finished_at = ?,updated_at = ? WHERE id = ?`)
                .run(uncertain ? 'unknown' : accepted.length ? 'completed' : 'failed', nativeCommandJson(details), at, at, row.execution_id);
            this.db.prepare(`UPDATE savana_collaborative_command_receipts SET state = ?,receipt_json = ?,updated_at = ?
                WHERE command_id = ? AND version = ?`).run(outcome, nativeCommandJson(receipt), at, command.command_id, command.version);
            return receipt;
        }).immediate();
    }
    async execute(command, viewerContext) {
        validateNativeCommandModel('AdapterCommand', command);
        assertNativeParameterContract(command);
        const bound = await this.binding(command, viewerContext, 'execute');
        const existing = this.row(command);
        if (existing) { if (existing.tenant_id !== bound.nativeTenantId) fail('native_command_binding_changed', 403); return this.receiptForRow(existing, command); }
        const adapter = this.adapter(command.capability, command.payload.parameters);
        const payload = adapter.validate(command.payload, command.action);
        if (await adapter.configured({ tenantId: bound.nativeTenantId, parameters: payload.parameters }) !== true) fail('native_provider_configuration_required', 422);
        const prepared = await adapter.prepare({ tenantId: bound.nativeTenantId, scope: command.scope,
            parameters: payload.parameters, command, authority: bound, preview: false });
        if (!publicValue(prepared.parameters) || !/^[a-f0-9]{64}$/.test(prepared.resourceFingerprint || '')) fail('native_adapter_prepare_invalid', 500);
        if (command.validation_revision !== prepared.resourceFingerprint
            || Date.parse(command.validation_valid_until) <= this.now()) fail('native_validation_review_expired');
        const claimed = this.claim(command, bound, prepared);
        if (!claimed.claimed) return this.receiptForRow(claimed.row, command);
        if (claimed.blockedReason) return this.finish(command, claimed.row, null, false, claimed.blockedReason);
        this.activeExecutions.add(claimed.row.execution_id);
        try {
            const result = await adapter.execute({ command, tenantId: bound.nativeTenantId, scope: command.scope,
                executionId: claimed.row.execution_id, prepared,
                effect: spec => this.effect(command, viewerContext, claimed.row, adapter, prepared, spec) });
            return this.finish(command, claimed.row, result);
        } catch (error) {
            const effects = this.db.prepare(`SELECT state FROM savana_collaborative_effects WHERE execution_id = ?`).all(claimed.row.execution_id);
            const unknown = effects.some(effect => ['dispatching', 'unknown'].includes(effect.state)) || error?.deliveryUncertain === true;
            return this.finish(command, claimed.row, null, unknown);
        } finally { this.activeExecutions.delete(claimed.row.execution_id); }
    }
    async reconcile(command, viewerContext) {
        validateNativeCommandModel('AdapterCommand', command);
        const bound = await this.binding(command, viewerContext, 'reconcile'); const row = this.row(command);
        if (!row || row.tenant_id !== bound.nativeTenantId) fail('native_command_not_found', 404);
        this.assertIdentity(command, row);
        if (this.activeExecutions.has(row.execution_id)) return this.receipt(command, 'unknown', null, 'native_execution_inflight');
        if (row.state === 'executing' && Date.parse(command.validation_valid_until) > this.now()) {
            return this.receipt(command, 'unknown', null, 'native_execution_inflight');
        }
        if (!['unknown', 'executing', 'pending'].includes(row.state)) return this.receiptForRow(row, command);
        const adapter = this.adapter(command.capability, command.payload.parameters);
        const effects = this.db.prepare(`SELECT * FROM savana_collaborative_effects WHERE execution_id = ? AND state IN ('dispatching','unknown')`).all(row.execution_id);
        for (const effect of effects) {
            // Reconciliation is status-only. A new send/apply callable is never exposed.
            const evidence = await adapter.reconcile({ tenantId: row.tenant_id, command, effect: { ...effect, receipt: parse(effect.receipt_json) } });
            if (evidence?.definitive === true && ['accepted', 'rejected'].includes(evidence.state)
                && publicValue(evidence.receipt) && typeof evidence.receipt?.accepted === 'boolean'
                && (evidence.state !== 'accepted' || (evidence.receipt.accepted && evidence.receipt.native_id))) {
                this.db.prepare(`UPDATE savana_collaborative_effects SET state = ?,native_id = ?,receipt_json = ?,updated_at = ? WHERE id = ? AND state IN ('unknown','dispatching')`)
                    .run(evidence.state, evidence.receipt.native_id || null, nativeCommandJson(evidence.receipt), new Date(this.now()).toISOString(), effect.id);
            }
        }
        // After the original reviewed deadline, terminal local state fences any
        // late worker before it can insert another dispatch claim. Existing
        // dispatch/unknown rows still require actual provider evidence.
        return this.finish(command, row, null, false,
            row.state === 'executing' ? 'native_review_expired_without_effect' : null);
    }
    async result(commandId, viewerContext, { format = 'json', version = null, fingerprint = null, providerRef = null } = {}) {
        if (!['json', 'csv'].includes(format)) fail('native_result_format_invalid', 422);
        if (version != null && (!/^[1-9][0-9]*$/.test(String(version)) || !Number.isSafeInteger(Number(version)))) fail('native_result_version_invalid', 422);
        const row = version == null
            ? this.db.prepare('SELECT * FROM savana_collaborative_command_receipts WHERE command_id = ? ORDER BY version DESC LIMIT 1').get(commandId)
            : this.db.prepare('SELECT * FROM savana_collaborative_command_receipts WHERE command_id = ? AND version = ?').get(commandId, Number(version));
        if (!row) fail('native_command_not_found', 404);
        const command = parse(row.command_json);
        if ((fingerprint != null && fingerprint !== row.fingerprint) || (providerRef != null && providerRef !== command.provider_ref)) fail('native_command_identity_conflict');
        const bound = await this.binding(command, viewerContext, 'result');
        if (row.tenant_id !== bound.nativeTenantId) fail('native_command_binding_changed', 403);
        const fields = new Set(bound.viewer.allowedFields || []);
        const includeStatus = fields.has('result.status'); const includeReceipt = fields.has('result.receipt');
        const adapter = this.adapter(command.capability,command.payload.parameters);
        const includeBusiness = typeof adapter.projectResult === 'function' && (adapter.resultFields || []).some(field => fields.has(field));
        if (!includeStatus && !includeReceipt && !includeBusiness) fail('native_result_field_permission_required', 403);
        const policy = bound.viewer.resourcePolicy;
        if (!['new_only', 'selected', 'activity'].includes(policy)
            || (policy === 'new_only' && bound.viewer.actorId !== command.actor_id)) fail('native_result_resource_scope_required', 403);
        const stored = this.execution(row);
        const resources = parse(stored.resources_json) || {};
        const allowed = new Set(bound.viewer.resourceRefs || []);
        if (policy === 'selected' && !allowed.has(resources.nativeAccountRef)) fail('native_result_resource_scope_required', 403);
        const original = parse(stored.result_json) || { command_id: commandId, outcome: 'pending', effects: [] };
        original.effects = this.db.prepare('SELECT effect_key,state,receipt_json FROM savana_collaborative_effects WHERE execution_id=? ORDER BY created_at,id')
            .all(row.execution_id).map(effect => ({ key: effect.effect_key, state: effect.state, receipt: parse(effect.receipt_json) }));
        const effects = original.effects.filter(effect => policy !== 'selected' || allowed.has(effect.key));
        const details = { command_id: commandId, capability: command.capability, filtered: policy === 'selected',
            ...(includeStatus ? { outcome: original.outcome,
                effect_counts: Object.fromEntries(['accepted','rejected','unknown','dispatching'].map(state =>
                    [state, effects.filter(effect => effect.state === state).length])) } : {}),
            effects: effects.map((effect, index) => ({ index,
                ...(includeStatus ? { state: effect.state,
                    ...(['accepted','sent','delivered','read','failed'].includes(effect.receipt?.provider_status)
                        ? { provider_status: effect.receipt.provider_status } : {}) } : {}),
                ...(includeReceipt && effect.receipt?.native_id ? { receipt: {
                    native_kind: effect.receipt.native_kind, native_id: effect.receipt.native_id,
                    ...(effect.receipt.provider_id ? { provider_id: effect.receipt.provider_id } : {}) } } : {}),
            })),
        };
        if (includeBusiness) Object.assign(details, adapter.projectResult({tenantId:row.tenant_id,command,viewer:bound.viewer,
            effects:this.db.prepare('SELECT * FROM savana_collaborative_effects WHERE execution_id=? ORDER BY created_at,id').all(row.execution_id)}));
        const csvColumns = ['effect_index', ...(includeStatus ? ['state'] : []),
            ...(includeReceipt ? ['native_kind','native_id','provider_id'] : [])];
        const cell = value => {const text = typeof value === 'object' && value !== null ? nativeCommandJson(value) : String(value ?? '');
            return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replace(/"/g,'""')}"`;};
        const businessColumns = [...new Set((details.records || []).flatMap(record=>Object.keys(record)))];
        const csv = format === 'csv' && includeBusiness ? [businessColumns.map(cell).join(','),...(details.records || []).map(record=>businessColumns.map(key=>cell(record[key])).join(','))].join('\r\n')
            : format === 'csv' ? [csvColumns.join(','), ...details.effects.map(effect =>
            [effect.index, ...(includeStatus ? [effect.state] : []), ...(includeReceipt
                ? [effect.receipt?.native_kind || '', effect.receipt?.native_id || '', effect.receipt?.provider_id || ''] : [])]
                .map(cell).join(','))].join('\r\n') : null;
        return validateNativeCommandModel('NativeResult', { spec_version: '1.0', command_id: commandId, version: row.version,
            fingerprint: row.fingerprint, provider_ref: command.provider_ref, scope: command.scope, format,
            content_type: format === 'csv' ? 'text/csv' : 'application/json', data: format === 'json' ? details : null,
            text: csv, content_sha256: crypto.createHash('sha256').update(csv ?? nativeCommandJson(details)).digest('hex'),
            generated_at: new Date(this.now()).toISOString() });
    }
}
