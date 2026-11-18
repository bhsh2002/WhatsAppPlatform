import { SharedProductReadError } from './centralProductRead.js';
import { validateNativeCommandModel } from './nativeCommandModels.js';

// Core command-execution-models-v1 ProductCommandPayload/ProductFields. This
// validates an outgoing proposal only; source ownership, policy and approval
// remain fresh Core/source checks and are never inferred from these fields.
const fail = () => { throw new SharedProductReadError('workspace_product_invalid', 422); };
const object = (value, allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).some(key => !allowed.includes(key))) fail();
};
const text = (value, max, minimum = 1) => typeof value === 'string' && value.length >= minimum && value.length <= max;
const fields = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'];
const clearable = fields.filter(field => field !== 'name');

export const validateWorkspaceProductPayload = (payload, { mode, allowedFields }) => {
    try { validateNativeCommandModel('ProductCommandPayload', payload); } catch { fail(); }
    object(payload, ['kind', 'entity_id', 'expected_record_version', 'fields', 'clear_fields']);
    if (!['create', 'change'].includes(mode) || !Array.isArray(allowedFields)
        || allowedFields.some(field => !fields.includes(field))
        || (payload.kind !== undefined && payload.kind !== 'goods')) fail();
    const changed = mode === 'change';
    if (changed ? !text(payload.entity_id, 255) || !Number.isSafeInteger(payload.expected_record_version) || payload.expected_record_version < 1
        : payload.entity_id != null || payload.expected_record_version != null) fail();
    object(payload.fields, fields);
    const proposed = Object.keys(payload.fields);
    const clears = payload.clear_fields ?? [];
    if (!Array.isArray(clears) || clears.length > 6 || new Set(clears).size !== clears.length
        || clears.some(field => !clearable.includes(field) || proposed.includes(field) || !allowedFields.includes(field))
        || proposed.some(field => !allowedFields.includes(field)) || (!changed && (clears.length || !proposed.includes('name')))
        || (changed && proposed.length + clears.length === 0)) fail();
    const value = payload.fields;
    for (const [field, maximum, minimum] of [['name', 200, 1], ['description', 4000, 0], ['sku', 100, 1], ['base_unit', 50, 1]]) {
        if (Object.hasOwn(value, field) && (!text(value[field], maximum, minimum) || (minimum && !value[field].trim()))) fail();
    }
    // Round-trip strips prototypes while preserving decimal text and omissions.
    return JSON.parse(JSON.stringify({ kind: 'goods', ...(changed ? { entity_id: payload.entity_id,
        expected_record_version: payload.expected_record_version } : {}), fields: value, clear_fields: clears }));
};
