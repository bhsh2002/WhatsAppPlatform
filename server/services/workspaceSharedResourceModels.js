import fs from 'node:fs';
import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';

// Exact draft models only. Loading this decoder does not activate a producer.
export const SHARED_RESOURCE_PRODUCER_MODELS_SHA256 = '66ab2146f7a34af30373b16d0783f8f55f5913d63bd9c7947478abc195aceb12';
export const SHARED_MEDIA_MAX_BYTES = 524_288;
const source = fs.readFileSync(new URL('../config/shared-resource-producer-models-v1.schema.json', import.meta.url));
if (crypto.createHash('sha256').update(source).digest('hex') !== SHARED_RESOURCE_PRODUCER_MODELS_SHA256) {
    throw new TypeError('Unreviewed shared resource producer schema');
}
const definitions = JSON.parse(source).$defs;
const invalid = () => { throw new SharedProductReadError('workspace_resource_response_invalid', 502); };
const mismatch = () => { throw new SharedProductReadError('workspace_resource_scope_invalid', 403); };
const expired = () => { throw new SharedProductReadError('workspace_resource_read_expired', 403); };
const badMedia = () => { throw new SharedProductReadError('workspace_resource_media_invalid', 502); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const scopeKeys = ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'];
const sameScope = (left, right) => scopeKeys.every(key => (left?.[key] ?? null) === (right?.[key] ?? null));
const distinct = values => Array.isArray(values) && new Set(values).size === values.length;
const sameSet = (left, right) => distinct(left) && distinct(right) && left.length === right.length && left.every(value => right.includes(value));

const dateTime = value => {
    if (typeof value !== 'string') return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
        && hour <= 23 && minute <= 59 && second <= 59;
};

// JSON input only: never invoke getters/toJSON or silently drop undefined,
// sparse entries, symbols or non-JSON prototypes while cloning a response.
const cloneJson = (value, seen = new Set(), depth = 0) => {
    if (depth > 40) invalid();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) invalid();
        return value;
    }
    if (typeof value !== 'object' || seen.has(value)) invalid();
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) invalid();
    seen.add(value);
    let result;
    if (array) {
        if (Object.keys(descriptors).some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) invalid();
        result = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = descriptors[index];
            if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) invalid();
            result.push(cloneJson(descriptor.value, seen, depth + 1));
        }
    } else {
        result = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => {
            if (descriptor.get || descriptor.set || !descriptor.enumerable) invalid();
            return [key, cloneJson(descriptor.value, seen, depth + 1)];
        }));
    }
    seen.delete(value);
    return result;
};

const matches = (schema, value, depth = 0) => {
    if (depth > 160 || schema === false) return false;
    if (schema === true) return true;
    if (!object(schema)) return false;
    if (schema.$ref) {
        const name = schema.$ref.startsWith('#/$defs/') ? schema.$ref.slice(8) : null;
        if (!name || !definitions[name] || !matches(definitions[name], value, depth + 1)) return false;
    }
    if (schema.allOf && !schema.allOf.every(rule => matches(rule, value, depth + 1))) return false;
    if (schema.anyOf && !schema.anyOf.some(rule => matches(rule, value, depth + 1))) return false;
    if (schema.oneOf && schema.oneOf.filter(rule => matches(rule, value, depth + 1)).length !== 1) return false;
    if (schema.not && matches(schema.not, value, depth + 1)) return false;
    if (schema.if) {
        const branch = matches(schema.if, value, depth + 1) ? schema.then : schema.else;
        if (branch && !matches(branch, value, depth + 1)) return false;
    }
    if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some(type => type === 'null' ? value === null : type === 'object' ? object(value)
            : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value)
                : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type)) return false;
    }
    if (typeof value === 'string') {
        const length = [...value].length;
        if ((schema.minLength !== undefined && length < schema.minLength)
            || (schema.maxLength !== undefined && length > schema.maxLength)
            || (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
            || (schema.format === 'date-time' && !dateTime(value))) return false;
    }
    if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum)
        || (schema.maximum !== undefined && value > schema.maximum)
        || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)
        || (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum))) return false;
    if (Array.isArray(value) && ((schema.minItems !== undefined && value.length < schema.minItems)
        || (schema.maxItems !== undefined && value.length > schema.maxItems)
        || (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length)
        || (schema.items && !value.every(item => matches(schema.items, item, depth + 1))))) return false;
    if (object(value)) {
        const keys = Object.keys(value);
        if (schema.required?.some(key => !Object.hasOwn(value, key))
            || (schema.minProperties !== undefined && keys.length < schema.minProperties)
            || (schema.maxProperties !== undefined && keys.length > schema.maxProperties)) return false;
        for (const key of keys) {
            if (schema.propertyNames && !matches(schema.propertyNames, key, depth + 1)) return false;
            if (Object.hasOwn(schema.properties || {}, key)) {
                if (!matches(schema.properties[key], value[key], depth + 1)) return false;
            } else if (schema.additionalProperties === false) return false;
            else if (object(schema.additionalProperties) && !matches(schema.additionalProperties, value[key], depth + 1)) return false;
        }
    }
    return true;
};

