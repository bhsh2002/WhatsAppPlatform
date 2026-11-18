import fs from 'node:fs';
import { NativeCommandProtocolError, nativeCommandJson } from './nativeCommandProtocol.js';

export const NATIVE_COMMAND_MODELS_SHA256 = '170930f571deebed9924e4d903fbc6b423097fc3f171464ff9023f3b9f85e8e1';
const document = JSON.parse(fs.readFileSync(new URL('../config/native-command-models-v2.json', import.meta.url), 'utf8'));
const models = document.models || document;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const jsonValue = (value, depth = 0) => {
    if (depth > 40) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => jsonValue(item, depth + 1));
    return object(value) && Object.values(value).every(item => jsonValue(item, depth + 1));
};
const dateTime = value => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const matches = (schema, value, root, depth = 0) => {
    if (depth > 60) return false;
    if (schema.$ref) {
        if (!schema.$ref.startsWith('#/$defs/')) return false;
        const target = root.$defs?.[schema.$ref.slice(8)];
        return Boolean(target) && matches(target, value, root, depth + 1);
    }
    if (schema.anyOf && !schema.anyOf.some(choice => matches(choice, value, root, depth + 1))) return false;
    if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.type === 'null' && value !== null) return false;
    if (schema.type === 'string' && typeof value !== 'string') return false;
    if (schema.type === 'integer' && !Number.isSafeInteger(value)) return false;
    if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
    if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
    if (schema.type === 'array' && !Array.isArray(value)) return false;
    if (schema.type === 'object' && !object(value)) return false;
    if (typeof value === 'string') {
        const length = [...value].length;
        if ((schema.minLength !== undefined && length < schema.minLength)
            || (schema.maxLength !== undefined && length > schema.maxLength)
            || (schema.pattern && !new RegExp(schema.pattern).test(value))
            || (schema.format === 'date-time' && !dateTime(value))) return false;
    }
    if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum)
        || (schema.maximum !== undefined && value > schema.maximum))) return false;
    if (Array.isArray(value)) {
        if ((schema.minItems !== undefined && value.length < schema.minItems)
            || (schema.maxItems !== undefined && value.length > schema.maxItems)
            || (schema.uniqueItems && new Set(value.map(nativeCommandJson)).size !== value.length)
            || (schema.items && !value.every(item => matches(schema.items, item, root, depth + 1)))) return false;
    }
    if (object(value)) {
        if (schema.required?.some(key => !Object.hasOwn(value, key))) return false;
        for (const [key, item] of Object.entries(value)) {
            if (schema.properties?.[key]) {
                if (!matches(schema.properties[key], item, root, depth + 1)) return false;
            } else if (schema.additionalProperties === false) return false;
            else if (object(schema.additionalProperties) && !matches(schema.additionalProperties, item, root, depth + 1)) return false;
        }
    }
    return true;
};

export const validateSchemaModel = (modelSet, name, value) => {
    modelSet = modelSet.models || modelSet;
    const root = modelSet[name] || Object.values(modelSet).find(model => model.$defs?.[name]);
    const schema = modelSet[name] || root?.$defs?.[name];
    if (!schema || !jsonValue(value) || !matches(schema, value, root)) {
        throw new NativeCommandProtocolError('native_command_model_invalid', 422);
    }
    return value;
};
const invalidModel = () => { throw new NativeCommandProtocolError('native_command_model_invalid', 422); };
const semanticFields = ['effect_fields', 'effect_resources', 'creates_resource'];
const distinctStrings = values => Array.isArray(values) && new Set(values).size === values.length;
const validateSemanticProof = value => {
    const present = semanticFields.filter(key => value[key] != null).length;
    if (present !== 0 && present !== semanticFields.length) invalidModel();
    for (const key of ['effect_fields', 'effect_resources']) {
        if (value[key] != null && !distinctStrings(value[key])) invalidModel();
    }
    if (value.effect_values != null && Object.values(value.effect_values).some(items => !distinctStrings(items))) invalidModel();
};
export const validateNativeCommandModel = (name, value) => {
    validateSchemaModel(models, name, value);
    if (['AdapterCommand', 'AdapterCancelCommand', 'AdapterValidation', 'EffectAuthorization'].includes(name)) validateSemanticProof(value);
    const capabilities = name === 'AdapterDiscovery' ? value.providers.flatMap(provider => provider.capabilities)
        : name === 'NativeProviderChoice' ? value.capabilities : name === 'AdapterCapability' ? [value] : [];
    for (const capability of capabilities) {
        if (capability.creates_resource_actions != null && (!distinctStrings(capability.creates_resource_actions)
            || capability.creates_resource_actions.some(action => !capability.actions.includes(action)))) invalidModel();
    }
    return value;
};
// These native WA handlers use the published parameter-name contract. A new
// semantic proof must never be accepted and then silently ignored by them.
export const assertNativeParameterContract = value => {
    if ((value.permission_contract != null && value.permission_contract !== 'parameters_v1')
        || [...semanticFields, 'effect_values', 'validation_effect_fields', 'validation_effect_resources',
            'validation_creates_resource', 'validation_effect_values'].some(key => value[key] != null)) {
        throw new NativeCommandProtocolError('native_permission_contract_unsupported', 422);
    }
    return value;
};
export const validateAdapterCommand = value => validateNativeCommandModel('AdapterCommand', value);
export const validateExecutionContext = value => validateNativeCommandModel('ExecutionContext', value);
export const validateEffectAuthorization = value => validateNativeCommandModel('EffectAuthorization', value);
export const validateAdapterReceipt = value => validateNativeCommandModel('AdapterReceipt', value);

export const assertEffectAuthorizationForCommand = (command, context, authorization, { now = Date.now() } = {}) => {
    validateAdapterCommand(command); validateExecutionContext(context); validateEffectAuthorization(authorization);
    if (['command_id', 'version', 'fingerprint', 'attempt_id'].some(key => authorization[key] !== command[key])
        || authorization.authorization_revision !== command.authorization_revision
        || context.authorization_revision !== command.authorization_revision
        || Date.parse(authorization.valid_until) <= now || Date.parse(context.valid_until) <= now) {
        throw new NativeCommandProtocolError('native_command_effect_authorization_changed', 403);
    }
    for (const key of ['grant_approved_by', 'native_authority_revision', 'capability_grant_revision',
        'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs']) {
        if (!Object.hasOwn(command, key) || nativeCommandJson(command[key]) !== nativeCommandJson(context[key])
            || nativeCommandJson(command[key]) !== nativeCommandJson(authorization[key])) {
            throw new NativeCommandProtocolError('native_command_effect_authorization_changed', 403);
        }
    }
    for (const key of ['namespace_installation_id', 'namespace_epoch', 'namespace_version','authority_domain','ownership_epoch']) {
        if ((command[key] ?? null) !== (context[key] ?? null) || (command[key] ?? null) !== (authorization[key] ?? null)) {
            throw new NativeCommandProtocolError('native_command_effect_authorization_changed', 403);
        }
    }
    if ((command.effect_fields != null) !== (context.permission_contract === 'semantic_effects_v1')) {
        throw new NativeCommandProtocolError('native_command_effect_authorization_changed', 403);
    }
    for (const key of [...semanticFields, 'effect_values']) {
        if (nativeCommandJson(command[key] ?? null) !== nativeCommandJson(authorization[key] ?? null)
            || nativeCommandJson(command[key] ?? null) !== nativeCommandJson(context[`validation_${key}`] ?? null)) {
            throw new NativeCommandProtocolError('native_command_effect_authorization_changed', 403);
        }
    }
    return authorization;
};
