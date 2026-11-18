import crypto from 'node:crypto';
import { canonicalWorkspaceJson } from './workspaceIntents.js';
import { SharedProductReadError } from './centralProductRead.js';

const fail = () => { throw new SharedProductReadError('workspace_receipt_unverified', 403); };
const keyText = value => typeof value === 'string' && value.length > 0 && value.length <= 255;
const context = (principal, identity) => {
    if (!Number.isSafeInteger(principal?.tenantId) || principal.tenantId < 1 || !Number.isSafeInteger(principal?.userId)
        || principal.userId < 1 || ![identity?.actorId, identity?.organizationId, identity?.nativeAccountId].every(keyText)) fail();
    return [principal.tenantId, principal.userId, identity.actorId, identity.organizationId, identity.nativeAccountId];
};

// Server-only persisted receipts survive a lost browser acknowledgement and a
// process restart. Their encryption binds the exact owner/account and purpose.
export class WorkspaceReceipts {
    constructor({ database, encryption, verifyLocalPrincipal, now = () => Date.now() }) {
        if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || typeof verifyLocalPrincipal !== 'function') throw new TypeError('Workspace receipts require owned storage and a current principal');
        this.db = database; this.cipher = encryption; this.verify = verifyLocalPrincipal; this.now = now;
    }
    #keys(principal, identity, kind, key) {
        if (this.verify(principal) !== true || principal.sessionExpiresAt * 1000 <= this.now()
            || !/^[a-z][a-z_.]{0,60}$/.test(kind) || !keyText(key)) fail();
        return [...context(principal, identity), kind, key];
    }
    #open(row) {
        try {
            const keys = [row.tenant_id, row.user_id, row.central_actor_id, row.organization_id, row.native_account_id, row.kind, row.receipt_key];
            const data = JSON.parse(this.cipher.decrypt(row.encrypted_payload));
            if (data.binding !== crypto.createHash('sha256').update(canonicalWorkspaceJson(keys)).digest('hex')) fail();
            return data.payload;
        } catch { fail(); }
    }
    save(principal, identity, kind, key, payload) {
        const keys = this.#keys(principal, identity, kind, key);
        const raw = canonicalWorkspaceJson({ binding: crypto.createHash('sha256').update(canonicalWorkspaceJson(keys)).digest('hex'), payload });
        const ciphertext = this.cipher.encrypt(raw);
        if (!keyText(ciphertext) && (typeof ciphertext !== 'string' || ciphertext.length > 2_000_000)) fail();
        if (!ciphertext || ciphertext.includes(raw) || this.cipher.decrypt(ciphertext) !== raw) fail();
        const stamp = new Date(this.now()).toISOString();
        this.#keys(principal, identity, kind, key);
        this.db.prepare(`INSERT INTO savana_workspace_receipts
            (tenant_id,user_id,central_actor_id,organization_id,native_account_id,kind,receipt_key,encrypted_payload,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,user_id,central_actor_id,organization_id,native_account_id,kind,receipt_key)
            DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at`).run(...keys, ciphertext, stamp, stamp);
        return structuredClone(payload);
    }
    read(principal, identity, kind, key) {
        const keys = this.#keys(principal, identity, kind, key);
        const row = this.db.prepare(`SELECT * FROM savana_workspace_receipts WHERE tenant_id=? AND user_id=?
            AND central_actor_id=? AND organization_id=? AND native_account_id=? AND kind=? AND receipt_key=?`).get(...keys);
        return row ? this.#open(row) : null;
    }
    list(principal, identity, kind) {
        this.#keys(principal, identity, kind, '_');
        return this.db.prepare(`SELECT * FROM savana_workspace_receipts WHERE tenant_id=? AND user_id=?
            AND central_actor_id=? AND organization_id=? AND native_account_id=? AND kind=? ORDER BY updated_at DESC LIMIT 100`)
            .all(...context(principal, identity), kind).map(row => ({ key: row.receipt_key, payload: this.#open(row) }));
    }
    // Only a verified machine NativeRPC caller uses this mapping. A fresh Core
    // status read must still validate lifecycle, account, scope and all epochs.
    nativeNamespace({ nativeTenantId, organizationId, installationId }) {
        const rows = this.db.prepare(`SELECT * FROM savana_workspace_receipts WHERE tenant_id=? AND organization_id=?
            AND kind='namespace' AND receipt_key=?`).all(nativeTenantId, organizationId, installationId);
        if (!rows.length) return null;
        const values = rows.map(row => this.#open(row));
        if (new Set(values.map(value => value.namespace_id)).size !== 1) fail();
        return values.sort((a, b) => b.version - a.version)[0];
    }
}
