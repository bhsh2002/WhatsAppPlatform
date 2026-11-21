import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { runMigrationsSync } from '../db/migrator.js';
import { quote } from '../services/billingQuote.js';
import { reserveBillingUsage, commitBillingUsage, releaseBillingUsage } from '../services/billingUsage.js';
import { getBillingSettings } from '../services/billingSettings.js';
import { BILLING_OPERATIONS } from '../services/billingCore.js';
import { SmsGatewayService } from '../services/smsGateway.js';
import { CollaborativeConsentService } from '../services/collaborativeConsents.js';
import { CollaborativeExecutionService } from '../services/collaborativeExecution.js';
import { createCollaborativeNativeAdapters } from '../services/collaborativeNativeAdapters.js';
import { createNativeCollaborativeDependencies } from '../services/nativeCollaborativeDependencies.js';
import { CollaborativeEffectEvidence } from '../services/collaborativeEffectEvidence.js';
import { NativeCommandProtocol, nativeCommandJson } from '../services/nativeCommandProtocol.js';
import { createNativeCommandAdapterRouter } from '../routes/nativeCommandAdapter.js';
import { createOwnerJourneyProviderFault } from '../test-support/ownerJourneyProviderFault.js';
import { createOwnerJourneyReconciliationEvidence } from '../test-support/ownerJourneyCapabilityProofs.js';

// Owned component HTTP evidence only. These are synthetic native/provider rows,
// not the four-application owner journey or business-data acceptance.
const now = Date.parse('2026-11-18T12:00:00Z');
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const prefix = '/api/savana/command-adapter/v1';
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
const principal = { tenantId: 1, userId: 1, sessionId: 'synthetic-session', authVersion: 0, role: 'tenant', sessionExpiresAt: now / 1000 + 3600 };
const delegation = command => Object.fromEntries(['grant_approved_by', 'native_authority_revision', 'capability_grant_revision',
    'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs'].map(key => [key, command[key]]));
