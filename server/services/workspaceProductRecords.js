import { SharedProductReadError } from './centralProductRead.js';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { validateNativeCommandModel } from './nativeCommandModels.js';
import { decodeWorkspaceCommandOption } from './workspaceCoreResponses.js';

// Actual published v4 enriched record bodies. This consumer decoder declares
// no peer route: that transport must be published by Core before mounting it.
const fail = () => { throw new SharedProductReadError('workspace_record_response_invalid', 502); };
const text = (value, maximum = 255) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const object = (value, required, optional = []) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail();
};
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const date = value => {
    if (!text(value, 80) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
        || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const sameInstant = (left, right) => date(left) && date(right) && Date.parse(left) === Date.parse(right);
const scopeKeys = ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'];
const sameScope = (left, right) => scopeKeys.every(key => (left?.[key] ?? null) === (right?.[key] ?? null));
const hashText = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const scope = (value, expected) => {
    object(value, ['organization_id', 'activity_id'], ['branch_id', 'warehouse_id']);
    if (!text(value.organization_id) || !text(value.activity_id)
        || ['branch_id', 'warehouse_id'].some(key => value[key] != null && !text(value[key]))
        || (value.warehouse_id != null && value.branch_id == null) || !sameScope(value, expected)) fail();
};
const clone = value => { try { return JSON.parse(canonicalWorkspaceJson(value)); } catch { fail(); } };

const readContext = (value, expected, now) => {
    object(value, ['scope', 'actor_id', 'consumer_platform', 'consumer_account_id', 'consumer_installation_id',
        'checked_at', 'valid_until', 'authorization_revision', 'permissions', 'freshness_max_age_seconds']);
    scope(value.scope, expected.scope);
    if (value.actor_id !== expected.actorId || value.consumer_platform !== expected.consumerPlatform
        || value.consumer_account_id !== expected.consumerAccountId || value.consumer_installation_id !== expected.consumerInstallationId
        || !date(value.checked_at) || !date(value.valid_until) || Date.parse(value.checked_at) > now || Date.parse(value.valid_until) <= now
        || Date.parse(value.valid_until) <= Date.parse(value.checked_at) || !hashText(value.authorization_revision)
        || !Array.isArray(value.permissions) || !value.permissions.includes('data.read') || value.permissions.length > 32
        || value.permissions.some(item => !text(item)) || new Set(value.permissions).size !== value.permissions.length
        || !integer(value.freshness_max_age_seconds)) fail();
};

const record = (value, expected) => {
    object(value, ['scope', 'entity_id', 'entity_type', 'domain', 'source', 'ownership_epoch', 'expected_version', 'source_revision',
        'observed_at', 'state', 'data', 'version', 'received_at', 'freshness', 'field_visibility', 'record_ref', 'label', 'fields'], ['available_actions']);
    scope(value.scope, expected.scope);
    object(value.source, ['installation_id', 'entity_type', 'local_entity_id']);
    if (!text(value.entity_id) || value.record_ref !== value.entity_id || value.entity_type !== 'product' || value.domain !== 'product.core'
        || !text(value.source.installation_id) || !text(value.source.entity_type, 80) || !text(value.source.local_entity_id)
        || !integer(value.ownership_epoch, 1) || !integer(value.version, 1) || !integer(value.expected_version)
        || !(text(value.source_revision) || integer(value.source_revision)) || !date(value.observed_at) || !date(value.received_at)
        || !['active', 'archived', 'tombstone'].includes(value.state) || !['current', 'stale', 'clock_ahead'].includes(value.freshness)
        || value.field_visibility !== 'explicit_grants_only' || !text(value.label, 1000)) fail();
    object(value.data, [], ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media', 'is_visible']);
    const fields = { ...value.data }; delete fields.is_visible;
    if (Object.hasOwn(value.data, 'is_visible') && typeof value.data.is_visible !== 'boolean') fail();
    try { validateNativeCommandModel('ProductCommandPayload', { kind: 'goods', fields }); } catch { fail(); }
    if (!Array.isArray(value.fields) || value.fields.length !== Object.keys(value.data).length || value.fields.length > 8) fail();
    const seen = new Set();
    for (const field of value.fields) {
        object(field, ['key', 'label', 'value', 'source_label', 'authoritative', 'received_at', 'observed_at', 'freshness']);
        if (!Object.hasOwn(value.data, field.key) || seen.has(field.key) || !text(field.label, 1000) || !text(field.source_label, 1000)
            || field.authoritative !== true || !sameInstant(field.received_at, value.received_at) || !sameInstant(field.observed_at, value.observed_at)
            || field.freshness !== value.freshness || canonicalWorkspaceJson(field.value) !== canonicalWorkspaceJson(value.data[field.key])) fail();
        seen.add(field.key);
    }
    if (value.available_actions !== undefined) {
        if (!Array.isArray(value.available_actions) || value.available_actions.length > 1) fail();
        for (const raw of value.available_actions) {
            let action;
            try { action = decodeWorkspaceCommandOption(raw); } catch { fail(); }
            if (action.action !== 'product.change' || action.available !== true || action.activity_id !== value.scope.activity_id
                || action.record_ref !== value.entity_id || action.record_version !== value.version
                || action.source_installation_id !== value.source.installation_id
                || (expected.providerRef && action.provider_ref !== expected.providerRef)) fail();
        }
    }
};

export const decodeWorkspaceProductRecords = (raw, expected, { detail = false, now = Date.now() } = {}) => {
    if (!expected || !text(expected.actorId) || !text(expected.consumerAccountId) || !text(expected.consumerInstallationId)
        || !['wa_savana', 'catalog', 'sawemly'].includes(expected.consumerPlatform) || !Number.isSafeInteger(now)) fail();
    const value = clone(raw);
    object(value, detail ? ['spec_version', 'context', 'record'] : ['spec_version', 'context', 'records', 'has_more', 'next_cursor']);
    if (value.spec_version !== '1.0') fail();
    readContext(value.context, expected, now);
    const records = detail ? [value.record] : value.records;
    if (!Array.isArray(records) || records.length > 100 || (detail && records.length !== 1)) fail();
    for (const item of records) record(item, expected);
    if (new Set(records.map(item => item.entity_id)).size !== records.length) fail();
    if (!detail && (typeof value.has_more !== 'boolean' || !(value.next_cursor === null || text(value.next_cursor, 16384))
        || (value.has_more && !value.next_cursor) || records.some(item => item.state !== 'active'))) fail();
    return value;
};
