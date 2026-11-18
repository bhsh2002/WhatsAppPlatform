import crypto from 'node:crypto';
import { validateNativeCommandModel } from '../services/nativeCommandModels.js';

export const OWNER_JOURNEY_RESULT_BINDING_HEADER = 'x-savana-owner-fixture-result-binding';
const format = 'savana-owner-fixture-result-binding/1';
const keys = ['format', 'run_id', 'command_id', 'version', 'approval_fingerprint', 'provider_ref', 'source_installation_id',
    'scope', 'capability_code', 'operation', 'source_result', 'content_type', 'byte_length', 'content_sha256'];
const scopeKeys = ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'];
const receiptKeys = ['local_entity_id', 'source_revision', 'result_reference'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const text = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max && !value.includes('\0');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const closed = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const validScope = value => closed(value, scopeKeys) && text(value.organization_id) && text(value.activity_id)
    && ['branch_id', 'warehouse_id'].every(key => value[key] === null || text(value[key]))
    && (value.warehouse_id === null || value.branch_id !== null);
const activeScopeMatches = (active, bound) => validScope(active) && validScope(bound)
    && active.organization_id === bound.organization_id && active.activity_id === bound.activity_id
    && ['branch_id', 'warehouse_id'].every(key => active[key] === null || active[key] === bound[key]);
const pair = value => (value.capability_code === 'inventory.read' && value.operation === 'inventory.read')
    || (value.capability_code === 'inventory.count' && value.operation === 'inventory.count_delta');

// The closed header has objects, strings, null and integer tokens only. Parse
// those JSON tokens directly so escaped duplicate keys and 2.0/2e0 cannot be
// silently normalized by JSON.parse before the strict metadata check.
const metadataJson = source => {
    let at = 0;
    const invalid = () => { throw new Error('fixture_result_binding_invalid'); };
    const space = () => { while (/[\t\r\n ]/.test(source[at] || '') && at < source.length) at += 1; };
    const string = () => {
        if (source[at] !== '"') invalid();
        const start = at++;
        while (at < source.length) {
            const char = source[at++];
            if (char === '\\') at += 1;
            else if (char === '"') return JSON.parse(source.slice(start, at));
        }
        invalid();
    };
    const value = depth => {
        if (depth > 8) invalid();
        space();
        if (source[at] === '"') return string();
        if (source.slice(at, at + 4) === 'null') { at += 4; return null; }
        if (source[at] === '{') {
            at += 1; space();
            const result = Object.create(null), names = new Set();
            if (source[at] === '}') { at += 1; return result; }
            while (at < source.length) {
                const key = string();
                if (names.has(key)) invalid();
                names.add(key); space();
                if (source[at++] !== ':') invalid();
                result[key] = value(depth + 1); space();
                const separator = source[at++];
                if (separator === '}') return result;
                if (separator !== ',') invalid();
                space();
            }
            invalid();
        }
        const number = /^-?(?:0|[1-9][0-9]*)/.exec(source.slice(at));
        if (!number) invalid();
        at += number[0].length;
        if (/[.eE]/.test(source[at] || '')) invalid();
        const integer = Number(number[0]);
        if (!Number.isSafeInteger(integer)) invalid();
        return integer;
    };
    const result = value(0); space();
    if (at !== source.length) invalid();
    return result;
};

// Fixture diagnostic metadata only: never authentication, a permission grant,
// source-installation inference or a substitute for actual delivery fences.
export const decodeOwnerJourneyResultBinding = header => {
    try {
        if (typeof header !== 'string' || header.length < 1 || header.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(header)) return null;
        const bytes = Buffer.from(header, 'base64url');
        if (bytes.toString('base64url') !== header) return null;
        const value = metadataJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
        if (!closed(value, keys) || value.format !== format || !text(value.run_id, 200) || !text(value.command_id)
            || !positive(value.version) || !digest(value.approval_fingerprint) || !text(value.provider_ref)
            || !text(value.source_installation_id) || !validScope(value.scope) || !pair(value)
            || !closed(value.source_result, receiptKeys) || !text(value.source_result.local_entity_id)
            || !positive(value.source_result.source_revision) || !text(value.source_result.result_reference, 1000)
            || !['application/json', 'text/csv'].includes(value.content_type)
            || !positive(value.byte_length) || value.byte_length > 4_194_304 || !digest(value.content_sha256)) return null;
        return Object.freeze({ ...value, scope: Object.freeze({ ...value.scope }), source_result: Object.freeze({ ...value.source_result }) });
    } catch { return null; }
};

const finiteJson = (value, depth = 0) => depth <= 40 && (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.every(item => finiteJson(item, depth + 1)))
    || (object(value) && Object.values(value).every(item => finiteJson(item, depth + 1))));

export const matchOwnerJourneyResultBinding = ({ header, runId, command, scope, provider, representation } = {}) => {
    try {
        const binding = decodeOwnerJourneyResultBinding(header);
        if (!binding || !text(runId, 200) || binding.run_id !== runId) return null;
        validateNativeCommandModel('CommandResponse', command);
        if (command.state !== 'source_applied' || command.payload?.payload_type !== 'native_action'
            || command.command_id !== binding.command_id || command.version !== binding.version
            || command.approval_fingerprint !== binding.approval_fingerprint || command.provider_ref !== binding.provider_ref
            || command.capability !== binding.capability_code || command.action !== binding.operation
            || command.organization_id !== binding.scope.organization_id || command.activity_id !== binding.scope.activity_id
            || !receiptKeys.every(key => command.source_result?.[key] === binding.source_result[key])
            || !activeScopeMatches(scope, binding.scope) || provider?.platform !== 'catalog' || provider.provider_ref !== binding.provider_ref
            || provider.activity_id !== binding.scope.activity_id || !Array.isArray(provider.installations)
            || !provider.installations.some(row => row?.installation_id === binding.source_installation_id && row.activity_id === binding.scope.activity_id)) return null;
        const bytes = representation?.bytes;
        if (!Buffer.isBuffer(bytes) || bytes.length !== binding.byte_length || representation.contentType !== binding.content_type
            || !digest(representation.sha256) || representation.sha256 !== binding.content_sha256 || sha(bytes) !== binding.content_sha256) return null;
        const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (binding.content_type === 'application/json' && !finiteJson(JSON.parse(body))) return null;
        return Object.freeze({ sourceInstallationId: binding.source_installation_id, scope: Object.freeze({ ...binding.scope }) });
    } catch { return null; }
};
