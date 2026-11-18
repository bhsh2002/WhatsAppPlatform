// Dedicated private process. Only node:* modules load before the explicit owned
// environment is installed. Never import server.js or dotenv in this harness.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const applicationPath = path.join(root, 'server/test-support/ownerJourneyApplication.js');
const offsets = { connect: 0, subscriptions: 1, portal: 2, catalog: 3, sawemly: 4,
    wa_savana: 5, wa_frontend: 6, message_provider: 7, payment_provider: 8, controller: 9 };
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const object = (value, required, optional = []) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('invalid_request');
    return value;
};

export const ownerJourneyJsonParserOptions = () => ({ limit: '1mb',
    verify: (req, _res, bytes) => { req.rawBody = Buffer.from(bytes); } });

// Set before application imports: actual webhook modules snapshot these values.
// Both the application and runtime derive only this run's private owned keys.
export const ownerJourneyProviderEnvironment = config => ({
    META_APP_SECRET: crypto.createHmac('sha256', config.credentials.callback_token).update(`owned-meta:${config.run_id}`).digest('hex'),
    META_APP_ID: 'owned-native-meta-app',
    WEBHOOK_VERIFY_TOKEN: crypto.createHmac('sha256', config.credentials.callback_token).update(`owned-webhook:${config.run_id}`).digest('hex'),
    SMS_GATEWAY_CALLBACK_BASE_URL: `${config.urls.wa_savana}/api/integrations/sms-gateway/events`,
    SMS_GATEWAY_ALLOW_TENANT_MANUAL_CONFIG: 'true',
});

export const ownerJourneyObservations = (source, observed, nativeAuth) => {
    // Persisted application observations are authoritative when available;
    // in-process copies must not double count them. Auth exists only in the
    // automatic runtime stream. Preserve repeated real calls, even identical
    // tuples/timestamps. The existing recorders bound each source stream.
    const ownServer = row => row?.service === 'wa_savana' || row?.service === 'wa_frontend';
    return (source === undefined ? [...observed] : [...source, ...nativeAuth]).filter(ownServer);
};

export const ownerJourneyDiagnosticEnvelope = ({ source, config, traces = [], nativeAuthTraces = [] }) => {
    object(source, ['facts'], ['observations', 'capability_proofs', 'catalog_result_reads']);
    object(source.facts, Object.keys(source.facts));
    if (Object.values(source.facts).some(value => !Number.isSafeInteger(value) || value < 0)
        || (source.catalog_result_reads !== undefined
            && (!Array.isArray(source.catalog_result_reads) || source.catalog_result_reads.length > 512))) fail('diagnostic_invalid');
    return { run_id: config.run_id, platform: 'wa_savana', source_revision: config.source_revision, source_sha256: config.source_sha256,
        owned_state: true, facts: { ...source.facts, actual_process_restarts: config.process_generation - 1 },
        observations: ownerJourneyObservations(source.observations, traces, nativeAuthTraces),
        ...(source.capability_proofs ? { capability_proofs: source.capability_proofs } : {}),
        ...(source.catalog_result_reads === undefined ? {} : { catalog_result_reads: source.catalog_result_reads }) };
};

export function privateOwnerBrowserContext(owner, provider, routeTemplates = []) {
    const output = { ordinary_owner: { username: owner.username, password: owner.password } };
    if (!Array.isArray(routeTemplates) || routeTemplates.length > 2000) fail('private_route_templates_invalid');
    const templates = new Map();
    for (const row of routeTemplates) {
        object(row, ['browser_service', 'method', 'public_path_template', 'trace_service', 'path_template']);
        if (!['wa_frontend', 'wa_savana'].includes(row.browser_service) || row.trace_service !== 'wa_savana'
            || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(row.method)
            || ![row.public_path_template, row.path_template].every(path => typeof path === 'string'
                && path.startsWith('/api/') && path.length <= 512 && /^\/[A-Za-z0-9_:/{}.-]+$/.test(path))) fail('private_route_templates_invalid');
        templates.set(JSON.stringify(row), { ...row });
    }
    if (templates.size) output.http_route_templates = [...templates.values()];
    if (provider === undefined) return output;
    const seen = new Set();
    const inspect = (value, depth = 0) => {
        if (depth > 8) fail('private_provider_context_invalid');
        if (value === null || typeof value === 'string' || typeof value === 'boolean'
            || typeof value === 'number' && Number.isFinite(value)) return;
        if (!value || typeof value !== 'object' || seen.has(value)
            || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) fail('private_provider_context_invalid');
        seen.add(value);
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            if (descriptor.get || descriptor.set || /(?:grant|consent|binding|contact|recipient|permission|authority|approved)/i.test(key)) fail('private_provider_context_invalid');
            inspect(descriptor.value, depth + 1);
        }
        seen.delete(value);
    };
    object(provider, Object.keys(provider)); inspect(provider);
    const bytes = JSON.stringify(provider);
    if (Buffer.byteLength(bytes) > 65536) fail('private_provider_context_invalid');
    output.native_provider = JSON.parse(bytes);
    return output;
}

