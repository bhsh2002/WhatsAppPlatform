import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { CollaborativeConsentService } from '../services/collaborativeConsents.js';

const START = Date.parse('2026-11-18T13:00:00Z');
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const principal = { userId: 1, tenantId: 1, role: 'tenant', sessionId: 'synthetic-local-session', authVersion: 0, sessionExpiresAt: START / 1000 + 600 };
const input = extra => ({ activity_ref: 'synthetic-activity-choice', channel: 'sms', account_ref: 'sms_account:1', recipient_ref: 'native_contact:1',
    purpose: 'transactional', evidence: { kind: 'owner_recorded', reference: 'synthetic-owner-register', note: 'Synthetic recorded customer consent evidence for this exact purpose.',
        recorded_at: new Date(START - 1000).toISOString() }, valid_until: new Date(START + 3600_000).toISOString(),
    idempotency_key: ['synthetic','consent','operation'].join('-'), ...extra });
const fixture = t => {
    const database = new Database(':memory:'); runMigrationsSync(database); t.after(() => database.close());
    database.exec(`INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic owner','218910000001','Active'),(2,'Other synthetic','218910000002','Active');
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version) VALUES(1,'synthetic','unused','tenant',1,1,0);
        INSERT INTO contacts(id,tenant_id,phone,profile_name) VALUES(1,1,'218910000099','Synthetic contact'),(2,2,'218920000099','Other contact');
        INSERT INTO sms_gateway_accounts(id,tenant_id,name,base_url,api_key_encrypted,credential_fingerprint,webhook_secret_encrypted,webhook_key,status)
        VALUES(1,1,'Synthetic SMS','https://owned-sms.invalid','unused-cipher','synthetic-fingerprint-1','unused-cipher','synthetic-hook-1','active'),
              (2,2,'Other SMS','https://other-sms.invalid','unused-cipher','synthetic-fingerprint-2','unused-cipher','synthetic-hook-2','active');`);
    let clock = START; let allowed = true; let authorityUntil = START + 30_000; let verifySource = async selection => ({ verified: true,
        source_platform: 'catalog', scope: selection.scope, account_ref: selection.accountRef, recipient_fingerprint: selection.recipientFingerprint,
        purpose: selection.purpose, source_record_ref: 'synthetic-source-consent', source_revision: 1, evidence_sha256: 'a'.repeat(64),
        valid_until: new Date(START + 3600_000).toISOString() });
    const service = new CollaborativeConsentService({ database, now: () => clock,
        verifyLocalPrincipal: p => database.prepare('SELECT is_active FROM users WHERE id=? AND tenant_id=?').get(p.userId,p.tenantId)?.is_active === 1,
        verifyOwnerAuthority: async ({ principal: p, resourceSelection }) => {
            assert.equal(resourceSelection.accountRef.startsWith('sms_account:') || resourceSelection.accountRef.startsWith('whatsapp_number:'), true);
            return { verified: allowed, canManageConsent: allowed, nativeTenantId: p.tenantId, nativeUserId: p.userId,
                actorId: 'synthetic-core-owner', scope, validUntil: new Date(authorityUntil).toISOString() };
        }, verifySourceEvidence: value => verifySource(value) });
    return { database, service, now: () => clock, setClock: value => { clock=value; }, deny: () => { allowed=false; },
        deadline: value => { authorityUntil=value; }, source: callback => { verifySource=callback; }, count: () => database.prepare('SELECT COUNT(*) n FROM savana_collaborative_consents').get().n };
};

test('actual scoped owner record is labeled owner-recorded, deduplicated and does not disclose evidence text or phone', async t => {
    const f=fixture(t); const first=await f.service.record(principal,input()); const repeated=await f.service.record(principal,input());
    assert.equal(first.value,repeated.value); assert.equal(first.evidence_kind,'owner_recorded'); assert.equal(first.revoked,false); assert.equal(f.count(),1);
    assert.equal(JSON.stringify(first).includes('218910000099'),false); assert.equal(JSON.stringify(first).includes('Synthetic recorded'),false);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_collaborative_consent_audit').get().n,1);
    await assert.rejects(f.service.record(principal,input({purpose:'marketing'})),{code:'consent_idempotency_conflict'});
});

test('foreign account/contact, absent scope authority and invented contact claims cannot create consent', async t => {
    const f=fixture(t);
    for(const extra of [{account_ref:'sms_account:2'},{recipient_ref:'native_contact:2'},{recipient_ref:'218910000099'},{purpose:'invented'}]) {
        await assert.rejects(f.service.record(principal,input(extra)));
    }
    f.deny(); await assert.rejects(f.service.record(principal,input()),{code:'consent_authority_unverified'}); assert.equal(f.count(),0);
});

test('current consent binds exact scope/purpose/account/recipient and invalidates changed native resources', async t => {
    const f=fixture(t); const saved=await f.service.record(principal,input());
    const lookup={tenantId:1,scope,channel:'sms',accountRef:'sms_account:1',recipientRef:'native_contact:1',purpose:'transactional',consentRef:saved.value};
    assert.equal(f.service.current(lookup).record.value,saved.value);
    assert.throws(()=>f.service.current({...lookup,purpose:'marketing'}),{code:'consent_current_record_required'});
    assert.throws(()=>f.service.current({...lookup,scope:{...scope,activity_id:'other'}}),{code:'consent_current_record_required'});
    f.database.prepare("UPDATE contacts SET phone='218930000099' WHERE id=1").run();
    assert.throws(()=>f.service.current(lookup),{code:'consent_resource_changed'});
});

