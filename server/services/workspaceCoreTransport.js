import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';

const fail = (code, status = 503) => { throw new SharedProductReadError(code, status); };
const text = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max;
const stamp = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const principalStamp = p => stamp([p.tenantId, p.userId, p.sessionId, p.authVersion, p.sessionExpiresAt, p.role]);
const identityStamp = owner => stamp([owner.actorId, owner.organizationId, owner.generation, owner.expiresAt, owner.accessToken]);
const publicIdentity = opened => ({ actorId: opened.owner.actorId, organizationId: opened.owner.organizationId,
    nativeAccountId: opened.externalTenant, coreAccountId: opened.native?.id ?? null,
    generation: opened.owner.generation, expiresAt: opened.owner.expiresAt });
const jsonBody = body => {
    if (body === undefined) return undefined;
    const visited = new Set();
    const check = value => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean'
            || (typeof value === 'number' && Number.isFinite(value))) return;
        if (typeof value !== 'object' || visited.has(value)
            || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) fail('workspace_request_invalid', 422);
        visited.add(value);
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if (descriptor.get || descriptor.set) fail('workspace_request_invalid', 422);
            check(descriptor.value);
        }
        visited.delete(value);
    };
    check(body);
    const raw = JSON.stringify(body);
    if (Buffer.byteLength(raw) > 1_048_576) fail('workspace_request_invalid', 422);
    return raw;
};
const noSecrets = value => {
    if (Array.isArray(value)) return value.forEach(noSecrets);
    if (!value || typeof value !== 'object') return;
    const prohibited = /^(?:cookie|set-cookie|secret|credential_secret|access_token|refresh_token|password|private_key|private_key_pem|portal_secret|ciphertext|encrypted_key|authorization)$/i;
    for (const [key, item] of Object.entries(value)) {
        if (prohibited.test(key)) fail('workspace_response_invalid', 502);
        noSecrets(item);
    }
};

const readJson = async response => {
    if (Number(response.headers.get('content-length')) > 1_048_576) fail('workspace_response_invalid', 502);
    const reader = response.body?.getReader();
    if (!reader) fail('workspace_response_invalid', 502);
    const chunks = []; let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1_048_576) {
                await reader.cancel();
                fail('workspace_response_invalid', 502);
            }
            chunks.push(Buffer.from(value));
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!payload || typeof payload !== 'object') fail('workspace_response_invalid', 502);
        noSecrets(payload);
        return payload;
    } catch (error) {
        if (error instanceof SharedProductReadError) throw error;
        fail('workspace_response_invalid', 502);
    } finally { reader.releaseLock(); }
};
const readRepresentation = async (response, format) => {
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType !== (format === 'csv' ? 'text/csv' : 'application/json') || Number(response.headers.get('content-length')) > 4_194_304) fail('workspace_result_invalid', 502);
    const expectedHash = response.headers.get('x-savana-result-sha256');
    if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || !response.body?.getReader) fail('workspace_result_invalid', 502);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
        while (true) {
            const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
            if (size > 4_194_304) { await reader.cancel(); fail('workspace_result_invalid', 502); }
            chunks.push(Buffer.from(next.value));
        }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) fail('workspace_result_invalid', 502);
    if (format === 'json') {
        let decoded; try { decoded = JSON.parse(bytes.toString('utf8')); } catch { fail('workspace_result_invalid', 502); }
        if (!decoded || typeof decoded !== 'object') fail('workspace_result_invalid', 502);
        noSecrets(decoded);
    }
    return { contentType, sha256: actualHash, bytes };
};