export function validateRuntimeConfig(config) {
    object(config, ['run_id', 'state_root', 'port_base', 'urls', 'credentials', 'peers', 'identity',
        'source_revision', 'source_sha256', 'process_generation'], ['private_native']);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(config.run_id) || !/^[a-f0-9]{40}$/.test(config.source_revision)
        || !/^[a-f0-9]{64}$/.test(config.source_sha256) || !Number.isSafeInteger(config.port_base)
        || config.port_base < 1024 || config.port_base > 65525 || !Number.isSafeInteger(config.process_generation)
        || config.process_generation < 1) fail('invalid_request');
    object(config.urls, [...Object.keys(offsets), 'catalog_domain_proxy']);
    for (const [key, offset] of Object.entries(offsets)) {
        if (config.urls[key] !== `http://127.0.0.1:${config.port_base + offset}`) fail('loopback_urls_required');
    }
    if (config.urls.catalog_domain_proxy !== `https://127.0.0.1:${config.port_base + 10}`) fail('loopback_urls_required');
    if (config.private_native) {
        object(config.private_native, ['jwt_secret', 'crypto_key', 'username', 'password']);
        if (!/^[a-f0-9]{96}$/.test(config.private_native.jwt_secret) || !/^[a-f0-9]{64}$/.test(config.private_native.crypto_key)
            || !/^owner_[a-f0-9]{16}$/.test(config.private_native.username)
            || typeof config.private_native.password !== 'string' || config.private_native.password.length < 24) fail('invalid_request');
    }
    if (!path.isAbsolute(config.state_root) || fs.realpathSync(config.state_root) !== config.state_root
        || !fs.statSync(config.state_root).isDirectory()
        || config.state_root === root || config.state_root.startsWith(`${root}/`)) fail('owned_state_required');
    object(config.credentials, ['platform_token', 'callback_token', 'subscriptions_platform_token', 'subscription_signing']);
    if (Object.values(config.credentials).some(value => typeof value !== 'string' || value.length < 32 || value.length > 4096)) fail('invalid_request');
    if (!config.peers || typeof config.peers !== 'object' || Array.isArray(config.peers)) fail('invalid_request');
    object(config.identity, ['client_id', 'redirect_uri', 'issuer', 'discovery_url', 'subscriptions_url', 'portal_url',
        'ingress_service', 'ingress_url', 'api_base_url', 'authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri']);
    const expectedIdentity = { redirect_uri: config.urls.wa_frontend + '/api/portal/integrations/shared-read-setup/callback',
        issuer: config.urls.portal, discovery_url: config.urls.portal + '/.well-known/openid-configuration',
        subscriptions_url: config.urls.subscriptions, portal_url: config.urls.portal, ingress_service: 'portal',
        ingress_url: config.urls.portal, api_base_url: config.urls.portal, authorization_endpoint: config.urls.portal + '/oauth/authorize',
        token_endpoint: config.urls.portal + '/v1/oidc/token', userinfo_endpoint: config.urls.portal + '/v1/oidc/userinfo',
        jwks_uri: config.urls.portal + '/.well-known/jwks.json' };
    if (Object.entries(expectedIdentity).some(([key, expected]) => config.identity[key] !== expected)) fail('identity_registration_mismatch');
    return config;
}

// Guard actual application sockets, not just fetch. Native provider defaults
// cannot escape to a public host. No business data or host network is mounted.
export function installLoopbackGuard(urls) {
    // The Catalog TLS proxy is peer metadata only. It grants WA no socket/TLS access.
    const ports = new Set(Object.entries(urls).filter(([key, value]) => key !== 'catalog_domain_proxy' && new URL(value).protocol === 'http:')
        .map(([, value]) => Number(new URL(value).port)));
    const allow = (host, port) => {
        if (host !== '127.0.0.1' || !ports.has(Number(port))) fail('external_network_forbidden');
    };
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
        const list = Array.isArray(args[0]) ? args[0] : args;
        const first = list[0];
        if (first && typeof first === 'object') {
            if (first.path) fail('external_network_forbidden');
            allow(first.host || 'localhost', first.port);
        } else if (typeof first === 'number' || /^\d+$/.test(String(first))) {
            allow(typeof list[1] === 'string' ? list[1] : 'localhost', first);
        } else fail('external_network_forbidden');
        return Reflect.apply(originalConnect, this, args);
    };
    tls.connect = () => fail('external_network_forbidden');
    dgram.createSocket = () => fail('external_network_forbidden');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options = {}) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.protocol !== 'http:' || url.username || url.password) fail('external_network_forbidden');
        allow(url.hostname, url.port);
        // Every redirect must be rejected; a declared provider cannot redirect
        // credentials to another host, scheme, or non-declared loopback port.
        return originalFetch(input, { ...options, redirect: 'error' });
    };
    syncBuiltinESMExports();
}

