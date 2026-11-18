import crypto from 'node:crypto';
import { canonicalWorkspaceJson } from './workspaceIntents.js';

const TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_REF_BYTES = 65_536;
const TYPES = new Set(['intent', 'command', 'record', 'request', 'read_grant']);
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 255;
export class WorkspaceReferenceError extends Error {
    constructor(code, status = 403) { super(code); this.code = code; this.status = status; this.statusCode = status; }
}
const fail = (code, status) => { throw new WorkspaceReferenceError(code, status); };
const contextValues = (principal, identity) => {
    if (!Number.isSafeInteger(principal?.tenantId) || principal.tenantId < 1 || !Number.isSafeInteger(principal?.userId) || principal.userId < 1
        || ![identity?.actorId, identity?.organizationId, identity?.nativeAccountId].every(text)) fail('workspace_reference_context_changed');
    return [principal.tenantId, principal.userId, identity.actorId, identity.organizationId, identity.nativeAccountId];
};
// Stable browser record partition, never identity evidence or an authorization grant.
export const workspaceContextReference = (principal, identity) => crypto.createHash('sha256')
    .update(canonicalWorkspaceJson(['wa-workspace-context-v1', ...contextValues(principal, identity)])).digest('hex');
const principalStamp = p => canonicalWorkspaceJson([p?.tenantId, p?.userId, p?.sessionId, p?.authVersion, p?.role,
    p?.sessionExpiresAt, p?.issuedAt ?? null]);
const identityStamp = identity => canonicalWorkspaceJson([identity.actorId, identity.organizationId, identity.nativeAccountId,
    identity.generation, Date.parse(identity.expiresAt)]);

export class WorkspaceReferences {
    constructor({ encryption, verifyLocalPrincipal, currentIdentity, now = () => Date.now() } = {}) {
        if (typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || [verifyLocalPrincipal, currentIdentity, now].some(value => typeof value !== 'function')) {
            throw new TypeError('Workspace references require explicit cipher and fresh identity readers');
        }
        this.cipher = encryption; this.verify = verifyLocalPrincipal; this.currentIdentity = currentIdentity; this.now = now;
    }
    #local(principal, expected) {
        let verified = false;
        try { verified = this.verify(principal); } catch { /* Fixed identity error only. */ }
        if (verified !== true || !Number.isSafeInteger(principal?.userId) || !Number.isSafeInteger(principal?.tenantId)
            || typeof principal?.sessionId !== 'string' || !principal.sessionId || !Number.isSafeInteger(principal.authVersion)
            || principal.authVersion < 0 || !text(principal.role) || !Number.isSafeInteger(principal?.sessionExpiresAt)
            || principal.sessionExpiresAt * 1000 <= this.now() || (expected && principalStamp(principal) !== expected)) fail('workspace_reference_context_changed');
    }
    #identity(principal, identity) {
        contextValues(principal, identity);
        if (!text(identity.generation) || typeof identity.expiresAt !== 'string'
            || !Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= this.now()) fail('workspace_reference_context_changed');
    }
    issue(principal, verifiedIdentity, { type, key, version } = {}) {
        this.#local(principal); this.#identity(principal, verifiedIdentity);
        if (!TYPES.has(type) || !text(key) || (version !== undefined
            && (type === 'intent' || !Number.isSafeInteger(version) || version < 1))) fail('workspace_reference_invalid', 422);
        const local = principalStamp(principal); const owner = identityStamp(verifiedIdentity);
        const issuedAt = this.now();
        const raw = canonicalWorkspaceJson({ format: 1, type, key, ...(version === undefined ? {} : { version }), context: workspaceContextReference(principal, verifiedIdentity),
            issued_at: issuedAt, expires_at: issuedAt + TTL });
        let sealed;
        try {
            sealed = this.cipher.encrypt(raw);
            if (typeof sealed !== 'string' || !sealed || sealed.includes(raw) || this.cipher.decrypt(sealed) !== raw) throw new Error();
        } catch { fail('workspace_reference_encryption_unavailable', 503); }
        this.#local(principal, local); this.#identity(principal, verifiedIdentity);
        if (identityStamp(verifiedIdentity) !== owner) fail('workspace_reference_context_changed');
        const ref = `wr1.${Buffer.from(sealed, 'utf8').toString('base64url')}`;
        if (Buffer.byteLength(ref) > MAX_REF_BYTES) fail('workspace_reference_invalid', 422);
        return ref;
    }
    async #current(principal, local) {
        let current;
        try { current = await this.currentIdentity(principal); }
        catch (error) {
            this.#local(principal, local);
            fail([401, 403].includes(error?.status || error?.statusCode) ? 'workspace_reference_context_changed' : 'workspace_reference_identity_unavailable',
                [401, 403].includes(error?.status || error?.statusCode) ? 403 : 503);
        }
        this.#local(principal, local); this.#identity(principal, current);
        return current;
    }
    async resolve(principal, reference, expectedType) {
        this.#local(principal); const local = principalStamp(principal);
        if (!TYPES.has(expectedType) || typeof reference !== 'string' || Buffer.byteLength(reference) > MAX_REF_BYTES
            || !/^wr1\.[A-Za-z0-9_-]+$/.test(reference)) fail('workspace_reference_invalid', 422);
        const openedIdentity = await this.#current(principal, local);
        const owner = identityStamp(openedIdentity);
        let envelope; let invalid = false;
        try {
            const opaque = reference.slice(4); const buffer = Buffer.from(opaque, 'base64url');
            if (buffer.toString('base64url') !== opaque) throw new Error();
            envelope = JSON.parse(this.cipher.decrypt(buffer.toString('utf8')));
            if (!envelope || Object.keys(envelope).some(key => !['format','type','key','version','context','issued_at','expires_at'].includes(key))
                || envelope.format !== 1 || envelope.type !== expectedType || !text(envelope.key)
                || (Object.hasOwn(envelope, 'version') && (envelope.type === 'intent' || !Number.isSafeInteger(envelope.version) || envelope.version < 1))
                || !Number.isSafeInteger(envelope.issued_at) || !Number.isSafeInteger(envelope.expires_at)
                || envelope.expires_at !== envelope.issued_at + TTL || envelope.issued_at > this.now()) throw new Error();
        } catch { invalid = true; }
        this.#local(principal, local);
        const current = await this.#current(principal, local);
        if (invalid) fail('workspace_reference_unavailable', 404);
        if (identityStamp(current) !== owner || envelope.context !== workspaceContextReference(principal, current)) fail('workspace_reference_context_changed');
        if (envelope.expires_at <= this.now()) fail('workspace_reference_expired', 410);
        return { key: envelope.key, ...(Object.hasOwn(envelope, 'version') ? { version: envelope.version } : {}), identity: { actorId: current.actorId, organizationId: current.organizationId,
            nativeAccountId: current.nativeAccountId, generation: current.generation, expiresAt: current.expiresAt } };
    }
}