test('concurrent revocation uses exact version once and current consumption rejects the withdrawn evidence', async t => {
    const f=fixture(t); const saved=await f.service.record(principal,input());
    const replies=await Promise.allSettled([1,2].map(()=>f.service.revoke(principal,saved.value,{activity_ref:input().activity_ref,expected_version:1})));
    assert.equal(replies.filter(value=>value.status==='fulfilled').length,1);
    assert.equal(replies.filter(value=>value.status==='rejected'&&value.reason.code==='consent_version_changed').length,1);
    assert.throws(()=>f.service.current({tenantId:1,scope,channel:'sms',accountRef:'sms_account:1',recipientRef:'native_contact:1',purpose:'transactional',consentRef:saved.value}),{code:'consent_current_record_required'});
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_collaborative_consent_audit').get().n,2);
});

test('signed source evidence cannot outlive current owner authority or consent validity across its await', async t => {
    for(const expireAuthority of [true,false]) {
        const f=fixture(t); f.deadline(START+(expireAuthority?1000:30_000));
        f.source(async selected=>{
            f.setClock(START+2000);
            return {verified:true,source_platform:'catalog',scope:selected.scope,account_ref:selected.accountRef,
                recipient_fingerprint:selected.recipientFingerprint,purpose:selected.purpose,source_record_ref:'synthetic-source-consent',
                source_revision:1,evidence_sha256:'a'.repeat(64),valid_until:new Date(START+3600_000).toISOString()};
        });
        await assert.rejects(f.service.record(principal,input({evidence:{kind:'signed_source',evidence_ref:'synthetic-evidence'},
            valid_until:new Date(START+(expireAuthority?3600_000:1000)).toISOString()})));
        assert.equal(f.count(),0);
    }
});

test('signed evidence scope/recipient mismatches and owner withdrawal during evidence lookup reject without a record', async t => {
    const f=fixture(t);
    f.source(async selected=>({verified:true,source_platform:'catalog',scope:{...scope,activity_id:'foreign'},account_ref:selected.accountRef,
        recipient_fingerprint:selected.recipientFingerprint,purpose:selected.purpose,source_record_ref:'source',source_revision:1,evidence_sha256:'a'.repeat(64),valid_until:new Date(START+300_000).toISOString()}));
    await assert.rejects(f.service.record(principal,input({evidence:{kind:'signed_source',evidence_ref:'synthetic-evidence'}})),{code:'consent_source_evidence_unverified'});
    f.source(async selected=>{f.deny();return {verified:true,source_platform:'catalog',scope,account_ref:selected.accountRef,
        recipient_fingerprint:selected.recipientFingerprint,purpose:selected.purpose,source_record_ref:'source',source_revision:1,evidence_sha256:'a'.repeat(64),valid_until:new Date(START+300_000).toISOString()};});
    await assert.rejects(f.service.record(principal,input({evidence:{kind:'signed_source',evidence_ref:'synthetic-evidence'}})),{code:'consent_authority_unverified'});
    assert.equal(f.count(),0);
});

test('verified signed source evidence is scoped to native selections and bounded by its own validity', async t => {
    const f=fixture(t);
    f.source(async selected=>({verified:true,source_platform:'catalog',scope:selected.scope,account_ref:selected.accountRef,
        recipient_fingerprint:selected.recipientFingerprint,purpose:selected.purpose,source_record_ref:'synthetic-source-consent',
        source_revision:2,evidence_sha256:'a'.repeat(64),valid_until:new Date(START+1200_000).toISOString()}));
    const saved=await f.service.record(principal,input({evidence:{kind:'signed_source',evidence_ref:'synthetic-source-reference'}}));
    assert.equal(saved.evidence_kind,'signed_source'); assert.equal(saved.valid_until,new Date(START+1200_000).toISOString());
    assert.equal(f.service.current({tenantId:1,scope,channel:'sms',accountRef:'sms_account:1',recipientRef:'native_contact:1',purpose:'transactional',consentRef:saved.value}).record.value,saved.value);
});

test('native inbound consent binds the actual WhatsApp number/current conversation and never authorizes marketing', async t => {
    const f=fixture(t); const received=new Date(START-10_000).toISOString();
    f.database.exec(`INSERT INTO tenant_whatsapp_numbers(id,tenant_id,phone_number_id,waba_id,is_default,is_active)
        VALUES(1,1,'synthetic-wa-number-1','synthetic-waba',1,1),(2,1,'synthetic-wa-number-2','synthetic-waba',0,1);`);
    f.database.prepare(`INSERT INTO tenant_whatsapp_contact_windows(tenant_id,phone_number_id,contact_phone,last_customer_message_at)
        VALUES(1,'synthetic-wa-number-1','218910000099',?)`).run(received);
    f.database.prepare(`INSERT INTO messages(tenant_id,direction,sender,recipient,message_type,content,created_at)
        VALUES(1,'incoming','218910000099','synthetic-wa-number-1','text','Synthetic inbound service question',?)`).run(received);
    const native=input({channel:'whatsapp',account_ref:'whatsapp_number:1',purpose:'service_response',evidence:{kind:'native_inbound'},
        valid_until:new Date(START+48*3600_000).toISOString()});
    const saved=await f.service.record(principal,native);
    assert.equal(saved.evidence_kind,'native_inbound'); assert.equal(saved.valid_until,new Date(START-10_000+24*3600_000).toISOString());
    await assert.rejects(f.service.record(principal,{...native,purpose:'marketing',idempotency_key:['synthetic','marketing','denied'].join('-')}),{code:'consent_inbound_purpose_invalid'});
    await assert.rejects(f.service.record(principal,{...native,account_ref:'whatsapp_number:2',idempotency_key:['synthetic','other','number'].join('-')}),{code:'consent_current_inbound_required'});
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM messages WHERE direction='outgoing'").get().n,0);
});
