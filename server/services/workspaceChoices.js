import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';

const fail = () => { throw new SharedProductReadError('workspace_choice_changed', 409); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const stamp = principal => crypto.createHash('sha256').update(JSON.stringify([
    principal.tenantId, principal.userId, principal.sessionId, principal.authVersion,
    principal.sessionExpiresAt, principal.role,
])).digest('hex');
const canonical = value => {
    const visit = (item, depth = 0) => {
        if (depth > 30) fail();
        if (item === null || typeof item === 'string' || typeof item === 'boolean'
            || (typeof item === 'number' && Number.isFinite(item))) return item;
        if (!item || typeof item !== 'object') fail();
        const descriptors = Object.getOwnPropertyDescriptors(item);
        if (Object.values(descriptors).some(d => d.get || d.set)) fail();
        if (Array.isArray(item)) return item.map(child => visit(child, depth + 1));
        if (Object.getPrototypeOf(item) !== Object.prototype) fail();
        return Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key], depth + 1)]));
    };
    const raw = JSON.stringify(visit(value));
    if (Buffer.byteLength(raw) > 65_536) fail();
    return raw;
};
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const contextIdentity = context => {
    if (!context || !text(context.actorId) || !text(context.organizationId)
        || !text(context.nativeAccountId) || !text(context.identityGeneration) || !text(context.revision)
        || !text(context.validUntil) || !/(?:Z|[+-]\d\d:\d\d)$/.test(context.validUntil)
        || !Number.isFinite(Date.parse(context.validUntil))) fail();
    const coreAccountId = context.coreAccountId ?? context.identity?.coreAccountId ?? null;
    const consumerInstallationId = context.consumerInstallationId ?? null;
    if ((coreAccountId !== null && !text(coreAccountId)) || (consumerInstallationId !== null && !text(consumerInstallationId))) fail();
    return [context.actorId, context.organizationId, context.nativeAccountId, coreAccountId, consumerInstallationId, context.identityGeneration, context.revision];
};
const choiceFor = (context, kind, key) => {
    if (!/^[a-z][a-z_]{0,63}$/.test(kind) || !text(key)) fail();
    const rows = context.choices?.[kind];
    if (!Array.isArray(rows)) fail();
    const matches = rows.filter(row => row?.key === key);
    if (matches.length !== 1 || matches[0].selectable !== true) fail();
    return matches[0];
};

// A display choice is a session-bound reference, never a permission or a
// credential. Consumers must still check the current Core action/grant at the
// actual operation. No registration/scope/account IDs need manual UI entry.
export class WorkspaceChoices {
    constructor({ encryption, verifyLocalPrincipal, loadContext, now = () => Date.now(), ttlMs = 300_000 }) {
        if (typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || typeof verifyLocalPrincipal !== 'function' || typeof loadContext !== 'function'
            || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 300_000) {
            throw new TypeError('Workspace choices require encryption and current principal/context verification');
        }
        this.encryption = encryption;
        this.verify = verifyLocalPrincipal;
        this.loadContext = loadContext;
        this.now = now;
        this.ttlMs = ttlMs;
    }
    assertLocal(principal) {
        if (!Number.isSafeInteger(principal?.tenantId) || principal.tenantId < 1
            || !Number.isSafeInteger(principal.userId) || principal.userId < 1
            || !text(principal.sessionId) || !Number.isSafeInteger(principal.authVersion)
            || principal.authVersion < 0 || !Number.isSafeInteger(principal.sessionExpiresAt)
            || principal.sessionExpiresAt * 1000 <= this.now() || this.verify(principal) !== true) fail();
    }
    issue(principal, context, { kind, key }) {
        this.assertLocal(principal);
        const identity = contextIdentity(context);
        const option = choiceFor(context, kind, key);
        const expires = Math.min(this.now() + this.ttlMs, Date.parse(context.validUntil), principal.sessionExpiresAt * 1000);
        if (expires <= this.now()) fail();
        const value = { purpose: 'wa-connections-choice-v1', principal: stamp(principal),
            context: identity, kind, key, version: option.version ?? null, expires, nonce: crypto.randomUUID() };
        const raw = JSON.stringify(value);
        const encrypted = this.encryption.encrypt(raw);
        if (typeof encrypted !== 'string' || !encrypted.length || encrypted.length > 12_288
            || encrypted.includes(raw) || encrypted.includes(key)) fail();
        return Buffer.from(encrypted, 'utf8').toString('base64url');
    }
    async resolve(principal, token, expectedKind) {
        this.assertLocal(principal);
        if (typeof token !== 'string' || token.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(token)) fail();
        let value;
        try {
            const encrypted = Buffer.from(token, 'base64url').toString('utf8');
            value = JSON.parse(this.encryption.decrypt(encrypted));
        } catch { fail(); }
        if (value?.purpose !== 'wa-connections-choice-v1' || value.principal !== stamp(principal)
            || value.kind !== expectedKind || !Number.isSafeInteger(value.expires) || value.expires <= this.now()) fail();
        const before = stamp(principal);
        const context = await this.loadContext(principal);
        this.assertLocal(principal);
        if (before !== stamp(principal) || JSON.stringify(contextIdentity(context)) !== JSON.stringify(value.context)
            || Date.parse(context.validUntil) <= this.now() || value.expires <= this.now()) fail();
        const option = choiceFor(context, expectedKind, value.key);
        if ((option.version ?? null) !== value.version) fail();
        return { option, context };
    }
    issueReview(principal, context, { operation, payload }) {
        this.assertLocal(principal);
        const identity = contextIdentity(context);
        if (typeof operation !== 'string' || !/^[a-z][a-z0-9_.]{0,99}$/.test(operation)) fail();
        const expires = Math.min(this.now() + this.ttlMs, Date.parse(context.validUntil), principal.sessionExpiresAt * 1000);
        if (expires <= this.now()) fail();
        const raw = canonical({ purpose: 'wa-workspace-review-v1', principal: stamp(principal), context: identity,
            operation, payload, payloadHash: hash(payload), expires, idempotencyKey: crypto.randomUUID() });
        const encrypted = this.encryption.encrypt(raw);
        if (typeof encrypted !== 'string' || !encrypted.length || encrypted.length > 131_072 || encrypted.includes(raw)) fail();
        return Buffer.from(encrypted, 'utf8').toString('base64url');
    }
    async resolveReview(principal, token, expectedOperation) {
        this.assertLocal(principal);
        if (typeof token !== 'string' || token.length > 180_000 || !/^[A-Za-z0-9_-]+$/.test(token)) fail();
        let value;
        try { value = JSON.parse(this.encryption.decrypt(Buffer.from(token, 'base64url').toString('utf8'))); }
        catch { fail(); }
        if (value?.purpose !== 'wa-workspace-review-v1' || value.principal !== stamp(principal)
            || !(Array.isArray(expectedOperation) ? expectedOperation.includes(value.operation) : value.operation === expectedOperation)
            || !Number.isSafeInteger(value.expires) || value.expires <= this.now()
            || typeof value.idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/.test(value.idempotencyKey)
            || value.payloadHash !== hash(value.payload)) fail();
        const before = stamp(principal);
        const context = await this.loadContext(principal);
        this.assertLocal(principal);
        if (before !== stamp(principal) || JSON.stringify(contextIdentity(context)) !== JSON.stringify(value.context)
            || Date.parse(context.validUntil) <= this.now() || value.expires <= this.now()) fail();
        return { operation: value.operation, payload: value.payload, payloadHash: value.payloadHash,
            idempotencyKey: value.idempotencyKey, expiresAt: value.expires, context };
    }
}
