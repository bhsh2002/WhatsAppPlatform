import crypto from 'node:crypto';
import { createSqliteReadPrincipalVerifier } from './centralProductRead.js';
import { getWhatsAppConversationWindow } from './whatsappConversationWindow.js';
import { nativeCommandJson, NativeCommandProtocolError } from './nativeCommandProtocol.js';
import { resolveCollaborativeAccount, resolveCollaborativeRecipient } from './collaborativeNativeResources.js';

const purposes = new Set(['service_response', 'transactional', 'marketing','customer_service','business_record','correction']);
const sha = value => crypto.createHash('sha256').update(nativeCommandJson(value)).digest('hex');
const fail = (code, status = 422) => { throw new NativeCommandProtocolError(code, status); };
const text = (value, max = 255) => typeof value === 'string' && value.trim() && value.length <= max;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
const normalizeScope = scope => {
    if (!exact(scope, ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'])
        || !text(scope.organization_id) || !text(scope.activity_id)
        || (scope.branch_id != null && !text(scope.branch_id))
        || (scope.warehouse_id != null && (!text(scope.warehouse_id) || !scope.branch_id))) fail('consent_scope_unverified', 403);
    return { organization_id: scope.organization_id, activity_id: scope.activity_id,
        branch_id: scope.branch_id || null, warehouse_id: scope.warehouse_id || null };
};
const refId = ref => {
    if (!text(ref) || !/^consent:[a-f0-9-]{36}$/.test(ref)) fail('consent_not_found', 404);
    return ref.slice(8);
};

export class CollaborativeConsentService {
    constructor({ database, verifyOwnerAuthority, verifySourceEvidence = null,
        verifyLocalPrincipal = createSqliteReadPrincipalVerifier(database), now = () => Date.now() }) {
        if (!database || typeof verifyOwnerAuthority !== 'function') throw new TypeError('Consent records require an actual current native/Core owner authority verifier');
        this.db = database; this.verifyOwner = verifyOwnerAuthority; this.verifySource = verifySourceEvidence;
        this.verifyLocal = verifyLocalPrincipal; this.now = now;
    }
    assertLocal(principal) {
        if (this.verifyLocal(principal) !== true) fail('consent_session_required', 403);
    }
    selection(tenantId, input) {
        if (!purposes.has(input.purpose)) fail('consent_purpose_invalid');
        if(input.channel === 'native') {
            if(input.account_ref !== 'native_contacts'||!['customer_service','business_record','correction'].includes(input.purpose)
                ||!/^native_contact:[1-9][0-9]*$/.test(input.recipient_ref||''))fail('consent_native_selection_invalid');
            const tenant=this.db.prepare('SELECT id,status FROM tenants WHERE id=?').get(tenantId);
            const contact=this.db.prepare('SELECT id,phone,profile_name FROM contacts WHERE id=? AND tenant_id=?').get(Number(input.recipient_ref.slice(15)),tenantId);
            if(!['Active','Warning'].includes(tenant?.status)||!contact)fail('consent_resource_changed',409);
            return {account:{ref:'native_contacts',channel:'native',fingerprint:sha({tenantId,account:'native_contacts'})},
                recipient:{ref:input.recipient_ref,row:contact,fingerprint:sha({tenantId,account:'native_contacts',contactId:contact.id,phone:contact.phone,profileName:contact.profile_name})}};
        }
        if(!['service_response','transactional','marketing'].includes(input.purpose))fail('consent_purpose_invalid');
        const account = resolveCollaborativeAccount(this.db, tenantId, input.channel, input.account_ref);
        const recipient = resolveCollaborativeRecipient(this.db, tenantId, account, input.recipient_ref);
        return { account, recipient };
    }
    async owner(principal, input, action) {
        this.assertLocal(principal);
        if (!text(input.activity_ref,16384)) fail('consent_activity_selection_required');
        const selected = this.selection(principal.tenantId, input);
        const authority = await this.verifyOwner({ principal, activityRef: input.activity_ref,
            capabilityId: 'customers.manage', action, resourceSelection: {
                channel: input.channel, accountRef: selected.account.ref, recipientRef: selected.recipient.ref,
                accountFingerprint: selected.account.fingerprint, recipientFingerprint: selected.recipient.fingerprint,
                purpose: input.purpose,
            } });
        this.assertLocal(principal);
        if (!authority || authority.verified !== true || authority.canManageConsent !== true
            || String(authority.nativeTenantId) !== String(principal.tenantId)
            || String(authority.nativeUserId) !== String(principal.userId) || !text(authority.actorId)
            || !Number.isFinite(Date.parse(authority.validUntil)) || Date.parse(authority.validUntil) <= this.now()) {
            fail('consent_authority_unverified', 403);
        }
        const scope = normalizeScope(authority.scope); const current = this.selection(principal.tenantId, input);
        if (current.account.fingerprint !== selected.account.fingerprint
            || current.recipient.fingerprint !== selected.recipient.fingerprint) fail('consent_resource_changed', 409);
        return { ...current, authority, scope, scopeHash: sha(scope) };
    }
    inboundEvidence(tenantId, selected, purpose) {
        if (selected.account.channel !== 'whatsapp' || purpose !== 'service_response') fail('consent_inbound_purpose_invalid');
        const window = getWhatsAppConversationWindow(this.db, tenantId, selected.recipient.value, this.now(), selected.account.row.phone_number_id);
        const incoming = this.db.prepare(`SELECT id, created_at FROM messages WHERE tenant_id = ?
            AND direction = 'incoming' AND sender = ? AND recipient = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
            .get(tenantId, selected.recipient.value, selected.account.row.phone_number_id);
        if (!window.isOpen || !incoming || !Number.isFinite(Date.parse(window.closesAt))) fail('consent_current_inbound_required');
        return { kind: 'native_inbound', reference: `native_message:${incoming.id}`,
            recorded_at: incoming.created_at, valid_until: window.closesAt };
    }
    publicRecord(row) {
        return { value: `consent:${row.id}`, label: row.evidence_kind === 'native_inbound'
            ? 'طلب خدمة من المحادثة الحالية' : row.evidence_kind === 'signed_source'
                ? 'موافقة موثقة من المصدر' : 'سجل موافقة موثق لدى النشاط',
        channel: row.channel, account_ref: row.account_ref, recipient_ref: row.recipient_ref,
        purpose: row.purpose, evidence_kind: row.evidence_kind, version: row.version,
        source_label: row.evidence_kind === 'native_inbound' ? 'المحادثة الأصلية'
            : row.evidence_kind === 'signed_source' ? 'المصدر المتحقق منه' : 'سجل النشاط',
        recorded_at: row.recorded_at, valid_until: row.valid_until, revoked: Boolean(row.revoked_at),
        expired: Date.parse(row.valid_until) <= this.now() };
    }
    async record(principal, input) {
        if (!exact(input, ['activity_ref', 'channel', 'account_ref', 'recipient_ref', 'purpose', 'evidence', 'valid_until', 'idempotency_key'])
            || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotency_key || '')
            || !Number.isFinite(Date.parse(input.valid_until)) || Date.parse(input.valid_until) <= this.now()) fail('consent_record_invalid');
        const selected = await this.owner(principal, input, 'consent.record');
        const evidence = input.evidence; let verifiedEvidence;
        if (evidence?.kind === 'native_inbound') {
            if (!exact(evidence, ['kind'])) fail('consent_evidence_invalid');
            verifiedEvidence = this.inboundEvidence(principal.tenantId, selected, input.purpose);
        } else if (evidence?.kind === 'owner_recorded') {
            if (!exact(evidence, ['kind', 'reference', 'note', 'recorded_at']) || !text(evidence.reference)
                || !text(evidence.note, 2000) || evidence.note.trim().length < 20
                || !Number.isFinite(Date.parse(evidence.recorded_at)) || Date.parse(evidence.recorded_at) > this.now()) {
                fail('consent_recorded_evidence_required');
            }
            // This is explicitly owner-recorded evidence, never represented as
            // a customer signature or an automatic identity/marketing grant.
            verifiedEvidence = { ...evidence, actor_id: selected.authority.actorId,
                valid_until: input.valid_until };
        } else if (evidence?.kind === 'signed_source') {
            if (!exact(evidence, ['kind', 'evidence_ref']) || !text(evidence.evidence_ref)
                || typeof this.verifySource !== 'function') fail('consent_source_verification_required', 409);
            const proof = await this.verifySource({ principal, evidenceRef: evidence.evidence_ref, scope: selected.scope,
                accountRef: selected.account.ref, recipientRef: selected.recipient.ref,
                recipientFingerprint: selected.recipient.fingerprint, purpose: input.purpose });
            this.assertLocal(principal);
            if (!proof || proof.verified !== true || !['catalog', 'sawemly', 'wa_savana'].includes(proof.source_platform)
                || sha(normalizeScope(proof.scope)) !== selected.scopeHash || proof.account_ref !== selected.account.ref
                || proof.recipient_fingerprint !== selected.recipient.fingerprint || proof.purpose !== input.purpose
                || !text(proof.source_record_ref) || !Number.isSafeInteger(proof.source_revision) || proof.source_revision < 1
                || !/^[a-f0-9]{64}$/.test(proof.evidence_sha256 || '')
                || !Number.isFinite(Date.parse(proof.valid_until)) || Date.parse(proof.valid_until) <= this.now()) {
                fail('consent_source_evidence_unverified', 403);
            }
            verifiedEvidence = { kind: 'signed_source', reference: evidence.evidence_ref, source_platform: proof.source_platform,
                source_record_ref: proof.source_record_ref, source_revision: proof.source_revision,
                source_evidence_sha256: proof.evidence_sha256, recorded_at: proof.recorded_at || new Date(this.now()).toISOString(),
                valid_until: proof.valid_until };
        } else fail('consent_evidence_required');
        const fresh = await this.owner(principal, input, 'consent.record');
        if (fresh.authority.actorId !== selected.authority.actorId || fresh.scopeHash !== selected.scopeHash
            || fresh.account.fingerprint !== selected.account.fingerprint
            || fresh.recipient.fingerprint !== selected.recipient.fingerprint) fail('consent_authority_changed', 403);
        const validUntil = new Date(Math.min(Date.parse(input.valid_until), Date.parse(verifiedEvidence.valid_until))).toISOString();
        const operationHash = sha({ input, actor: selected.authority.actorId, scope: selected.scope });
        const evidenceHash = sha({ evidence: verifiedEvidence, scope: selected.scope,
            account: selected.account.fingerprint, recipient: selected.recipient.fingerprint, purpose: input.purpose });
        const row = this.db.transaction(() => {
            this.assertLocal(principal);
            if (Date.parse(fresh.authority.validUntil) <= this.now()
                || Date.parse(validUntil) <= this.now()) fail('consent_authority_expired', 403);
            const current = this.selection(principal.tenantId, input);
            if (current.account.fingerprint !== selected.account.fingerprint
                || current.recipient.fingerprint !== selected.recipient.fingerprint) fail('consent_resource_changed', 409);
            const existing = this.db.prepare('SELECT * FROM savana_collaborative_consents WHERE tenant_id = ? AND operation_key = ?')
                .get(principal.tenantId, input.idempotency_key);
            if (existing) {
                if (existing.operation_hash !== operationHash) fail('consent_idempotency_conflict', 409);
                return existing;
            }
            const id = crypto.randomUUID(); const at = new Date(this.now()).toISOString();
            this.db.prepare(`INSERT INTO savana_collaborative_consents (id, tenant_id, organization_id, activity_id,
                scope_json, scope_hash, channel, account_ref, account_fingerprint, recipient_ref, recipient_fingerprint,
                purpose, evidence_kind, evidence_json, evidence_hash, recorded_by_actor, recorded_by_user, recorded_at,
                valid_until, operation_key, operation_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id,
                principal.tenantId, selected.scope.organization_id, selected.scope.activity_id,
                nativeCommandJson(selected.scope), selected.scopeHash, input.channel, selected.account.ref,
                selected.account.fingerprint, selected.recipient.ref, selected.recipient.fingerprint, input.purpose,
                verifiedEvidence.kind, nativeCommandJson(verifiedEvidence), evidenceHash, selected.authority.actorId,
                principal.userId, verifiedEvidence.recorded_at, validUntil, input.idempotency_key, operationHash, at, at);
            this.db.prepare(`INSERT INTO savana_collaborative_consent_audit
                (id, consent_id, version, action, actor_id, evidence_hash, occurred_at) VALUES (?, ?, 1, 'recorded', ?, ?, ?)`)
                .run(crypto.randomUUID(), id, selected.authority.actorId, evidenceHash, at);
            return this.db.prepare('SELECT * FROM savana_collaborative_consents WHERE id = ?').get(id);
        }).immediate();
        return this.publicRecord(row);
    }
    current({ tenantId, scope, channel, accountRef, recipientRef, purpose, consentRef }) {
        if (!purposes.has(purpose)) fail('consent_purpose_invalid');
        const row = this.db.prepare('SELECT * FROM savana_collaborative_consents WHERE id = ? AND tenant_id = ?')
            .get(refId(consentRef), tenantId);
        if (!row || row.revoked_at || Date.parse(row.valid_until) <= this.now() || row.scope_hash !== sha(normalizeScope(scope))
            || row.channel !== channel || row.account_ref !== accountRef || row.recipient_ref !== recipientRef || row.purpose !== purpose) {
            fail('consent_current_record_required', 409);
        }
        const selected = this.selection(tenantId, { channel, account_ref: accountRef, recipient_ref: recipientRef, purpose });
        if (selected.account.fingerprint !== row.account_fingerprint || selected.recipient.fingerprint !== row.recipient_fingerprint) {
            fail('consent_resource_changed', 409);
        }
        if (row.evidence_kind === 'native_inbound') this.inboundEvidence(tenantId, selected, purpose);
        return { record: this.publicRecord(row), evidenceHash: row.evidence_hash, account: selected.account, recipient: selected.recipient };
    }
    async list(principal, input) {
        const selected = await this.owner(principal, { ...input, purpose: input.purpose || (input.channel === 'native' ? 'customer_service' : 'service_response') }, 'consent.read');
        return this.db.prepare(`SELECT * FROM savana_collaborative_consents WHERE tenant_id = ? AND scope_hash = ?
            AND channel = ? AND account_ref = ? AND recipient_ref = ? ORDER BY created_at DESC LIMIT 100`)
            .all(principal.tenantId, selected.scopeHash, input.channel, selected.account.ref, selected.recipient.ref)
            .map(row => this.publicRecord(row));
    }
    async lookup(principal,input) {
        this.assertLocal(principal);
        if(!exact(input,['activity_ref','channel','account_ref','recipient_ref','purpose','idempotency_key'])
            ||!text(input.activity_ref,16384)||!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotency_key||''))fail('consent_record_invalid');
        const row=this.db.prepare('SELECT * FROM savana_collaborative_consents WHERE tenant_id=? AND operation_key=?').get(principal.tenantId,input.idempotency_key);
        if(!row||['channel','account_ref','recipient_ref','purpose'].some(key=>input[key]!==undefined&&input[key]!==row[key]))fail('consent_lookup_unresolved',404);
        const selected=await this.owner(principal,{activity_ref:input.activity_ref,channel:row.channel,account_ref:row.account_ref,
            recipient_ref:row.recipient_ref,purpose:row.purpose},'consent.lookup');
        if(row.scope_hash!==selected.scopeHash||row.account_ref!==selected.account.ref
            ||row.recipient_ref!==selected.recipient.ref||row.recorded_by_user!==principal.userId
            ||row.recorded_by_actor!==selected.authority.actorId||row.account_fingerprint!==selected.account.fingerprint
            ||row.recipient_fingerprint!==selected.recipient.fingerprint)fail('consent_lookup_unresolved',404);
        return {record:this.publicRecord(row),operation_key:input.idempotency_key};
    }
    async revoke(principal, consentRef, { activity_ref: activityRef, expected_version: version } = {}) {
        this.assertLocal(principal);
        if (!Number.isSafeInteger(version) || version < 1) fail('consent_version_required');
        const row = this.db.prepare('SELECT * FROM savana_collaborative_consents WHERE id = ? AND tenant_id = ?')
            .get(refId(consentRef), principal.tenantId);
        if (!row) fail('consent_not_found', 404);
        const selected = await this.owner(principal, { activity_ref: activityRef, channel: row.channel,
            account_ref: row.account_ref, recipient_ref: row.recipient_ref, purpose: row.purpose }, 'consent.revoke');
        if (selected.scopeHash !== row.scope_hash) fail('consent_scope_unverified', 403);
        this.db.transaction(() => {
            this.assertLocal(principal); const at = new Date(this.now()).toISOString();
            const changed = this.db.prepare(`UPDATE savana_collaborative_consents SET version = version + 1,
                revoked_at = ?, revoked_by_actor = ?, updated_at = ? WHERE id = ? AND version = ? AND revoked_at IS NULL`)
                .run(at, selected.authority.actorId, at, row.id, version);
            if (!changed.changes) fail('consent_version_changed', 409);
            this.db.prepare(`INSERT INTO savana_collaborative_consent_audit
                (id, consent_id, version, action, actor_id, evidence_hash, occurred_at) VALUES (?, ?, ?, 'revoked', ?, ?, ?)`)
                .run(crypto.randomUUID(), row.id, version + 1, selected.authority.actorId, row.evidence_hash, at);
        }).immediate();
        return this.publicRecord(this.db.prepare('SELECT * FROM savana_collaborative_consents WHERE id = ?').get(row.id));
    }
}