// Internal HTTP boundary for Core's delegated owner workspace. Paths are
// supplied by the source-owned protocol adapter, never forwarded from a browser.
// OIDC proves current identity; Core still authorizes every requested operation.
export class WorkspaceCoreTransport {
    constructor({ setupService, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
        if (typeof setupService?.assertLocal !== 'function' || typeof setupService.identity !== 'function'
            || typeof setupService.nativeAccount !== 'function' || typeof setupService.store?.ownerCurrent !== 'function') {
            throw new TypeError('Workspace transport requires current native identity and account binding');
        }
        this.setup = setupService; this.fetch = fetchImpl; this.now = now;
        const url = new URL(setupService.config.centerOrigin);
        const loopback = setupService.config.allowLoopback === true && url.protocol === 'http:'
            && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
        const privateService = url.protocol === 'http:' && url.hostname === 'savana-connect' && url.port === '8010';
        if (!(url.protocol === 'https:' || loopback || privateService) || url.username || url.password
            || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Workspace requires a fixed trusted Core origin');
        this.origin = url.origin;
    }
    assertLocal(principal, expected) {
        this.setup.assertLocal(principal);
        if (expected && principalStamp(principal) !== expected) fail('workspace_context_changed', 403);
    }
    async #current(principal, expected, { allowUnbound = false } = {}) {
        this.assertLocal(principal, expected?.principal);
        const local = principalStamp(principal);
        const owner = await this.setup.identity(principal);
        this.assertLocal(principal, local);
        if (!text(owner?.actorId) || !text(owner.organizationId) || !text(owner.generation)
            || !text(owner.accessToken, 16384) || !text(owner.expiresAt)
            || !/(?:Z|[+-]\d\d:\d\d)$/.test(owner.expiresAt)
            || !Number.isFinite(Date.parse(owner.expiresAt)) || Date.parse(owner.expiresAt) <= this.now()
            || !this.setup.store.ownerCurrent(principal, owner)) fail('workspace_identity_required', 403);
        const ownerHash = identityStamp(owner);
        if (expected && ownerHash !== expected.identity) fail('workspace_context_changed', 403);
        const externalTenant = `wa_savana:tenant:${principal.tenantId}`;
        const native = await this.setup.nativeAccount(principal, owner, { allowUnbound });
        this.assertLocal(principal, local);
        if (!this.setup.store.ownerCurrent(principal, owner) || ownerHash !== identityStamp(owner)
            || (native === null ? !allowUnbound : !text(native?.id) || native.platform_code !== 'wa_savana' || native.status !== 'active'
                || native.organization_id !== owner.organizationId || native.external_tenant_id !== externalTenant)
            || (expected && expected.nativeAccount !== (native?.id ?? null))) fail('workspace_context_changed', 403);
        return { owner, native, externalTenant, proof: { principal: local, identity: ownerHash, nativeAccount: native?.id ?? null } };
    }
    async currentIdentity(principal, options) { return publicIdentity(await this.#current(principal, undefined, options)); }
    async request(principal, { method = 'GET', path, body, expectedIdentity, notAfter, representation = null, consumerInstallation = null }) {
        let target; let bodyJson; let opened;
        // Core explicitly permits discovery/binding before a platform account
        // exists. This is an identity/setup boundary, never a command grant.
        const allowUnbound = method === 'GET' && ['/v1/integration/workspace', '/v1/integration/workspace/discovery',
            '/v1/integration/workspace/binding-requests/lookup'].includes(path?.split('?')[0])
            || method === 'POST' && ['/v1/integration/workspace/binding-requests', '/v1/integration/workspace/activities'].includes(path);
        try {
        // Encoded slashes/dot segments and caller-selected origins are forbidden.
        if (!['GET', 'POST', 'PATCH', 'PUT'].includes(method) || typeof path !== 'string'
            || path.length > 4096 || !/^\/v1\/integration\/workspace(?:[/?]|$)/.test(path)
            || /[\u0000-\u0020\u007f\\#]/.test(path) || /%(?:2f|5c|2e)/i.test(path)
            || /%(?:0[0-9a-f]|1[0-9a-f]|20|7f)/i.test(path.split('?')[0])
            || path.split('?')[0].split('/').some(part => part === '.' || part === '..')
            || (method === 'GET' && body !== undefined)) fail('workspace_request_invalid', 422);
        target = new URL(path, this.origin);
        if (target.origin !== this.origin || !/^\/v1\/integration\/workspace(?:\/|$)/.test(target.pathname)) fail('workspace_request_invalid', 422);
        if (representation !== null && (method !== 'GET' || !['json', 'csv'].includes(representation)
            || !/^\/v1\/integration\/workspace\/commands\/[A-Za-z0-9_:.-]+\/result$/.test(target.pathname)
            || target.searchParams.size !== 1 || target.searchParams.get('format') !== representation)) fail('workspace_request_invalid', 422);
        bodyJson = jsonBody(body);
        if (consumerInstallation !== null && (!text(consumerInstallation, 255) || /[\r\n]/.test(consumerInstallation))) fail('workspace_request_invalid', 422);
        if (notAfter !== undefined && (!Number.isSafeInteger(notAfter) || notAfter <= this.now())) fail('workspace_review_expired', 409);
        opened = await this.#current(principal, undefined, { allowUnbound });
        if (expectedIdentity && ['actorId', 'organizationId', 'nativeAccountId', 'coreAccountId', 'generation', 'expiresAt']
            .some(key => expectedIdentity[key] !== publicIdentity(opened)[key])) fail('workspace_context_changed', 403);
        if (!text(this.setup.config.platformToken, 16384)) fail('workspace_configuration_required');
        if (notAfter !== undefined && notAfter <= this.now()) fail('workspace_review_expired', 409);
        } catch (error) {
            const failure = error instanceof SharedProductReadError ? error : new SharedProductReadError('workspace_context_changed', 403);
            failure.requestDispatched = false;
            throw failure;
        }
        let response;
        try {
            response = await this.fetch(target.href, { method, redirect: 'error', cache: 'no-store',
                signal: AbortSignal.timeout(5000), headers: {
                    'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': this.setup.config.platformToken,
                    Authorization: `Bearer ${opened.owner.accessToken}`,
                    ...(consumerInstallation === null ? {} : { 'X-Savana-Consumer-Installation': consumerInstallation }),
                    ...(bodyJson === undefined ? {} : { 'Content-Type': 'application/json' }),
                }, ...(bodyJson === undefined ? {} : { body: bodyJson }) });
        } catch {
            this.assertLocal(principal, opened.proof.principal);
            fail(method === 'GET' ? 'workspace_unavailable' : 'workspace_outcome_unknown');
        }
        await this.#current(principal, opened.proof, { allowUnbound });
        const payload = response.ok && representation ? await readRepresentation(response, representation) : await readJson(response);
        await this.#current(principal, opened.proof, { allowUnbound });
        if (!response.ok) {
            const status = [401, 403, 404, 409, 422, 423, 428, 429, 503].includes(response.status) ? response.status : 503;
            // Do not turn an unrecognized server/transport failure into proof
            // that a mutation had no effect. The durable caller retains it.
            const definitive = [401, 403, 404, 409, 422, 423, 428, 429].includes(response.status);
            const code = method !== 'GET' && !definitive ? 'workspace_outcome_unknown' : 'workspace_rejected';
            const error = new SharedProductReadError(code, status);
            // Internal protocol validation may establish a correlated definitive
            // rejection. A status code alone is not proof of no committed effect.
            error.remotePayload = payload;
            if (/^[a-z][a-z0-9_.]{0,99}$/.test(payload?.detail?.code || payload?.error?.code || '')) {
                error.reasonCode = payload.detail?.code || payload.error.code;
            }
            throw error;
        }
        return { payload, identity: publicIdentity(opened) };
    }
}
