import crypto from 'node:crypto';
import { NativeCommandProtocolError, nativeCommandJson } from './nativeCommandProtocol.js';
import { validateAdapterCommand, validateEffectAuthorization } from './nativeCommandModels.js';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
    && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const reject = code => { throw new NativeCommandProtocolError(code, 403); };
const readBounded = async response => {
    if (Number(response.headers.get('content-length')) > 1_048_576) reject('native_command_authorization_response_invalid');
    if (!response.body?.getReader) {
        const bytes = Buffer.from(await response.text(), 'utf8');
        if (bytes.length > 1_048_576) reject('native_command_authorization_response_invalid');
        return bytes;
    }
    const reader = response.body.getReader(); const chunks = []; let bytes = 0;
    while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.length;
        if (bytes > 1_048_576) { await reader.cancel(); reject('native_command_authorization_response_invalid'); }
        chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
};

// Native -> Core uses the platform token, never the inbound native callback key.
// URLs are operator-owned. Neither actors nor browsers can select a destination.
export class NativeCommandAuthorizationClient {
    constructor({ centerOrigin, platformToken, fetchImpl = globalThis.fetch, now = () => Date.now(), allowLoopback = false }) {
        const origin = new URL(centerOrigin);
        const privateCore = origin.protocol === 'http:' && origin.hostname === 'savana-connect' && origin.port === '8010';
        const loopback = allowLoopback === true && origin.protocol === 'http:'
            && ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname);
        if (typeof platformToken !== 'string' || !platformToken || typeof fetchImpl !== 'function'
            || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
            || !(origin.protocol === 'https:' || privateCore || loopback)) throw new TypeError('Explicit trusted Core authorization origin and platform credential required');
        this.origin = origin.origin; this.token = platformToken; this.fetch = fetchImpl; this.now = now;
    }
    async authorize(command) {
        validateAdapterCommand(command);
        const path = `/v1/integration/operational/commands/${encodeURIComponent(command.command_id)}/authorize-effect`;
        const body = Buffer.from(nativeCommandJson({ version: command.version, fingerprint: command.fingerprint, attempt_id: command.attempt_id }));
        const timestamp = String(Math.floor(this.now() / 1000)); const nonce = crypto.randomBytes(16).toString('hex');
        const signature = `v1=${crypto.createHmac('sha256', this.token).update(
            ['savana-command-request-v1', 'POST', path, timestamp, nonce, sha(body)].join('\n')).digest('hex')}`;
        let response;
        try {
            response = await this.fetch(this.origin + path, { method: 'POST', redirect: 'error', cache: 'no-store',
                signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json',
                    'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': this.token,
                    'X-Savana-Command-Timestamp': timestamp, 'X-Savana-Command-Nonce': nonce,
                    'X-Savana-Command-Signature': signature }, body });
        } catch { reject('native_command_authorization_unavailable'); }
        let raw;
        try { raw = await readBounded(response); }
        catch { reject('native_command_authorization_response_invalid'); }
        const responseTime = response.headers.get('x-savana-command-timestamp');
        const responseNonce = response.headers.get('x-savana-command-nonce');
        const responseSignature = response.headers.get('x-savana-command-signature');
        if (typeof responseTime !== 'string' || !/^[0-9]{10,12}$/.test(responseTime)
            || Math.abs(Number(responseTime) - Math.floor(this.now() / 1000)) > 30 || responseNonce !== nonce) {
            reject('native_command_authorization_response_invalid');
        }
        const expected = `v1=${crypto.createHmac('sha256', this.token).update(['savana-command-response-v1',
            'POST', path, responseTime, nonce, sha(body), String(response.status), sha(raw)].join('\n')).digest('hex')}`;
        if (!equal(responseSignature, expected)) reject('native_command_authorization_signature_invalid');
        if (!response.ok) reject('native_command_effect_denied');
        let proof;
        try { proof = validateEffectAuthorization(JSON.parse(raw.toString('utf8'))); }
        catch { reject('native_command_authorization_response_invalid'); }
        if (['command_id', 'version', 'fingerprint', 'attempt_id'].some(k => proof[k] !== command[k])
            || proof.authorization_revision !== command.authorization_revision
            || Date.parse(proof.valid_until) <= this.now()
            || Date.parse(proof.valid_until) > Number(responseTime) * 1000 + 6000) reject('native_command_authorization_changed');
        for (const key of ['grant_approved_by', 'native_authority_revision', 'capability_grant_revision',
            'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs']) {
            if (!Object.hasOwn(command, key) || !Object.hasOwn(proof, key)
                || nativeCommandJson(command[key]) !== nativeCommandJson(proof[key])) reject('native_command_authorization_changed');
        }
        for (const key of ['namespace_installation_id', 'namespace_epoch', 'namespace_version','authority_domain','ownership_epoch']) {
            if ((command[key] ?? null) !== (proof[key] ?? null)) reject('native_command_authorization_changed');
        }
        for (const key of ['effect_fields', 'effect_resources', 'creates_resource', 'effect_values']) {
            if (nativeCommandJson(command[key] ?? null) !== nativeCommandJson(proof[key] ?? null)) reject('native_command_authorization_changed');
        }
        return proof;
    }
}
