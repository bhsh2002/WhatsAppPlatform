import crypto from 'node:crypto';

const bindingFields = ['integrationId', 'tenantId', 'platformCode', 'organizationId', 'localPlatformTenantId', 'remotePlatformTenantId', 'remoteExternalTenantId'];
const snapshotFields = ['connectionId', 'version', 'status', 'scopes', 'binding'];
const statuses = new Set(['pending_authorization', 'active', 'paused', 'degraded', 'revoked', 'rejected', 'error', 'disconnected']);
const replacementStatuses = new Set(['disconnected', 'revoked', 'error']);
const localStatus = status => status === 'rejected' ? 'revoked' : status;
const bindingColumns = { integrationId: 'id', tenantId: 'tenant_id', platformCode: 'platform_code', organizationId: 'organization_id',
    localPlatformTenantId: 'local_platform_tenant_id', remotePlatformTenantId: 'remote_platform_tenant_id', remoteExternalTenantId: 'remote_external_tenant_id' };
const locks = new WeakMap();
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 255 && !value.includes('\0');
const positive = value => Number.isSafeInteger(value) && value > 0;
const closed = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const canonical = value => JSON.stringify(value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
        : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const scopesOf = value => {
    if (!Array.isArray(value) || !value.every(text)) fail('lifecycle_snapshot_invalid', 422);
    return [...new Set(value)].sort();
};

export class SavanaLifecycleStateError extends Error {
    constructor(code, statusCode = 409) { super(code); this.name = 'SavanaLifecycleStateError'; this.code = code; this.statusCode = statusCode; }
}
const fail = (code, statusCode = 409) => { throw new SavanaLifecycleStateError(code, statusCode); };

// Internal snapshots only. The caller authenticates and validates the actual
// Core wire contract before using this module; it never supplies missing versions.
export const normalizeSavanaLifecycleSnapshot = input => {
    if (!closed(input, snapshotFields) || !text(input.connectionId) || !statuses.has(input.status)
        || !closed(input.binding, bindingFields) || !positive(input.binding.integrationId) || !positive(input.binding.tenantId)
        || !bindingFields.slice(2).every(key => text(input.binding[key]))) fail('lifecycle_snapshot_invalid', 422);
    if (!Number.isSafeInteger(input.version) || input.version < 0) fail('lifecycle_version_required');
    return Object.freeze({ connectionId: input.connectionId, version: input.version, status: input.status,
        scopes: Object.freeze(scopesOf(input.scopes)), binding: Object.freeze({ ...input.binding }) });
};
export const fingerprintSavanaLifecycleSnapshot = input => hash(normalizeSavanaLifecycleSnapshot(input));

const parsedScopes = row => {
    try { return scopesOf(JSON.parse(row.scopes_json)); } catch { fail('lifecycle_state_changed'); }
};
const sameScopes = (left, right) => canonical(left) === canonical(right);
const currentBindingMatches = (row, binding, { allowMissing = false, replacement = false } = {}) => bindingFields.every(key => {
    const actual = row[bindingColumns[key]];
    if (['integrationId', 'tenantId', 'platformCode'].includes(key)) return actual === binding[key];
    return replacement || actual === binding[key] || (allowMissing && actual === null);
});
const thenable = value => value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';

export const createSavanaLifecycleState = ({ database, now = () => Date.now() }) => {
    if (typeof database?.prepare !== 'function' || typeof database.transaction !== 'function' || typeof now !== 'function') {
        throw new TypeError('An explicit lifecycle database and clock are required');
    }
    const read = connectionId => {
        if (!text(connectionId)) fail('lifecycle_snapshot_invalid', 422);
        const row = database.prepare('SELECT * FROM savana_lifecycle_state WHERE connection_id=?').get(connectionId);
        return row ? { connectionId: row.connection_id, version: row.lifecycle_version, status: row.status,
            scopes: JSON.parse(row.scopes_json), binding: JSON.parse(row.binding_json), snapshotFingerprint: row.snapshot_sha256,
            pendingCleanupVersion: row.pending_cleanup_version, pendingCleanupFingerprint: row.pending_cleanup_sha256 } : null;
    };
    const applyVerified = (input, options = {}) => {
        const snapshot = normalizeSavanaLifecycleSnapshot(input);
        const { onApply, onDuplicate = null, duplicateEffect = 'initial_key_fill', verifyCurrentState = null, expectedConnectionId, allowConnectionChange = false } = options;
        if (!Object.hasOwn(options, 'expectedConnectionId') || !(expectedConnectionId === null || text(expectedConnectionId))) fail('lifecycle_expected_connection_required', 422);
        if (typeof onApply !== 'function' || onApply.constructor?.name === 'AsyncFunction'
            || (onDuplicate !== null && (typeof onDuplicate !== 'function' || onDuplicate.constructor?.name === 'AsyncFunction'))
            || (verifyCurrentState !== null && (typeof verifyCurrentState !== 'function' || verifyCurrentState.constructor?.name === 'AsyncFunction'))
            || typeof allowConnectionChange !== 'boolean') fail('lifecycle_callback_invalid', 500);
        if (!['initial_key_fill', 'pending_key_clear'].includes(duplicateEffect)) fail('lifecycle_duplicate_effect_invalid', 422);
        if (duplicateEffect === 'pending_key_clear' && snapshot.status !== 'pending_authorization') fail('lifecycle_duplicate_key_clear_forbidden');
        const active = locks.get(database) || new Set(); locks.set(database, active);
        const lock = snapshot.binding.integrationId;
        if (active.has(lock)) fail('lifecycle_reentrant');
        active.add(lock);
        try {
            return database.transaction(() => {
                const initialRow = database.prepare('SELECT * FROM savana_integrations WHERE id=?').get(snapshot.binding.integrationId);
                if (!initialRow || initialRow.connection_id !== expectedConnectionId) fail('lifecycle_binding_changed');
                Object.freeze(initialRow);
                const stored = database.prepare('SELECT * FROM savana_lifecycle_state WHERE connection_id=?').get(snapshot.connectionId);
                const replacement = initialRow.connection_id !== null && initialRow.connection_id !== snapshot.connectionId;
                if (replacement && (stored || !allowConnectionChange || !replacementStatuses.has(initialRow.status))) fail('lifecycle_binding_conflict');
                if (!currentBindingMatches(initialRow, snapshot.binding, { allowMissing: !stored, replacement })) fail('lifecycle_binding_conflict');
                const snapshotFingerprint = hash(snapshot), bindingFingerprint = hash(snapshot.binding);
                if (stored && (stored.integration_id !== snapshot.binding.integrationId || stored.binding_sha256 !== bindingFingerprint)) fail('lifecycle_binding_conflict');
                const proofRequired = !stored || stored.lifecycle_version === null || duplicateEffect === 'pending_key_clear';
                const proofContext = Object.freeze({ snapshotFingerprint, initialRow });
                const verifyProof = (required = proofRequired) => {
                    if (verifyCurrentState === null) { if (required) fail('lifecycle_current_state_required'); return; }
                    const verified = verifyCurrentState(snapshot, proofContext);
                    if (thenable(verified) || verified !== true) fail('lifecycle_current_state_required');
                };
                const assertUnchanged = () => {
                    if (canonical(database.prepare('SELECT * FROM savana_integrations WHERE id=?').get(snapshot.binding.integrationId)) !== canonical(initialRow)) {
                        fail('lifecycle_binding_changed');
                    }
                };
                const assertApplied = () => {
                    const finalRow = database.prepare('SELECT * FROM savana_integrations WHERE id=?').get(snapshot.binding.integrationId);
                    if (!finalRow || finalRow.connection_id !== snapshot.connectionId || !currentBindingMatches(finalRow, snapshot.binding)
                        || finalRow.status !== localStatus(snapshot.status) || !sameScopes(parsedScopes(finalRow), snapshot.scopes)) fail('lifecycle_apply_incomplete', 500);
                    return finalRow;
                };
                const markPendingCleanup = () => {
                    const marked = database.prepare(`UPDATE savana_lifecycle_state SET pending_cleanup_version=?,pending_cleanup_sha256=?
                        WHERE connection_id=? AND lifecycle_version=? AND snapshot_sha256=?`)
                        .run(snapshot.version, snapshotFingerprint, snapshot.connectionId, snapshot.version, snapshotFingerprint);
                    if (marked.changes !== 1) fail('lifecycle_state_changed');
                };
                if (stored?.lifecycle_version !== null && stored?.lifecycle_version !== undefined) {
                    if (initialRow.connection_id !== snapshot.connectionId || initialRow.status !== localStatus(stored.status)
                        || !sameScopes(parsedScopes(initialRow), JSON.parse(stored.scopes_json))) fail('lifecycle_state_changed');
                    if (snapshot.version < stored.lifecycle_version) fail('lifecycle_version_stale');
                    if (snapshot.version === stored.lifecycle_version) {
                        if (stored.snapshot_sha256 !== snapshotFingerprint) fail('lifecycle_version_conflict');
                        if (duplicateEffect === 'pending_key_clear') {
                            verifyProof(true); assertUnchanged();
                            const alreadyCleaned = stored.pending_cleanup_version === snapshot.version && stored.pending_cleanup_sha256 === snapshotFingerprint;
                            if (!alreadyCleaned && initialRow.webhook_secret_encrypted !== null) {
                                if (onDuplicate === null) fail('lifecycle_callback_invalid', 500);
                                if (thenable(onDuplicate(snapshot))) fail('lifecycle_callback_invalid', 500);
                            }
                            if (!alreadyCleaned) {
                                if (assertApplied().webhook_secret_encrypted !== null) fail('lifecycle_apply_incomplete', 500);
                                markPendingCleanup();
                            }
                            verifyProof(true);
                            if (alreadyCleaned) assertUnchanged();
                            else if (assertApplied().webhook_secret_encrypted !== null) fail('lifecycle_apply_incomplete', 500);
                        } else if (onDuplicate !== null) {
                            if (!['pending_authorization', 'active', 'degraded'].includes(snapshot.status) || initialRow.webhook_secret_encrypted !== null) fail('lifecycle_duplicate_key_fill_forbidden');
                            verifyProof(true); assertUnchanged();
                            if (thenable(onDuplicate(snapshot))) fail('lifecycle_callback_invalid', 500);
                            verifyProof(true);
                            const ciphertext = assertApplied().webhook_secret_encrypted;
                            if (typeof ciphertext !== 'string' || ciphertext.length === 0) fail('lifecycle_apply_incomplete', 500);
                        }
                        return { applied: false, duplicate: true, connectionId: snapshot.connectionId, version: snapshot.version,
                            status: snapshot.status, snapshotFingerprint };
                    }
                }
                verifyProof();
                assertUnchanged();
                const result = onApply(snapshot);
                if (thenable(result)) fail('lifecycle_callback_invalid', 500);
                assertApplied();
                if (duplicateEffect === 'pending_key_clear' && assertApplied().webhook_secret_encrypted !== null) fail('lifecycle_apply_incomplete', 500);
                const stamp = new Date(now()).toISOString();
                database.prepare(`INSERT INTO savana_lifecycle_state(connection_id,integration_id,lifecycle_version,binding_sha256,snapshot_sha256,binding_json,status,scopes_json,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET lifecycle_version=excluded.lifecycle_version,
                    snapshot_sha256=excluded.snapshot_sha256,status=excluded.status,scopes_json=excluded.scopes_json,updated_at=excluded.updated_at`)
                    .run(snapshot.connectionId, snapshot.binding.integrationId, snapshot.version, bindingFingerprint, snapshotFingerprint,
                        canonical(snapshot.binding), snapshot.status, canonical(snapshot.scopes), stamp, stamp);
                if (duplicateEffect === 'pending_key_clear') markPendingCleanup();
                verifyProof();
                assertApplied();
                if (duplicateEffect === 'pending_key_clear' && assertApplied().webhook_secret_encrypted !== null) fail('lifecycle_apply_incomplete', 500);
                return { applied: true, duplicate: false, connectionId: snapshot.connectionId, version: snapshot.version,
                    status: snapshot.status, snapshotFingerprint };
            }).immediate();
        } finally { active.delete(lock); }
    };
    return { read, applyVerified };
};
