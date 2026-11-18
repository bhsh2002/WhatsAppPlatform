import crypto from 'node:crypto';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { SharedProductReadError } from './centralProductRead.js';

const fail = code => { throw new SharedProductReadError(code, 403); };
const text = (value, max = 255) => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = value => crypto.createHash('sha256').update(canonicalWorkspaceJson(value)).digest('hex');
const principalKey = p => hash([p.tenantId, p.userId, p.sessionId, p.authVersion, p.role, p.sessionExpiresAt]);

// Persistent identity evidence comes from real native authentication + current
// Core OIDC, not email, enrollment or a caller-supplied actor. It creates no
// grants. Core still owns every explicit scope/capability approval and effect.
export class NativeOwnerProofs {
    constructor({ database, verifyLocalPrincipal, currentIdentity, resolveBinding, issuer, clientId, now = () => Date.now() }) {
        if (!database || [verifyLocalPrincipal, currentIdentity, resolveBinding, now].some(value => typeof value !== 'function')
            || !text(issuer, 2048) || !text(clientId)) throw new TypeError('Native owner evidence requires real native/OIDC identity and binding readers');
        this.db = database; this.verify = verifyLocalPrincipal; this.currentIdentity = currentIdentity;
        this.resolveBinding = resolveBinding; this.issuer = issuer; this.clientId = clientId; this.now = now;
    }
    #local(principal, expected) {
        if (!Number.isSafeInteger(principal?.tenantId) || principal.tenantId < 1 || !Number.isSafeInteger(principal.userId) || principal.userId < 1
            || principal.role !== 'tenant' || !text(principal.sessionId, 4096) || !Number.isSafeInteger(principal.authVersion)
            || !Number.isSafeInteger(principal.sessionExpiresAt) || principal.sessionExpiresAt * 1000 <= this.now()
            || this.verify(principal) !== true || (expected && principalKey(principal) !== expected)) fail('native_owner_identity_required');
        const user = this.db.prepare('SELECT id,tenant_id,auth_version,role,is_active FROM users WHERE id=?').get(principal.userId);
        const tenant = this.db.prepare('SELECT id,status FROM tenants WHERE id=?').get(principal.tenantId);
        if (!user || user.tenant_id !== principal.tenantId || user.auth_version !== principal.authVersion
            || user.role !== 'tenant' || user.is_active !== 1 || !['Active', 'Warning'].includes(tenant?.status)) fail('native_owner_identity_required');
    }
    async capture(principal) {
        this.#local(principal); const expected = principalKey(principal);
        const identity = await this.currentIdentity(principal);
        this.#local(principal, expected);
        if (!text(identity?.actorId) || !text(identity.organizationId) || !text(identity.generation)
            || !Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= this.now()) fail('native_owner_identity_required');
        const actor = identity.actorId; const organization = identity.organizationId;
        return this.db.transaction(() => {
            this.#local(principal, expected);
            const prior = this.db.prepare(`SELECT id FROM savana_native_owner_proofs WHERE tenant_id=? AND user_id=? AND native_auth_version=?
                AND central_actor_id=? AND organization_id=? AND oidc_issuer=? AND oidc_client_id=? AND revoked_at IS NULL`)
                .get(principal.tenantId, principal.userId, principal.authVersion, actor, organization, this.issuer, this.clientId);
            if (prior) return { recorded: true, identityOnly: true };
            const withdrawn = this.db.prepare(`SELECT 1 FROM savana_native_owner_proofs WHERE tenant_id=? AND user_id=? AND native_auth_version=?
                AND central_actor_id=? AND organization_id=? AND oidc_issuer=? AND oidc_client_id=? AND identity_generation=? AND revoked_at IS NOT NULL`)
                .get(principal.tenantId, principal.userId, principal.authVersion, actor, organization, this.issuer, this.clientId, identity.generation);
            if (withdrawn) fail('native_owner_identity_withdrawn');
            const stamp = new Date(this.now()).toISOString();
            const row = this.db.prepare(`INSERT INTO savana_native_owner_proofs
                (tenant_id,user_id,native_auth_version,native_role,central_actor_id,organization_id,oidc_issuer,oidc_client_id,identity_generation,verified_at)
                VALUES(?,?,?,'tenant',?,?,?,?,?,?)`).run(principal.tenantId, principal.userId, principal.authVersion, actor, organization,
                    this.issuer, this.clientId, identity.generation, stamp);
            this.db.prepare(`INSERT INTO savana_native_owner_proof_audit
                (proof_id,tenant_id,user_id,central_actor_id,organization_id,action,created_at) VALUES(?,?,?,?,?,'identity_verified',?)`)
                .run(row.lastInsertRowid, principal.tenantId, principal.userId, actor, organization, stamp);
            return { recorded: true, identityOnly: true };
        }).immediate();
    }
    #owners(tenantId, organizationId) {
        const tenant = this.db.prepare('SELECT id,status FROM tenants WHERE id=?').get(tenantId);
        if (!['Active', 'Warning'].includes(tenant?.status)) fail('native_owner_authority_unavailable');
        return this.db.prepare(`SELECT proof.id,proof.user_id,proof.native_auth_version,proof.native_role,proof.central_actor_id,
            proof.organization_id,proof.oidc_issuer,proof.oidc_client_id
            FROM savana_native_owner_proofs proof JOIN users native ON native.id=proof.user_id
            WHERE proof.tenant_id=? AND proof.organization_id=? AND proof.revoked_at IS NULL
                AND proof.oidc_issuer=? AND proof.oidc_client_id=?
                AND native.tenant_id=proof.tenant_id AND native.is_active=1 AND native.role='tenant'
                AND native.auth_version=proof.native_auth_version ORDER BY proof.id`)
            .all(tenantId, organizationId, this.issuer, this.clientId);
    }
    async authority({ nativeTenantId, scope, grantApprovedBy }) {
        if (!Number.isSafeInteger(nativeTenantId) || nativeTenantId < 1 || !text(scope?.organization_id)
            || !text(scope.activity_id) || !text(grantApprovedBy)) fail('native_owner_authority_unavailable');
        const scopeSnapshot = hash(scope);
        const initial = this.#owners(nativeTenantId, scope.organization_id);
        if (!initial.some(row => row.central_actor_id === grantApprovedBy)) fail('native_owner_authority_unavailable');
        const expected = hash(initial);
        const native = await this.resolveBinding({ nativeTenantId, organizationId: scope.organization_id });
        const owners = this.#owners(nativeTenantId, scope.organization_id);
        if (scopeSnapshot !== hash(scope) || hash(owners) !== expected || !text(native?.id) || native.platform_code !== 'wa_savana' || native.status !== 'active'
            || native.organization_id !== scope.organization_id || native.external_tenant_id !== `wa_savana:tenant:${nativeTenantId}`) fail('native_owner_authority_changed');
        return { verified: true, nativeTenantId, grantApprovedBy,
            nativeAuthorityRevision: hash(['wa-native-ownership-v1', nativeTenantId, scope.organization_id, native.id, owners]),
            validUntil: new Date(this.now() + 30_000).toISOString() };
    }
}