export async function startOwnerJourneyRuntime(input) {
    if (process.version !== 'v22.23.5') fail('node_version_required');
    const config = validateRuntimeConfig(input);
    if (!fs.existsSync(applicationPath)) fail('application_factory_unavailable');
    const privateNative = config.private_native || { jwt_secret: crypto.randomBytes(48).toString('hex'),
        crypto_key: crypto.randomBytes(32).toString('hex'), username: 'owner_' + crypto.randomBytes(8).toString('hex'),
        password: crypto.randomBytes(24).toString('base64url') };
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, { PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'test',
        DATABASE_PATH: path.join(config.state_root, 'platform.db'), JWT_SECRET: privateNative.jwt_secret,
        CRYPTO_KEY: privateNative.crypto_key, DISABLE_BACKGROUND_JOBS: 'true',
        SAVANA_EGRESS_MAINTENANCE: 'false', SAVANA_EGRESS_REQUIRE_IDLE: 'false',
        ...ownerJourneyProviderEnvironment(config) });
    installLoopbackGuard(config.urls);
    const require = createRequire(path.join(root, 'server/package.json'));
    const express = require('express');
    const bcrypt = require('bcryptjs');
    let database, server, vite, services;
    const close = async () => {
        // A failed service close must not skip either listener or SQLite.
        const results = await Promise.allSettled([
            Promise.resolve().then(() => services?.close?.()),
            Promise.resolve().then(() => vite?.close()),
            Promise.resolve().then(async () => {
                if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
            }),
        ]);
        if (database?.open) database.close();
        if (results.some(result => result.status === 'rejected')) fail('runtime_cleanup_failed');
    };
    try {
        const [{ default: db }, { default: authRouter }, { initEncryption }, { createOwnerJourneyApplication }, { ownerJourneyRouteTemplates }] = await Promise.all([
            import('../db/database.js'), import('../routes/auth.js'), import('../services/encryption.js'), import(pathToFileURL(applicationPath).href), import('./ownerJourneyRouteTemplates.js'),
        ]);
        database = db;
        if (database.name !== process.env.DATABASE_PATH || typeof createOwnerJourneyApplication !== 'function') fail('application_factory_unavailable');
        initEncryption();
        const existing = database.prepare('SELECT id,tenant_id,role FROM users WHERE username=?').get(privateNative.username);
        let owner;
        if (existing) {
            if (existing.role !== 'tenant' || !existing.tenant_id) fail('owned_identity_invalid');
            owner = { userId: existing.id, tenantId: existing.tenant_id };
        } else {
            if (config.process_generation !== 1 || database.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) fail('owned_identity_invalid');
            const passwordHash = await bcrypt.hash(privateNative.password, 10);
            owner = database.transaction(() => {
                const tenant = database.prepare("INSERT INTO tenants(name,status) VALUES(?, 'Active')").run(`Synthetic ordinary WA owner ${config.run_id}`);
                const user = database.prepare("INSERT INTO users(username,password_hash,name,role,tenant_id,is_active,auth_version) VALUES(?,?,?,'tenant',?,1,0)")
                    .run(privateNative.username, passwordHash, 'Ordinary synthetic owner', tenant.lastInsertRowid);
                return { userId: Number(user.lastInsertRowid), tenantId: Number(tenant.lastInsertRowid) };
            })();
        }
        const traces = [], nativeAuthTraces = [];
        const app = express();
        app.disable('x-powered-by');
        app.use(express.json(ownerJourneyJsonParserOptions()));
        const observe = (value, nativeAuth = false) => {
            object(value, ['method', 'path_template', 'status'], ['service']);
            if (!/^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(value.method)
                || typeof value.path_template !== 'string' || value.path_template.length > 200
                || !/^\/[A-Za-z0-9_:/{}.-]*$/.test(value.path_template)
                || value.path_template.includes('?') || !Number.isInteger(value.status) || value.status < 100 || value.status > 599) fail('observation_invalid');
            if (value.service && !Object.hasOwn(offsets, value.service)) fail('observation_invalid');
            if (traces.length < 10000) {
                const trace = { service: value.service || 'wa_savana', ...value, observed_at: new Date().toISOString() };
                traces.push(trace);
                if (nativeAuth) nativeAuthTraces.push(trace);
            }
        };
        app.use((req, res, next) => {
            res.set('Cache-Control', 'no-store');
            res.once('finish', () => {
                // Express's route declaration is authoritative. Never fallback
                // to originalUrl, which could contain opaque IDs or credentials.
                if (req.ownerJourneyTracePrefix === '/api/auth' && typeof req.route?.path === 'string') {
                    const template = `${req.ownerJourneyTracePrefix}${req.route.path}`;
                    if (!/[a-f0-9]{32,}/i.test(template)) {
                        try { observe({ method: req.method, path_template: template, status: res.statusCode }, true); } catch { /* omit unsafe trace */ }
                    }
                }
            });
            next();
        });
        app.use('/api/auth', (req, res, next) => { req.ownerJourneyTracePrefix = '/api/auth'; next(); }, authRouter);
        services = await createOwnerJourneyApplication({ app, database, stateRoot: config.state_root, runId: config.run_id,
            urls: Object.freeze({ ...config.urls }), serviceCredentials: config.credentials,
            nativeOwner: Object.freeze(owner), observe, oidc: config.identity, peers: config.peers });
        if (!services || ['diagnostics', 'checkpoint', 'fault', 'close'].some(name => typeof services[name] !== 'function')) fail('application_factory_unavailable');
        server = await new Promise((resolve, reject) => {
            const listener = app.listen(config.port_base + 5, '127.0.0.1', () => resolve(listener));
            listener.once('error', reject);
        });
        const clientRequire = createRequire(path.join(root, 'client/package.json'));
        const { createServer } = await import(pathToFileURL(clientRequire.resolve('vite')).href);
        const { default: react } = await import(pathToFileURL(clientRequire.resolve('@vitejs/plugin-react')).href);
        vite = await createServer({ root: path.join(root, 'client'), configFile: false, envDir: false,
            plugins: [react()], logLevel: 'silent', cacheDir: path.join(config.state_root, 'vite-cache'),
            server: { host: '127.0.0.1', port: config.port_base + 6, strictPort: true,
                proxy: { '/api': { target: config.urls.wa_savana, changeOrigin: false } },
                fs: { strict: true, allow: [path.join(root, 'client')] } } });
        await vite.listen();
        const proof = async (method, params) => {
            const source = await services[method](params);
            return ownerJourneyDiagnosticEnvelope({ source, config, traces, nativeAuthTraces });
        };
        return { startup: { ...await proof('diagnostics'), api_url: config.urls.wa_savana, frontend_url: config.urls.wa_frontend,
                browser_context: privateOwnerBrowserContext(privateNative, services.privateBrowserContext,
                    [...ownerJourneyRouteTemplates({ router: authRouter, publicPrefix: '/api/auth' }), ...(services.httpRouteTemplates || [])]),
                _private_runtime: privateNative },
            diagnostics: () => proof('diagnostics'),
            checkpoint: params => proof('checkpoint', params),
            fault: params => services.fault(params), close };
    } catch (error) {
        try { await close(); } catch { /* preserve fixed original failure */ }
        throw error;
    }
}

