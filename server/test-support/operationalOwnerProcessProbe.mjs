// Cold-process durability probe. Real service/SQLite/AES; explicit mock portal
// HTTP only. Key material arrives privately over stdin, never argv or env.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { OperationalOwnerPortalService } from '../services/operationalOwnerPortal.js';

const start = Date.parse('2026-11-17T10:00:00Z');
const principal = sessionId => ({ userId: 1, tenantId: 1, sessionId, authVersion: 0,
    role: 'tenant', sessionExpiresAt: start / 1000 + 300 });
const original = principal('synthetic-cold-owner-jti');
const identity = { actorId: 'synthetic-cold-actor', organizationId: 'synthetic-cold-organization',
    generation: 'synthetic-cold-oidc-generation', expiresAt: '2026-11-17T10:04:00Z' };
const credentials = { username: 'synthetic-cold-owner@example.invalid', password: 'synthetic-cold-login-password' };
const cookie = 'savana_control_session=synthetic.cold.owner.cookie';
const intent = { operation: 'scope.create', idempotencyKey: 'synthetic-cold-owner-intent',
    body: { scope: { activity_id: 'synthetic-cold-activity' }, label: 'Synthetic cold scope' } };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const reportAndExit = report => process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(0));

try {
    process.umask(0o077);
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 4096) throw new Error('Private input too large'); }
    const { keyHex } = JSON.parse(input); input = '';
    assert.match(keyHex, /^[0-9a-f]{64}$/);
    assert.equal(process.argv.some(v => v.includes(keyHex)), false);
    assert.equal(Object.values(process.env).some(v => String(v).includes(keyHex)), false);
    const key = Buffer.from(keyHex, 'hex');
    const encryption = {
        encrypt(raw) {
            const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
        },
        decrypt(raw) {
            const body = Buffer.from(raw, 'base64'); const cipher = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
            cipher.setAuthTag(body.subarray(12, 28));
            return Buffer.concat([cipher.update(body.subarray(28)), cipher.final()]).toString('utf8');
        },
    };
    const [filename, mode] = process.argv.slice(2);
    assert.ok(['write-and-exit', 'reopen', 'wrong-key'].includes(mode));
    const database = new Database(filename, { fileMustExist: true });
    database.pragma('foreign_keys = ON');
    const counters = { actual_network_attempts: 0, mock_http_calls: 0, mock_membership_checks: 0, mock_mutation_dispatches: 0 };
    globalThis.fetch = () => { counters.actual_network_attempts++; throw new Error('No actual network in process probe'); };
    const report = { mode, pid: process.pid, runtime: process.execPath, key_source: 'stdin',
        central_transport: 'explicit_mock_http', database_closed_explicitly: false };
    const base = '/api/member/organizations/synthetic-cold-organization/integration';
    const fetchImpl = async (url, options) => {
        assert.equal(new URL(url).origin, 'https://synthetic-portal.invalid');
        const path = new URL(url).pathname;
        counters.mock_http_calls++;
        let payload; let headers = { 'Cache-Control': 'no-store' };
        if (path === '/api/session' && options.method === 'POST') {
            assert.deepEqual(JSON.parse(options.body), credentials);
            payload = { authenticated: true, username: credentials.username, display_name: 'Synthetic cold owner', role: 'organization_member' };
            headers['Set-Cookie'] = `${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120`;
        } else {
            assert.equal(options.headers.Cookie, cookie);
            if (path === '/api/session' && options.method === 'GET') payload = { authenticated: true, username: credentials.username,
                display_name: 'Synthetic cold owner', role: 'organization_member', account_id: identity.actorId };
            else if (path === `${base}/ui-context` && options.method === 'GET') {
                counters.mock_membership_checks++;
                payload = { membership: { account_id: identity.actorId, organization_id: identity.organizationId,
                    status: 'active', role: 'owner', permissions: ['organization:members'] },
                    members: [{ account_id: identity.actorId, display_name: 'Synthetic cold owner', status: 'active' }], integration_operational_enabled: true };
            } else if (path === `${base}/overview` && options.method === 'GET') payload = {
                organization_id: identity.organizationId, scopes: [], scope_authorizations: [], requests: [], installations: [],
                publisher_grants: [], read_grants: [], deliveries: [], enrollments: [], origin_evidence: [],
                approval_policy: 'explicit_current_exact_scope_actions; self_approval_permitted' };
            else if (path === `${base}/scopes` && options.method === 'POST') {
                counters.mock_mutation_dispatches++;
                assert.equal(mode, 'write-and-exit', 'A reopened process must never dispatch an owner mutation');
                assert.equal(options.headers['X-Savana-CSRF'], '1');
                const row = database.prepare('SELECT * FROM savana_owner_portal_intents').get();
                assert.equal(row.state, 'inflight');
                assert.equal(row.encrypted_result, null);
                report.intent_id = row.id;
                report.intent_state = row.state;
                report.committed_before_exit = true;
                report.immutable_intent_sha256 = sha(JSON.stringify(row));
                // Exit from inside the actual service fetch after its atomic
                // claim committed. No response/finish/database.close executes.
                reportAndExit({ ...report, ...counters });
                await new Promise(() => {});
            } else throw new Error('Unexpected mock portal operation');
        }
        return Response.json(payload, { headers });
    };
    const verifyLocalPrincipal = p => {
        const user = database.prepare('SELECT tenant_id,is_active,auth_version FROM users WHERE id=?').get(p.userId);
        return !!user?.is_active && user.tenant_id === p.tenantId && user.auth_version === p.authVersion
            && p.sessionExpiresAt * 1000 > start;
    };
    const service = new OperationalOwnerPortalService({ database, encryption, config: { enabled: true, portalOrigin: 'https://synthetic-portal.invalid' },
        verifyLocalPrincipal, verifyIdentitySession: async () => ({ ...identity }), resolveNativeAccount: async () => null,
        fetchImpl, now: () => start });
    if (mode === 'write-and-exit') {
        assert.equal((await service.login(original, credentials)).session.state, 'connected');
        await service.perform(original, intent);
        throw new Error('The writer must exit during mock fetch');
    }
    const before = database.prepare('SELECT * FROM savana_owner_portal_intents').get();
    assert.equal(before.state, 'inflight');
    if (mode === 'reopen') {
        const status = await service.status(original);
        assert.equal(status.session.state, 'connected');
        assert.equal(status.intents.inflight_count, 1);
        assert.equal(status.intents.mutations_blocked, true);
        const saved = await service.intentByKey(original, intent.idempotencyKey);
        assert.equal(saved.intent.id, before.id); assert.equal(saved.intent.result, null);
        assert.equal((await service.perform(original, intent)).intent.state, 'inflight');
        const newPrincipal = principal('new-synthetic-native-jti-after-process-exit');
        const initial = await service.status(newPrincipal);
        assert.equal(initial.session.state, 'disconnected');
        assert.equal(initial.intents.inflight_count, 1);
        await service.login(newPrincipal, credentials);
        const relogged = await service.status(newPrincipal);
        assert.equal(relogged.session.state, 'connected');
        assert.equal(relogged.intents.inflight_count, 1);
        await assert.rejects(service.perform(newPrincipal, { ...intent, idempotencyKey: 'new-key-must-not-force' }),
            { code: 'owner_portal_unresolved_intent' });
        const metadata = await service.intentByKey(newPrincipal, intent.idempotencyKey);
        assert.equal(metadata.intent.id, before.id); assert.equal(metadata.intent.result, null);
        assert.ok(counters.mock_membership_checks >= 4);
        report.saved_cookie_restored = true;
        report.fresh_mock_membership_verified = true;
        report.new_native_jti_and_portal_login_preserve_hold = true;
    } else {
        const status = await service.status(original);
        assert.equal(status.session.state, 'unknown');
        assert.equal(status.actions.overview, false);
        await assert.rejects(service.overview(original), { code: 'owner_portal_credentials_unavailable' });
        await assert.rejects(service.perform(original, intent), { code: 'owner_portal_credentials_unavailable' });
        assert.equal(counters.mock_http_calls, 0);
        report.wrong_key_state = status.session.state;
        report.no_connected_fallback = true;
    }
    assert.deepEqual(database.prepare('SELECT * FROM savana_owner_portal_intents').get(), before);
    assert.equal(counters.mock_mutation_dispatches, 0);
    report.intent_id = before.id;
    report.intent_state = before.state;
    report.immutable_intent_sha256 = sha(JSON.stringify(before));
    report.reclaimed = false;
    reportAndExit({ ...report, ...counters });
} catch {
    // Assertion details could contain plaintext cookie/credentials; redact them.
    process.stderr.write('Synthetic owner process durability probe failed\n');
    process.exit(2);
}
