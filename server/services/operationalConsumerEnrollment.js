import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';

const fail = (code, status = 503) => { throw new SharedProductReadError(code, status); };
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 255;
const flags = { read_only: true, execution_ready: false, pricing_use_allowed: false, grants_created: false };
const responseFields = ['enrollment_id', 'organization_id', 'platform', 'external_tenant_id', 'display_name',
    'version', 'accepted_scopes', 'public_key_fingerprint'];

// Service enrollment is not an owner operation. Local authorization and the
// actual current OIDC session are injected by the native server, never the UI.
export class OperationalConsumerEnrollmentService {
    constructor({ database, encryption, config = {}, verifyLocalPrincipal, verifyOidcSession,
        fetchImpl = globalThis.fetch, now = () => Date.now(), identicalEnrollmentReplayDocumented = false }) {
        if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || typeof verifyLocalPrincipal !== 'function' || typeof verifyOidcSession !== 'function') {
            throw new TypeError('Consumer enrollment requires explicit database, cipher and current-session verifiers');
        }
        this.db = database;
        this.encryption = encryption;
        this.config = config;
        this.verifyLocal = verifyLocalPrincipal;
        this.verifyOidc = verifyOidcSession;
        this.fetch = fetchImpl;
        this.now = now;
        this.replayDocumented = identicalEnrollmentReplayDocumented === true;
        if (config.enabled === true) {
            const origin = new URL(config.centerOrigin);
            const loopback = config.allowLoopback === true && origin.protocol === 'http:'
                && ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname);
            const privateService = origin.protocol === 'http:' && origin.hostname === 'savana-connect' && origin.port === '8010';
            if (!(origin.protocol === 'https:' || loopback || privateService) || origin.username || origin.password
                || origin.pathname !== '/' || origin.search || origin.hash
                || typeof config.platformToken !== 'string' || !config.platformToken) {
                throw new TypeError('Consumer enrollment requires a trusted server-owned center origin and service credential');
            }
            this.centerOrigin = origin.origin;
            this.url = `${origin.origin}/v1/integration/operational/enrollments`;
        }
    }
    #stamp() { return new Date(this.now()).toISOString(); }
    #sessionSnapshot(session) {
        if (!identifier(session?.organizationId) || !identifier(session?.actorId)
            || typeof session.accessToken !== 'string' || !session.accessToken
            || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= this.now()) {
            fail('shared_read_identity_session_required', 403);
        }
        return JSON.stringify([session.organizationId, session.actorId, session.accessToken, session.expiresAt, session.generation]);
    }
    async #assertCurrent(principal, session, expected) {
        if (this.config.enabled !== true) fail('consumer_enrollment_disabled');
        if (!Number.isSafeInteger(principal?.tenantId) || principal.tenantId < 1
            || !Number.isSafeInteger(principal.userId) || principal.userId < 1
            || typeof principal.sessionId !== 'string' || !principal.sessionId
            || this.verifyLocal(principal) !== true) fail('shared_product_read_session_required', 403);
        const currentSnapshot = () => JSON.stringify([principal.tenantId, principal.userId, principal.sessionId,
            principal.authVersion, principal.sessionExpiresAt, principal.role, this.#sessionSnapshot(session)]);
        const snapshot = currentSnapshot();
        if (expected && snapshot !== expected) fail('shared_read_identity_session_changed', 403);
        if (await this.verifyOidc(principal, session) !== true) fail('shared_read_identity_session_required', 403);
        if (this.config.enabled !== true || this.verifyLocal(principal) !== true || currentSnapshot() !== snapshot) {
            fail('shared_read_identity_session_changed', 403);
        }
        return snapshot;
    }
    #row(principal, session) {
        const row = this.db.prepare('SELECT * FROM savana_operational_consumer_enrollments WHERE tenant_id=?').get(principal.tenantId);
        if (row && (row.organization_id !== session.organizationId || row.external_tenant_id !== `wa_savana:tenant:${principal.tenantId}`
            || row.center_origin !== this.centerOrigin)) fail('consumer_enrollment_binding_conflict', 409);
        return row;
    }
    #audit(principal, id, action) {
        this.db.prepare(`INSERT INTO savana_operational_consumer_enrollment_audit
            (enrollment_id,actor_user_id,session_reference,action,created_at) VALUES(?,?,?,?,?)`)
            .run(id, principal.userId, sha(principal.sessionId), action, this.#stamp());
    }
    #validateResponse(payload, row) {
        const body = JSON.parse(row.request_json);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || Object.keys(payload).length !== responseFields.length
            || Object.keys(payload).some(name => !responseFields.includes(name))
            || !identifier(payload.enrollment_id) || payload.organization_id !== row.organization_id
            || payload.platform !== 'wa_savana' || payload.external_tenant_id !== row.external_tenant_id
            || payload.display_name !== body.display_name || !Number.isSafeInteger(payload.version) || payload.version < 1
            || !Array.isArray(payload.accepted_scopes) || payload.accepted_scopes.length !== 1
            || payload.accepted_scopes[0] !== 'savana.products.sync'
            || payload.public_key_fingerprint !== row.public_key_fingerprint) {
            fail('consumer_enrollment_response_invalid', 502);
        }
        return Object.fromEntries(responseFields.map(name => [name, payload[name]]));
    }
    #public(row) {
        // Stored completion is not proof that the retained key is still usable.
        // A wrong/unavailable cipher fails closed and never generates a new key.
        if (row) this.#verifySavedKey(row);
        return { ...flags, state: row?.state || 'unregistered',
            organization_id: row?.organization_id || null, external_tenant_id: row?.external_tenant_id || null,
            enrollment: row?.state === 'completed' && row.response_json ? this.#validateResponse(JSON.parse(row.response_json), row) : null,
            public_key_fingerprint: row?.public_key_fingerprint || null, request_sha256: row?.request_sha256 || null,
            requires_reconciliation: ['inflight', 'unknown'].includes(row?.state),
            reconciliation_available: this.replayDocumented && ['unknown', 'failed'].includes(row?.state),
            attempts: row?.attempt_count || 0 };
    }
    async status(principal, verifiedOidcSession) {
        await this.#assertCurrent(principal, verifiedOidcSession);
        return this.#public(this.#row(principal, verifiedOidcSession));
    }
    #prepare(principal, session, displayName) {
        return this.db.transaction(() => {
            if (this.verifyLocal(principal) !== true) fail('shared_product_read_session_required', 403);
            let row = this.#row(principal, session);
            if (row) {
                if (JSON.parse(row.request_json).display_name !== displayName) fail('consumer_enrollment_content_conflict', 409);
                return row;
            }
            const id = crypto.randomUUID();
            const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
            const request = JSON.stringify({ organization_id: session.organizationId,
                external_tenant_id: `wa_savana:tenant:${principal.tenantId}`, display_name: displayName,
                public_key_pem: publicKey, accepted_scopes: ['savana.products.sync'] });
            const plaintext = JSON.stringify({ purpose: 'wa_consumer_enrollment_key', enrollment_id: id,
                tenant_id: principal.tenantId, organization_id: session.organizationId, private_key_pem: privateKey });
            const encrypted = this.encryption.encrypt(plaintext);
            if (typeof encrypted !== 'string' || !encrypted || encrypted.includes(privateKey) || encrypted.includes(plaintext)) {
                fail('consumer_enrollment_encryption_unavailable');
            }
            this.db.prepare(`INSERT INTO savana_operational_consumer_enrollments
                (id,tenant_id,organization_id,external_tenant_id,center_origin,encrypted_private_key,request_json,
                request_sha256,public_key_fingerprint,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'prepared',?,?)`)
                .run(id, principal.tenantId, session.organizationId, `wa_savana:tenant:${principal.tenantId}`, this.centerOrigin,
                    encrypted, request, sha(request), sha(publicKey), this.#stamp(), this.#stamp());
            this.#audit(principal, id, 'consumer_enrollment_prepared_no_grant');
            return this.#row(principal, session);
        }).immediate();
    }
    #verifySavedKey(row) {
        try {
            const envelope = JSON.parse(this.encryption.decrypt(row.encrypted_private_key));
            const body = JSON.parse(row.request_json);
            const key = crypto.createPrivateKey(envelope.private_key_pem);
            const pem = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' });
            if (envelope.purpose !== 'wa_consumer_enrollment_key' || envelope.enrollment_id !== row.id
                || envelope.tenant_id !== row.tenant_id || envelope.organization_id !== row.organization_id
                || key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048
                || pem !== body.public_key_pem || sha(pem) !== row.public_key_fingerprint || sha(row.request_json) !== row.request_sha256) {
                throw new Error('Invalid key binding');
            }
        } catch { fail('consumer_enrollment_key_unavailable'); }
    }
    #finish(principal, row, state, result, failureCode) {
        this.db.transaction(() => {
            const changed = this.db.prepare(`UPDATE savana_operational_consumer_enrollments
                SET state=?,response_json=?,failure_code=?,updated_at=? WHERE id=? AND state='inflight' AND attempt_count=?`)
                .run(state, result ? JSON.stringify(result) : null, failureCode || null, this.#stamp(), row.id, row.attempt_count);
            if (changed.changes !== 1) fail('consumer_enrollment_state_changed', 409);
            this.#audit(principal, row.id, `consumer_enrollment_${state}_no_grant`);
        }).immediate();
    }
    async #dispatch(principal, session, row, snapshot, fromState) {
        await this.#assertCurrent(principal, session, snapshot);
        this.#verifySavedKey(row);
        const claimed = this.db.transaction(() => {
            if (this.verifyLocal(principal) !== true) fail('shared_product_read_session_required', 403);
            const result = this.db.prepare(`UPDATE savana_operational_consumer_enrollments
                SET state='inflight',attempt_count=attempt_count+1,updated_at=? WHERE id=? AND state=? AND attempt_count=?`)
                .run(this.#stamp(), row.id, fromState, row.attempt_count);
            if (result.changes) this.#audit(principal, row.id, 'consumer_enrollment_dispatch_started');
            return result.changes === 1;
        }).immediate();
        if (!claimed) return this.#public(this.#row(principal, session));
        row = this.#row(principal, session);
        let failureState = 'unknown';
        try {
            const response = await this.fetch(this.url, { method: 'POST', redirect: 'error', cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-Savana-Platform-Code': 'wa_savana',
                    'X-Savana-Platform-Token': this.config.platformToken },
                body: row.request_json, signal: AbortSignal.timeout(5000) });
            await this.#assertCurrent(principal, session, snapshot);
            if (!response.ok) {
                failureState = [401, 403, 404, 409, 422].includes(response.status) ? 'failed' : 'unknown';
                fail('consumer_enrollment_rejected', [401, 403, 404, 409, 422, 503].includes(response.status) ? response.status : 503);
            }
            const raw = await response.text();
            await this.#assertCurrent(principal, session, snapshot);
            if (raw.length > 32_768 || !response.headers.get('cache-control')?.includes('no-store')) {
                fail('consumer_enrollment_response_invalid', 502);
            }
            const result = this.#validateResponse(JSON.parse(raw), row);
            this.#finish(principal, row, 'completed', result);
            return this.#public(this.#row(principal, session));
        } catch (error) {
            this.#finish(principal, row, failureState, null,
                error instanceof SharedProductReadError ? error.code : 'consumer_enrollment_outcome_unknown');
            if (error instanceof SharedProductReadError) throw error;
            fail('consumer_enrollment_outcome_unknown');
        }
    }
    async enroll(principal, verifiedOidcSession, input = {}) {
        const snapshot = await this.#assertCurrent(principal, verifiedOidcSession);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'displayName')
            || typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 200) {
            fail('consumer_enrollment_request_invalid', 422);
        }
        const row = this.#prepare(principal, verifiedOidcSession, input.displayName);
        if (row.state !== 'prepared') return this.#public(row);
        return this.#dispatch(principal, verifiedOidcSession, row, snapshot, 'prepared');
    }
    async reconcile(principal, verifiedOidcSession) {
        const snapshot = await this.#assertCurrent(principal, verifiedOidcSession);
        const row = this.#row(principal, verifiedOidcSession);
        if (!this.replayDocumented) fail('consumer_enrollment_reconciliation_not_documented', 409);
        if (!row || !['unknown', 'failed'].includes(row.state)) fail('consumer_enrollment_reconciliation_unavailable', 409);
        return this.#dispatch(principal, verifiedOidcSession, row, snapshot, row.state);
    }
}
