// Private JSONL entry for the center-owned simultaneous acceptance harness.
// Credential-bearing ready data goes to its pipe only, never to report files.
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { startOperationalWaServer } from './operationalWaServer.js';

const prefix = '@@WA_OPERATIONAL@@';
const emit = value => process.stdout.write(`${prefix}${JSON.stringify(value)}\n`);
const lines = createInterface({ input: process.stdin });
const iterator = lines[Symbol.asyncIterator]();
let fixture;
let startup;
let allocated;
let stopping;
let signalRequested = false;
let startupCancelled = false;
const exitAfterFlush = async code => {
    await new Promise(resolve => process.stdout.write('', resolve));
    // The actual auth router owns an SSE token cleanup interval. This dedicated
    // CLI ends only after fixture cleanup, without changing the native router.
    process.exit(code);
};
const stop = async () => {
    if (stopping) return stopping;
    stopping = (async () => {
        lines.close();
        process.stdin.destroy();
        try { await startup; } catch { /* startup's own catch closes its state */ }
        const diagnostics = fixture?.diagnostics();
        const cleanup = fixture ? await fixture.close() : { not_started: true,
            owned_state_removed: !allocated || !fs.existsSync(allocated.ownedDirectory) };
        if (cleanup.owned_state_removed !== true && allocated) throw new Error('Allocated fixture state survived cancellation');
        emit({ event: 'stopped', diagnostics, cleanup });
    })();
    return stopping;
};
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    signalRequested = true;
    stop().then(() => exitAfterFlush(0), () => exitAfterFlush(1));
});
try {
    while (!stopping) {
        const next = await iterator.next();
        if (next.done) break;
        const message = JSON.parse(next.value);
        if (!fixture) {
            if (message.command !== 'start' || !message.config) throw new Error('Use the explicit owned-fixture start protocol');
            startup = startOperationalWaServer(message.config, { afterListen: async allocation => {
                allocated = allocation;
                emit({ event: 'configuration_required', base_url: allocation.baseUrl,
                    callback_uri: allocation.callbackUri, owned_directory: allocation.ownedDirectory });
                const configuration = await iterator.next();
                if (configuration.done) {
                    startupCancelled = true;
                    throw new Error('OIDC fixture configuration was cancelled');
                }
                const continuation = JSON.parse(configuration.value);
                if (continuation.command === 'stop') {
                    startupCancelled = true;
                    throw new Error('OIDC fixture configuration was cancelled');
                }
                if (continuation.command !== 'configure_oidc') throw new Error('Configure only the actual registered OIDC client');
                return continuation.config;
            } });
            fixture = await startup;
            if (signalRequested) break;
            emit({ event: 'ready', base_url: fixture.baseUrl, callback_uri: fixture.callbackUri,
                local_login: fixture.localCredentials, owned_directory: fixture.ownedDirectory,
                grants_seeded: false, delegated_sessions_seeded: false, effects: fixture.effects,
                contract_sha256: fixture.contractHashes,
                owner_intent_header: { name: 'X-Savana-Owner-Intent', value: 'shared-read-setup-v1' } });
        } else if (message.command === 'diagnostics') {
            emit({ event: 'diagnostics', ...fixture.diagnostics() });
        } else if (message.command === 'network') {
            fixture.setNetwork(message.state || {});
            emit({ event: 'network_configured' });
        } else if (message.command === 'pause_http') {
            emit({ event: 'http_paused', ...await fixture.pauseHttp() });
        } else if (message.command === 'resume_http') {
            emit({ event: 'http_resumed', ...await fixture.resumeHttp() });
        } else if (message.command === 'stop') {
            await stop();
            break;
        } else {
            throw new Error('Unknown private WA operational fixture control');
        }
    }
    await stop();
    await exitAfterFlush(0);
} catch (error) {
    if (!signalRequested && !startupCancelled) emit({ event: 'error', exception: error.name });
    try { await stop(); } finally { await exitAfterFlush(signalRequested || startupCancelled ? 0 : 1); }
}
