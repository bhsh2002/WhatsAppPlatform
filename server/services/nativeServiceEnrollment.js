import crypto from 'node:crypto';
import { NativeCommandProtocolError, nativeCommandJson } from './nativeCommandProtocol.js';
import { validateNativeCommandModel } from './nativeCommandModels.js';
import { assertEgressAvailable, EgressMaintenanceError } from '../runtime/egressMaintenance.js';

const fail = (code, status = 503) => { throw new NativeCommandProtocolError(code, status); };
const text = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const responseFields = ['enrollment_id', 'organization_id', 'platform', 'external_tenant_id', 'display_name', 'version', 'accepted_scopes', 'public_key_fingerprint'];
const requestFields = ['organization_id', 'external_tenant_id', 'display_name', 'public_key_pem', 'accepted_scopes'];
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
const PRODUCT_SCOPE = 'savana.products.sync';
const COLLABORATION_SCOPE = 'savana.collaboration.v1';
const acceptedScopes = value => Array.isArray(value) && value.length > 0 && value.length <= 2
    && new Set(value).size === value.length && value.every(scope => [PRODUCT_SCOPE, COLLABORATION_SCOPE].includes(scope));
const sameScopes = (left, right) => acceptedScopes(left) && acceptedScopes(right)
    && left.length === right.length && left.every(scope => right.includes(scope));
const collaborationExtension = (before, after) => sameScopes(before, [PRODUCT_SCOPE]) && sameScopes(after, [PRODUCT_SCOPE, COLLABORATION_SCOPE]);
const productExtension = (before, after) => sameScopes(before, [COLLABORATION_SCOPE]) && sameScopes(after, [PRODUCT_SCOPE, COLLABORATION_SCOPE]);
const sameScope = (left, right) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'].every(key => (left?.[key] ?? null) === (right?.[key] ?? null));
const readBounded = async response => {
    if (Number(response.headers.get('content-length')) > 32_768) fail('native_service_enrollment_registration_invalid', 502);
    if (!response.body?.getReader) {
        const raw = await response.text();
        if (Buffer.byteLength(raw) > 32_768) fail('native_service_enrollment_registration_invalid', 502);
        return raw;
    }
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    while (true) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length;
        if (length > 32_768) { await reader.cancel(); fail('native_service_enrollment_registration_invalid', 502); }
        chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks).toString('utf8');
};

