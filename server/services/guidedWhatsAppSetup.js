import crypto from 'node:crypto';
import { persistVerifiedWhatsAppNumbers } from './verifiedWhatsAppNumbers.js';
import { listTenantWhatsAppNumbers } from './whatsappNumbers.js';

const SCOPES = ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'];
const text = (v, max = 255) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const graphId = v => text(v) && /^[A-Za-z0-9_-]+$/.test(v);
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const binding = p => hash([p.tenantId, p.userId, p.sessionId, p.authVersion, p.role, p.sessionExpiresAt]);
const label = (v, fallback) => typeof v === 'string' && v.trim()
    ? v.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '').trim().slice(0, 200) || fallback : fallback;
const NEXT = { idle: ['authorize', 'ربط حساب WhatsApp'], authorizing: ['await_authorization', 'أكمل تسجيل الدخول إلى Meta'],
    business: ['choose_business', 'اختر المؤسسة'], account: ['choose_account', 'اختر حساب WhatsApp'],
    phone: ['choose_phone', 'اختر الرقم'], connected: ['connected', 'تم ربط الرقم'], expired: ['restart_authorization', 'أعد تسجيل الدخول إلى Meta'] };

export class GuidedWhatsAppSetupError extends Error {
    constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new GuidedWhatsAppSetupError(`whatsapp_setup_${code}`, status); };
const strict = (value, keys, required = keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))
        || required.some(k => !Object.hasOwn(value, k))) fail('request_invalid', 422);
};

