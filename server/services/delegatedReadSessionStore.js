import crypto from 'node:crypto';
import { SharedProductReadError, validateDelegatedReadBinding } from './centralProductRead.js';
import { canonicalJson } from './savanaIntegration.js';

const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const key = principal => digest(JSON.stringify([String(principal.userId), String(principal.tenantId), principal.sessionId, principal.authVersion]));
const principalValues = principal => {
    if (principal?.userId == null || principal?.tenantId == null || typeof principal.sessionId !== 'string'
        || !principal.sessionId || !Number.isSafeInteger(principal.authVersion) || principal.authVersion < 0) {
        throw new SharedProductReadError('shared_product_read_session_required', 403);
    }
    return [principal.tenantId, principal.userId, digest(principal.sessionId), principal.authVersion];
};
const predicate = 'tenant_id = ? AND user_id = ? AND session_hash = ? AND auth_version = ?';

// No default key, environment, singleton database or plaintext fallback. The
// caller supplies the application cipher (or a fresh test-owned cipher).
export class SqliteDelegatedReadBindings {
    constructor({ database, encryption, now = () => Date.now() }) {
        if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function') {
            throw new TypeError('Delegated read sessions require an explicit database and cipher');
        }
        this.db = database;
        this.encryption = encryption;
        this.now = now;
    }
    #stamp() { return new Date(this.now()).toISOString(); }
    #audit(principal, action) {
        this.db.prepare(`INSERT INTO savana_delegated_read_audit
            (tenant_id, user_id, session_reference, action, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(principal.tenantId, principal.userId, key(principal), action, this.#stamp());
    }
    #seal(principal, payload, purpose) {
        const ciphertext = this.encryption.encrypt(JSON.stringify({ principal_key: key(principal), purpose, payload }));
        if (typeof ciphertext !== 'string' || !ciphertext || ciphertext.includes(JSON.stringify(payload))) {
            throw new SharedProductReadError('shared_read_encryption_unavailable', 503);
        }
        return ciphertext;
    }
    #open(principal, ciphertext, purpose) {
        try {
            const envelope = JSON.parse(this.encryption.decrypt(ciphertext));
            if (envelope.principal_key !== key(principal) || envelope.purpose !== purpose) return null;
            return envelope.payload;
        } catch { return null; }
    }
    bind(principal, credentials) {
        validateDelegatedReadBinding(principal, credentials);
        const values = principalValues(principal);
        const expiry = Math.min(Date.parse(credentials?.expiresAt),
            Number.isSafeInteger(principal.sessionExpiresAt) ? principal.sessionExpiresAt * 1000 : Infinity);
        if (!credentials?.accessToken || !Number.isFinite(expiry) || expiry <= this.now()) {
            throw new SharedProductReadError('shared_product_binding_invalid', 403);
        }
        const generation = crypto.randomUUID();
        const id = crypto.randomUUID();
        const encrypted = this.#seal(principal, { ...credentials, expiresAt: new Date(expiry).toISOString() }, 'delegated_read');
        return this.db.transaction(() => {
            this.db.prepare(`INSERT INTO savana_delegated_read_sessions
                (id, tenant_id, user_id, session_hash, auth_version, generation, state, encrypted_credentials, expires_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?)
                ON CONFLICT(tenant_id, user_id, session_hash, auth_version) DO UPDATE SET
                    generation = excluded.generation, state = 'connected', encrypted_credentials = excluded.encrypted_credentials,
                    expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
                .run(id, ...values, generation, encrypted, new Date(expiry).toISOString(), this.#stamp(), this.#stamp());
            this.#audit(principal, 'delegated_read_session_connected');
            return generation;
        }).immediate();
    }
    load(principal) {
        const values = principalValues(principal);
        const row = this.db.prepare(`SELECT * FROM savana_delegated_read_sessions WHERE ${predicate}`).get(...values);
        if (!row || row.state !== 'connected' || Date.parse(row.expires_at) <= this.now()) return null;
        const credentials = this.#open(principal, row.encrypted_credentials, 'delegated_read');
        return credentials ? Object.freeze({ ...credentials, bindingId: row.generation }) : null;
    }
    current(principal, entry) {
        if (!entry?.bindingId) return false;
        const row = this.db.prepare(`SELECT generation, state, expires_at FROM savana_delegated_read_sessions WHERE ${predicate}`)
            .get(...principalValues(principal));
        return row?.state === 'connected' && row.generation === entry.bindingId && Date.parse(row.expires_at) > this.now();
    }
    startReaderSelection(principal) {
        const values = principalValues(principal);
        if (!Number.isSafeInteger(principal.sessionExpiresAt) || principal.sessionExpiresAt * 1000 <= this.now()) {
            throw new SharedProductReadError('shared_product_read_session_required', 403);
        }
        const generation = crypto.randomUUID();
        this.db.transaction(() => {
            this.db.prepare(`INSERT INTO savana_delegated_read_sessions
                (id,tenant_id,user_id,session_hash,auth_version,generation,state,expires_at,created_at,updated_at)
                VALUES (?,?,?,?,?,?,'revoked',?,?,?) ON CONFLICT(tenant_id,user_id,session_hash,auth_version)
                DO UPDATE SET generation=excluded.generation,state='revoked',encrypted_credentials=NULL,
                    expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
                .run(crypto.randomUUID(), ...values, generation, new Date(principal.sessionExpiresAt * 1000).toISOString(), this.#stamp(), this.#stamp());
            this.#audit(principal, 'read_selection_started_no_central_grant');
        }).immediate();
        return generation;
    }
    readerSelectionCurrent(principal, generation) {
        const row = this.db.prepare(`SELECT generation,state,expires_at FROM savana_delegated_read_sessions WHERE ${predicate}`)
            .get(...principalValues(principal));
        return row?.generation === generation && row.state === 'revoked' && Date.parse(row.expires_at) > this.now();
    }
    completeReaderSelection(principal, generation, credentials) {
        return this.db.transaction(() => {
            if (!this.readerSelectionCurrent(principal, generation)) {
                throw new SharedProductReadError('shared_read_selection_superseded', 409);
            }
            return this.bind(principal, credentials);
        }).immediate();
    }
    revoke(principal) {
        return this.db.transaction(() => {
            this.db.prepare(`UPDATE savana_delegated_read_sessions SET state = 'revoked',
                generation = ?, encrypted_credentials = NULL, updated_at = ? WHERE ${predicate}`)
                .run(crypto.randomUUID(), this.#stamp(), ...principalValues(principal));
            this.#audit(principal, 'local_delegated_read_disconnected_not_central_grant_revoke');
        }).immediate();
    }
    summary(principal) {
        const row = this.db.prepare(`SELECT state, expires_at FROM savana_delegated_read_sessions WHERE ${predicate}`)
            .get(...principalValues(principal));
        return !row ? { state: 'disconnected' } : {
            state: row.state === 'connected' && Date.parse(row.expires_at) <= this.now() ? 'expired' : row.state,
            expires_at: row.expires_at,
        };
    }
    beginFlow(principal, flow, ttlSeconds = 300) {
        const values = principalValues(principal);
        if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900) throw new TypeError('Invalid authorization state lifetime');
        const state = crypto.randomBytes(32).toString('base64url');
        const id = crypto.randomUUID();
        const expiry = Math.min(this.now() + ttlSeconds * 1000,
            Number.isSafeInteger(principal.sessionExpiresAt) ? principal.sessionExpiresAt * 1000 : Infinity);
        if (expiry <= this.now()) throw new SharedProductReadError('shared_product_read_session_required', 403);
        const expiresAt = new Date(expiry).toISOString();
        this.db.transaction(() => {
            this.db.prepare(`INSERT INTO savana_delegated_read_flows
                (id, state_hash, tenant_id, user_id, session_hash, auth_version, state, encrypted_flow, expires_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
                .run(id, digest(state), ...values, this.#seal(principal, flow, 'pkce_flow'), expiresAt, this.#stamp(), this.#stamp());
            this.#audit(principal, 'read_authorization_started');
        }).immediate();
        return { state, flowId: id, expiresAt };
    }
    consumeFlow(principal, state) {
        return this.db.transaction(() => {
            const row = this.db.prepare(`SELECT * FROM savana_delegated_read_flows WHERE state_hash = ? AND ${predicate}`)
                .get(digest(state), ...principalValues(principal));
            if (!row || row.state !== 'pending' || Date.parse(row.expires_at) <= this.now()) {
                throw new SharedProductReadError('shared_read_authorization_state_invalid', 409);
            }
            const flow = this.#open(principal, row.encrypted_flow, 'pkce_flow');
            if (!flow) throw new SharedProductReadError('shared_read_authorization_state_invalid', 409);
            this.db.prepare("UPDATE savana_delegated_read_flows SET state = 'exchanging', updated_at = ? WHERE id = ?")
                .run(this.#stamp(), row.id);
            this.#audit(principal, 'read_authorization_code_exchange_started');
            return { flowId: row.id, flow };
        }).immediate();
    }
    finishFlow(principal, flowId, state) {
        if (!['completed', 'unknown', 'failed'].includes(state)) throw new TypeError('Invalid authorization outcome');
        return this.db.transaction(() => {
            const changed = this.db.prepare(`UPDATE savana_delegated_read_flows
                SET state = ?, encrypted_flow = NULL, updated_at = ? WHERE id = ? AND ${predicate} AND state = 'exchanging'`)
                .run(state, this.#stamp(), flowId, ...principalValues(principal));
            if (changed.changes !== 1) throw new SharedProductReadError('shared_read_authorization_state_invalid', 409);
            this.#audit(principal, `read_authorization_${state}`);
        }).immediate();
    }
    flowSummary(principal) {
        const row = this.db.prepare(`SELECT state, expires_at FROM savana_delegated_read_flows WHERE ${predicate}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(...principalValues(principal));
        return row && { state: Date.parse(row.expires_at) <= this.now()
            ? (row.state === 'pending' ? 'expired' : row.state === 'exchanging' ? 'unknown' : row.state)
            : row.state, expires_at: row.expires_at };
    }
    saveOwnerSession(principal, session) {
        const values = principalValues(principal);
        const expiry = Math.min(Date.parse(session?.expiresAt),
            Number.isSafeInteger(principal.sessionExpiresAt) ? principal.sessionExpiresAt * 1000 : Infinity);
        if (typeof session?.accessToken !== 'string' || !session.accessToken || !Number.isFinite(expiry) || expiry <= this.now()) {
            throw new SharedProductReadError('shared_read_owner_session_invalid', 403);
        }
        const generation = crypto.randomUUID();
        this.db.transaction(() => {
            this.db.prepare(`INSERT INTO savana_operational_owner_sessions
                (id,tenant_id,user_id,session_hash,auth_version,generation,encrypted_session,expires_at,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(tenant_id,user_id,session_hash,auth_version) DO UPDATE SET
                    generation=excluded.generation, encrypted_session=excluded.encrypted_session,
                    expires_at=excluded.expires_at, revoked_at=NULL, updated_at=excluded.updated_at`)
                .run(crypto.randomUUID(), ...values, generation,
                    this.#seal(principal, { ...session, expiresAt: new Date(expiry).toISOString() }, 'owner_session'),
                    new Date(expiry).toISOString(), this.#stamp(), this.#stamp());
            this.#audit(principal, 'central_owner_session_connected_not_read_grant');
        }).immediate();
        return generation;
    }
    completeOwnerFlow(principal, flowId, session) {
        // The token exchange is remote. Its result may only be persisted while
        // the same local flow is still current; disconnect/reconnect can have
        // invalidated it while the HTTP request was awaiting a response.
        return this.db.transaction(() => {
            const flow = this.db.prepare(`SELECT state,expires_at FROM savana_delegated_read_flows
                WHERE id=? AND ${predicate}`).get(flowId, ...principalValues(principal));
            if (flow?.state !== 'exchanging' || Date.parse(flow.expires_at) <= this.now()) {
                throw new SharedProductReadError('shared_read_authorization_state_invalid', 409);
            }
            const generation = this.saveOwnerSession(principal, session);
            this.finishFlow(principal, flowId, 'completed');
            return generation;
        }).immediate();
    }
    ownerSession(principal) {
        const row = this.db.prepare(`SELECT * FROM savana_operational_owner_sessions WHERE ${predicate}`)
            .get(...principalValues(principal));
        if (!row || row.revoked_at || Date.parse(row.expires_at) <= this.now()) return null;
        const session = this.#open(principal, row.encrypted_session, 'owner_session');
        return session && { ...session, generation: row.generation };
    }
    ownerCurrent(principal, session) {
        const row = this.db.prepare(`SELECT generation,revoked_at,expires_at FROM savana_operational_owner_sessions WHERE ${predicate}`)
            .get(...principalValues(principal));
        return !!row && !row.revoked_at && Date.parse(row.expires_at) > this.now() && row.generation === session?.generation;
    }
    disconnectOwner(principal) {
        this.db.transaction(() => {
            this.db.prepare(`UPDATE savana_delegated_read_flows SET state='failed',encrypted_flow=NULL,updated_at=?
                WHERE ${predicate} AND state IN ('pending','exchanging')`)
                .run(this.#stamp(), ...principalValues(principal));
            this.db.prepare(`UPDATE savana_operational_owner_sessions SET generation=?,encrypted_session=NULL,
                revoked_at=?,updated_at=? WHERE ${predicate}`)
                .run(crypto.randomUUID(), this.#stamp(), this.#stamp(), ...principalValues(principal));
            this.revoke(principal);
            this.#audit(principal, 'local_owner_session_disconnected_no_central_grant_or_source_key_revocation');
        }).immediate();
    }
    ownerSummary(principal) {
        const row = this.db.prepare(`SELECT revoked_at,expires_at,encrypted_session FROM savana_operational_owner_sessions WHERE ${predicate}`)
            .get(...principalValues(principal));
        return !row ? { state: 'disconnected' } : { state: row.revoked_at ? 'revoked'
            : Date.parse(row.expires_at) <= this.now() ? 'expired'
                : this.#open(principal, row.encrypted_session, 'owner_session') ? 'connected' : 'unknown', expires_at: row.expires_at };
    }
    prepareAction(principal, { operation, idempotencyKey, payload }) {
        const values = principalValues(principal);
        if (typeof operation !== 'string' || !operation || operation.length > 100
            || typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 255) {
            throw new SharedProductReadError('shared_read_action_invalid', 422);
        }
        const hash = digest(canonicalJson(payload));
        return this.db.transaction(() => {
            const previous = this.db.prepare(`SELECT id,operation,payload_hash,state FROM savana_operational_read_actions
                WHERE ${predicate} AND idempotency_key = ?`).get(...values, idempotencyKey);
            if (previous) {
                if (previous.operation !== operation || previous.payload_hash !== hash) {
                    throw new SharedProductReadError('shared_read_action_content_conflict', 409);
                }
                return previous;
            }
            const id = crypto.randomUUID();
            this.db.prepare(`INSERT INTO savana_operational_read_actions
                (id,tenant_id,user_id,session_hash,auth_version,operation,idempotency_key,payload_hash,
                 encrypted_request,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'prepared',?,?)`)
                .run(id, ...values, operation, idempotencyKey, hash, this.#seal(principal, payload, 'operation_request'), this.#stamp(), this.#stamp());
            this.#audit(principal, 'operational_intent_recorded_no_remote_effect_claim');
            return { id, operation, payload_hash: hash, state: 'prepared' };
        }).immediate();
    }
    claimAction(principal, id) {
        const result = this.db.prepare(`UPDATE savana_operational_read_actions SET state='inflight',updated_at=?
            WHERE id=? AND ${predicate} AND state='prepared'`).run(this.#stamp(), id, ...principalValues(principal));
        return result.changes === 1;
    }
    finishAction(principal, id, state, result) {
        if (!['unknown', 'completed', 'failed'].includes(state)) throw new TypeError('Invalid operational outcome');
        return this.db.transaction(() => {
            const changed = this.db.prepare(`UPDATE savana_operational_read_actions SET state=?,encrypted_result=?,updated_at=?
                WHERE id=? AND ${predicate} AND state IN ('inflight','unknown')`)
                .run(state, result === undefined ? null : this.#seal(principal, result, 'operation_result'), this.#stamp(), id, ...principalValues(principal));
            if (changed.changes !== 1) throw new SharedProductReadError('shared_read_action_state_invalid', 409);
            this.#audit(principal, `operational_intent_${state}`);
        }).immediate();
    }
    action(principal, id) {
        const row = this.db.prepare(`SELECT * FROM savana_operational_read_actions WHERE id=? AND ${predicate}`)
            .get(id, ...principalValues(principal));
        return row && { id: row.id, operation: row.operation, idempotencyKey: row.idempotency_key,
            state: row.state, payload: this.#open(principal, row.encrypted_request, 'operation_request'),
            result: row.encrypted_result ? this.#open(principal, row.encrypted_result, 'operation_result') : null };
    }
}
