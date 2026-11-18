import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateNativeCommandModel, validateAdapterCommand, validateAdapterReceipt,
    validateExecutionContext, validateEffectAuthorization, assertEffectAuthorizationForCommand, NATIVE_COMMAND_MODELS_SHA256, assertNativeParameterContract } from '../services/nativeCommandModels.js';

const scope = { organization_id: 'owned-org', activity_id: 'owned-activity' };
const delegation = { grant_approved_by: 'synthetic-owner', native_authority_revision: 'synthetic-owner-revision',
    capability_grant_revision: 3, allowed_fields: ['message'], resource_policy: 'new_only', resource_refs: [], scope_epochs: [] };
const command = () => ({ command_id: 'owned-command', version: 1, fingerprint: 'a'.repeat(64), attempt_id: 'attempt-1',
    capability: 'messaging.send', action: 'message.send', scope, actor_id: 'actor', provider_ref: 'provider',
    provider_installation_id: 'installation', external_tenant_id: 'wa_savana:tenant:1',
    authorization_revision: 'revision', ownership_epoch: 1, ...delegation,
    validation_revision: 'synthetic-preview', validation_valid_until: '2026-11-18T12:00:00Z',
    payload: { payload_type: 'native_action', parameters: { channel: 'sms', message: 'رسالة اختبار' } } });

test('official command/context models retain JSON data without accepting added actor or authority claims', () => {
    const value = command();
    assert.equal(validateAdapterCommand(value), value);
    for (const extra of [{ approved: true }, { access_token: 'untrusted' }, { actor_role: 'owner' }]) {
        assert.throws(() => validateAdapterCommand({ ...value, ...extra }), error => error.code === 'native_command_model_invalid');
    }
    const context = { actor_id: 'actor', scope, provider_ref: 'provider', provider_platform: 'wa_savana',
        provider_installation_id: 'installation', external_tenant_id: 'wa_savana:tenant:1',
        authorization_revision: 'revision', valid_until: '2026-11-18T12:00:00Z', ownership_epoch: 1, ...delegation };
    assert.equal(validateExecutionContext(context), context);
    assert.throws(() => validateExecutionContext({ ...context, scope: { ...scope, tenant_id: 9 } }));
    assert.throws(() => validateExecutionContext({ ...context, valid_until: '2026-02-31T12:00:00Z' }));
});

test('source result requires durable entity/revision/reference and unknown does not invent one', () => {
    const receipt = { command_id: 'owned-command', version: 1, fingerprint: 'a'.repeat(64), outcome: 'applied',
        source_result: { local_entity_id: 'native-1', source_revision: 1, result_reference: 'wa_savana:receipt:native-1' } };
    assert.equal(validateAdapterReceipt(receipt), receipt);
    assert.throws(() => validateAdapterReceipt({ ...receipt, source_result: { ...receipt.source_result, source_revision: -1 } }));
    assert.throws(() => validateAdapterReceipt({ ...receipt, source_result: { local_entity_id: 'native-1' } }));
    assert.doesNotThrow(() => validateAdapterReceipt({ command_id: receipt.command_id, version: 1,
        fingerprint: receipt.fingerprint, outcome: 'unknown', source_result: null, reason_code: 'provider_outcome_unknown' }));
});

test('product definitions share exact decimal and authority fields while rejecting numeric price coercion', () => {
    const payload = { kind: 'goods', fields: { name: 'منتج', price: { amount: '12.345', currency: 'LYD',
        unit_code: 'each', price_list_id: 'retail', channel: 'catalog' } }, clear_fields: [] };
    assert.equal(validateNativeCommandModel('ProductCommandPayload', payload), payload);
    for (const amount of [12.345, '01.000', '-1', '1.0000', '1e2']) {
        assert.throws(() => validateNativeCommandModel('ProductCommandPayload', { ...payload,
            fields: { ...payload.fields, price: { ...payload.fields.price, amount } } }));
    }
    assert.throws(() => validateNativeCommandModel('ProductCommandPayload', { ...payload, transfer_authority: true }));
});

test('effect authorization stays bound to the exact command/version/fingerprint/attempt model', () => {
    const proof = { command_id: 'owned-command', version: 1, fingerprint: 'a'.repeat(64), attempt_id: 'attempt-1',
        authorized: true, valid_until: '2026-11-18T12:00:00Z', authorization_revision: 'revision',ownership_epoch:1, ...delegation };
    assert.equal(validateEffectAuthorization(proof), proof);
    assert.throws(() => validateEffectAuthorization({ ...proof, authorized: false }));
    const context = { actor_id: 'actor', scope, provider_ref: 'provider', provider_platform: 'wa_savana',
        provider_installation_id: 'installation', external_tenant_id: 'wa_savana:tenant:1',
        authorization_revision: 'revision', valid_until: proof.valid_until, ownership_epoch: 1, ...delegation };
    const now = Date.parse('2026-11-18T11:00:00Z');
    assert.equal(assertEffectAuthorizationForCommand(command(), context, proof, { now }), proof);
    for (const changed of [{ fingerprint: 'invalid' }, { attempt_id: 'another' }, { version: 2 },
        { authorization_revision: 'older' },{authority_domain:'products.goods'},{ownership_epoch:2}, { valid_until: '2026-11-18T10:00:00Z' }]) {
        assert.throws(() => assertEffectAuthorizationForCommand(command(), context, { ...proof, ...changed }, { now }),
            error => error.code === 'native_command_effect_authorization_changed');
    }
    assert.throws(() => validateAdapterCommand({ ...command(), version: 1.5 }));
    assert.throws(() => validateAdapterCommand({ ...command(), payload: { payload_type: 'native_action', parameters: { bad: Infinity } } }));
});


