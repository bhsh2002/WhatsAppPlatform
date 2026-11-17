// Isolated image-validation controller/probes. Never load a runtime env file.
// Synthetic credentials are generated only in container memory, never argv.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire('/app/package.json');
const Database = require('better-sqlite3');
const filename = '/app/data/platform.db';
const commandFile = '/tmp/wa-candidate-command.json';
const stateFile = '/tmp/wa-candidate-state.json';
const marker = 0x57414344;
const effectTables = ['messages', 'savana_service_requests', 'savana_integration_outbox', 'billing_usage_events',
    'billing_ledger', 'billing_payments', 'savana_product_projection', 'facebook_content_campaigns', 'facebook_content_publications', 'webhook_logs'];
const summary = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const state = value => fs.writeFileSync(stateFile, JSON.stringify(value), { mode: 0o600 });

if (process.argv[2] === 'control') {
    const random = () => crypto.randomBytes(40).toString('base64url');
    const origin = 'https://wa-candidate.invalid';
    const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'Africa/Tripoli', NODE_ENV: 'production',
        NPM_CONFIG_CACHE: '/tmp/wa-npm-cache', PORT: '3031', DATABASE_PATH: filename, BACKUP_DIR: '/app/data/backups',
        JWT_SECRET: random(), CRYPTO_KEY: crypto.randomBytes(32).toString('hex'), METRICS_TOKEN: random(),
        WEBHOOK_VERIFY_TOKEN: random(), META_APP_SECRET: random(), SMS_GATEWAY_PROVISIONING_SECRET: random(),
        BOOTSTRAP_ADMIN_USERNAME: 'synthetic-linux-candidate', BOOTSTRAP_ADMIN_PASSWORD: random(),
        META_APP_ID: '12345678901', WA_EMBEDDED_SIGNUP_CONFIG_ID: '12345678902', PUBLIC_APP_URL: origin,
        CORS_ORIGINS: origin, META_WEBHOOK_CALLBACK_URL: `${origin}/api/webhook`,
        FACEBOOK_REDIRECT_URI: `${origin}/auth/facebook/callback`, SMS_GATEWAY_CALLBACK_BASE_URL: `${origin}/api/integrations/sms-gateway/events`,
        SAVANA_INTEGRATIONS_ENABLED: 'false', WEB_PUSH_ENABLED: 'false', SAVANA_SHARED_PRODUCT_READS_ENABLED: 'false',
        SAVANA_SHARED_READ_SETUP_ENABLED: 'false', SAVANA_SHARED_READ_OWNER_PORTAL_ENABLED: 'false',
        WA_BROWSER_RELEASE: process.env.WA_CANDIDATE_RELEASE_ID };
    let child; let output = ''; let handled = '';
    const redact = raw => Object.entries(env).filter(([key]) => /SECRET|TOKEN|PASSWORD|CRYPTO_KEY/.test(key))
        .reduce((value, [, secret]) => value.split(secret).join('[redacted]'), raw);
    const stop = async () => {
        if (!child || child.exitCode !== null) return;
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
        for (let n = 0; n < 60 && child.exitCode === null; n++) await delay(200);
        if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
        for (let n = 0; n < 50; n++) {
            try { await fetch('http://127.0.0.1:3031/health', { signal: AbortSignal.timeout(100) }); await delay(100); }
            catch { break; }
        }
    };
    const start = async phase => {
        await stop();
        if (phase === 'nonidle') {
            const db = new Database(filename, { fileMustExist: true });
            try {
                db.pragma('foreign_keys = ON');
                db.transaction(() => {
                    db.prepare("INSERT INTO tenants(id,name,phone,status) VALUES(900,'Synthetic Linux guard','synthetic-linux-900','Active')").run();
                    db.prepare("INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version) VALUES(900,'synthetic-linux-guard','unused','tenant',900,1,0)").run();
                    db.prepare(`INSERT INTO savana_operational_read_actions
                        (id,tenant_id,user_id,session_hash,auth_version,operation,idempotency_key,payload_hash,encrypted_request,state,created_at,updated_at)
                        VALUES('synthetic-linux-unknown',900,900,'synthetic-hash',0,'synthetic-no-dispatch','synthetic-linux-key',?,?,'unknown',?,?)`)
                        .run('0'.repeat(64), 'synthetic-retained-inert-ciphertext', new Date().toISOString(), new Date().toISOString());
                }).immediate();
                db.pragma('wal_checkpoint(TRUNCATE)');
            } finally { db.close(); }
        }
        output = '';
        const applicationEnv = { ...env, SAVANA_EGRESS_MAINTENANCE: phase === 'initial' ? 'true' : 'false',
            SAVANA_EGRESS_REQUIRE_IDLE: 'true', DISABLE_BACKGROUND_JOBS: phase === 'initial' ? 'false' : 'true' };
        child = spawn('npm', ['start'], { cwd: '/app', env: applicationEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        state({ phase, state: 'starting', actual_command: 'npm start' });
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-16000); });
        child.on('exit', code => state({ phase, state: 'exited', exit_code: code,
            diagnostic: redact(output).slice(-4000) }));
    };
    await start('initial');
    process.on('SIGTERM', () => { stop().finally(() => process.exit(0)); });
    for (;;) {
        if (fs.existsSync(commandFile)) {
            const raw = fs.readFileSync(commandFile, 'utf8');
            if (raw !== handled) {
                handled = raw; const request = JSON.parse(raw);
                assert.ok(['idle', 'nonidle'].includes(request.phase)); await start(request.phase);
            }
        }
        await delay(200);
    }
} else if (process.argv[2] === 'migrations') {
    assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
    assert.equal(Number(process.versions.node.split('.')[0]), 20);
    const { runMigrationsSync, getMigrationStatusSync } = await import('/app/db/migrator.js');
    const db = new Database('/tmp/wa-linux-migration.db');
    let result;
    try {
        runMigrationsSync(db); const first = getMigrationStatusSync(db); const rerun = runMigrationsSync(db);
        assert.equal(first.pending, 0); assert.equal(rerun.applied, 0);
        assert.equal(db.pragma('quick_check', { simple: true }), 'ok'); assert.deepEqual(db.pragma('foreign_key_check'), []);
        const rows = db.prepare("SELECT name,checksum FROM _migrations WHERE name GLOB '05[5-9]_*' OR name GLOB '060_*' ORDER BY name").all();
        assert.equal(rows.length, 6);
        for (const row of rows) assert.equal(row.checksum, crypto.createHash('sha256').update(fs.readFileSync(`/app/db/migrations/${row.name}`)).digest('hex'));
        const binary = require.resolve('better-sqlite3/build/Release/better_sqlite3.node');
        result = { platform: process.platform, architecture: process.arch, node: process.version, module_abi: process.versions.modules,
            sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
            native_binary_sha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
            migrations: first, reviewed_migrations: rows, rerun_skipped: true, quick_check: 'ok', foreign_key_errors: 0 };
    } finally { db.close(); }
    summary(result);
} else {
    const phase = process.argv[2];
    assert.ok(['probe-initial', 'probe-idle', 'probe-blocked'].includes(phase));
    const health = async () => {
        const expectedPhase = phase === 'probe-initial' ? 'initial' : 'idle';
        for (let n = 0; n < 200; n++) {
            const current = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
            if (current?.phase !== expectedPhase) { await delay(200); continue; }
            if (current.state === 'exited') throw new Error(`Synthetic npm start exited: ${current.exit_code}`);
            try {
                const response = await fetch('http://127.0.0.1:3031/health', { signal: AbortSignal.timeout(1000) });
                if (response.ok) return response.json();
            } catch {}
            await delay(200);
        }
        throw new Error('Synthetic health deadline exceeded');
    };
    if (phase === 'probe-blocked') {
        let stopped;
        for (let n = 0; n < 200; n++) {
            const current = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            if (current.phase === 'nonidle' && current.state === 'exited') { stopped = current; break; }
            await delay(200);
        }
        assert.ok(stopped && stopped.exit_code !== 0);
        await assert.rejects(fetch('http://127.0.0.1:3031/health', { signal: AbortSignal.timeout(1000) }));
        const db = new Database(filename, { readonly: true, fileMustExist: true });
        try {
            assert.equal(db.pragma('application_id', { simple: true }), marker);
            assert.equal(db.prepare("SELECT state FROM savana_operational_read_actions WHERE id='synthetic-linux-unknown'").get().state, 'unknown');
        } finally { db.close(); }
        summary({ actual_command: 'npm start', nonidle_resume_rejected_before_listener: true, unknown_history_preserved: true,
            same_synthetic_database: true, real_sends: 0 });
    } else {
        const ready = await health();
        assert.equal(ready.maintenance.enforced, true);
        assert.equal(ready.maintenance.resume_check.required, true);
        const db = new Database(filename, { fileMustExist: true });
        const counts = () => Object.fromEntries(effectTables.map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
        try {
            if (phase === 'probe-initial') {
                assert.equal(ready.maintenance.active, true); assert.equal(ready.maintenance.requested, true);
                assert.equal((await fetch('http://127.0.0.1:3031/health', { method: 'HEAD' })).status, 200);
                db.pragma(`application_id = ${marker}`);
                const before = counts();
                const routes = [['GET', '/auth/session'], ['POST', '/auth/login'], ['POST', '/v1/messages/send'],
                    ['GET', '/portal/integrations/shared-products'], ['GET', '/webhook?hub.mode=subscribe&hub.verify_token=synthetic&hub.challenge=1'],
                    ['POST', '/webhook'], ['POST', '/integrations/connect/events']];
                for (const [method, path] of routes) {
                    const response = await fetch(`http://127.0.0.1:3031${path}`, { method, headers: { 'Content-Type': 'application/json' },
                        ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(1000) });
                    assert.equal(response.status, 503); const body = await response.json();
                    assert.equal(body.accepted, false); assert.equal(body.error.code, 'WA_EGRESS_MAINTENANCE');
                }
                assert.deepEqual(counts(), before); assert.ok(Object.values(before).every(value => value === 0));
                summary({ maintenance: ready.maintenance, actual_command: 'npm start', DISABLE_BACKGROUND_JOBS: false,
                    native_auth_api_webhook_routes_refused: routes.length, counters_before: before, counters_after: counts(),
                    new_webhooks_ingested: false, real_sends: 0 });
            } else {
                assert.equal(db.pragma('application_id', { simple: true }), marker);
                assert.equal(ready.maintenance.active, false); assert.equal(ready.maintenance.requested, false);
                assert.equal(ready.maintenance.resume_check.passed, true);
                const response = await fetch('http://127.0.0.1:3031/auth/session', { signal: AbortSignal.timeout(1000) });
                assert.equal(response.status, 200); assert.ok(Object.values(counts()).every(value => value === 0));
                const oldBrowser = await fetch('http://127.0.0.1:3031/auth/login', { method: 'POST',
                    headers: { Origin: 'https://wa-candidate.invalid', 'Content-Type': 'application/json' }, body: '{}' });
                assert.equal(oldBrowser.status, 409);
                const currentBrowser = await fetch('http://127.0.0.1:3031/auth/login', { method: 'POST',
                    headers: { Origin: 'https://wa-candidate.invalid', 'Content-Type': 'application/json',
                        'X-WA-Client-Release': process.env.WA_CANDIDATE_RELEASE_ID }, body: '{}' });
                assert.equal(currentBrowser.status, 400);
                summary({ maintenance: ready.maintenance, actual_command: 'npm start', same_synthetic_database: true,
                    idle_resume_allowed: true, old_browser_relogin_refused: true, matching_public_release_reaches_auth_validation: true,
                    counters: counts(), real_sends: 0 });
            }
        } finally { db.close(); }
    }
}