export const validateSharedResourceModel = (name, value) => {
    const cloned = cloneJson(value);
    if (!Object.hasOwn(definitions, name) || Buffer.byteLength(JSON.stringify(cloned)) > 1_048_576
        || !matches(definitions[name], cloned)) invalid();
    return cloned;
};

const deadline = (value, now) => {
    if (!dateTime(value) || Date.parse(value) <= now) expired();
    return Date.parse(value);
};
const authorization = (value, expected, now) => {
    if (!expected || !Number.isSafeInteger(now) || !['offering', 'product'].includes(expected.resourceKind)) mismatch();
    try { validateSharedResourceModel('Scope', expected.scope); } catch { mismatch(); }
    const fields = Object.keys(definitions[expected.resourceKind === 'product' ? 'ProductContextFields' : 'OfferingFields'].properties);
    if (!sameScope(value.scope, expected.scope)
        || value.provider_ref !== expected.providerRef || value.source_platform !== expected.sourcePlatform
        || value.source_installation_id !== expected.sourceInstallationId || !text(expected.sourceExternalTenantId)
        || value.principal_kind !== expected.principalKind
        || value.consumer_installation_id !== expected.consumerInstallationId || value.consumer_platform !== expected.consumerPlatform
        || !Array.isArray(expected.allowedFields) || !expected.allowedFields.length || expected.allowedFields.length > 32
        || expected.allowedFields.some(field => !fields.includes(field)) || !sameSet(value.allowed_fields, expected.allowedFields)
        || (expected.authorizationRevision !== undefined && value.authorization_revision !== expected.authorizationRevision)) mismatch();
    const until = deadline(value.valid_until, now);
    return expected.validUntil === undefined ? until : Math.min(until, deadline(expected.validUntil, now));
};
const sourceMatches = (value, expected) => value.platform === expected.sourcePlatform
    && value.installation_id === expected.sourceInstallationId && value.external_tenant_id === expected.sourceExternalTenantId;
const record = (value, expected) => {
    if (value.resource_kind !== expected.resourceKind || !sameScope(value.scope, expected.scope)
        || !sourceMatches(value.source, expected)
        || (expected.sourceLocalId !== undefined && value.source_local_id !== expected.sourceLocalId)
        || (expected.nativeRevision !== undefined && value.native_revision !== expected.nativeRevision)
        || Object.keys(value.data).some(field => !expected.allowedFields.includes(field))) mismatch();
    if (value.resource_kind === 'product') {
        for (const key of ['price_options', 'media']) {
            const items = value.data[key] || [];
            const id = key === 'media' ? 'asset_id' : 'option_ref';
            if (new Set(items.map(item => item[id])).size !== items.length
                || items.some(item => item.parent_source_local_id !== value.source_local_id)) mismatch();
        }
    }
};