// This is a normal server-side Meta user OAuth flow. Wizard state is short-lived
// and encrypted; only the selected, freshly verified native number is persisted.
// Provider setup never grants shared-data authority or sends a business message.
export class GuidedWhatsAppSetupService {
    #flows = new Map();
    constructor({ database, encryption, verifyLocalPrincipal, fetchImpl = globalThis.fetch, now = () => Date.now(), config = {} }) {
        if (!database || typeof encryption?.encrypt !== 'function' || typeof encryption?.decrypt !== 'function'
            || [verifyLocalPrincipal, fetchImpl, now].some(v => typeof v !== 'function')) throw new TypeError('Explicit native storage, cipher and current identity are required');
        this.db = database; this.cipher = encryption; this.verify = verifyLocalPrincipal; this.fetch = fetchImpl; this.now = now;
        this.config = { ...config }; this.configured = [config.appId, config.appSecret, config.redirectUri].every(v => text(v, 8192));
        const version = config.apiVersion || 'v25.0';
        if (!/^v\d+\.\d+$/.test(version)) throw new TypeError('Invalid configured Graph version');
        this.api = new URL(config.apiBase || `https://graph.facebook.com/${version}`);
        this.authorization = new URL(config.authorizationEndpoint || `https://www.facebook.com/${version}/dialog/oauth`);
        const safe = (url, host) => !url.username && !url.password && !url.search && !url.hash
            && ((url.protocol === 'https:' && url.hostname === host && !url.port)
                || (config.allowLoopback === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'));
        if (!safe(this.api, 'graph.facebook.com') || !/^\/v\d+\.\d+\/?$/.test(this.api.pathname)
            || !safe(this.authorization, 'www.facebook.com') || !/^\/v\d+\.\d+\/dialog\/oauth$/.test(this.authorization.pathname)) {
            throw new TypeError('Only configured Meta or explicit owned loopback endpoints are permitted');
        }
        this.api.pathname = this.api.pathname.replace(/\/$/, '');
        if (this.configured) {
            const redirect = new URL(config.redirectUri);
            if (redirect.username || redirect.password || redirect.search || redirect.hash
                || !(redirect.protocol === 'https:' || (config.allowLoopback === true && redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1'))) {
                throw new TypeError('A registered server-owned redirect URI is required');
            }
        }
        if (config.loginConfigId != null && !graphId(config.loginConfigId)) throw new TypeError('Invalid user-token login configuration');
    }
    #slot(p) { return `${p.tenantId}:${p.userId}`; }
    #local(p, flow) {
        if (!Number.isSafeInteger(p?.tenantId) || p.tenantId < 1 || !Number.isSafeInteger(p.userId) || p.userId < 1
            || p.role !== 'tenant' || !text(p.sessionId, 4096) || !Number.isSafeInteger(p.authVersion) || p.authVersion < 0
            || !Number.isSafeInteger(p.sessionExpiresAt) || p.sessionExpiresAt * 1000 <= this.now() || this.verify(p) !== true) fail('context_changed', 403);
        const user = this.db.prepare('SELECT tenant_id,role,is_active,auth_version FROM users WHERE id=?').get(p.userId);
        const tenant = this.db.prepare('SELECT status FROM tenants WHERE id=?').get(p.tenantId);
        if (!user || user.tenant_id !== p.tenantId || user.role !== 'tenant' || user.is_active !== 1
            || user.auth_version !== p.authVersion || !['Active', 'Warning'].includes(tenant?.status)) fail('context_changed', 403);
        if (flow && (flow.binding !== binding(p) || this.#flows.get(this.#slot(p)) !== flow)) fail('context_changed', 403);
        if (flow && flow.expires <= this.now()) fail('expired', 409);
        if (flow?.authorityExpires && flow.authorityExpires <= this.now()) fail('permission_required', 403);
    }
    #seal(p, flow, payload) {
        const raw = JSON.stringify({ purpose: 'guided-whatsapp-v1', binding: binding(p), reference: flow.reference, payload });
        const value = this.cipher.encrypt(raw);
        if (!text(value, 2_000_000) || value.includes(raw) || this.cipher.decrypt(value) !== raw) fail('encryption_unavailable', 503);
        flow.encrypted = value;
    }
    #open(p, flow) {
        this.#local(p, flow);
        try {
            const value = JSON.parse(this.cipher.decrypt(flow.encrypted));
            if (value.purpose === 'guided-whatsapp-v1' && value.binding === binding(p) && value.reference === flow.reference) return value.payload;
        } catch { /* Cipher failures must never become a new default credential. */ }
        fail('encryption_unavailable', 503);
    }
    #flow(p) {
        this.#local(p); const flow = this.#flows.get(this.#slot(p));
        if (!flow) fail('state_invalid', 409);
        this.#local(p, flow); return flow;
    }
    #connection(p) {
        const numbers = listTenantWhatsAppNumbers(this.db, p.tenantId).filter(row => {
            const secret = row.id == null ? this.db.prepare('SELECT access_token_encrypted FROM tenants WHERE id=?').get(p.tenantId)
                : this.db.prepare('SELECT access_token_encrypted FROM tenant_whatsapp_numbers WHERE tenant_id=? AND id=?').get(p.tenantId, row.id);
            try { return text(this.cipher.decrypt(secret?.access_token_encrypted), 8192); } catch { return false; }
        }).map((row, index) => ({ label: label(row.label || row.verified_name || row.display_phone_number, `رقم WhatsApp ${index + 1}`), is_default: !!row.is_default }));
        return { connected: numbers.length > 0, numbers };
    }
    #public(p, flow = null, payload = null) {
        this.#local(p); const connection = this.#connection(p);
        let stage = flow?.stage || (connection.connected ? 'connected' : 'idle');
        if (flow && flow.expires <= this.now()) stage = 'expired';
        let next = this.configured ? NEXT[stage] : ['configure_meta', 'يلزم إعداد تطبيق Meta لدى مشغّل المنصة'];
        if (this.configured && ['business', 'account', 'phone'].includes(stage) && !payload?.choices?.length) {
            next = ['restart_authorization', { business: 'لم نجد مؤسسة متاحة. راجع ملكيتك وصلاحيات تطبيق Meta ثم أعد الدخول.',
                account: 'لا يوجد حساب WhatsApp مملوك متاح لهذه المؤسسة. راجع إعداده لدى Meta.',
                phone: 'لا يوجد رقم متاح لهذا الحساب. أكمل إعداد الرقم لدى Meta ثم أعد الدخول.' }[stage]];
        }
        return { stage, configured: this.configured, expires_at: flow ? new Date(flow.expires).toISOString() : null,
            choices: ['business', 'account', 'phone'].includes(stage) ? (payload?.choices || []).map(row => ({ value: row.value, label: row.label, detail: row.detail })) : [],
            connection, next_action: { code: next[0], label: next[1], href: '/portal/integrations' },
            webhook_status: flow?.webhookStatus || 'not_checked' };
    }
    status(p) {
        this.#local(p); const flow = this.#flows.get(this.#slot(p));
        // A fresh native login cannot reuse another JWT's unfinished Meta token.
        if (!flow || flow.binding !== binding(p)) return this.#public(p);
        return this.#public(p, flow, flow.expires > this.now() ? this.#open(p, flow) : null);
    }
    start(p) {
        this.#local(p); if (!this.configured) fail('configuration_required', 503);
        for (const [key, flow] of this.#flows) if (flow.expires <= this.now()) this.#flows.delete(key);
        if (this.#flows.size >= 1000 && !this.#flows.has(this.#slot(p))) fail('temporarily_unavailable', 503);
        const state = crypto.randomBytes(32).toString('hex');
        const flow = { binding: binding(p), reference: crypto.randomUUID(), stateHash: hash(state), consumed: false, stage: 'authorizing',
            expires: Math.min(this.now() + 600_000, p.sessionExpiresAt * 1000), busy: false, webhookStatus: 'not_checked' };
        this.#flows.set(this.#slot(p), flow); this.#seal(p, flow, {});
        const url = new URL(this.authorization);
        Object.entries({ client_id: this.config.appId, redirect_uri: this.config.redirectUri, state, response_type: 'code',
            scope: [...SCOPES, 'public_profile'].join(','), ...(this.config.loginConfigId ? { config_id: this.config.loginConfigId } : {}) })
            .forEach(([key, value]) => url.searchParams.set(key, value));
        return { ...this.#public(p, flow), authorization_url: url.href, state };
    }
    cancel(p) { this.#local(p); this.#flows.delete(this.#slot(p)); return this.#public(p); }
    async #locked(p, action) {
        const flow = this.#flow(p); if (flow.busy) fail('operation_in_progress', 409);
        flow.busy = true;
        try { return await action(flow, this.#open(p, flow)); }
        finally { flow.busy = false; }
    }
    async #json(p, flow, path, { token, method = 'GET', query = {}, app = false } = {}) {
        this.#local(p, flow); const url = new URL(`${this.api.href}/${path}`);
        Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
        let response;
        try { response = await this.fetch(url.href, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
            headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${app ? `${this.config.appId}|${this.config.appSecret}` : token}` } : {}) } }); }
        catch { this.#local(p, flow); fail('provider_unavailable', 502); }
        this.#local(p, flow);
        if (!response.ok) fail([401, 403].includes(response.status) ? 'permission_required' : 'provider_unavailable', [401, 403].includes(response.status) ? 403 : 502);
        const chunks = []; let size = 0; let data;
        try {
            if (Number(response.headers.get('content-length')) > 1_000_000) fail('provider_invalid', 502);
            for await (const chunk of response.body) { const bytes = Buffer.from(chunk); size += bytes.length;
                if (size > 1_000_000) fail('provider_invalid', 502); chunks.push(bytes); }
            data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch { this.#local(p, flow); fail('provider_invalid', 502); }
        this.#local(p, flow);
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) fail('provider_invalid', 502);
        return data;
    }
    async #authority(p, flow, token, expectedUser = null) {
        const result = await this.#json(p, flow, 'debug_token', { token, app: true, query: { input_token: token } });
        const data = result.data;
        if (data?.is_valid !== true || String(data.app_id) !== this.config.appId || data.type !== 'USER' || !graphId(data.user_id)
            || !Array.isArray(data.scopes) || !SCOPES.every(scope => data.scopes.includes(scope))
            || !Number.isSafeInteger(data.expires_at) || data.expires_at * 1000 <= this.now()
            || (data.data_access_expires_at != null && (!Number.isSafeInteger(data.data_access_expires_at)
                || (data.data_access_expires_at !== 0 && data.data_access_expires_at * 1000 <= this.now())))) fail('permission_required', 403);
        flow.authorityExpires = Math.min(data.expires_at * 1000, data.data_access_expires_at ? data.data_access_expires_at * 1000 : Infinity);
        const user = await this.#json(p, flow, 'me', { token, query: { fields: 'id,name' } });
        if (!graphId(user.id) || String(user.id) !== String(data.user_id) || (expectedUser && String(user.id) !== expectedUser)) fail('provider_identity_changed', 403);
        return String(user.id);
    }
    async #list(p, flow, token, path, fields) {
        const all = []; let after = null; const seen = new Set();
        for (let page = 0; page < 10; page++) {
            const result = await this.#json(p, flow, path, { token, query: { fields, limit: '100', ...(after ? { after } : {}) } });
            if (!Array.isArray(result.data) || result.data.length > 100 || result.data.some(row => !row || !graphId(row.id))
                || result.data.some(row => seen.has(String(row.id)))) fail('provider_invalid', 502);
            for (const row of result.data) { seen.add(String(row.id)); all.push(row); }
            if (!result.paging?.next) return all;
            let next;
            try { next = new URL(result.paging.next); } catch { fail('provider_invalid', 502); }
            const cursor = result.paging.cursors?.after;
            if (next.origin !== this.api.origin || next.pathname !== `${this.api.pathname}/${path}` || next.username || next.password || next.hash
                || !text(cursor, 4096) || cursor === after || next.searchParams.get('after') !== cursor) fail('provider_invalid', 502);
            // Never follow returned URLs, credentials or fields; only copy the bounded cursor.
            after = cursor;
        }
        fail('provider_limit', 502);
    }
    #choices(rows, kind) {
        return rows.map((row, index) => ({ value: crypto.randomBytes(24).toString('hex'), id: String(row.id),
            label: label(kind === 'phone' ? row.verified_name || row.display_phone_number : row.name, `${kind === 'phone' ? 'رقم' : 'حساب'} ${index + 1}`),
            detail: kind === 'phone' ? label(row.display_phone_number, '') : '' }));
    }
    async complete(p, input) {
        strict(input, ['code', 'state']);
        if (!text(input.code, 8192) || !/^[a-f0-9]{64}$/.test(input.state)) fail('request_invalid', 422);
        return this.#locked(p, async flow => {
            if (flow.stage !== 'authorizing' || flow.consumed || flow.stateHash !== hash(input.state)) fail('state_invalid', 409);
            flow.consumed = true; // Claim before the first external await; never replay an OAuth code.
            try {
                const exchanged = await this.#json(p, flow, 'oauth/access_token', { query: { client_id: this.config.appId,
                    client_secret: this.config.appSecret, redirect_uri: this.config.redirectUri, code: input.code } });
                if (!text(exchanged.access_token, 8192)) fail('provider_invalid', 502);
                const firstUser = await this.#authority(p, flow, exchanged.access_token);
                // Meta's documented server-only exchange avoids persisting the
                // default short-lived login token. It creates no refresh grant.
                const extended = await this.#json(p, flow, 'oauth/access_token', { query: { grant_type: 'fb_exchange_token',
                    client_id: this.config.appId, client_secret: this.config.appSecret, fb_exchange_token: exchanged.access_token } });
                if (!text(extended.access_token, 8192)) fail('provider_invalid', 502);
                const token = extended.access_token;
                const user = await this.#authority(p, flow, token, firstUser);
                const businesses = await this.#list(p, flow, token, 'me/businesses', 'id,name');
                const payload = { token, user, choices: this.#choices(businesses, 'business') };
                flow.stage = 'business'; this.#seal(p, flow, payload);
                return this.#public(p, flow, payload);
            } catch (error) {
                // A consumed code has no retry semantics; explicit fresh login is safe.
                if (this.#flows.get(this.#slot(p)) === flow) { flow.stage = 'expired'; flow.expires = this.now(); flow.encrypted = null; }
                throw error;
            }
        });
    }
    async #parents(p, flow, payload) {
        await this.#authority(p, flow, payload.token, payload.user);
        const businesses = await this.#list(p, flow, payload.token, 'me/businesses', 'id,name');
        if (payload.business && !businesses.some(row => String(row.id) === payload.business)) fail('choice_changed', 409);
        if (!payload.business) return;
        const accounts = await this.#list(p, flow, payload.token, `${payload.business}/owned_whatsapp_business_accounts`, 'id,name');
        if (payload.account && !accounts.some(row => String(row.id) === payload.account)) fail('choice_changed', 409);
        return accounts;
    }
    async choose(p, input) {
        strict(input, ['choice']); if (!/^[a-f0-9]{48}$/.test(input.choice)) fail('request_invalid', 422);
        return this.#locked(p, async (flow, payload) => {
            if (!['business', 'account'].includes(flow.stage)) fail('choice_changed', 409);
            const selected = payload.choices.find(row => row.value === input.choice); if (!selected) fail('choice_changed', 409);
            if (flow.stage === 'business') {
                payload.business = selected.id; const accounts = await this.#parents(p, flow, payload);
                payload.choices = this.#choices(accounts, 'account'); flow.stage = 'account';
            } else {
                payload.account = selected.id; await this.#parents(p, flow, payload);
                payload.choices = this.#choices(await this.#list(p, flow, payload.token, `${payload.account}/phone_numbers`,
                    'id,display_phone_number,verified_name,quality_rating,status,name_status'), 'phone'); flow.stage = 'phone';
            }
            this.#seal(p, flow, payload); return this.#public(p, flow, payload);
        });
    }
    async connect(p, input) {
        strict(input, ['choice', 'setDefault'], ['choice']);
        if (!/^[a-f0-9]{48}$/.test(input.choice) || (input.setDefault !== undefined && typeof input.setDefault !== 'boolean')) fail('request_invalid', 422);
        return this.#locked(p, async (flow, payload) => {
            if (flow.stage !== 'phone') fail('choice_changed', 409);
            const choice = payload.choices.find(row => row.value === input.choice); if (!choice) fail('choice_changed', 409);
            await this.#parents(p, flow, payload);
            const phones = await this.#list(p, flow, payload.token, `${payload.account}/phone_numbers`, 'id,display_phone_number,verified_name,quality_rating,status,name_status');
            const phone = phones.find(row => String(row.id) === choice.id); if (!phone) fail('choice_changed', 409);
            // Recheck the owning business/account after the final asynchronous
            // number lookup; an earlier accessible list is not current authority.
            await this.#parents(p, flow, payload);
            this.#local(p, flow);
            const encryptedToken = this.cipher.encrypt(payload.token);
            if (!text(encryptedToken, 100_000) || encryptedToken.includes(payload.token) || this.cipher.decrypt(encryptedToken) !== payload.token) fail('encryption_unavailable', 503);
            try {
                this.db.transaction(() => {
                    persistVerifiedWhatsAppNumbers({ database: this.db, tenantId: p.tenantId, phones: [phone], selectedPhoneId: choice.id,
                        wabaId: payload.account, businessId: payload.business, encryptedToken, makeDefault: input.setDefault === true,
                        verifyCurrent: () => { this.#local(p, flow); return true; } });
                    const tenant = this.db.prepare('SELECT name FROM tenants WHERE id=?').get(p.tenantId);
                    this.db.prepare(`INSERT INTO activity_logs(tenant_id,tenant_name,event_type,description,status)
                        VALUES(?,?,'whatsapp_connected',?,'success')`).run(p.tenantId, tenant.name, 'ربط رقم WhatsApp باختيار موثق من Meta');
                    this.#local(p, flow);
                }).immediate();
            } catch (error) {
                if (error.code === 'WHATSAPP_NUMBER_ALREADY_ASSIGNED') fail('conflict', 409);
                throw error;
            }
            flow.stage = 'connected'; flow.webhookStatus = 'unknown'; this.#seal(p, flow, {});
            try {
                const subscribed = await this.#json(p, flow, `${payload.account}/subscribed_apps`, { token: payload.token, method: 'POST' });
                flow.webhookStatus = subscribed.success === true ? 'confirmed' : 'unknown';
            } catch (error) {
                this.#local(p, flow); // Saving a verified number is independent of an uncertain subscription ACK.
                if (error.code === 'whatsapp_setup_context_changed' || error.code === 'whatsapp_setup_expired') throw error;
            }
            return this.#public(p, flow);
        });
    }
}