const listen = async (t, server) => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
};
const fixture = async (t, { observedRun = 'synthetic-run', responseMutation } = {}) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-reconciliation-evidence-'));
    const databasePath = path.join(directory, 'native.sqlite');
    const database = new Database(databasePath);
    const provider = new Database(':memory:');
    t.after(() => { database.close(); provider.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    runMigrationsSync(database);
    provider.exec('CREATE TABLE accepted(correlation TEXT PRIMARY KEY,provider_id TEXT NOT NULL); CREATE TABLE calls(id INTEGER PRIMARY KEY);');
    const key = crypto.randomBytes(32);
    const encryption = {
        encrypt(raw) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            return Buffer.concat([iv, cipher.update(raw), cipher.final(), cipher.getAuthTag()]).toString('base64'); },
        decrypt(raw) { const bytes = Buffer.from(raw, 'base64'), cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString(); }
    };
    const { encrypt, decrypt } = encryption;
    database.exec(`INSERT INTO tenants(id,name,phone,status,credits) VALUES(1,'Synthetic native','218910000001','Active',1000);
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active) VALUES(1,'synthetic-owner','unused','tenant',1,1);
        INSERT INTO contacts(id,tenant_id,phone,profile_name) VALUES(1,1,'218910000021','Synthetic contact');
        INSERT INTO templates(id,tenant_id,name,body,status,language,header_type) VALUES(1,1,'synthetic_template','Hello {{1}}','approved','ar','none');
        INSERT INTO tenant_whatsapp_numbers(id,tenant_id,phone_number_id,waba_id,is_active,is_default) VALUES(1,1,'synthetic-phone','synthetic-waba',1,1);
        UPDATE billing_price_items SET local_pricing_model='fixed',is_active=1,is_billable=1,unit_price_credits=2;`);
    const billing = { operations: BILLING_OPERATIONS };
    const settings = () => getBillingSettings(database).settings;
    billing.quote = input => quote(database, { summarizeMetaEstimate: () => ({ status: 'not_applicable', amount: 0 }) }, input);
    billing.reserve = input => reserveBillingUsage(database, { quote: billing.quote, getBillingSettings: settings }, input);
    billing.commit = (reservation, input) => commitBillingUsage(database, { getBillingSettings: settings }, reservation, input);
    billing.release = (reservation, input) => releaseBillingUsage(database, reservation, input);
    const consents = new CollaborativeConsentService({ database, now: () => now, verifyLocalPrincipal: () => true,
        verifyOwnerAuthority: async () => ({ verified: true, canManageConsent: true, nativeTenantId: 1, nativeUserId: 1,
            actorId: 'synthetic-owner', scope, validUntil: new Date(now + 30000).toISOString() }) });
    const consent = await consents.record(principal, { activity_ref: 'synthetic-activity-choice', channel: 'whatsapp',
        account_ref: 'whatsapp_number:1', recipient_ref: 'native_contact:1', purpose: 'transactional',
        evidence: { kind: 'owner_recorded', reference: 'synthetic-business-record',
            note: 'Synthetic evidence for the selected contact and transactional purpose.', recorded_at: new Date(now - 1000).toISOString() },
        valid_until: new Date(now + 3600000).toISOString(), idempotency_key: crypto.randomUUID() });
    const appSecret = crypto.randomBytes(32).toString('hex');
    const effectEvidence = new CollaborativeEffectEvidence({ database, encryption, billing, appSecret,
        appId: 'synthetic-app', settleWhatsAppStatus: () => undefined, now: () => now });
    let sentBody;
    const providerOrigin = await listen(t, http.createServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/v25.0/synthetic-phone/messages') { res.writeHead(404); res.end(); return; }
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        sentBody = JSON.parse(Buffer.concat(chunks));
        provider.prepare('INSERT INTO calls DEFAULT VALUES').run();
        provider.prepare('INSERT OR IGNORE INTO accepted VALUES(?,?)').run(sentBody.biz_opaque_callback_data, 'synthetic-wamid-1');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: [{ id: 'synthetic-wamid-1' }] }));
    }));
    const fault = createOwnerJourneyProviderFault({ database, runId: 'synthetic-run', providerOrigin });
    const fetchImpl = fault.wrapFetch(async (input, options) => {
        assert.equal(new URL(input).origin, providerOrigin);
        return fetch(input, options);
    });
    const smsService = new SmsGatewayService({ database, gatewayRequest: () => assert.fail('No SMS dispatch in WhatsApp fixture') });
    const dependencies = createNativeCollaborativeDependencies({ database, encryption, smsService, billing,
        whatsappCredentials: async tenantId => ({ tenant: database.prepare('SELECT id,name,status FROM tenants WHERE id=?').get(tenantId),
            phoneNumberId: 'synthetic-phone', accessToken: 'synthetic-fixture-token' }),
        contentCredentials: () => assert.fail('No content publication in WhatsApp fixture'),
        fetchImpl, metaApiBase: `${providerOrigin}/v25.0`, now: () => now });
    const adapters = createCollaborativeNativeAdapters({ ...dependencies, database, consents, effectEvidence, now: () => now });
    const parameters = { channel: 'whatsapp', account_ref: 'whatsapp_number:1', recipient_ref: 'native_contact:1', consent_ref: consent.value,
        purpose: 'transactional', template_ref: 'native_template:1', template_values: ['Synthetic'], max_cost_credits: 20 };
    const prepared = await adapters['messaging.send:whatsapp'].prepare({ tenantId: 1, scope, parameters, preview: true });
    const command = { spec_version: '1.0', command_id: crypto.randomUUID(), version: 1, fingerprint: 'a'.repeat(64), attempt_id: crypto.randomUUID(),
        capability: 'messaging.send', action: 'messaging.send', scope, actor_id: 'synthetic-owner', provider_ref: 'synthetic-provider',
        provider_installation_id: 'synthetic-installation', external_tenant_id: 'wa_savana:tenant:1', authorization_revision: 'synthetic-grants',
        grant_approved_by: 'synthetic-owner', native_authority_revision: 'synthetic-owner-proof', capability_grant_revision: 2,
        allowed_fields: Object.keys(parameters), resource_policy: 'activity', resource_refs: [], scope_epochs: [], ownership_epoch: null,
        validation_revision: prepared.resourceFingerprint, validation_valid_until: new Date(now + 30000).toISOString(),
        payload: { payload_type: 'native_action', parameters: prepared.parameters } };
    const execution = new CollaborativeExecutionService({ database, nativeAdapters: adapters, now: () => now,
        verifyNativeContext: async ({ command: cmd, action }) => ({ verified: true, localPolicyVerified: true, nativeTenantId: 1,
            ...(action === 'execute' ? { executionContext: { actor_id: cmd.actor_id, scope, provider_ref: cmd.provider_ref, provider_platform: 'wa_savana',
                provider_installation_id: cmd.provider_installation_id, external_tenant_id: cmd.external_tenant_id,
                authorization_revision: cmd.authorization_revision, valid_until: new Date(now + 5000).toISOString(), ...delegation(cmd) } }
                : { viewer: { actorId: 'synthetic-owner', scope, allowedFields: ['result.status', 'result.receipt'], resourcePolicy: 'activity',
                    resourceRefs: [], validUntil: new Date(now + 30000).toISOString() } }) }),
        authorizeEffect: async cmd => ({ command_id: cmd.command_id, version: cmd.version, fingerprint: cmd.fingerprint, attempt_id: cmd.attempt_id,
            authorization_revision: cmd.authorization_revision, valid_until: new Date(now + 5000).toISOString(), ...delegation(cmd) }) });
    const protocol = new NativeCommandProtocol({ database, callbackToken: crypto.randomBytes(32).toString('hex'), now: () => now });
    const evidence = createOwnerJourneyReconciliationEvidence({ database, runId: observedRun, encrypt, decrypt, protocol });
    const app = express();
    app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = Buffer.from(raw); } }));
    app.post('/meta-webhook', (req, res) => {
        try { const result = effectEvidence.ingest({ rawBody: req.rawBody, signature: req.headers['x-hub-signature-256'] });
            res.json({ matched: result.whatsapp.length + result.messenger.length }); }
        catch { res.status(403).end(); }
    });
    app.use(prefix, evidence.middleware, (req, res, next) => {
        // Negative transport assertions only; the canonical provider fault is
        // still the single real provider-accepted/drop-ACK boundary above.
        if (responseMutation && req.path.endsWith('/reconcile')) {
            const send = res.send;
            res.send = function (body) { responseMutation(res); return send.call(this, body); };
        }
        next();
    }, createNativeCommandAdapterRouter({ protocol, service: execution }));
    const nativeOrigin = await listen(t, http.createServer(app));
    const request = async (suffix, body = command, { invalidSignature = false, verifyResponse = true } = {}) => {
        const raw = Buffer.from(nativeCommandJson({ ...body, context: {} }));
        const requestPath = prefix + suffix;
        const timestamp = String(now / 1000), nonce = crypto.randomBytes(16).toString('hex');
        const mac = parts => 'v1=' + crypto.createHmac('sha256', protocol.token).update(parts.join('\n')).digest('hex');
        const signature = mac(['savana-command-request-v1', 'POST', requestPath, timestamp, nonce, sha(raw)]);
        const response = await fetch(nativeOrigin + requestPath, { method: 'POST', headers: { 'Content-Type': 'application/json',
            'X-Savana-Callback-Token': protocol.token, 'X-Savana-Command-Timestamp': timestamp, 'X-Savana-Command-Nonce': nonce,
            'X-Savana-Command-Signature': invalidSignature ? 'v1=' + '0'.repeat(64) : signature }, body: raw });
        const returned = Buffer.from(await response.arrayBuffer());
        if (verifyResponse && !invalidSignature) {
            assert.equal(response.headers.get('X-Savana-Command-Nonce'), nonce);
            assert.equal(response.headers.get('X-Savana-Command-Signature'), mac(['savana-command-response-v1', 'POST', requestPath,
                response.headers.get('X-Savana-Command-Timestamp'), nonce, sha(raw), String(response.status), sha(returned)]));
        }
        return { status: response.status, body: JSON.parse(returned) };
    };
    const webhook = async ({ invalidSignature = false } = {}) => {
        assert.ok(sentBody?.biz_opaque_callback_data);
        const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'synthetic-waba', changes: [{ value: {
            metadata: { phone_number_id: 'synthetic-phone' }, statuses: [{ id: 'synthetic-wamid-1', status: 'sent', recipient_id: sentBody.to,
                biz_opaque_callback_data: sentBody.biz_opaque_callback_data, timestamp: String(now / 1000) }] } }] }] }));
        const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
        const response = await fetch(nativeOrigin + '/meta-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json',
            'X-Hub-Signature-256': invalidSignature ? 'sha256=' + '0'.repeat(64) : signature }, body: raw });
        return { status: response.status, body: response.ok ? await response.json() : null };
    };
    const start = async () => {
        fault.control({ target: 'message_provider', mode: 'commit_then_drop_ack' });
        const result = await request('/commands'); assert.equal(result.status, 200); assert.equal(result.body.outcome, 'unknown');
        assert.deepEqual(fault.snapshot(), { armed: false, applied: 1 });
        return result;
    };
    const reconcile = (body = command, options) => request(`/commands/${encodeURIComponent(command.command_id)}/reconcile`, body, options);
    const counts = () => ({ sends: provider.prepare('SELECT COUNT(*) n FROM calls').get().n,
        accepted: provider.prepare('SELECT COUNT(*) n FROM accepted').get().n,
        effects: database.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n,
        messages: database.prepare("SELECT COUNT(*) n FROM messages WHERE direction='outgoing'").get().n,
        charges: database.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='committed'").get().n });
    return { database, databasePath, encryption, protocol, command, evidence, start, reconcile, webhook, counts };
};

test('signed native unknown-to-applied reconciliation proves this-run provider lookup once across durable reopen without duplicate effects', async t => {
    const f = await fixture(t); await f.start(); assert.equal(f.evidence.count(), 0);
    const identities = f.database.prepare('SELECT id,effect_key,native_kind,native_idempotency_key FROM savana_collaborative_effects').all();
    const fault = f.database.prepare("SELECT * FROM owner_journey_provider_faults WHERE state='applied'").get();
    assert.equal(fault.run_id, 'synthetic-run'); assert.equal(fault.effect_sha256, sha(identities[0].id));
    assert.equal(fault.receipt_sha256, sha(JSON.stringify({ messages: [{ id: 'synthetic-wamid-1' }] })));
    assert.equal((await f.reconcile()).body.outcome, 'unknown'); assert.equal(f.evidence.count(), 0);
    assert.equal((await f.webhook({ invalidSignature: true })).status, 403); assert.equal(f.evidence.count(), 0);
    assert.deepEqual(await f.webhook(), { status: 200, body: { matched: 1 } });
    assert.equal(f.database.prepare('SELECT state FROM savana_collaborative_executions').get().state, 'unknown');
    assert.deepEqual(f.counts(), { sends: 1, accepted: 1, effects: 1, messages: 1, charges: 1 });
    // Native/provider acceptance alone is not a completed reconciliation.
    assert.equal(f.evidence.count(), 0);
    assert.equal((await f.reconcile(f.command, { invalidSignature: true })).status, 403);
    const wrongAttempt = await f.reconcile({ ...f.command, attempt_id: crypto.randomUUID() });
    assert.equal(wrongAttempt.status, 409); assert.equal(f.evidence.count(), 0);
    const result = await f.reconcile(); assert.equal(result.status, 200); assert.equal(result.body.outcome, 'applied');
    assert.equal(f.evidence.count(), 1);
    assert.deepEqual(f.database.prepare('SELECT id,effect_key,native_kind,native_idempotency_key FROM savana_collaborative_effects').all(), identities);
    assert.equal((await f.reconcile()).body.outcome, 'applied'); assert.equal(f.evidence.count(), 1);
    assert.deepEqual(f.counts(), { sends: 1, accepted: 1, effects: 1, messages: 1, charges: 1 });
    const rows = f.database.prepare('SELECT * FROM owner_journey_native_reconciliations').all(); assert.equal(rows.length, 1);
    assert.doesNotMatch(rows[0].encrypted_evidence, new RegExp(f.command.command_id));
    const reopened = new Database(f.databasePath); t.after(() => reopened.close());
    const make = overrides => createOwnerJourneyReconciliationEvidence({ database: reopened, runId: 'synthetic-run',
        ...f.encryption, protocol: f.protocol, ...overrides });
    assert.equal(make().count(), 1); assert.equal(make().count(), 1);
    assert.equal(make({ decrypt: () => { throw new Error('Synthetic unavailable evidence key'); } }).count(), 0);
    assert.throws(() => f.database.prepare('UPDATE savana_collaborative_effects SET native_idempotency_key=? WHERE id=?')
        .run('synthetic-foreign-effect-key', identities[0].id), /collaborative_effect_identity_immutable/);
    assert.throws(() => f.database.prepare('UPDATE savana_collaborative_command_receipts SET attempt_id=? WHERE command_id=?')
        .run(crypto.randomUUID(), f.command.command_id), /collaborative_command_identity_immutable/);
    assert.equal(make().count(), 1);
    f.database.prepare('DELETE FROM savana_collaborative_provider_evidence').run();
    assert.equal(make().count(), 0);
});

test('a foreign-run applied provider fault never proves this-run reconciliation', async t => {
    const f = await fixture(t, { observedRun: 'foreign-run' }); await f.start(); await f.webhook();
    assert.equal((await f.reconcile()).body.outcome, 'applied');
    assert.equal(f.evidence.count(), 0);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM owner_journey_native_reconciliations').get().n, 0);
    assert.deepEqual(f.counts(), { sends: 1, accepted: 1, effects: 1, messages: 1, charges: 1 });
});

test('an applied native transition with an unsigned or non200 response is not observed signed reconciliation evidence', async t => {
    for (const kind of ['unsigned', 'non200']) await t.test(kind, async child => {
        const f = await fixture(child, { responseMutation: res => kind === 'unsigned'
            ? res.removeHeader('X-Savana-Command-Signature') : res.status(202) });
        await f.start(); await f.webhook();
        const response = await f.reconcile(f.command, { verifyResponse: false });
        assert.equal(response.status, kind === 'non200' ? 202 : 200); assert.equal(response.body.outcome, 'applied');
        assert.equal(f.database.prepare('SELECT state FROM savana_collaborative_command_receipts').get().state, 'applied');
        assert.equal(f.evidence.count(), 0);
        assert.deepEqual(f.counts(), { sends: 1, accepted: 1, effects: 1, messages: 1, charges: 1 });
    });
});