export const decodeSharedResourceRead = (raw, expected, { now = Date.now() } = {}) => {
    const value = validateSharedResourceModel('SharedResourceReadView', raw);
    authorization(value.authorization, expected, now);
    const until = Date.parse(value.authorization.valid_until);
    if (!text(expected.resourceRef) || value.resource_ref !== expected.resourceRef || value.resource_kind !== expected.resourceKind) mismatch();
    record(value.record, expected);
    if (value.resource_kind === 'offering' && (value.resource_ref !== value.record.source_local_id || value.media_previews?.length)) mismatch();
    const previews = value.media_previews || [];
    if (new Set(previews.map(item => item.asset_id)).size !== previews.length) mismatch();
    for (const preview of previews) {
        const media = value.record.data.media?.find(item => item.asset_id === preview.asset_id && item.rights_reference === preview.rights_reference);
        if (value.resource_kind !== 'product' || !expected.allowedFields.includes('media') || !media
            || !distinct(preview.content_types) || Date.parse(preview.valid_until) > until) mismatch();
        deadline(preview.valid_until, now);
    }
    return value;
};

export const decodeSharedResourceSearch = (raw, expected, { now = Date.now() } = {}) => {
    const value = validateSharedResourceModel('SharedResourceSearchView', raw);
    authorization(value.authorization, expected, now);
    if (expected.resourceKind !== 'offering' || (value.resource_kind !== undefined && value.resource_kind !== 'offering')
        || new Set(value.records.map(item => item.source_local_id)).size !== value.records.length) mismatch();
    for (const item of value.records) record(item, expected);
    return value;
};

const imageMagic = (bytes, type) => type === 'image/jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : type === 'image/png' ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : type === 'image/webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
            && bytes.subarray(8, 12).toString('ascii') === 'WEBP';

export const decodeSharedMediaPreview = (raw, expected, { now = Date.now() } = {}) => {
    const value = validateSharedResourceModel('SharedMediaPreviewView', raw);
    // Preview has no requested field-mask query. The caller separately fences
    // these actual projected fields against its current product read grant.
    const previewExpected = expected?.allowedFields === undefined
        ? { ...expected, allowedFields: value.authorization.allowed_fields } : expected;
    const authUntil = authorization(value.authorization, previewExpected, now);
    const preview = value.preview;
    if (expected.resourceKind !== 'product' || !previewExpected.allowedFields.includes('media')
        || !text(expected.resourceRef) || !text(expected.sourceLocalId) || !Number.isSafeInteger(expected.nativeRevision) || expected.nativeRevision < 1
        || ![expected.assetId, expected.accessReference, expected.rightsReference].every(text)
        || value.resource_ref !== expected.resourceRef || !sourceMatches(value.source, expected)
        || preview.source_local_id !== expected.sourceLocalId || preview.asset_id !== expected.assetId
        || preview.access_reference !== expected.accessReference || preview.rights_reference !== expected.rightsReference
        || (preview.source_revision !== null && preview.source_revision !== undefined && preview.source_revision !== expected.nativeRevision)) mismatch();
    const previewUntil = deadline(preview.valid_until, now), checkedAt = Date.parse(preview.checked_at);
    if (checkedAt > now || previewUntil <= checkedAt || previewUntil > checkedAt + 5000
        || previewUntil > Date.parse(value.authorization.valid_until)) expired();
    const validUntil = new Date(Math.min(authUntil, previewUntil)).toISOString();
    if (preview.state !== 'available') return { value, bytes: null, contentType: null, validUntil };
    if (preview.rights_active !== true || preview.source_revision !== expected.nativeRevision) mismatch();
    const encoded = preview.content_base64;
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) badMedia();
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > SHARED_MEDIA_MAX_BYTES || bytes.length !== preview.byte_length
        || bytes.toString('base64') !== encoded || sha(bytes) !== preview.content_sha256 || !imageMagic(bytes, preview.content_type)) badMedia();
    return { value, bytes, contentType: preview.content_type, validUntil };
};
