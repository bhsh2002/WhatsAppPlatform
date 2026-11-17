import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';
import { canonicalJson } from './savanaIntegration.js';

const flags = { read_only: true, execution_ready: false, pricing_use_allowed: false };
const COOKIE = 'savana_control_session';
const POLICY = 'explicit_current_exact_scope_actions; self_approval_permitted';
const READ_ACTIONS = ['read.request', 'read.approve', 'fields.approve', 'read.manage', 'reviews.read', 'operations.inspect'];
const FIELDS = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media', 'is_visible'];
const KINDS = ['consumer_registration', 'read_sharing'];
const OPS = ['scope.create', 'scope.authorize', 'request.create', 'request.edit', 'request.approve', 'request.reject', 'read_grant.revoke'];
const fail = (code, status = 503) => { throw new SharedProductReadError(code, status); };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,255}$/.test(value);
const version = value => Number.isSafeInteger(value) && value > 0;
const text = (value, max = 200) => typeof value === 'string' && !!value.trim() && value.length <= max;
const aware = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const sameScope = (a, b) => ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'].every(k => (a[k] ?? null) === (b[k] ?? null));
const principalValues = p => [p.tenantId, p.userId, sha(p.sessionId), p.authVersion];
const predicate = 'tenant_id=? AND user_id=? AND session_hash=? AND auth_version=?';
const principalKey = p => sha(JSON.stringify(principalValues(p)));
const nativeReference = p => sha(canonicalJson({ tenant_id: p.tenantId, user_id: p.userId }));
const strict = (value, allowed, required = allowed, input = false) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) {
        fail(input ? 'owner_portal_request_invalid' : 'owner_portal_response_invalid', input ? 422 : 502);
    }
};
const check = (condition, input = false) => { if (!condition) fail(input ? 'owner_portal_request_invalid' : 'owner_portal_response_invalid', input ? 422 : 502); };
const list = (value, maximum = 1000) => { check(Array.isArray(value) && value.length <= maximum); return value; };
const distinct = (value, allowed, maximum, input = false) => {
    check(Array.isArray(value) && value.length <= maximum && new Set(value).size === value.length
        && value.every(v => allowed ? allowed.includes(v) : id(v)), input);
    return [...value];
};
const noSecrets = value => {
    const prohibited = new Set(['cookie', 'set-cookie', 'secret', 'credential_secret', 'access_token', 'refresh_token',
        'password', 'private_key', 'private_key_pem', 'portal_secret', 'ciphertext', 'encrypted_key', 'authorization']);
    if (Array.isArray(value)) value.forEach(noSecrets);
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
        if (prohibited.has(key.toLowerCase())) fail('owner_portal_response_invalid', 502);
        noSecrets(item);
    });
};
const scope = (value, organizationId, input = false) => {
    const keys = input ? ['activity_id', 'branch_id', 'warehouse_id'] : ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'];
    strict(value, keys, input ? ['activity_id'] : ['organization_id', 'activity_id'], input);
    check(id(value.activity_id) && (input || value.organization_id === organizationId)
        && [value.branch_id, value.warehouse_id].every(v => v == null || id(v))
        && (!value.warehouse_id || !!value.branch_id), input);
    return { organization_id: organizationId, activity_id: value.activity_id,
        branch_id: value.branch_id ?? null, warehouse_id: value.warehouse_id ?? null };
};
const proposal = (kind, value, input = false) => {
    if (kind === 'consumer_registration') {
        strict(value, ['enrollment_id', 'enrollment_version', 'installation_label'], undefined, input);
        check(id(value.enrollment_id) && version(value.enrollment_version) && text(value.installation_label), input);
        return { enrollment_id: value.enrollment_id, enrollment_version: value.enrollment_version, installation_label: value.installation_label };
    }
    check(kind === 'read_sharing', input);
    strict(value, ['source_installation_id', 'consumer_installation_id', 'fields', 'reader_account_ids', 'expires_at'], undefined, input);
    check(id(value.source_installation_id) && id(value.consumer_installation_id) && aware(value.expires_at), input);
    const fields = distinct(value.fields, FIELDS, 8, input);
    const readers = distinct(value.reader_account_ids, null, 100, input);
    check(fields.length > 0 && readers.length > 0, input);
    return { source_installation_id: value.source_installation_id, consumer_installation_id: value.consumer_installation_id,
        fields, reader_account_ids: readers, expires_at: new Date(value.expires_at).toISOString() };
};
const effective = (kind, value) => {
    if (value == null) return null;
    if (kind === 'consumer_registration') {
        strict(value, ['installation_id', 'enrollment_id']);
        check(id(value.installation_id) && id(value.enrollment_id));
        return { installation_id: value.installation_id, enrollment_id: value.enrollment_id };
    }
    const keys = ['read_grant_id', 'revision', 'source_installation_id', 'consumer_installation_id', 'fields', 'reader_account_ids', 'expires_at'];
    strict(value, [...keys, 'active', 'superseded_by_request'], keys);
    check(id(value.read_grant_id) && version(value.revision)
        && (value.active === undefined || typeof value.active === 'boolean')
        && (value.superseded_by_request === undefined || id(value.superseded_by_request)));
    return { read_grant_id: value.read_grant_id, revision: value.revision,
        ...proposal('read_sharing', Object.fromEntries(keys.slice(2).map(k => [k, value[k]]))),
        ...(value.active === undefined ? {} : { active: value.active }),
        ...(value.superseded_by_request === undefined ? {} : { superseded_by_request: value.superseded_by_request }) };
};