test('V2 runtime vendor is byte-pinned while historical V1 remains unchanged', () => {
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(new URL(file, import.meta.url))).digest('hex');
    assert.equal(digest('../config/native-command-models-v2.json'), NATIVE_COMMAND_MODELS_SHA256);
    assert.equal(NATIVE_COMMAND_MODELS_SHA256, '170930f571deebed9924e4d903fbc6b423097fc3f171464ff9023f3b9f85e8e1');
    assert.equal(digest('../config/native-command-models-v1.json'), 'e72d6c2d9b6dcd9858ac40d9b2d0d9ee466ab5b8b15c9795848cbec532022403');
});

test('V2 NativeValidationContext requires the real current delegation and excludes execution/owner/internal claims', () => {
    const context = { ...scope, actor_id: 'actor', external_tenant_id: 'wa_savana:tenant:1', authorization_revision: 'current', ...delegation };
    assert.equal(validateNativeCommandModel('NativeValidationContext', context), context);
    for (const key of ['grant_approved_by', 'native_authority_revision', 'capability_grant_revision', 'authorization_revision', 'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs']) {
        const value = { ...context }; delete value[key];
        assert.throws(() => validateNativeCommandModel('NativeValidationContext', value), { code: 'native_command_model_invalid' });
    }
    for (const extra of [{ scope }, { branch_id: 'branch' }, { warehouse_id: 'warehouse' }, { session_version: 1 },
        { provider_ref: 'core-only' }, { provider_installation_id: 'core-only' }, { consumer_authorization_revision: 'd'.repeat(64) },
        { allowed_value_contexts: {} }, { semantic_value_keys: [] }]) {
        assert.throws(() => validateNativeCommandModel('NativeValidationContext', { ...context, ...extra }), { code: 'native_command_model_invalid' });
    }
});

test('V2 semantic proof is closed, complete and exactly bound, while native parameter handlers cannot ignore it', () => {
    const semantic = { effect_fields: ['message'], effect_resources: ['native:parent'], creates_resource: true,
        effect_values: { channels: ['sms'] } };
    const cmd = { ...command(), ...semantic };
    assert.equal(validateAdapterCommand(cmd), cmd);
    assert.equal(assertNativeParameterContract(command()).command_id, command().command_id);
    assert.throws(() => assertNativeParameterContract(cmd), { code: 'native_permission_contract_unsupported' });
    for (const changes of [{ effect_resources: null }, { effect_fields: ['message', 'message'] },
        { effect_values: { channels: ['sms', 'sms'] } }, { effect_values: { unknown: ['sms'] } }]) {
        assert.throws(() => validateAdapterCommand({ ...cmd, ...changes }), { code: 'native_command_model_invalid' });
    }
    const proof = { command_id: cmd.command_id, version: cmd.version, fingerprint: cmd.fingerprint, attempt_id: cmd.attempt_id,
        valid_until: '2026-11-18T12:00:00Z', authorization_revision: cmd.authorization_revision, ownership_epoch: 1, ...delegation, ...semantic };
    const context = { actor_id: 'actor', scope, provider_ref: 'provider', provider_platform: 'wa_savana', provider_installation_id: 'installation',
        external_tenant_id: cmd.external_tenant_id, authorization_revision: cmd.authorization_revision, valid_until: proof.valid_until,
        ownership_epoch: 1, ...delegation, permission_contract: 'semantic_effects_v1', validation_effect_fields: semantic.effect_fields,
        validation_effect_resources: semantic.effect_resources, validation_creates_resource: true, validation_effect_values: semantic.effect_values };
    const now = Date.parse('2026-11-18T11:00:00Z');
    assert.equal(assertEffectAuthorizationForCommand(cmd, context, proof, { now }), proof);
    assert.throws(() => assertEffectAuthorizationForCommand(cmd, { ...context, permission_contract: 'parameters_v1' }, proof, { now }), { code: 'native_command_effect_authorization_changed' });
    for (const change of [{ effect_fields: ['another'] }, { effect_resources: ['another'] }, { creates_resource: false },
        { effect_values: { channels: ['whatsapp'] } }]) {
        assert.throws(() => assertEffectAuthorizationForCommand(cmd, context, { ...proof, ...change }, { now }), { code: 'native_command_effect_authorization_changed' });
    }
    const capability = { capability: 'messaging.send', actions: ['messaging.send'], validator_version: '1.0', handler_registered: true, configured: true };
    assert.throws(() => validateNativeCommandModel('AdapterCapability', { ...capability, creates_resource_actions: ['another'] }), { code: 'native_command_model_invalid' });
});