// The NativeRPC router authenticates Core's exact signed request. This service
// additionally requires current source-owner evidence. It creates no WA JWT,
// native user, source grant, installation approval or business permission.
export class NativeServiceEnrollment {
    constructor({ database, encryption, config, verifyOwnerAuthority, fetchImpl = globalThis.fetch,
        now = () => Date.now(), lookupRegistration = null }) {
        if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || typeof verifyOwnerAuthority !== 'function' || typeof fetchImpl !== 'function' || typeof now !== 'function'
            || (lookupRegistration !== null && typeof lookupRegistration !== 'function')) {
            throw new TypeError('Native service enrollment requires explicit database, cipher and actual owner-proof verification');
        }
        let origin;
        try { origin = new URL(config?.centerOrigin); } catch { throw new TypeError('Native enrollment requires a trusted Core origin'); }
        const privateCore = origin.protocol === 'http:' && origin.hostname === 'savana-connect' && origin.port === '8010';
        const loopback = config?.allowLoopback === true && origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
        if (!(origin.protocol === 'https:' || privateCore || loopback) || origin.username || origin.password || origin.search || origin.hash
            || origin.pathname !== '/' || !text(config?.platformToken, 16_384)) throw new TypeError('Native enrollment requires a fixed trusted Core origin and platform credential');
        this.db = database; this.encryption = encryption; this.verifyOwner = verifyOwnerAuthority;
        this.fetch = fetchImpl; this.now = now; this.lookup = lookupRegistration;
        this.origin = origin.origin; this.url = `${origin.origin}/v1/integration/operational/enrollments`;
        this.platformToken = config.platformToken;
        this.productScopeProjections = new Map();
    }
    #stamp() { return new Date(this.now()).toISOString(); }
    #input(context) {
        let serialized;
        try { serialized = nativeCommandJson(context); } catch { fail('native_service_enrollment_context_invalid', 422); }
        if (!context || !text(context.actor_id) || !text(context.organization_id) || !text(context.activity_id)
            || !/^wa_savana:tenant:[1-9][0-9]*$/.test(context.external_tenant_id || '')
            || (context.branch_id != null && !text(context.branch_id)) || (context.warehouse_id != null && !text(context.warehouse_id))
            || (context.warehouse_id != null && context.branch_id == null)) fail('native_service_enrollment_context_invalid', 422);
        const nativeTenantId = Number(context.external_tenant_id.slice('wa_savana:tenant:'.length));
        if (!Number.isSafeInteger(nativeTenantId) || nativeTenantId < 1) fail('native_service_enrollment_context_invalid', 422);
        const scope = { organization_id: context.organization_id, activity_id: context.activity_id,
            branch_id: context.branch_id ?? null, warehouse_id: context.warehouse_id ?? null };
        const grantApprovedBy = context.grant_approved_by ?? context.actor_id;
        if (!text(grantApprovedBy)) fail('native_service_enrollment_context_invalid', 422);
        return { context, serialized, nativeTenantId, scope, grantApprovedBy,
            actorId: context.actor_id, externalTenantId: context.external_tenant_id };
    }
    #unchanged(input) {
        if (nativeCommandJson(input.context) !== input.serialized) fail('native_service_enrollment_context_changed', 403);
        const tenant = this.db.prepare('SELECT id,name,status FROM tenants WHERE id=?').get(input.nativeTenantId);
        if (!tenant || !['Active', 'Warning'].includes(tenant.status) || !text(tenant.name, 200)) fail('native_service_enrollment_owner_unavailable', 403);
        if (input.tenantName !== undefined && input.tenantName !== tenant.name) fail('native_service_enrollment_context_changed', 403);
        input.tenantName = tenant.name;
        return tenant;
    }
    async #authority(input, operation, expected = null) {
        this.#unchanged(input);
        let proof;
        try {
            proof = await this.verifyOwner({ context: structuredClone(input.context), nativeTenantId: input.nativeTenantId,
                scope: { ...input.scope }, grantApprovedBy: input.grantApprovedBy, operation });
        } catch { fail('native_service_enrollment_owner_unavailable', 403); }
        this.#unchanged(input);
        if (proof?.verified !== true || proof.nativeTenantId !== input.nativeTenantId || proof.grantApprovedBy !== input.grantApprovedBy
            || !text(proof.nativeAuthorityRevision) || !Number.isFinite(Date.parse(proof.validUntil)) || Date.parse(proof.validUntil) <= this.now()
            || (input.context.native_authority_revision != null && input.context.native_authority_revision !== proof.nativeAuthorityRevision)
            || (expected && (proof.nativeAuthorityRevision !== expected.nativeAuthorityRevision || proof.grantApprovedBy !== expected.grantApprovedBy))) {
            fail('native_service_enrollment_owner_changed', 403);
        }
        return { nativeAuthorityRevision: proof.nativeAuthorityRevision, grantApprovedBy: proof.grantApprovedBy,
            validUntil: proof.validUntil };
    }
    #row(input) {
        const row = this.db.prepare('SELECT * FROM savana_operational_consumer_enrollments WHERE tenant_id=?').get(input.nativeTenantId);
        if (row && (row.organization_id !== input.scope.organization_id || row.external_tenant_id !== input.externalTenantId
            || row.center_origin !== this.origin)) fail('native_service_enrollment_binding_conflict', 409);
        return row;
    }
    #saved(row) {
        try {
            const body = JSON.parse(row.request_json);
            const keyEnvelope = JSON.parse(this.encryption.decrypt(row.encrypted_private_key));
            const key = crypto.createPrivateKey(keyEnvelope.private_key_pem);
            const publicKey = crypto.createPublicKey(key).export({ format: 'pem', type: 'spki' });
            if (!exact(body, requestFields) || body.organization_id !== row.organization_id || body.external_tenant_id !== row.external_tenant_id
                || !text(body.display_name, 200) || !acceptedScopes(body.accepted_scopes)
                || keyEnvelope.purpose !== 'wa_consumer_enrollment_key' || keyEnvelope.enrollment_id !== row.id
                || keyEnvelope.tenant_id !== row.tenant_id || keyEnvelope.organization_id !== row.organization_id
                || key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048 || publicKey !== body.public_key_pem
                || sha(publicKey) !== row.public_key_fingerprint || sha(row.request_json) !== row.request_sha256) throw new Error();
            return body;
        } catch { fail('native_service_enrollment_key_unavailable'); }
    }
    #registration(payload, row, allowScopeExtension = false) {
        const body = this.#saved(row);
        if (!exact(payload, responseFields) || !text(payload.enrollment_id) || payload.organization_id !== row.organization_id
            || payload.platform !== 'wa_savana' || payload.external_tenant_id !== row.external_tenant_id || payload.display_name !== body.display_name
            || !Number.isSafeInteger(payload.version) || payload.version < 1 || !acceptedScopes(payload.accepted_scopes)
            || !(sameScopes(payload.accepted_scopes, body.accepted_scopes)
                || (allowScopeExtension && (collaborationExtension(body.accepted_scopes, payload.accepted_scopes)
                    || productExtension(body.accepted_scopes, payload.accepted_scopes))))
            || payload.public_key_fingerprint !== row.public_key_fingerprint) fail('native_service_enrollment_registration_invalid', 502);
        return Object.fromEntries(responseFields.map(key => [key, payload[key]]));
    }
    #public(row) {
        const body = this.#saved(row);
        let registered = null;
        if (row.state === 'completed') {
            try { registered = this.#registration(JSON.parse(row.response_json), row, true); }
            catch { fail('native_service_enrollment_registration_invalid', 502); }
        }
        return validateNativeCommandModel('AdapterEnrollment', { spec_version: '1.0', platform: 'wa_savana',
            organization_id: row.organization_id, external_tenant_id: row.external_tenant_id, display_name: body.display_name,
            public_key_pem: body.public_key_pem, accepted_scopes: [...(registered?.accepted_scopes ?? body.accepted_scopes)],
            enrollment_id: registered?.enrollment_id ?? null, enrollment_version: registered?.version ?? null });
    }
    #audit(input, row, proof, action, state) {
        this.db.prepare(`INSERT INTO savana_native_enrollment_service_audit
            (enrollment_id,tenant_id,organization_id,central_actor_id,authority_revision,action,state,created_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(row.id, input.nativeTenantId, input.scope.organization_id, input.actorId,
            proof.nativeAuthorityRevision, action, state, this.#stamp());
    }
    #claimNew(input, proof) {
        return this.db.transaction(() => {
            const tenant = this.#unchanged(input);
            if (Date.parse(proof.validUntil) <= this.now()) fail('native_service_enrollment_owner_changed', 403);
            const existing = this.#row(input);
            if (existing) return { row: existing, claimed: false };
            if (proof.grantApprovedBy !== input.actorId) fail('native_service_enrollment_initial_owner_required', 403);
            const id = crypto.randomUUID();
            const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
            const request = JSON.stringify({ organization_id: input.scope.organization_id, external_tenant_id: input.externalTenantId,
                display_name: tenant.name, public_key_pem: keys.publicKey, accepted_scopes: [COLLABORATION_SCOPE] });
            const plaintext = JSON.stringify({ purpose: 'wa_consumer_enrollment_key', enrollment_id: id, tenant_id: input.nativeTenantId,
                organization_id: input.scope.organization_id, private_key_pem: keys.privateKey });
            let encrypted;
            try { encrypted = this.encryption.encrypt(plaintext); } catch { fail('native_service_enrollment_encryption_unavailable'); }
            if (typeof encrypted !== 'string' || !encrypted || encrypted.includes(plaintext) || encrypted.includes(keys.privateKey)) fail('native_service_enrollment_encryption_unavailable');
            this.#unchanged(input);
            if (Date.parse(proof.validUntil) <= this.now()) fail('native_service_enrollment_owner_changed', 403);
            this.db.prepare(`INSERT INTO savana_operational_consumer_enrollments
                (id,tenant_id,organization_id,external_tenant_id,center_origin,encrypted_private_key,request_json,request_sha256,
                public_key_fingerprint,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'prepared',?,?)`)
                .run(id, input.nativeTenantId, input.scope.organization_id, input.externalTenantId, this.origin, encrypted,
                    request, sha(request), sha(keys.publicKey), this.#stamp(), this.#stamp());
            let row = this.#row(input);
            this.#saved(row);
            this.#audit(input, row, proof, 'prepared', 'prepared');
            const claimed = this.db.prepare(`UPDATE savana_operational_consumer_enrollments SET state='inflight',attempt_count=1,updated_at=?
                WHERE id=? AND state='prepared' AND attempt_count=0`).run(this.#stamp(), id);
            if (claimed.changes !== 1) fail('native_service_enrollment_state_changed', 409);
            row = this.#row(input);
            this.#audit(input, row, proof, 'dispatch_started', 'inflight');
            return { row, claimed: true };
        }).immediate();
    }
    #finish(input, row, proof, state, registration = null, failureCode = null, action = state) {
        return this.db.transaction(() => {
            const current = this.#row(input);
            if (!current || current.id !== row.id || current.attempt_count !== row.attempt_count) fail('native_service_enrollment_state_changed', 409);
            if (current.state === 'completed') return current;
            if (!['inflight', 'unknown'].includes(current.state)) fail('native_service_enrollment_state_changed', 409);
            const changed = this.db.prepare(`UPDATE savana_operational_consumer_enrollments SET state=?,response_json=?,failure_code=?,updated_at=?
                WHERE id=? AND state=? AND attempt_count=?`).run(state, registration ? JSON.stringify(registration) : null,
                    failureCode, this.#stamp(), row.id, current.state, row.attempt_count);
            if (changed.changes !== 1) fail('native_service_enrollment_state_changed', 409);
            const finished = this.#row(input);
            this.#audit(input, finished, proof, action, state);
            return finished;
        }).immediate();
    }
    async #recover(input, row, proof) {
        if (!this.lookup || !['inflight', 'unknown'].includes(row.state)) return row;
        const body = this.#saved(row);
        assertEgressAvailable();
        let registration;
        try {
            registration = await this.lookup({ centerOrigin: this.origin, platform: 'wa_savana', organizationId: row.organization_id,
                externalTenantId: row.external_tenant_id, publicKeyFingerprint: row.public_key_fingerprint,
                publicKeyPem: body.public_key_pem, displayName: body.display_name, acceptedScopes: [...body.accepted_scopes],
                requestSha256: row.request_sha256, context: structuredClone(input.context), signal: AbortSignal.timeout(5000) });
        } catch {
            await this.#authority(input, 'lookup', proof);
            return this.#row(input);
        }
        const currentProof = await this.#authority(input, 'lookup', proof);
        if (registration == null) return this.#row(input);
        const valid = this.#registration(registration, row);
        return this.#finish(input, row, currentProof, 'completed', valid, null, 'registration_reconciled');
    }
    async read(context) {
        const input = this.#input(context);
        const proof = await this.#authority(input, 'read');
        let row = this.#row(input);
        if (row) {
            if (this.#saved(row).display_name !== this.#unchanged(input).name) fail('native_service_enrollment_content_conflict', 409);
            row = await this.#recover(input, row, proof);
        }
        await this.#authority(input, 'read', proof);
        return validateNativeCommandModel('AdapterEnrollments', { spec_version: '1.0', platform: 'wa_savana', enrollments: row ? [this.#public(row)] : [] });
    }
    #productScopeExpected(row, expected) {
        if (!exact(expected, ['enrollment_id', 'enrollment_version', 'public_key_fingerprint'])
            || !text(expected.enrollment_id) || !Number.isSafeInteger(expected.enrollment_version) || expected.enrollment_version < 1
            || !/^[a-f0-9]{64}$/.test(expected.public_key_fingerprint || '') || !row || row.state !== 'completed') {
            fail('native_service_enrollment_product_scope_unavailable', 409);
        }
        const registration = this.#registration(JSON.parse(row.response_json), row, true);
        if (registration.enrollment_id !== expected.enrollment_id || registration.version !== expected.enrollment_version
            || registration.public_key_fingerprint !== expected.public_key_fingerprint
            || !sameScopes(registration.accepted_scopes, [COLLABORATION_SCOPE])) {
            fail('native_service_enrollment_product_scope_changed', 409);
        }
        return registration;
    }
    // Explicit reviewed BFF only. Durable intent pins reopen this short window
    // around readonly lost-ACK recovery; the saved enrollment stays unchanged.
    async withProductScopeProjection(context, expected, action, { assertCurrent } = {}) {
        if (typeof action !== 'function' || typeof assertCurrent !== 'function') fail('native_service_enrollment_request_invalid', 422);
        const input = this.#input(context);
        const expectedStamp = nativeCommandJson(expected);
        if (!Number.isSafeInteger(context.session_version) || context.session_version < 1
            || input.actorId !== input.grantApprovedBy) fail('native_service_enrollment_product_scope_owner_required', 403);
        const fence = () => {
            if (assertCurrent() !== true) fail('native_service_enrollment_session_changed', 403);
            this.#unchanged(input);
        };
        fence();
        const proof = await this.#authority(input, 'product_scope');
        fence();
        if (nativeCommandJson(expected) !== expectedStamp) fail('native_service_enrollment_product_scope_changed', 409);
        const row = this.#row(input);
        this.#productScopeExpected(row, expected);
        if (this.productScopeProjections.has(input.nativeTenantId)) fail('native_service_enrollment_product_scope_busy', 409);
        const projection = { input, expected: structuredClone(expected), rowId: row.id, proof, fence,
            validUntil: Math.min(this.now() + 15_000, Date.parse(proof.validUntil)) };
        this.productScopeProjections.set(input.nativeTenantId, projection);
        try { const result = await action(); fence(); return result; }
        finally { if (this.productScopeProjections.get(input.nativeTenantId) === projection) this.productScopeProjections.delete(input.nativeTenantId); }
    }
    // Used only by authenticated NativeRPC GET. Local read/enroll stay factual.
    async readForCore(context) {
        const input = this.#input(context), projection = this.productScopeProjections.get(input.nativeTenantId);
        if (!projection) return this.read(context);
        projection.fence();
        if (projection.validUntil <= this.now() || input.actorId !== projection.input.actorId
            || input.grantApprovedBy !== input.actorId || !sameScope(input.scope, projection.input.scope)
            || input.externalTenantId !== projection.input.externalTenantId
            || context.session_version !== projection.input.context.session_version) {
            fail('native_service_enrollment_product_scope_context_changed', 403);
        }
        const proof = await this.#authority(input, 'product_scope_read', projection.proof);
        projection.fence();
        const row = this.#row(input);
        if (this.productScopeProjections.get(input.nativeTenantId) !== projection
            || projection.validUntil <= this.now() || Date.parse(proof.validUntil) <= this.now() || row?.id !== projection.rowId) {
            fail('native_service_enrollment_product_scope_context_changed', 403);
        }
        this.#productScopeExpected(row, projection.expected);
        const enrollment = this.#public(row);
        enrollment.accepted_scopes = [PRODUCT_SCOPE, COLLABORATION_SCOPE];
        return validateNativeCommandModel('AdapterEnrollments', { spec_version: '1.0', platform: 'wa_savana', enrollments: [enrollment] });
    }
    // Internal BFF callback ONLY after actual owner prepare-provider returned
    // authenticated complete Core registration metadata. No HTTP route, scope
    // advertisement, key replacement or registration POST is inferred here.
    async acceptVerifiedRegistration(context, options = {}, {assertCurrent=null, productScopeExpected=null}={}) {
        if(assertCurrent!==null&&typeof assertCurrent!=='function')fail('native_service_enrollment_request_invalid',422);
        if(productScopeExpected!==null&&typeof assertCurrent!=='function')fail('native_service_enrollment_request_invalid',422);
        const fence=()=>{if(assertCurrent!==null){let result;try{result=assertCurrent();}catch{fail('native_service_enrollment_session_changed',403);}
            if(result!==true)fail('native_service_enrollment_session_changed',403);}};
        fence();
        if (!exact(options, ['registration', 'expectedEnrollmentVersion'])
            || !(options.expectedEnrollmentVersion === null || (Number.isSafeInteger(options.expectedEnrollmentVersion)
                && options.expectedEnrollmentVersion >= 1))) fail('native_service_enrollment_request_invalid', 422);
        let receiptStamp, productScopeStamp;
        try { receiptStamp = nativeCommandJson(options.registration); } catch { fail('native_service_enrollment_registration_invalid', 502); }
        try { productScopeStamp = nativeCommandJson(productScopeExpected); } catch { fail('native_service_enrollment_registration_invalid', 502); }
        const input = this.#input(context);
        const proof = await this.#authority(input, 'accept_registration');
        fence();
        if (proof.grantApprovedBy !== input.actorId) fail('native_service_enrollment_initial_owner_required', 403);
        if (nativeCommandJson(options.registration) !== receiptStamp || nativeCommandJson(productScopeExpected) !== productScopeStamp) fail('native_service_enrollment_context_changed', 403);
        // Finish every awaited authority check before the atomic local receipt
        // write, so losing the original BFF session cannot leave a late update.
        fence();const currentProof=await this.#authority(input,'accept_registration',proof);fence();
        const row = this.db.transaction(() => {
            fence();
            if (nativeCommandJson(options.registration) !== receiptStamp || nativeCommandJson(productScopeExpected) !== productScopeStamp) fail('native_service_enrollment_context_changed', 403);
            this.#unchanged(input);
            if (Date.parse(currentProof.validUntil) <= this.now()) fail('native_service_enrollment_owner_changed', 403);
            const saved = this.#row(input);
            if (!saved || !['completed','inflight','unknown'].includes(saved.state)) fail('native_service_enrollment_state_changed', 409);
            const body = this.#saved(saved);
            if (body.display_name !== input.tenantName) fail('native_service_enrollment_content_conflict', 409);
            const registration = this.#registration(options.registration, saved, true);
            if(saved.state !== 'completed') {
                // An unresolved protected collaboration create has no reviewed
                // product-scope baseline. It cannot adopt this union implicitly.
                if (productExtension(body.accepted_scopes, registration.accepted_scopes)) fail('native_service_enrollment_extension_invalid', 409);
                if(options.expectedEnrollmentVersion !== null||saved.attempt_count<1)fail('native_service_enrollment_version_conflict',409);
                const extended=collaborationExtension(body.accepted_scopes,registration.accepted_scopes);
                if(extended&&registration.version<2)fail('native_service_enrollment_extension_invalid',409);
                const changed=this.db.prepare(`UPDATE savana_operational_consumer_enrollments SET state='completed',response_json=?,failure_code=NULL,updated_at=?
                    WHERE id=? AND state=? AND attempt_count=? AND response_json IS ?`).run(JSON.stringify(registration),this.#stamp(),saved.id,saved.state,saved.attempt_count,saved.response_json);
                if(changed.changes!==1)fail('native_service_enrollment_state_changed',409);
                const recovered=this.#row(input);
                this.#audit(input,recovered,proof,'registration_reconciled','completed');
                if(extended)this.#audit(input,recovered,proof,'registration_extended','completed');
                fence();
                return recovered;
            }
            let prior;
            try { prior = this.#registration(JSON.parse(saved.response_json), saved, true); }
            catch { fail('native_service_enrollment_registration_invalid', 502); }
            const sameReceipt=responseFields.every(key=>key==='accepted_scopes'?sameScopes(prior[key],registration[key]):prior[key]===registration[key]);
            if(sameReceipt) {
                if (productScopeExpected !== null && (!exact(productScopeExpected, ['enrollment_id', 'enrollment_version', 'public_key_fingerprint'])
                    || productScopeExpected.enrollment_id !== prior.enrollment_id
                    || productScopeExpected.public_key_fingerprint !== prior.public_key_fingerprint
                    || productScopeExpected.enrollment_version + 1 !== prior.version
                    || options.expectedEnrollmentVersion !== productScopeExpected.enrollment_version
                    || !sameScopes(prior.accepted_scopes, [PRODUCT_SCOPE, COLLABORATION_SCOPE])
                    || !sameScopes(body.accepted_scopes, [COLLABORATION_SCOPE]))) fail('native_service_enrollment_product_scope_changed', 409);
                if(options.expectedEnrollmentVersion !== null&&options.expectedEnrollmentVersion>prior.version)fail('native_service_enrollment_version_conflict',409);
                fence();
                return saved;
            }
            if (prior.version !== options.expectedEnrollmentVersion) fail('native_service_enrollment_version_conflict', 409);
            const addProducts = productScopeExpected !== null;
            if (addProducts) this.#productScopeExpected(saved, productScopeExpected);
            if (registration.enrollment_id !== prior.enrollment_id || registration.version !== prior.version + 1
                || !(collaborationExtension(prior.accepted_scopes, registration.accepted_scopes)
                    || (addProducts && productExtension(prior.accepted_scopes, registration.accepted_scopes)))) {
                fail('native_service_enrollment_extension_invalid', 409);
            }
            const changed = this.db.prepare(`UPDATE savana_operational_consumer_enrollments SET response_json=?,updated_at=?
                WHERE id=? AND state='completed' AND response_json=?`).run(JSON.stringify(registration), this.#stamp(), saved.id, saved.response_json);
            if (changed.changes !== 1) fail('native_service_enrollment_version_conflict', 409);
            const updated = this.#row(input);
            this.#audit(input, updated, proof, 'registration_extended', 'completed');
            fence();
            return updated;
        }).immediate();
        fence();
        return this.#public(row);
    }
    async enroll(context, options = {}) {
        if (!exact(options, [])) fail('native_service_enrollment_request_invalid', 422);
        const input = this.#input(context);
        const proof = await this.#authority(input, 'enroll');
        const existing = this.#row(input);
        if (existing) {
            const saved = this.#saved(existing);
            if (saved.display_name !== this.#unchanged(input).name) fail('native_service_enrollment_content_conflict', 409);
            const recovered = await this.#recover(input, existing, proof);
            await this.#authority(input, 'enroll', proof);
            return this.#public(recovered);
        }
        if (proof.grantApprovedBy !== input.actorId) fail('native_service_enrollment_initial_owner_required', 403);
        assertEgressAvailable();
        const prepared = this.#claimNew(input, proof);
        if (!prepared.claimed) {
            const saved = this.#saved(prepared.row);
            if (saved.display_name !== this.#unchanged(input).name) fail('native_service_enrollment_content_conflict', 409);
            await this.#authority(input, 'enroll', proof);
            return this.#public(prepared.row);
        }
        const row = prepared.row;
        let dispatched = false;
        try {
            const currentProof = await this.#authority(input, 'dispatch', proof);
            this.#saved(row); assertEgressAvailable();
            dispatched = true;
            const response = await this.fetch(this.url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
                headers: { 'Content-Type': 'application/json', 'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': this.platformToken }, body: row.request_json });
            await this.#authority(input, 'dispatch', currentProof);
            if (!response.ok || !response.headers.get('cache-control')?.includes('no-store')) fail('native_service_enrollment_outcome_unknown');
            const raw = await readBounded(response);
            await this.#authority(input, 'dispatch', currentProof);
            let parsed;
            try { parsed = JSON.parse(raw); } catch { fail('native_service_enrollment_registration_invalid', 502); }
            const registration = this.#registration(parsed, row);
            const result = this.#finish(input, row, currentProof, 'completed', registration);
            return this.#public(result);
        } catch (error) {
            const noEffect = !dispatched || error instanceof EgressMaintenanceError;
            this.#finish(input, row, proof, noEffect ? 'failed' : 'unknown', null,
                error instanceof NativeCommandProtocolError ? error.code : 'native_service_enrollment_outcome_unknown');
            if (error instanceof NativeCommandProtocolError || error instanceof EgressMaintenanceError) throw error;
            fail('native_service_enrollment_outcome_unknown');
        }
    }
}