async function main() {
    const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
    // Native libraries may print diagnostics containing request details. The
    // private protocol has its own explicit emitter; all ambient logs disappear.
    for (const name of ['log', 'error', 'warn', 'info', 'debug']) console[name] = () => {};
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let runtime;
    let closing;
    const close = () => closing ||= (async () => { await runtime?.close(); })();
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
        close().finally(() => process.exit(0));
    });
    try {
        for await (const line of lines) {
            let request;
            try {
                if (Buffer.byteLength(line) > 1024 * 1024) fail('request_too_large');
                request = JSON.parse(line);
                object(request, ['id', 'command', 'params']);
                if (typeof request.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.id)) fail('invalid_request');
                let data;
                if (request.command === 'start' && !runtime) {
                    runtime = await startOwnerJourneyRuntime(request.params);
                    data = runtime.startup;
                } else if (request.command === 'diagnostics' && runtime) data = await runtime.diagnostics();
                else if (request.command === 'checkpoint' && runtime) data = await runtime.checkpoint(request.params);
                else if (request.command === 'fault' && runtime) data = await runtime.fault(request.params);
                else fail('invalid_request');
                emit({ id: request.id, ok: true, data });
            } catch (error) {
                const code = /^[a-z_]{1,80}$/.test(error.code || '') ? error.code : 'runtime_failed';
                emit({ id: request?.id ?? null, ok: false, data: { error_code: code } });
                if (!runtime) break;
            }
        }
    } finally {
        await close();
        process.exit(0); // Native auth owns an interval; all state/listeners closed.
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => process.exit(1));
}
