import crypto from 'node:crypto';

export class WorkspaceIntentError extends Error {
    constructor(code, status = 409) { super(code); this.code = code; this.status = status; this.statusCode = status; }
}
const fail = (code, status) => { throw new WorkspaceIntentError(code, status); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const text = (value, max = 255) => typeof value === 'string' && value.length > 0 && value.length <= max;
const rejectedStatuses = new Set([401, 403, 404, 409, 422, 423, 428, 429]);
const localNoEffectCodes = new Set(['workspace_review_expired','workspace_context_changed','workspace_request_invalid','workspace_configuration_required']);
const localNoEffect = outcome => outcome.state === 'failed' && outcome.definitiveNoEffect === true
    && outcome.dispatchAttempted === false && localNoEffectCodes.has(outcome.errorCode);
const unresolved = "state IN ('prepared','inflight','unknown')";
const MAX_BYTES = 1_048_576;

export const canonicalWorkspaceJson = (value, maxBytes = MAX_BYTES) => {
    const ancestors = new Set();
    const normalize = (item, depth) => {
        if (depth > 40) fail('workspace_request_invalid', 422);
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (!item || typeof item !== 'object' || ancestors.has(item)) fail('workspace_request_invalid', 422);
        ancestors.add(item); let result;
        if (Array.isArray(item)) {
            const keys = Object.keys(item); const fields = Object.getOwnPropertyDescriptors(item);
            if (keys.length !== item.length || Object.getOwnPropertySymbols(item).length
                || keys.some((key, index) => key !== String(index) || fields[key].get || fields[key].set)) fail('workspace_request_invalid', 422);
            result = keys.map(key => normalize(fields[key].value, depth + 1));
        } else {
            if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail('workspace_request_invalid', 422);
            const fields = Object.getOwnPropertyDescriptors(item);
            if (Object.getOwnPropertySymbols(item).length || Object.values(fields).some(field => !field.enumerable || field.get || field.set)) fail('workspace_request_invalid', 422);
            result = Object.fromEntries(Object.keys(fields).sort().map(key => [key, normalize(fields[key].value, depth + 1)]));
        }
        ancestors.delete(item); return result;
    };
    const result = JSON.stringify(normalize(value, 0));
    if (Buffer.byteLength(result) > maxBytes) fail('workspace_request_invalid', 422);
    return result;
};
const identityValues = identity => {
    if (![identity?.actorId, identity?.organizationId, identity?.nativeAccountId, identity?.generation].every(value => text(value))
        || typeof identity.expiresAt !== 'string' || !Number.isFinite(Date.parse(identity.expiresAt))) fail('workspace_identity_required', 403);
    return [identity.actorId, identity.organizationId, identity.nativeAccountId, identity.generation, new Date(Date.parse(identity.expiresAt)).toISOString()];
};
const principalValues = principal => {
    if (!Number.isSafeInteger(principal?.tenantId) || principal.tenantId < 1 || !Number.isSafeInteger(principal?.userId) || principal.userId < 1
        || !text(principal.sessionId, 4096) || !Number.isSafeInteger(principal.authVersion) || principal.authVersion < 0
        || !text(principal.role, 40) || !Number.isSafeInteger(principal.sessionExpiresAt) || principal.sessionExpiresAt < 1) fail('workspace_context_changed', 403);
    return [principal.tenantId, principal.userId, hash(principal.sessionId), principal.authVersion,
        principal.role, new Date(principal.sessionExpiresAt * 1000).toISOString()];
};
const requestBytes = request => {
    if (!request || Array.isArray(request) || Object.keys(request).some(key => !['method', 'path', 'body'].includes(key))
        || !['POST', 'PUT', 'PATCH'].includes(request.method) || !text(request.path, 4096)
        || !/^\/v1\/integration\/workspace(?:[/?]|$)/.test(request.path) || /[\u0000-\u0020\u007f\\#]/.test(request.path)
        || /%(?:2f|5c|2e)/i.test(request.path) || request.path.split('?')[0].split('/').some(part => ['.', '..'].includes(part))) fail('workspace_request_invalid', 422);
    const bodyJson = Object.hasOwn(request, 'body') ? canonicalWorkspaceJson(request.body) : null;
    return { method: request.method, path: request.path, bodyJson };
};
const binding = row => hash(canonicalWorkspaceJson([row.id, row.tenant_id, row.user_id, row.session_hash, row.auth_version,
    row.native_role, row.native_expires_at, row.central_actor_id, row.organization_id, row.native_account_id,
    row.identity_generation, row.identity_expires_at, row.operation, row.input_sha256, row.request_sha256]));

export class WorkspaceIntentStore {
    constructor({ database, encryption, verifyLocalPrincipal, loadOutcome = null, now = () => Date.now() } = {}) {
        if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || typeof verifyLocalPrincipal !== 'function' || typeof now !== 'function'
            || (loadOutcome != null && typeof loadOutcome !== 'function')) throw new TypeError('Workspace intents require an explicit database, cipher and verifier');
        this.db = database; this.cipher = encryption; this.verify = verifyLocalPrincipal; this.now = now; this.loadOutcome = loadOutcome;
    }
    #stamp() { return new Date(this.now()).toISOString(); }
    #valid(principal, identity) {
        try {
            principalValues(principal); identityValues(identity);
            return principal.sessionExpiresAt * 1000 > this.now() && Date.parse(identity.expiresAt) > this.now()
                && this.verify(principal) === true;
        } catch { return false; }
    }
    #assert(principal, identity) { if (!this.#valid(principal, identity)) fail('workspace_context_changed', 403); }
    #sameUser(row, principal, identity) {
        return row && row.tenant_id === principal.tenantId && row.user_id === principal.userId
            && row.central_actor_id === identity.actorId && row.organization_id === identity.organizationId;
    }
    #original(row, principal, identity) {
        try {
            return this.#sameUser(row, principal, identity)
                && JSON.stringify([row.tenant_id, row.user_id, row.session_hash, row.auth_version, row.native_role, row.native_expires_at]) === JSON.stringify(principalValues(principal))
                && JSON.stringify([row.central_actor_id, row.organization_id, row.native_account_id, row.identity_generation, row.identity_expires_at]) === JSON.stringify(identityValues(identity));
        } catch { return false; }
    }
    #public(row) {
        return { id: row.id, operation: row.operation, state: row.state, inputHash: row.input_sha256,
            requestHash: row.request_sha256, createdAt: row.created_at, updatedAt: row.updated_at,
            errorCode: row.error_code, result: null };
    }
    #seal(row, purpose, payload) {
        const raw = canonicalWorkspaceJson({ binding: binding(row), purpose, payload }, MAX_BYTES * 8);
        try {
            const sealed = this.cipher.encrypt(raw);
            if (typeof sealed !== 'string' || !sealed || sealed.includes(raw) || this.cipher.decrypt(sealed) !== raw) throw new Error();
            return sealed;
        } catch { fail('workspace_encryption_unavailable', 503); }
    }
    #open(row, purpose, ciphertext) {
        try {
            const envelope = JSON.parse(this.cipher.decrypt(ciphertext));
            if (envelope.binding !== binding(row) || envelope.purpose !== purpose) throw new Error();
            return envelope.payload;
        } catch { fail('workspace_encryption_unavailable', 503); }
    }
    #audit(row, action) {
        this.db.prepare(`INSERT INTO savana_workspace_intent_audit
            (intent_id,tenant_id,user_id,central_actor_id,organization_id,action,created_at) VALUES (?,?,?,?,?,?,?)`)
            .run(row.id, row.tenant_id, row.user_id, row.central_actor_id, row.organization_id, action, this.#stamp());
    }
    #row(id) { return this.db.prepare('SELECT * FROM savana_workspace_intents WHERE id=?').get(id); }
    #reviewTable() { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='savana_workspace_review_fences'").get(); }
    #review(principal, identity, idempotencyKey) {
        if (!this.#reviewTable()) return null;
        return this.db.prepare(`SELECT * FROM savana_workspace_review_fences WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=?`)
            .get(principal.tenantId, identity.actorId, identity.organizationId, idempotencyKey);
    }
    #reviewOwner(principal, identity) { return hash(canonicalWorkspaceJson([principalValues(principal), identityValues(identity), identity.coreAccountId ?? null])); }
    registerReview(principal, identity, { idempotencyKey, operation, inputHash, contextRevision, reviewExpiresAt }) {
        this.#assert(principal, identity);
        if (!this.#reviewTable()) fail('workspace_configuration_required', 503);
        if (!text(idempotencyKey) || !/^[a-z][a-z0-9_.]{0,99}$/.test(operation || '') || !/^[a-f0-9]{64}$/.test(inputHash || '')
            || !text(contextRevision) || !Number.isSafeInteger(reviewExpiresAt) || reviewExpiresAt <= this.now()) fail('workspace_review_expired', 409);
        const owner = this.#reviewOwner(principal, identity); const stamp = this.#stamp();
        return this.db.transaction(() => {
            this.#assert(principal, identity);
            const prior = this.#review(principal, identity, idempotencyKey);
            if (prior) {
                if (!this.#sameUser(prior, principal, identity) || prior.native_account_id !== identity.nativeAccountId || prior.owner_fingerprint !== owner
                    || prior.operation !== operation || prior.input_sha256 !== inputHash || prior.context_revision !== contextRevision
                    || prior.expires_at !== reviewExpiresAt) fail('workspace_intent_content_conflict', 409);
                if (prior.state === 'failed') fail(prior.reason_code || 'workspace_review_expired', 409);
                return { state: prior.state };
            }
            this.db.prepare(`INSERT INTO savana_workspace_review_fences
                (tenant_id,user_id,central_actor_id,organization_id,native_account_id,idempotency_key,operation,input_sha256,
                    context_revision,owner_fingerprint,expires_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reviewed',?,?)`)
                .run(principal.tenantId, principal.userId, identity.actorId, identity.organizationId, identity.nativeAccountId,
                    idempotencyKey, operation, inputHash, contextRevision, owner, reviewExpiresAt, stamp, stamp);
            return { state: 'reviewed' };
        }).immediate();
    }
    reviewOutcome(principal, identity, idempotencyKey, { contextRevision } = {}) {
        this.#assert(principal, identity);
        return this.db.transaction(() => {
            this.#assert(principal, identity);
            const attempted = this.db.prepare('SELECT * FROM savana_workspace_intents WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=?')
                .get(principal.tenantId, identity.actorId, identity.organizationId, idempotencyKey);
            if (attempted) {
                if (!this.#sameUser(attempted, principal, identity)) fail('workspace_intent_not_found', 404);
                return { intent: this.#public(attempted) };
            }
            const row = this.#review(principal, identity, idempotencyKey);
            if (!this.#sameUser(row, principal, identity) || row.native_account_id !== identity.nativeAccountId) fail('workspace_intent_not_found', 404);
            if (row.state === 'claimed') return { intent: { state: 'unknown' } };
            if (row.state === 'reviewed') {
                const expired = row.expires_at <= this.now();
                const changed = row.owner_fingerprint !== this.#reviewOwner(principal, identity)
                    || (text(contextRevision) && contextRevision !== row.context_revision);
                if (expired || changed) this.db.prepare("UPDATE savana_workspace_review_fences SET state='failed',reason_code=?,updated_at=? WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=? AND state='reviewed'")
                    .run(expired ? 'workspace_review_expired' : 'workspace_context_changed', this.#stamp(), row.tenant_id,
                        row.central_actor_id, row.organization_id, row.idempotency_key);
                return { intent: { state: expired || changed ? 'failed' : 'reviewed' } };
            }
            return { intent: { state: 'failed' } };
        }).immediate();
    }
    #unknown(row, code = 'workspace_outcome_unknown') {
        if (!['prepared', 'inflight'].includes(row.state)) return;
        this.db.prepare("UPDATE savana_workspace_intents SET state='unknown',error_code=?,updated_at=? WHERE id=? AND state IN ('prepared','inflight')")
            .run(code, this.#stamp(), row.id);
        this.#audit(row, 'workspace_outcome_unknown');
    }
    hasUnresolved(principal, identity) {
        this.#assert(principal, identity);
        return !!this.db.prepare(`SELECT 1 FROM savana_workspace_intents WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND ${unresolved} LIMIT 1`)
            .get(principal.tenantId, identity.actorId, identity.organizationId);
    }
    prepare(principal, identity, input) {
        this.#assert(principal, identity);
        if (!input || Object.keys(input).some(key => !['operation', 'idempotencyKey', 'inputHash', 'request', 'reviewExpiresAt'].includes(key))
            || !/^[a-z][a-z0-9_.]{0,99}$/.test(input.operation || '') || !text(input.idempotencyKey)
            || !/^[a-f0-9]{64}$/.test(input.inputHash || '')) fail('workspace_request_invalid', 422);
        const assertReview = () => {
            if (input.reviewExpiresAt === undefined) return;
            if (!Number.isSafeInteger(input.reviewExpiresAt)) fail('workspace_request_invalid', 422);
            if (input.reviewExpiresAt <= this.now()) fail('workspace_review_expired', 409);
        };
        assertReview();
        const request = requestBytes(input.request); const requestHash = hash(canonicalWorkspaceJson(request, MAX_BYTES * 3 + 8192));
        return this.db.transaction(() => {
            this.#assert(principal, identity); assertReview();
            const existing = this.db.prepare(`SELECT * FROM savana_workspace_intents WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=?`)
                .get(principal.tenantId, identity.actorId, identity.organizationId, input.idempotencyKey);
            if (existing) {
                if (!this.#sameUser(existing, principal, identity)) fail('workspace_intent_not_found', 404);
                if (existing.operation !== input.operation || existing.input_sha256 !== input.inputHash || existing.request_sha256 !== requestHash) fail('workspace_intent_content_conflict', 409);
                return { intent: this.#public(existing), dispatch: null };
            }
            const reviewed = this.#review(principal, identity, input.idempotencyKey);
            if (reviewed) {
                if (!this.#sameUser(reviewed, principal, identity) || reviewed.operation !== input.operation
                    || reviewed.input_sha256 !== input.inputHash || reviewed.native_account_id !== identity.nativeAccountId
                    || reviewed.owner_fingerprint !== this.#reviewOwner(principal, identity)) fail('workspace_context_changed', 403);
                if (reviewed.state !== 'reviewed' || reviewed.expires_at <= this.now()) fail('workspace_review_expired', 409);
            }
            if (this.hasUnresolved(principal, identity)) fail('workspace_unresolved_intent', 409);
            const values = [...principalValues(principal), ...identityValues(identity)]; const created = this.#stamp();
            const row = { id: crypto.randomUUID(), tenant_id: values[0], user_id: values[1], session_hash: values[2], auth_version: values[3],
                native_role: values[4], native_expires_at: values[5], central_actor_id: values[6], organization_id: values[7],
                native_account_id: values[8], identity_generation: values[9], identity_expires_at: values[10],
                operation: input.operation, input_sha256: input.inputHash, request_sha256: requestHash };
            const sealed = this.#seal(row, 'workspace_request', request);
            this.#assert(principal, identity);
            this.db.prepare(`INSERT INTO savana_workspace_intents
                (id,tenant_id,user_id,session_hash,auth_version,native_role,native_expires_at,central_actor_id,organization_id,native_account_id,
                    identity_generation,identity_expires_at,operation,idempotency_key,input_sha256,request_sha256,encrypted_request,state,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)`)
                .run(row.id, ...values, input.operation, input.idempotencyKey, input.inputHash, requestHash, sealed, created, created);
            this.#audit(row, 'workspace_prepared');
            this.#assert(principal, identity); assertReview();
            const claim = this.db.prepare("UPDATE savana_workspace_intents SET state='inflight',claimed_at=?,updated_at=? WHERE id=? AND state='prepared'")
                .run(created, created, row.id);
            if (claim.changes !== 1) fail('workspace_intent_not_claimed', 409);
            this.#audit(row, 'workspace_claimed_once');
            if (reviewed) this.db.prepare("UPDATE savana_workspace_review_fences SET state='claimed',updated_at=? WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=? AND state='reviewed'")
                .run(created, principal.tenantId, identity.actorId, identity.organizationId, input.idempotencyKey);
            const stored = this.#row(row.id);
            return { intent: this.#public(stored), dispatch: { method: request.method, path: request.path,
                ...(request.bodyJson == null ? {} : { body: JSON.parse(request.bodyJson) }), bodyJson: request.bodyJson, requestHash } };
        }).immediate();
    }
    readById(principal, identity, id) {
        this.#assert(principal, identity);
        const row = text(id) ? this.#row(id) : null;
        if (!this.#sameUser(row, principal, identity)) fail('workspace_intent_not_found', 404);
        return { intent: this.#public(row) };
    }
    readByKey(principal, identity, idempotencyKey) {
        this.#assert(principal, identity);
        if (!text(idempotencyKey)) fail('workspace_request_invalid', 422);
        const row = this.db.prepare(`SELECT * FROM savana_workspace_intents WHERE tenant_id=? AND user_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=?`)
            .get(principal.tenantId, principal.userId, identity.actorId, identity.organizationId, idempotencyKey);
        if (!row) fail('workspace_intent_not_found', 404);
        return { intent: this.#public(row) };
    }
    bindingRequestByKey(principal, identity, idempotencyKey) {
        this.#assert(principal, identity);
        if (!text(idempotencyKey)) fail('workspace_request_invalid', 422);
        const row = this.db.prepare(`SELECT * FROM savana_workspace_intents WHERE tenant_id=? AND user_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=?`)
            .get(principal.tenantId, principal.userId, identity.actorId, identity.organizationId, idempotencyKey);
        if (!row || !this.#sameUser(row, principal, identity)) fail('workspace_intent_not_found', 404);
        if (!this.#original(row, principal, identity)) fail('workspace_context_changed', 403);
        if (row.operation !== 'binding') fail('workspace_binding_authorization_not_applicable', 422);
        // Private server-only selector access. Never open/replay a historical
        // result or authorization URL; only the original request can be read.
        const request = this.#open(row, 'workspace_request', row.encrypted_request);
        if (hash(canonicalWorkspaceJson(request, MAX_BYTES * 3 + 8192)) !== row.request_sha256
            || request.method !== 'POST' || request.path !== '/v1/integration/workspace/binding-requests'
            || typeof request.bodyJson !== 'string') fail('workspace_reconciliation_unverified', 409);
        return { intent: this.#public(row), request: structuredClone(request) };
    }
    listForOwner(principal, identity, { limit = 50 } = {}) {
        this.#assert(principal, identity);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('workspace_request_invalid', 422);
        return this.db.prepare(`SELECT * FROM savana_workspace_intents
            WHERE tenant_id=? AND user_id=? AND central_actor_id=? AND organization_id=? AND native_account_id=?
            ORDER BY created_at DESC,id DESC LIMIT ?`)
            .all(principal.tenantId, principal.userId, identity.actorId, identity.organizationId, identity.nativeAccountId, limit)
            .map(row => ({ ...this.#public(row), idempotencyKey: row.idempotency_key }));
    }
    finish(principal, identity, id, outcome = {}) {
        const transition = this.db.transaction(() => {
            const row = this.#row(id);
            if (!this.#sameUser(row, principal, identity)) fail('workspace_intent_not_found', 404);
            if (!this.#original(row, principal, identity)) fail('workspace_context_changed', 403);
            const provenLocalRejection = localNoEffect(outcome);
            if (!this.#valid(principal, identity) && !provenLocalRejection) {
                if (row.state === 'unknown') return { intent: this.#public(row), result: null };
                this.#unknown(row, 'workspace_context_changed'); return { contextChanged: true };
            }
            if (['completed', 'failed', 'unknown'].includes(row.state)) return { intent: this.#public(row), result: null };
            if (row.state === 'prepared' && outcome.state !== 'unknown') {
                this.#unknown(row, 'workspace_intent_not_claimed'); return { notClaimed: true };
            }
            let state = outcome.state;
            if (!['completed', 'failed', 'unknown'].includes(state)) fail('workspace_outcome_invalid', 422);
            if (state === 'failed' && !provenLocalRejection && !(outcome.errorCode === 'workspace_rejected' && rejectedStatuses.has(outcome.remoteStatus))) state = 'unknown';
            if (state === 'unknown') {
                const code = outcome.state === 'unknown' && typeof outcome.errorCode === 'string' && /^[a-z][a-z0-9_.]{0,99}$/.test(outcome.errorCode)
                    ? outcome.errorCode : 'workspace_outcome_unknown';
                this.#unknown(row, code); return { intent: this.#public(this.#row(id)), result: null };
            }
            if (provenLocalRejection) {
                this.db.prepare("UPDATE savana_workspace_intents SET state='failed',error_code=?,finished_at=?,updated_at=? WHERE id=? AND state='inflight'")
                    .run(outcome.errorCode, this.#stamp(), this.#stamp(), id);
                this.#audit(row, 'workspace_failed_before_dispatch');
                return { intent: this.#public(this.#row(id)), result: null };
            }
            let encrypted = null; let completedResult = null;
            try {
                const request = this.#open(row, 'workspace_request', row.encrypted_request);
                if (hash(canonicalWorkspaceJson(request, MAX_BYTES * 3 + 8192)) !== row.request_sha256) throw new Error();
                if (state === 'completed') { completedResult = JSON.parse(canonicalWorkspaceJson(outcome.result ?? null)); encrypted = this.#seal(row, 'workspace_result', completedResult); }
            } catch {
                this.#unknown(row, 'workspace_encryption_unavailable'); return { encryptionFailed: true };
            }
            if (!this.#valid(principal, identity)) { this.#unknown(row, 'workspace_context_changed'); return { contextChanged: true }; }
            const errorCode = state === 'unknown' ? 'workspace_outcome_unknown'
                : typeof outcome.errorCode === 'string' && /^[a-z][a-z0-9_.]{0,99}$/.test(outcome.errorCode) ? outcome.errorCode : null;
            this.db.prepare(`UPDATE savana_workspace_intents SET state=?,encrypted_result=?,error_code=?,remote_status=?,finished_at=?,updated_at=? WHERE id=? AND state IN ('prepared','inflight')`)
                .run(state, encrypted, errorCode, state === 'failed' ? outcome.remoteStatus : null,
                    state === 'unknown' ? null : this.#stamp(), this.#stamp(), id);
            this.#audit(row, `workspace_${state}`);
            return { intent: this.#public(this.#row(id)), result: state === 'completed' ? completedResult : null };
        }).immediate();
        if (transition.contextChanged) fail('workspace_context_changed', 403);
        if (transition.notClaimed) fail('workspace_intent_not_claimed', 409);
        if (transition.encryptionFailed) fail('workspace_encryption_unavailable', 503);
        return transition;
    }
    async reconcile(principal, identity, id) {
        this.#assert(principal, identity);
        if (!this.loadOutcome) fail('workspace_reconciliation_unavailable', 503);
        const row = this.#row(id);
        if (!this.#sameUser(row, principal, identity)) fail('workspace_intent_not_found', 404);
        if (row.native_account_id !== identity.nativeAccountId) fail('workspace_context_changed', 403);
        if (['completed', 'failed'].includes(row.state)) return { intent: this.#public(row), result: null };
        const original = canonicalWorkspaceJson([principalValues(principal), identityValues(identity)]);
        const request = this.#open(row, 'workspace_request', row.encrypted_request);
        if (hash(canonicalWorkspaceJson(request, MAX_BYTES * 3 + 8192)) !== row.request_sha256) fail('workspace_reconciliation_unverified', 409);
        let outcome;
        try { outcome = await this.loadOutcome({ principal: Object.freeze({ ...principal }), identity: Object.freeze({ ...identity }),
            intentId: row.id, operation: row.operation, idempotencyKey: row.idempotency_key, inputHash: row.input_sha256, requestHash: row.request_sha256, request: structuredClone(request) }); }
        catch { this.#assert(principal, identity); fail('workspace_reconciliation_unavailable', 503); }
        this.#assert(principal, identity);
        if (canonicalWorkspaceJson([principalValues(principal), identityValues(identity)]) !== original) fail('workspace_context_changed', 403);
        const correlation = outcome?.correlation;
        if (!correlation || correlation.intentId !== row.id || correlation.inputHash !== row.input_sha256
            || correlation.requestHash !== row.request_sha256 || correlation.actorId !== row.central_actor_id
            || correlation.organizationId !== row.organization_id || correlation.nativeAccountId !== row.native_account_id) fail('workspace_reconciliation_unverified', 409);
        return this.db.transaction(() => {
            this.#assert(principal, identity);
            const current = this.#row(id);
            if (['completed', 'failed'].includes(current.state)) return { intent: this.#public(current), result: null };
            if (!['completed', 'failed'].includes(outcome.state)
                || (outcome.state === 'failed' && !(outcome.definitiveNoEffect === true
                    && outcome.errorCode === 'workspace_rejected' && rejectedStatuses.has(outcome.remoteStatus)))) {
                this.#unknown(current); return { intent: this.#public(this.#row(id)), result: null };
            }
            const encrypted = outcome.state === 'completed' ? this.#seal(current, 'workspace_result', JSON.parse(canonicalWorkspaceJson(outcome.result ?? null))) : null;
            this.#assert(principal, identity);
            this.db.prepare(`UPDATE savana_workspace_intents SET state=?,encrypted_result=?,error_code=?,remote_status=?,finished_at=?,updated_at=? WHERE id=? AND state IN ('prepared','inflight','unknown')`)
                .run(outcome.state, encrypted, outcome.state === 'failed' ? 'workspace_rejected' : null,
                    outcome.state === 'failed' ? outcome.remoteStatus : null, this.#stamp(), this.#stamp(), id);
            this.#audit(current, `workspace_reconciled_${outcome.state}`);
            return { intent: this.#public(this.#row(id)), result: null };
        }).immediate();
    }
}
