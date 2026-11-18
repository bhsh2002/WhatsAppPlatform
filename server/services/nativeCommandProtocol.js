import crypto from 'node:crypto';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safeEqual = (left, right) => {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const a = Buffer.from(left); const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
export class NativeCommandProtocolError extends Error {
    constructor(code, status = 403) { super(code); this.name = 'NativeCommandProtocolError'; this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new NativeCommandProtocolError(code, status); };
const canonicalValue = value => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
    }
    fail('native_command_json_invalid', 422);
};
export const nativeCommandJson = value => JSON.stringify(canonicalValue(value));

// Official native-command-adapter/1 signatures bind exact transport bytes and
// method/path, not a parsed/re-serialized owner claim. No provider token is used.
export class NativeCommandProtocol {
    constructor({ database, callbackToken, now = () => Date.now(), signaturePathPrefix = '' }) {
        if (!database || typeof callbackToken !== 'string' || !callbackToken
            || typeof signaturePathPrefix !== 'string' || !/^(?:\/[A-Za-z0-9/_-]+)?$/.test(signaturePathPrefix)
            || signaturePathPrefix.endsWith('/')) throw new TypeError('Native command protocol requires server-owned authentication configuration');
        this.db = database; this.token = callbackToken; this.now = now; this.pathPrefix = signaturePathPrefix;
    }
    authenticate({ method, pathAndQuery, headers, body = Buffer.alloc(0) }) {
        const normalized = Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
        const timestamp = normalized['x-savana-command-timestamp'];
        const nonce = normalized['x-savana-command-nonce'];
        const signature = normalized['x-savana-command-signature'];
        const token = normalized['x-savana-callback-token'];
        if (!safeEqual(token, this.token) || typeof timestamp !== 'string' || !/^[0-9]{10,12}$/.test(timestamp)
            || typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)
            || typeof signature !== 'string' || !/^v1=[a-f0-9]{64}$/.test(signature)
            || typeof method !== 'string' || !/^[A-Z]+$/.test(method.toUpperCase())
            || typeof pathAndQuery !== 'string' || !pathAndQuery.startsWith('/')
            || /[\r\n#]/.test(pathAndQuery) || !Buffer.isBuffer(body) || body.length > 1_048_576) {
            fail('native_command_authentication_required');
        }
        const seconds = Math.floor(this.now() / 1000);
        if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(Number(timestamp) - seconds) > 30) fail('native_command_timestamp_invalid');
        const path = this.pathPrefix + pathAndQuery;
        const requestBodySha256 = sha(body);
        const material = ['savana-command-request-v1', method.toUpperCase(), path, timestamp, nonce, requestBodySha256].join('\n');
        const expected = `v1=${crypto.createHmac('sha256', this.token).update(material).digest('hex')}`;
        if (!safeEqual(signature, expected)) fail('native_command_signature_invalid');
        const consumed = this.db.transaction(() => {
            this.db.prepare('DELETE FROM savana_collaborative_nonces WHERE expires_at < ?').run(seconds);
            return this.db.prepare(`INSERT INTO savana_collaborative_nonces (nonce, request_sha256, consumed_at, expires_at)
                VALUES (?, ?, ?, ?) ON CONFLICT(nonce) DO NOTHING`).run(nonce, requestBodySha256, seconds, Number(timestamp) + 31);
        }).immediate();
        if (!consumed.changes) fail('native_command_nonce_replayed');
        return Object.freeze({ method: method.toUpperCase(), path, timestamp, nonce, requestBodySha256 });
    }
    response(request, status, value) {
        if (!request || !Number.isInteger(status) || status < 100 || status > 599) throw new TypeError('An authenticated native request is required');
        const body = Buffer.from(nativeCommandJson(value), 'utf8');
        if (body.length > 1_048_576) fail('native_command_response_too_large', 500);
        const timestamp = String(Math.floor(this.now() / 1000));
        const material = ['savana-command-response-v1', request.method, request.path, timestamp,
            request.nonce, request.requestBodySha256, String(status), sha(body)].join('\n');
        return { body, timestamp, nonce: request.nonce,
            signature: `v1=${crypto.createHmac('sha256', this.token).update(material).digest('hex')}` };
    }
}