export class OperationalOwnerPortalService {
    constructor({ database, encryption, config = {}, verifyLocalPrincipal, verifyIdentitySession, resolveNativeAccount,
        fetchImpl = globalThis.fetch, now = () => Date.now() }) {
        if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || typeof verifyLocalPrincipal !== 'function' || typeof verifyIdentitySession !== 'function'
            || (config.enabled === true && typeof resolveNativeAccount !== 'function')) {
            throw new TypeError('Owner portal requires explicit storage, cipher and current native identity resolvers');
        }
        this.db = database; this.encryption = encryption; this.config = config;
        this.verifyLocal = verifyLocalPrincipal; this.verifyIdentity = verifyIdentitySession;
        this.resolveNativeAccount = resolveNativeAccount; this.fetch = fetchImpl; this.now = now;
        if (config.enabled === true) {
            const url = new URL(config.portalOrigin);
            const loopback = config.allowLoopback === true && url.protocol === 'http:'
                && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
            if (!(url.protocol === 'https:' || loopback) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
                throw new TypeError('An explicit trusted ControlCenter portal origin is required');
            }
            this.origin = url.origin;
        }
    }
    #stamp() { return new Date(this.now()).toISOString(); }
    #local(principal) {
        if (this.config.enabled !== true) fail('owner_portal_disabled');
        if (!Number.isSafeInteger(principal?.tenantId) || principal.tenantId < 1
            || !Number.isSafeInteger(principal.userId) || principal.userId < 1
            || !Number.isSafeInteger(principal.authVersion) || principal.authVersion < 0
            || !text(principal.sessionId, 1024) || !Number.isSafeInteger(principal.sessionExpiresAt)
            || principal.sessionExpiresAt * 1000 <= this.now() || this.verifyLocal(principal) !== true) {
            fail('shared_product_read_session_required', 403);
        }
    }
    async #identity(principal, expected) {
        this.#local(principal);
        const before = JSON.stringify(principal);
        const identity = await this.verifyIdentity(principal);
        this.#local(principal);
        if (JSON.stringify(principal) !== before || !id(identity?.actorId) || !id(identity?.organizationId)
            || !text(identity.generation, 255) || !aware(identity.expiresAt) || Date.parse(identity.expiresAt) <= this.now()) {
            fail('owner_portal_identity_required', 403);
        }
        const snapshot = JSON.stringify([identity.actorId, identity.organizationId, identity.generation, identity.expiresAt]);
        if (expected && snapshot !== expected.snapshot) fail('owner_portal_identity_changed', 403);
        return { actorId: identity.actorId, organizationId: identity.organizationId, generation: identity.generation,
            expiresAt: identity.expiresAt, snapshot };
    }
    #audit(principal, identity, reference, action) {
        this.db.prepare(`INSERT INTO savana_owner_portal_audit
            (tenant_id,user_id,central_actor_id,organization_id,session_reference,resource_reference,action,created_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(principal.tenantId, principal.userId, identity?.actorId ?? null,
                identity?.organizationId ?? null, principalKey(principal), reference, action, this.#stamp());
    }
    #seal(principal, identity, reference, purpose, payload) {
        const raw = JSON.stringify({ principal: principalKey(principal), actor: identity.actorId, organization: identity.organizationId,
            origin: this.origin, reference, purpose, payload });
        const encrypted = this.encryption.encrypt(raw);
        if (typeof encrypted !== 'string' || !encrypted || encrypted.includes(raw) || encrypted.includes(JSON.stringify(payload))) {
            fail('owner_portal_encryption_unavailable');
        }
        return encrypted;
    }
    #open(principal, identity, reference, purpose, encrypted) {
        try {
            const value = JSON.parse(this.encryption.decrypt(encrypted));
            return value.principal === principalKey(principal) && value.actor === identity.actorId
                && value.organization === identity.organizationId && value.origin === this.origin
                && value.reference === reference && value.purpose === purpose ? value.payload : null;
        } catch { return null; }
    }
    #sessionRow(principal, identity) {
        return this.db.prepare(`SELECT * FROM savana_owner_portal_sessions WHERE ${predicate}
            AND central_actor_id=? AND organization_id=? AND portal_origin=? ORDER BY rowid DESC LIMIT 1`)
            .get(...principalValues(principal), identity.actorId, identity.organizationId, this.origin);
    }
    #active(principal, identity) {
        const row = this.#sessionRow(principal, identity);
        if (!row || row.state !== 'connected' || Date.parse(row.expires_at) <= this.now()) fail('owner_portal_session_required', 403);
        const cookie = this.#open(principal, identity, row.id, 'central_portal_cookie', row.encrypted_cookie);
        if (!cookie || !text(cookie.cookie, 8192) || cookie.generation !== row.generation) fail('owner_portal_credentials_unavailable');
        return { row, cookie: cookie.cookie };
    }
    #generationCurrent(principal, binding, states = ['connected']) {
        const row = this.db.prepare(`SELECT generation,state,expires_at FROM savana_owner_portal_sessions WHERE id=? AND ${predicate}`)
            .get(binding.row.id, ...principalValues(principal));
        if (!row || row.generation !== binding.row.generation || !states.includes(row.state)
            || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= this.now()) fail('owner_portal_session_changed', 403);
    }
    async #bound(principal, identity, binding, states) {
        await this.#identity(principal, identity);
        this.#generationCurrent(principal, binding, states);
    }
    async #json(principal, identity, binding, method, path, body, states) {
        await this.#bound(principal, identity, binding, states);
        let response;
        try {
            response = await this.fetch(`${this.origin}${path}`, { method, redirect: 'error', cache: 'no-store',
                headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...(binding.cookie ? { Cookie: binding.cookie } : {}), ...(method === 'GET' ? {} : { 'X-Savana-CSRF': '1' }) },
                ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(5000) });
        } catch { fail('owner_portal_outcome_unknown'); }
        await this.#bound(principal, identity, binding, states);
        if (!response.ok) {
            const status = [401, 403, 404, 409, 422, 423, 428, 429, 503].includes(response.status) ? response.status : 503;
            fail(status === 428 ? 'owner_portal_mfa_required' : 'owner_portal_rejected', status);
        }
        let raw;
        try { raw = await response.text(); } catch { fail('owner_portal_outcome_unknown'); }
        await this.#bound(principal, identity, binding, states);
        if (raw.length > 1_000_000) fail('owner_portal_response_invalid', 502);
        let payload;
        try { payload = JSON.parse(raw); } catch { fail('owner_portal_response_invalid', 502); }
        noSecrets(payload);
        return { response, payload };
    }
    #prefix(identity) { return `/api/member/organizations/${encodeURIComponent(identity.organizationId)}/integration`; }
    #membership(payload, identity) {
        strict(payload, ['membership', 'members', 'integration_operational_enabled']);
        const member = payload.membership;
        check(member && member.account_id === identity.actorId && member.organization_id === identity.organizationId && member.status === 'active');
        check(Array.isArray(member.permissions) && member.permissions.every(p => typeof p === 'string'));
        check(typeof member.role === 'string' && typeof payload.integration_operational_enabled === 'boolean');
        const readers = list(payload.members).filter(m => m?.status === 'active').map(m => {
            check(id(m.account_id) && text(m.display_name));
            return { account_id: m.account_id, display_name: m.display_name };
        });
        return { ownerAdmin: member.role === 'owner' && member.permissions.includes('organization:members'),
            enabled: payload.integration_operational_enabled, readers };
    }
    async #context(principal, identity, binding, states) {
        const session = (await this.#json(principal, identity, binding, 'GET', '/api/session', undefined, states)).payload;
        strict(session, ['authenticated', 'username', 'display_name', 'role', 'account_id']);
        check(session.authenticated === true && session.account_id === identity.actorId && session.role === 'organization_member');
        const context = await this.#json(principal, identity, binding, 'GET', `${this.#prefix(identity)}/ui-context`, undefined, states);
        return this.#membership(context.payload, identity);
    }
    #counts(principal, identity) {
        const rows = this.db.prepare(`SELECT state,COUNT(*) AS n FROM savana_owner_portal_intents
            WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND state IN ('prepared','inflight','unknown') GROUP BY state`)
            .all(principal.tenantId, identity.actorId, identity.organizationId);
        const counts = Object.fromEntries(rows.map(r => [r.state, r.n]));
        return { unknown_count: counts.unknown || 0, inflight_count: (counts.inflight || 0) + (counts.prepared || 0),
            mutations_blocked: rows.length > 0 };
    }
    #status(principal, identity, state, row) {
        return { enabled: this.config.enabled === true, ...flags, native_reference: nativeReference(principal),
            session: { state, actor_id: row ? identity.actorId : null, organization_id: row ? identity.organizationId : null,
                expires_at: row?.expires_at ?? null },
            actions: { login: state !== 'authorizing', disconnect: !!row && state !== 'revoked', overview: state === 'connected' },
            intents: this.#counts(principal, identity) };
    }
    async status(principal) {
        if (this.config.enabled !== true) return { enabled: false, ...flags,
            session: { state: 'disconnected', actor_id: null, organization_id: null, expires_at: null },
            actions: { login: false, disconnect: false, overview: false }, intents: { unknown_count: 0, inflight_count: 0, mutations_blocked: false } };
        const identity = await this.#identity(principal);
        const row = this.#sessionRow(principal, identity);
        if (!row) return this.#status(principal, identity, 'disconnected');
        let state = Date.parse(row.expires_at) <= this.now() ? 'expired' : row.state;
        if (state === 'connected') {
            let binding;
            try { binding = this.#active(principal, identity); } catch { state = 'unknown'; }
            if (binding) await this.#context(principal, identity, binding);
        }
        return this.#status(principal, identity, state, row);
    }
    #invalidate(principal) {
        this.db.prepare(`UPDATE savana_owner_portal_sessions SET state='revoked',generation=?,encrypted_cookie=NULL,updated_at=?
            WHERE ${predicate} AND state IN ('authorizing','connected')`).run(crypto.randomUUID(), this.#stamp(), ...principalValues(principal));
        this.db.prepare(`UPDATE savana_owner_portal_intents SET state='unknown',updated_at=?
            WHERE ${predicate} AND state IN ('prepared','inflight')`).run(this.#stamp(), ...principalValues(principal));
    }
    async login(principal, credentials) {
        const identity = await this.#identity(principal);
        strict(credentials, ['username', 'password', 'mfa_code'], ['username', 'password'], true);
        check(text(credentials.username, 320) && text(credentials.password, 4096)
            && (credentials.mfa_code === undefined || /^\d{6}$/.test(credentials.mfa_code)), true);
        const row = { id: crypto.randomUUID(), generation: crypto.randomUUID() };
        const expiresAt = new Date(Math.min(principal.sessionExpiresAt * 1000, Date.parse(identity.expiresAt))).toISOString();
        this.db.transaction(() => {
            this.#local(principal); this.#invalidate(principal);
            this.db.prepare(`INSERT INTO savana_owner_portal_sessions
                (id,tenant_id,user_id,session_hash,auth_version,central_actor_id,organization_id,portal_origin,generation,state,expires_at,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,'authorizing',?,?,?)`).run(row.id, ...principalValues(principal), identity.actorId,
                    identity.organizationId, this.origin, row.generation, expiresAt, this.#stamp(), this.#stamp());
            this.#audit(principal, identity, row.id, 'portal_login_started_no_grant');
        }).immediate();
        const binding = { row, cookie: null };
        try {
            const login = await this.#json(principal, identity, binding, 'POST', '/api/session', JSON.stringify(credentials), ['authorizing']);
            strict(login.payload, ['authenticated', 'username', 'display_name', 'role']);
            check(login.payload.authenticated === true && login.payload.role === 'organization_member');
            const values = typeof login.response.headers.getSetCookie === 'function' ? login.response.headers.getSetCookie()
                : [login.response.headers.get('set-cookie')].filter(Boolean);
            const cookies = values.filter(v => v.startsWith(`${COOKIE}=`));
            check(cookies.length === 1);
            const parts = cookies[0].split(';').map(p => p.trim());
            const attributes = Object.fromEntries(parts.slice(1).map(p => { const [key, ...rest] = p.split('='); return [key.toLowerCase(), rest.join('=')]; }));
            const token = parts[0].slice(COOKIE.length + 1);
            check(/^[A-Za-z0-9._~-]{1,8192}$/.test(token) && Object.hasOwn(attributes, 'httponly')
                && attributes.path === '/' && Number.isSafeInteger(Number(attributes['max-age'])) && Number(attributes['max-age']) > 0
                && (this.origin.startsWith('http:') || Object.hasOwn(attributes, 'secure')));
            binding.cookie = `${COOKIE}=${token}`;
            await this.#context(principal, identity, binding, ['authorizing']);
            await this.#bound(principal, identity, binding, ['authorizing']);
            const expiry = new Date(Math.min(Date.parse(expiresAt), this.now() + Number(attributes['max-age']) * 1000)).toISOString();
            const encrypted = this.#seal(principal, identity, row.id, 'central_portal_cookie', { cookie: binding.cookie, generation: row.generation });
            this.db.transaction(() => {
                this.#local(principal); this.#generationCurrent(principal, binding, ['authorizing']);
                this.db.prepare("UPDATE savana_owner_portal_sessions SET state='connected',encrypted_cookie=?,expires_at=?,updated_at=? WHERE id=?")
                    .run(encrypted, expiry, this.#stamp(), row.id);
                this.#audit(principal, identity, row.id, 'portal_cookie_connected_not_oidc_or_read_grant');
            }).immediate();
            return this.#status(principal, identity, 'connected', this.#sessionRow(principal, identity));
        } catch (failure) {
            this.db.transaction(() => {
                this.db.prepare("UPDATE savana_owner_portal_sessions SET state='failed',encrypted_cookie=NULL,updated_at=? WHERE id=? AND generation=? AND state='authorizing'")
                    .run(this.#stamp(), row.id, row.generation);
                this.#audit(principal, identity, row.id, 'portal_login_unverified_no_cookie_saved');
            }).immediate();
            if (failure instanceof SharedProductReadError) throw failure;
            fail('owner_portal_unavailable');
        }
    }
    disconnect(principal) {
        this.#local(principal);
        const rows = this.db.prepare(`SELECT central_actor_id,organization_id FROM savana_owner_portal_sessions WHERE ${predicate}`)
            .all(...principalValues(principal));
        this.db.transaction(() => {
            this.#invalidate(principal);
            this.#audit(principal, null, principalKey(principal), 'portal_local_disconnect_no_global_revocation');
        }).immediate();
        const identities = [...new Map(rows.map(row => [JSON.stringify([row.central_actor_id, row.organization_id]), row])).values()];
        const counts = identities.map(row => this.#counts(principal, { actorId: row.central_actor_id, organizationId: row.organization_id }));
        return { enabled: true, ...flags, native_reference: nativeReference(principal),
            session: { state: 'revoked', actor_id: null, organization_id: null, expires_at: null },
            actions: { login: true, disconnect: false, overview: false },
            intents: { unknown_count: counts.reduce((n, c) => n + c.unknown_count, 0),
                inflight_count: counts.reduce((n, c) => n + c.inflight_count, 0), mutations_blocked: counts.some(c => c.mutations_blocked) },
            local_disconnected: true, central_session_revoked: false, central_read_grant_revoked: false };
    }
    #requestProjection(value, identity) {
        const keys = ['request_id', 'organization_id', 'scope', 'kind', 'proposal', 'version', 'state', 'requested_by',
            'reviewed_by', 'effective_version', 'effective_resource', 'reason', 'updated_at', 'approval_policy'];
        strict(value, keys);
        check(KINDS.includes(value.kind) && id(value.request_id) && value.organization_id === identity.organizationId
            && version(value.version) && ['pending', 'approved', 'rejected'].includes(value.state)
            && id(value.requested_by) && (value.reviewed_by === null || id(value.reviewed_by))
            && (value.effective_version === null || (version(value.effective_version) && value.effective_version <= value.version))
            && (value.reason === null || text(value.reason, 1000)) && (value.updated_at === null || aware(value.updated_at))
            && value.approval_policy === POLICY);
        const resource = effective(value.kind, value.effective_resource);
        check((resource === null) === (value.effective_version === null));
        return { request_id: value.request_id, kind: value.kind, scope: scope(value.scope, identity.organizationId),
            proposal: proposal(value.kind, value.proposal), version: value.version, state: value.state,
            effective_version: value.effective_version, effective_resource: resource, requested_by: value.requested_by,
            reviewed_by: value.reviewed_by, reason: value.reason, updated_at: value.updated_at };
    }
    #overviewProjection(raw, identity, membership, native, counts) {
        strict(raw, ['organization_id', 'scopes', 'scope_authorizations', 'requests', 'installations', 'publisher_grants',
            'read_grants', 'deliveries', 'enrollments', 'origin_evidence', 'approval_policy']);
        check(raw.organization_id === identity.organizationId && raw.approval_policy === POLICY);
        Object.entries(raw).filter(([key]) => !['organization_id', 'approval_policy'].includes(key)).forEach(([, value]) => list(value));
        const authorizations = raw.scope_authorizations.map(a => {
            strict(a, ['actor_id', 'scope', 'actions', 'expires_at', 'version', 'assigned_by']);
            check(id(a.actor_id) && version(a.version) && (a.expires_at === null || aware(a.expires_at)) && id(a.assigned_by));
            const actions = distinct(a.actions, null, 11);
            return { actor_id: a.actor_id, scope: scope(a.scope, identity.organizationId), actions: actions.filter(v => READ_ACTIONS.includes(v)),
                version: a.version, expires_at: a.expires_at, native_editable: actions.every(v => READ_ACTIONS.includes(v)) };
        });
        const actionsFor = selected => {
            const a = authorizations.find(v => v.actor_id === identity.actorId && sameScope(v.scope, selected)
                && (!v.expires_at || Date.parse(v.expires_at) > this.now()));
            const has = action => membership.enabled && !counts.mutations_blocked && !!a?.actions.includes(action);
            return { request_consumer_registration: has('read.request'), request_read_sharing: has('read.request'),
                approve_consumer_registration: has('read.approve'), approve_read_sharing: has('read.approve') && has('fields.approve'),
                review: !!a?.actions.includes('reviews.read'), revoke_read_grant: has('read.manage') };
        };
        const scopes = raw.scopes.map(v => {
            strict(v, ['scope', 'label']); check(text(v.label));
            const selected = scope(v.scope, identity.organizationId);
            return { scope: selected, label: v.label, actions: actionsFor(selected) };
        });
        // The native tenant id is local, not the central platform-account id.
        const ownEnrollments = raw.enrollments.filter(e => e?.platform === 'wa_savana'
            && e.external_tenant_id === identity.externalTenant).map(e => {
            strict(e, ['enrollment_id', 'organization_id', 'platform', 'external_tenant_id', 'display_name', 'version', 'accepted_scopes', 'public_key_fingerprint']);
            check(id(e.enrollment_id) && e.organization_id === identity.organizationId && text(e.display_name)
                && version(e.version) && /^[0-9a-f]{64}$/.test(e.public_key_fingerprint)
                && Array.isArray(e.accepted_scopes) && e.accepted_scopes.length === 1 && e.accepted_scopes[0] === 'savana.products.sync');
            return { enrollment_id: e.enrollment_id, organization_id: e.organization_id, platform: e.platform,
                external_tenant_id: e.external_tenant_id, display_name: e.display_name, version: e.version,
                accepted_scopes: ['savana.products.sync'], public_key_fingerprint: e.public_key_fingerprint };
        });
        const installations = raw.installations.map(v => {
            strict(v, ['id', 'installation_id', 'enrollment_id', 'scope', 'tenant_id', 'label', 'platform']);
            check(id(v.id) && v.id === v.installation_id && id(v.enrollment_id) && id(v.tenant_id)
                && text(v.label) && ['catalog', 'wa_savana', 'sawemly'].includes(v.platform));
            return { installation_id: v.installation_id, enrollment_id: v.enrollment_id,
                scope: scope(v.scope, identity.organizationId), label: v.label, platform: v.platform, account: v.tenant_id };
        });
        const consumerInstallations = installations.filter(v => native && v.platform === 'wa_savana' && v.account === native.id
            && ownEnrollments.some(e => e.enrollment_id === v.enrollment_id)).map(({ account, ...v }) => v);
        const publisherPolicies = raw.publisher_grants.map(v => {
            strict(v, ['id', 'publisher_grant_id', 'request_id', 'scope', 'installation_id', 'enrollment_id', 'revision', 'active', 'expires_at', 'expired', 'policy']);
            check(id(v.installation_id) && typeof v.active === 'boolean' && typeof v.expired === 'boolean' && aware(v.expires_at));
            check(v.policy && typeof v.policy === 'object');
            const fields = distinct(v.policy.fields, FIELDS, 8); check(fields.length > 0);
            return { installation_id: v.installation_id, scope: scope(v.scope, identity.organizationId), fields,
                active: v.active && !v.expired && Date.parse(v.expires_at) > this.now() };
        });
        const sourceInstallations = installations.filter(v => v.platform === 'catalog').flatMap(({ account, ...v }) => {
            const policies = publisherPolicies.filter(p => p.active && p.installation_id === v.installation_id && sameScope(p.scope, v.scope));
            if (!policies.length) return [];
            const fields = policies[0].fields.filter(field => policies.every(p => p.fields.includes(field)));
            return fields.length ? [{ ...v, fields }] : [];
        });
        const requests = raw.requests.filter(v => KINDS.includes(v?.kind)).map(v => {
            const projected = this.#requestProjection(v, identity);
            const actions = actionsFor(projected.scope);
            const approve = projected.kind === 'consumer_registration' ? actions.approve_consumer_registration : actions.approve_read_sharing;
            return { ...projected, actions: { edit: actions.request_consumer_registration && projected.requested_by === identity.actorId,
                approve: approve && projected.state === 'pending', reject: approve && projected.state === 'pending' } };
        }).filter(request => request.kind === 'consumer_registration'
            ? ownEnrollments.some(e => e.enrollment_id === request.proposal.enrollment_id
                && (!request.effective_resource || request.effective_resource.enrollment_id === e.enrollment_id))
            : consumerInstallations.some(i => sameScope(i.scope, request.scope)
                && i.installation_id === request.proposal.consumer_installation_id)
                && (!request.effective_resource || consumerInstallations.some(i => sameScope(i.scope, request.scope)
                    && i.installation_id === request.effective_resource.consumer_installation_id)));
        const readGrants = raw.read_grants.map(v => {
            strict(v, ['id', 'read_grant_id', 'request_id', 'scope', 'source_installation_id', 'consumer_installation_id', 'revision', 'active', 'expires_at', 'expired', 'policy']);
            check(id(v.read_grant_id) && v.id === v.read_grant_id && version(v.revision) && typeof v.active === 'boolean'
                && typeof v.expired === 'boolean' && aware(v.expires_at));
            const policy = proposal('read_sharing', v.policy);
            check(policy.source_installation_id === v.source_installation_id && policy.consumer_installation_id === v.consumer_installation_id);
            return { read_grant_id: v.read_grant_id, scope: scope(v.scope, identity.organizationId),
                source_installation_id: policy.source_installation_id, consumer_installation_id: policy.consumer_installation_id,
                revision: v.revision, active: v.active, expired: v.expired || Date.parse(v.expires_at) <= this.now(),
                expires_at: v.expires_at, fields: policy.fields, reader_account_ids: policy.reader_account_ids };
        }).filter(v => consumerInstallations.some(i => i.installation_id === v.consumer_installation_id && sameScope(i.scope, v.scope)));
        return { context: { actor_id: identity.actorId, organization_id: identity.organizationId, checked_at: this.#stamp(), valid_until: identity.expiresAt },
            options: { scopes, enrollments: ownEnrollments, consumer_installations: consumerInstallations,
                source_installations: sourceInstallations, readers: membership.readers }, requests, read_grants: readGrants,
            scope_authorizations: authorizations,
            actions: { create_scope: membership.enabled && membership.ownerAdmin && !counts.mutations_blocked,
                authorize_scope: membership.enabled && membership.ownerAdmin && !counts.mutations_blocked } };
    }
    async #overview(principal, identity, binding) {
        const membership = await this.#context(principal, identity, binding);
        const raw = (await this.#json(principal, identity, binding, 'GET', `${this.#prefix(identity)}/overview`)).payload;
        await this.#bound(principal, identity, binding);
        const native = await this.resolveNativeAccount(principal, identity);
        await this.#bound(principal, identity, binding);
        if (native !== null && (!native || !id(native.id) || native.organization_id !== identity.organizationId
            || native.platform_code !== 'wa_savana' || native.external_tenant_id !== `wa_savana:tenant:${principal.tenantId}`
            || native.status !== 'active')) fail('shared_read_native_binding_required', 403);
        const counts = this.#counts(principal, identity);
        const projected = this.#overviewProjection(raw, { ...identity, externalTenant: `wa_savana:tenant:${principal.tenantId}` }, membership, native, counts);
        return { ...this.#status(principal, identity, 'connected', binding.row), ...projected,
            actions: { ...this.#status(principal, identity, 'connected', binding.row).actions, ...projected.actions } };
    }
    async overview(principal) {
        const identity = await this.#identity(principal);
        return this.#overview(principal, identity, this.#active(principal, identity));
    }
    #mutation(input, identity, overview) {
        strict(input, ['operation', 'idempotencyKey', 'body', 'requestId', 'targetAccountId'], ['operation', 'idempotencyKey', 'body'], true);
        check(OPS.includes(input.operation) && text(input.idempotencyKey, 255), true);
        const { operation, body } = input;
        const requestOp = ['request.edit', 'request.approve', 'request.reject', 'read_grant.revoke'].includes(operation);
        check(requestOp ? id(input.requestId) : input.requestId === undefined, true);
        check(operation === 'scope.authorize' ? id(input.targetAccountId) : input.targetAccountId === undefined, true);
        let centralBody; let suffix; let method = 'POST'; let priorRequest = null;
        const validateProposal = (kind, value, selected) => {
            const p = proposal(kind, value, true);
            if (kind === 'consumer_registration') {
                check(overview.options.enrollments.some(e => e.enrollment_id === p.enrollment_id && e.version === p.enrollment_version), true);
            } else {
                const source = overview.options.source_installations.find(i => i.installation_id === p.source_installation_id && sameScope(i.scope, selected));
                check(!!source && overview.options.consumer_installations.some(i => i.installation_id === p.consumer_installation_id && sameScope(i.scope, selected))
                    && p.fields.every(f => source.fields.includes(f)) && Date.parse(p.expires_at) > this.now()
                    && p.reader_account_ids.every(reader => overview.options.readers.some(r => r.account_id === reader)), true);
            }
            return p;
        };
        if (operation === 'scope.create') {
            strict(body, ['scope', 'label'], undefined, true); check(text(body.label) && overview.actions.create_scope, true);
            centralBody = { scope: scope(body.scope, identity.organizationId, true), label: body.label }; suffix = 'scopes';
        } else if (operation === 'scope.authorize') {
            strict(body, ['scope', 'actions', 'expires_at', 'expected_version'], undefined, true);
            const selected = scope(body.scope, identity.organizationId, true);
            const previous = overview.scope_authorizations.find(a => a.actor_id === input.targetAccountId && sameScope(a.scope, selected));
            if (previous && !previous.native_editable) fail('owner_portal_control_center_required', 409);
            check(overview.actions.authorize_scope && overview.options.readers.some(r => r.account_id === input.targetAccountId)
                && Number.isSafeInteger(body.expected_version) && body.expected_version >= 0
                && (body.expires_at === null || (aware(body.expires_at) && Date.parse(body.expires_at) > this.now())), true);
            centralBody = { scope: selected, actions: distinct(body.actions, READ_ACTIONS, 6, true),
                expires_at: body.expires_at, expected_version: body.expected_version };
            suffix = `scope-authorizations/${encodeURIComponent(input.targetAccountId)}`; method = 'PUT';
        } else if (operation === 'request.create') {
            strict(body, ['kind', 'scope', 'proposal'], undefined, true); check(KINDS.includes(body.kind), true);
            const selected = scope(body.scope, identity.organizationId, true);
            const option = overview.options.scopes.find(s => sameScope(s.scope, selected));
            check(!!option?.actions.request_consumer_registration, true);
            centralBody = { kind: body.kind, scope: selected, proposal: validateProposal(body.kind, body.proposal, selected) }; suffix = 'requests';
        } else if (operation === 'read_grant.revoke') {
            strict(body, ['expected_revision', 'reason'], undefined, true);
            const grant = overview.read_grants.find(g => g.read_grant_id === input.requestId);
            const option = grant && overview.options.scopes.find(s => sameScope(s.scope, grant.scope));
            check(!!option?.actions.revoke_read_grant && version(body.expected_revision) && body.expected_revision === grant.revision && text(body.reason, 1000), true);
            centralBody = { expected_revision: body.expected_revision, reason: body.reason };
            suffix = `read-grants/${encodeURIComponent(input.requestId)}/revoke`;
        } else {
            const request = overview.requests.find(r => r.request_id === input.requestId);
            check(!!request, true);
            priorRequest = request;
            if (operation === 'request.edit') {
                strict(body, ['expected_version', 'proposal'], undefined, true); check(request.actions.edit, true);
                centralBody = { expected_version: body.expected_version, proposal: validateProposal(request.kind, body.proposal, request.scope) };
                suffix = `requests/${encodeURIComponent(input.requestId)}`; method = 'PATCH';
            } else {
                strict(body, operation === 'request.reject' ? ['expected_version', 'reason'] : ['expected_version'], undefined, true);
                check(operation === 'request.approve' ? request.actions.approve : request.actions.reject, true);
                centralBody = { expected_version: body.expected_version };
                if (operation === 'request.reject') { check(text(body.reason, 1000), true); centralBody.reason = body.reason; }
                suffix = `requests/${encodeURIComponent(input.requestId)}/${operation === 'request.approve' ? 'approve' : 'reject'}`;
            }
            check(version(body.expected_version) && body.expected_version === request.version, true);
        }
        const path = `${this.#prefix(identity)}/${suffix}`;
        const bodyJson = canonicalJson(centralBody);
        return { method, path, bodyJson, requestHash: sha(canonicalJson({ method, path, body: bodyJson })), centralBody, priorRequest };
    }
    #intentPublic(principal, identity, row, includeResult = false) {
        // Historical response bytes remain encrypted evidence. A lookup/retry
        // returns status only; current choices/resources come from fresh BFF reads.
        const result = includeResult && row.encrypted_result ? this.#open(principal, identity, row.id, 'owner_portal_intent_result', row.encrypted_result) : null;
        return { enabled: true, ...flags, intent: { id: row.id, operation: row.operation, state: row.state,
            request_sha256: row.request_sha256, created_at: row.created_at, updated_at: row.updated_at, result } };
    }
    async intent(principal, reference) {
        const identity = await this.#identity(principal);
        const binding = this.#active(principal, identity);
        await this.#context(principal, identity, binding);
        if (!id(reference)) fail('owner_portal_request_invalid', 422);
        const row = this.db.prepare(`SELECT * FROM savana_owner_portal_intents WHERE id=? AND ${predicate}
            AND central_actor_id=? AND organization_id=?`).get(reference, ...principalValues(principal), identity.actorId, identity.organizationId);
        if (!row) fail('owner_portal_intent_unavailable', 404);
        return this.#intentPublic(principal, identity, row);
    }
    async intentByKey(principal, key) {
        const identity = await this.#identity(principal);
        const binding = this.#active(principal, identity);
        await this.#context(principal, identity, binding);
        if (!text(key, 255)) fail('owner_portal_request_invalid', 422);
        // Only public ledger metadata crosses native JWT/user boundaries, for
        // the same verified tenant + actual central actor + organization.
        const row = this.db.prepare(`SELECT * FROM savana_owner_portal_intents
            WHERE idempotency_key=? AND tenant_id=? AND central_actor_id=? AND organization_id=?`)
            .get(key, principal.tenantId, identity.actorId, identity.organizationId);
        if (!row) fail('owner_portal_intent_unavailable', 404);
        return this.#intentPublic(principal, identity, row);
    }
    #result(input, payload, identity, planned) {
        if (input.operation.startsWith('request.')) {
            const result = this.#requestProjection(payload, identity);
            const equals = (a, b) => canonicalJson(a) === canonicalJson(b);
            if (input.operation === 'request.create') {
                check(result.kind === planned.centralBody.kind && sameScope(result.scope, planned.centralBody.scope)
                    && equals(result.proposal, planned.centralBody.proposal) && result.version === 1 && result.state === 'pending'
                    && result.requested_by === identity.actorId && result.reviewed_by === null && result.reason === null
                    && result.effective_version === null && result.effective_resource === null);
            } else {
                const prior = planned.priorRequest;
                check(result.request_id === input.requestId && result.kind === prior.kind && sameScope(result.scope, prior.scope)
                    && result.requested_by === prior.requested_by);
                if (input.operation === 'request.edit') {
                    check(result.version === planned.centralBody.expected_version + 1 && result.state === 'pending'
                        && equals(result.proposal, planned.centralBody.proposal) && result.reviewed_by === null && result.reason === null
                        && result.effective_version === prior.effective_version && equals(result.effective_resource, prior.effective_resource));
                } else {
                    check(result.version === planned.centralBody.expected_version && equals(result.proposal, prior.proposal)
                        && result.reviewed_by === identity.actorId);
                    if (input.operation === 'request.reject') {
                        check(result.state === 'rejected' && result.reason === planned.centralBody.reason
                            && result.effective_version === prior.effective_version && equals(result.effective_resource, prior.effective_resource));
                    } else {
                        check(result.state === 'approved' && result.reason === null && result.effective_version === result.version
                            && result.effective_resource !== null);
                        if (result.kind === 'consumer_registration') check(result.effective_resource.enrollment_id === result.proposal.enrollment_id);
                        else check(equals(proposal('read_sharing', Object.fromEntries(['source_installation_id', 'consumer_installation_id',
                            'fields', 'reader_account_ids', 'expires_at'].map(k => [k, result.effective_resource[k]]))), result.proposal)
                            && result.effective_resource.active !== false);
                    }
                }
            }
            return { request: result };
        }
        if (input.operation === 'scope.create') {
            strict(payload, ['scope', 'label', 'grants_created']); check(payload.grants_created === false && text(payload.label));
            const selected = scope(payload.scope, identity.organizationId);
            check(sameScope(selected, planned.centralBody.scope) && payload.label === planned.centralBody.label);
            return { scope: selected, label: payload.label, grants_created: false };
        }
        if (input.operation === 'scope.authorize') {
            strict(payload, ['target_account_id', 'scope', 'actions', 'expires_at', 'version']);
            check(payload.target_account_id === input.targetAccountId && version(payload.version)
                && (payload.expires_at === null || aware(payload.expires_at)));
            const selected = scope(payload.scope, identity.organizationId);
            const actions = distinct(payload.actions, READ_ACTIONS, 6);
            check(sameScope(selected, planned.centralBody.scope) && payload.version === planned.centralBody.expected_version + 1
                && canonicalJson(actions) === canonicalJson(planned.centralBody.actions)
                && (payload.expires_at === null ? planned.centralBody.expires_at === null
                    : Date.parse(payload.expires_at) === Date.parse(planned.centralBody.expires_at)));
            return { target_account_id: payload.target_account_id, scope: selected,
                actions, expires_at: payload.expires_at, version: payload.version };
        }
        strict(payload, ['grant_id', 'revision', 'active']);
        check(payload.grant_id === input.requestId && payload.revision === planned.centralBody.expected_revision + 1 && payload.active === false);
        return { read_grant: { read_grant_id: payload.grant_id, revision: payload.revision, active: false } };
    }
    async perform(principal, input) {
        const identity = await this.#identity(principal);
        const binding = this.#active(principal, identity);
        strict(input, ['operation', 'idempotencyKey', 'body', 'requestId', 'targetAccountId'], ['operation', 'idempotencyKey', 'body'], true);
        check(OPS.includes(input.operation) && text(input.idempotencyKey, 255), true);
        const inputHash = sha(canonicalJson(input));
        await this.#context(principal, identity, binding);
        const previous = this.db.prepare(`SELECT * FROM savana_owner_portal_intents
            WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=?`)
            .get(principal.tenantId, identity.actorId, identity.organizationId, input.idempotencyKey);
        if (previous) {
            if (previous.operation !== input.operation || previous.input_sha256 !== inputHash) fail('owner_portal_intent_content_conflict', 409);
            return this.#intentPublic(principal, identity, previous);
        }
        if (this.#counts(principal, identity).mutations_blocked) fail('owner_portal_unresolved_intent', 409);
        const overview = await this.#overview(principal, identity, binding);
        if (overview.intents.mutations_blocked) fail('owner_portal_unresolved_intent', 409);
        const request = this.#mutation(input, identity, overview);
        const prepared = this.db.transaction(() => {
            this.#local(principal); this.#generationCurrent(principal, binding);
            const existing = this.db.prepare(`SELECT * FROM savana_owner_portal_intents
                WHERE tenant_id=? AND central_actor_id=? AND organization_id=? AND idempotency_key=?`)
                .get(principal.tenantId, identity.actorId, identity.organizationId, input.idempotencyKey);
            if (existing) {
                if (existing.operation !== input.operation || existing.input_sha256 !== inputHash
                    || existing.request_sha256 !== request.requestHash) fail('owner_portal_intent_content_conflict', 409);
                return { row: existing, dispatch: false };
            }
            if (this.#counts(principal, identity).mutations_blocked) fail('owner_portal_unresolved_intent', 409);
            const reference = crypto.randomUUID();
            const encrypted = this.#seal(principal, identity, reference, 'owner_portal_intent_request',
                { method: request.method, path: request.path, body_json: request.bodyJson });
            this.db.prepare(`INSERT INTO savana_owner_portal_intents
                (id,tenant_id,user_id,session_hash,auth_version,central_actor_id,organization_id,operation,idempotency_key,
                input_sha256,request_sha256,encrypted_request,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)`)
                .run(reference, ...principalValues(principal), identity.actorId, identity.organizationId, input.operation,
                    input.idempotencyKey, inputHash, request.requestHash, encrypted, this.#stamp(), this.#stamp());
            this.#audit(principal, identity, reference, 'owner_intent_prepared');
            const claimed = this.db.prepare("UPDATE savana_owner_portal_intents SET state='inflight' WHERE id=? AND state='prepared'").run(reference);
            if (claimed.changes !== 1) fail('owner_portal_intent_unavailable', 409);
            this.#audit(principal, identity, reference, 'owner_intent_claimed_once');
            return { row: this.db.prepare('SELECT * FROM savana_owner_portal_intents WHERE id=?').get(reference), dispatch: true };
        }).immediate();
        if (!prepared.dispatch) return this.#intentPublic(principal, identity, prepared.row);
        const finish = (state, result) => this.db.transaction(() => {
            if (state === 'completed') { this.#local(principal); this.#generationCurrent(principal, binding); }
            const encrypted = result ? this.#seal(principal, identity, prepared.row.id, 'owner_portal_intent_result', result) : null;
            const changed = this.db.prepare("UPDATE savana_owner_portal_intents SET state=?,encrypted_result=?,updated_at=? WHERE id=? AND state='inflight'")
                .run(state, encrypted, this.#stamp(), prepared.row.id);
            if (changed.changes) this.#audit(principal, identity, prepared.row.id, `owner_intent_${state}`);
        }).immediate();
        try {
            const payload = (await this.#json(principal, identity, binding, request.method, request.path, request.bodyJson)).payload;
            const result = this.#result(input, payload, identity, request);
            finish('completed', result);
        } catch (failure) {
            const knownRejection = failure.code === 'owner_portal_rejected' && [401, 403, 404, 409, 422, 423, 428, 429].includes(failure.status);
            finish(knownRejection ? 'failed' : 'unknown');
            if (failure instanceof SharedProductReadError) throw failure;
            fail('owner_portal_outcome_unknown');
        }
        return this.#intentPublic(principal, identity, this.db.prepare('SELECT * FROM savana_owner_portal_intents WHERE id=?').get(prepared.row.id), true);
    }
}
