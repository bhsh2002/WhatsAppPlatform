import crypto from 'node:crypto';

const faultName = 'commit_then_drop_ack_once';
const boundary = 'owned_provider_http';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sourceTables = ['savana_collaborative_executions', 'savana_collaborative_effects', 'savana_collaborative_correlations'];

// Owned-fixture fault injection, never a provider simulator or a business
// retry. Only a real correlated collaborative send can consume an installed
// arm, after its actual endpoint-specific provider acceptance response.
export const createOwnerJourneyProviderFault = ({ database, runId, providerOrigin }) => {
    let origin;
    try { origin = new URL(providerOrigin); } catch { fail('owned_fault_provider_invalid'); }
    if (!database?.prepare || !database?.transaction || !/^[A-Za-z0-9_-]{1,200}$/.test(runId || '')
        || origin.origin !== providerOrigin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1'
        || !origin.port || origin.username || origin.password || origin.search || origin.hash) fail('owned_fault_provider_invalid');
    database.exec(`CREATE TABLE IF NOT EXISTS owner_journey_provider_faults(
        arm_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('armed','applied')),
        correlation_sha256 TEXT,effect_sha256 TEXT,receipt_sha256 TEXT,armed_at TEXT NOT NULL,applied_at TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS owner_journey_one_provider_fault_arm
        ON owner_journey_provider_faults(run_id) WHERE state='armed';
        CREATE TABLE IF NOT EXISTS owner_journey_counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
    let installed = false;
    const hasSource = () => sourceTables.every(name => database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const currentArm = () => database.prepare("SELECT * FROM owner_journey_provider_faults WHERE run_id=? AND state='armed'").get(runId);
    const control = input => {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => !['target', 'mode', 'correlation'].includes(key))
            || input.target !== 'message_provider' || input.mode !== 'commit_then_drop_ack'
            || (input.correlation !== undefined && (typeof input.correlation !== 'string'
                || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.correlation)))) fail('unsupported_owned_fault');
        if (!installed || !hasSource()) fail('owned_fault_boundary_unavailable');
        database.transaction(() => {
            if (currentArm()) fail('owned_fault_already_armed');
            database.prepare('INSERT INTO owner_journey_provider_faults(arm_id,run_id,state,correlation_sha256,armed_at) VALUES(?,?,?,?,?)')
                .run(crypto.randomUUID(), runId, 'armed', input.correlation ? hash(input.correlation) : null, new Date().toISOString());
        }).immediate();
        // This acknowledges persisted arming, not an applied drop or a
        // provider commit. The applied counter changes only in consume().
        return { fault: faultName, armed: true, boundary };
    };
    const capture = (input, options) => {
        const arm = currentArm();
        if (!arm || !hasSource()) return null;
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.origin !== providerOrigin || url.username || url.password || (options.method || 'GET').toUpperCase() !== 'POST') return null;
        const sms = url.pathname === '/services/v1/messages.php';
        if (!sms && !/^\/v25\.0\/[^/]+\/messages$/.test(url.pathname)) return null;
        let body;
        try { body = typeof options.body === 'string' ? JSON.parse(options.body) : null; } catch { body = null; }
        const key = new Headers(options.headers || {}).get('idempotency-key');
        const token = body?.biz_opaque_callback_data || body?.message?.metadata;
        const row = key ? database.prepare(`SELECT effect.id,effect.native_kind FROM savana_collaborative_effects effect
            JOIN savana_collaborative_executions execution ON execution.id=effect.execution_id
            WHERE effect.native_idempotency_key=? AND effect.state='dispatching' AND execution.state='executing'
            AND execution.capability_code IN ('messaging.send','campaigns.execute')`).get(key)
            : typeof token === 'string' ? database.prepare(`SELECT effect.id,effect.native_kind FROM savana_collaborative_correlations correlation
                JOIN savana_collaborative_effects effect ON effect.id=correlation.effect_id
                JOIN savana_collaborative_executions execution ON execution.id=effect.execution_id
                WHERE correlation.token_sha256=? AND effect.state='dispatching' AND execution.state='executing'
                AND execution.capability_code IN ('messaging.send','campaigns.execute')`).get(hash(token)) : null;
        const kind = sms ? 'sms_message' : body?.messaging_product === 'whatsapp' ? 'whatsapp_message'
            : body?.recipient && body?.message ? 'messenger_message' : null;
        if (!row || row.native_kind !== kind || (arm.correlation_sha256
            && ![key, token].some(value => typeof value === 'string' && hash(value) === arm.correlation_sha256))) return null;
        return { armId: arm.arm_id, effectId: row.id, kind };
    };
    const consume = (captured, receipt) => database.transaction(() => {
        const changed = database.prepare("UPDATE owner_journey_provider_faults SET state='applied',effect_sha256=?,receipt_sha256=?,applied_at=? WHERE arm_id=? AND run_id=? AND state='armed'")
            .run(hash(captured.effectId), hash(JSON.stringify(receipt)), new Date().toISOString(), captured.armId, runId).changes;
        if (!changed) return false;
        database.prepare("INSERT INTO owner_journey_counters(name,value) VALUES('commit_then_drop_ack',1) ON CONFLICT(name) DO UPDATE SET value=value+1").run();
        return true;
    }).immediate();
    const wrapFetch = delegate => {
        if (installed || typeof delegate !== 'function') fail('owned_fault_boundary_invalid');
        installed = true;
        return async (input, options = {}) => {
            // Snapshot the actual arm/effect before the HTTP request. A late
            // response cannot consume a newly armed generation after an await.
            const captured = capture(input, options);
            const response = await delegate(input, options);
            if (!captured || !response.ok) return response;
            let receipt;
            try { receipt = await response.clone().json(); } catch { return response; }
            const accepted = !receipt?.error && (captured.kind === 'sms_message'
                ? receipt?.success === true && nonempty(receipt.data?.message_id)
                : captured.kind === 'whatsapp_message' ? nonempty(receipt?.messages?.[0]?.id)
                    : nonempty(receipt?.message_id));
            if (!accepted || !consume(captured, receipt)) return response;
            try { await response.body?.cancel(); } catch { /* The acceptance proof and one-shot claim are already durable. */ }
            fail('owned_provider_ack_dropped');
        };
    };
    const snapshot = () => ({ armed: !!currentArm(), applied: database.prepare("SELECT COUNT(*) AS n FROM owner_journey_provider_faults WHERE run_id=? AND state='applied'").get(runId).n });
    return { control, wrapFetch, snapshot };
};
