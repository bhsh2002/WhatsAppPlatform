// Official WA-owned operational acceptance server. This file is a test factory,
// not an application bootstrap, credential importer or grant-enrollment API.
// Run once in a dedicated Node22.23.5 child before application singleton imports.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import bcrypt from 'bcryptjs';
import { countEffects } from './centralProductCycleWaServer.js';

const loopbackOrigin = value => {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Operational acceptance requires its center-owned ephemeral loopback origin');
    }
    return url.origin;
};
const routePattern = pathname => new RegExp(`^${pathname.split(/(\{[^}]+\})/).map(part => (
    /^\{[^}]+\}$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
)).join('')}/?$`);
const channelSendAttempt = (pathname, method) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    && /\/(messages|send|sendMessage|sendText|campaigns|publications|broadcast|feed|photos|videos|media)(\/|$)/i.test(pathname);
const ownerSuffixes = {
    GET: [/^(overview|enrollments|diagnostics)$/],
    POST: [/^(scopes|requests)$/, /^requests\/\{request_id\}\/(approve|reject)$/,
        /^publisher-grants\/\{grant_id\}\/(rotate|revoke)$/, /^read-grants\/\{grant_id\}\/revoke$/],
    PUT: [/^scope-authorizations\/\{target_account_id\}$/],
    PATCH: [/^requests\/\{request_id\}$/],
};

const allowedOperations = (config, centerOrigin, contractHashes = {}) => {
    const operations = [];
    const portalOrigin = config.ownerPortalEnabled === true ? loopbackOrigin(config.ownerPortalOrigin) : null;
    if (!Array.isArray(config.contractPaths) || config.contractPaths.length === 0) {
        throw new Error('Use the actual published central contract files');
    }
    for (const filename of config.contractPaths || []) {
        if (!path.isAbsolute(filename)) throw new Error('Use an explicit published contract file');
        const bytes = fs.readFileSync(filename);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        if (contractHashes[filename] && contractHashes[filename] !== hash) {
            throw new Error('The published contract changed during owned fixture startup');
        }
        contractHashes[filename] = hash;
        const contract = JSON.parse(bytes.toString('utf8'));
        if (!contract.openapi || !contract.paths) throw new Error('Published OpenAPI contract is unavailable');
        for (const [pathname, methods] of Object.entries(contract.paths)) {
            if (!pathname.startsWith('/')) throw new Error('Invalid published HTTP path');
            for (const method of Object.keys(methods).filter(value => ['get', 'post', 'put', 'patch', 'delete'].includes(value))) {
                const verb = method.toUpperCase();
                if (portalOrigin && pathname === '/api/session' && ['GET', 'POST', 'DELETE'].includes(verb)) {
                    operations.push({ origin: portalOrigin, method: verb, match: routePattern(pathname), ownerPortal: true });
                }
                const prefix = '/v1/integration/operational/organizations/{organization_id}/';
                if (portalOrigin && pathname.startsWith(prefix)
                    && ownerSuffixes[verb]?.some(pattern => pattern.test(pathname.slice(prefix.length)))) {
                    // This is the actual member-session BFF mapping published
                    // by ControlCenter; unrelated member/admin routes are not
                    // reachable and WA never signs a portal assertion.
                    const bff = `/api/member/organizations/{organization_id}/integration/${pathname.slice(prefix.length)}`;
                    operations.push({ origin: portalOrigin, method: verb, match: routePattern(bff), ownerPortal: true });
                }
                // The original Connect contract supplies only native-account
                // lookup here; its unrelated admin APIs gain no permission.
                if (!pathname.startsWith('/v1/integration/')
                    && !(pathname === '/v1/platform-bindings' && method === 'get')) continue;
                operations.push({ origin: centerOrigin, method: verb, match: routePattern(pathname) });
            }
        }
    }
    if (portalOrigin) {
        // The current portal runtime publishes this precise membership check;
        // it is distinct from GET /api/session's signed-cookie observation.
        operations.push({ origin: portalOrigin, method: 'GET',
            match: routePattern('/api/member/organizations/{organization_id}/integration/ui-context'), ownerPortal: true });
    }
    // Authorization is a browser redirect to the separate owned portal. It is
    // never a backend fetch permission. Token/JWKS/userinfo remain center-only.
    if (config.oidcAuthorizationEndpoint) {
        const authorize = new URL(config.oidcAuthorizationEndpoint);
        loopbackOrigin(authorize.origin);
        if (authorize.username || authorize.password || authorize.search || authorize.hash) {
            throw new Error('OIDC authorization must use an explicit owned portal endpoint');
        }
    }
    for (const [name, method] of [
        ['oidcTokenEndpoint', 'POST'], ['oidcJwksUri', 'GET'], ['oidcUserInfoEndpoint', 'GET'],
    ]) {
        if (!config[name]) continue;
        const url = new URL(config[name]);
        if (url.origin !== centerOrigin || url.username || url.password || url.search || url.hash) {
            throw new Error('OIDC acceptance endpoints must remain on the owned center');
        }
        operations.push({ origin: centerOrigin, method, match: routePattern(url.pathname) });
    }
    return operations;
};

export async function startOperationalWaServer(config, { afterListen = null } = {}) {
    if (process.version !== 'v22.23.5') {
        throw new Error('The owned WA fixture requires Node22.23.5');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)
        || Object.keys(config).some(key => ['DATABASE_PATH', 'databasePath', 'database_path',
            'database', 'grants', 'registry', 'accessToken', 'readToken', 'readBinding', 'delegatedSessions',
            'username', 'password', 'mfa_code', 'cookie', 'portalCookie', 'ownerCredentials',
            'portalCredentials', 'testLoginCredentials'].includes(key))) {
        throw new Error('The owned WA fixture cannot import existing state or a pre-authorized read session');
    }
    const centerOrigin = loopbackOrigin(config.centerOrigin);
    if (typeof config.platformToken !== 'string' || !config.platformToken) {
        throw new Error('The harness must provide its private temporary WA platform credential');
    }
    const contractHashes = {};
    const operations = allowedOperations(config, centerOrigin, contractHashes);
    const ownedOrigins = new Set(operations.map(operation => operation.origin));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-operational-acceptance-'));
    // This factory is dedicated-process only. Do not let inherited production
    // service settings become inputs when the real auth/config modules load.
    const previousEnvironment = { ...process.env };
    for (const name of Object.keys(process.env)) delete process.env[name];
    process.env.PATH = path.dirname(process.execPath);
    process.env.LANG = 'en_US.UTF-8';
    process.env.TZ = 'UTC';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = path.join(directory, 'synthetic-wa.db');
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
    process.env.CRYPTO_KEY = crypto.randomBytes(32).toString('hex');
    process.env.DISABLE_BACKGROUND_JOBS = 'true';
    const actualFetch = globalThis.fetch;
    const effects = { central_http_requests: 0, external_network_attempts: 0,
        channel_requests: 0, forbidden_business_requests: 0, lost_acknowledgements: 0,
        owner_portal_mutation_requests: 0, send_attempts: 0, actual_external_effects: 0 };
    const network = { disconnected: false, dropNextAck: null };
    let database;
    let server;
    let closed = false;
    const cleanup = { server_stopped: false, database_closed: false, owned_state_removed: false };
    const localCredentials = Object.fromEntries(['owner', 'employee', 'foreign'].map((kind, index) => [kind, {
        username: `synthetic-operational-wa-${kind}`, password: crypto.randomBytes(24).toString('base64url'), id: index + 1,
    }]));
    const guardedFetch = async (input, options = {}) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const method = String(options.method || input?.method || 'GET').toUpperCase();
        if (channelSendAttempt(url.pathname, method)) effects.send_attempts++;
        if (!ownedOrigins.has(url.origin) || url.username || url.password) {
            effects.external_network_attempts++;
            if (/messages|send|campaign|publication|payment|billing|reserve/i.test(url.pathname)) effects.channel_requests++;
            throw new Error('WA operational fixture rejected non-owned network target');
        }
        const operation = operations.find(item => item.origin === url.origin && item.method === method && item.match.test(url.pathname));
        const headers = new Headers(options.headers || input?.headers || {});
        const portalHeadersInvalid = operation?.ownerPortal && ['Authorization', 'X-Savana-Platform-Token',
            'X-Savana-Platform-Code', 'X-Savana-Portal-Assertion', 'X-Savana-Portal-Signature'].some(name => headers.has(name));
        const queryKeys = [...url.searchParams.keys()];
        const portalQueryInvalid = operation?.ownerPortal && (new Set(queryKeys).size !== queryKeys.length
            || queryKeys.some(name => !(method === 'GET' && url.pathname.endsWith('/integration/diagnostics')
                && ['activity_id', 'branch_id', 'warehouse_id'].includes(name))));
        if (/\/integration\/products\/changes\/?$/.test(url.pathname)
            || /\/(messages|campaigns|publications|payments|billing)(\/|$)/i.test(url.pathname)
            || !operation || portalHeadersInvalid || portalQueryInvalid) {
            effects.forbidden_business_requests++;
            throw new Error('WA operational fixture rejected an unpublished/non-reader operation');
        }
        if (network.disconnected) throw new Error('Synthetic WA-to-center network partition');
        effects.central_http_requests++;
        if (operation.ownerPortal && method !== 'GET' && url.pathname.includes('/integration/')) {
            effects.owner_portal_mutation_requests++;
        }
        const response = await actualFetch(url.href, { ...options, redirect: 'error' });
        if (network.dropNextAck && method === network.dropNextAck.method
            && url.pathname.replace(/\/$/, '') === network.dropNextAck.path.replace(/\/$/, '')) {
            network.dropNextAck = null;
            effects.lost_acknowledgements++;
            await response.arrayBuffer();
            throw new Error('Synthetic acknowledgement lost after actual center HTTP response');
        }
        return response;
    };
    const restoreEnvironment = () => {
        globalThis.fetch = actualFetch;
        for (const name of Object.keys(process.env)) delete process.env[name];
        Object.assign(process.env, previousEnvironment);
    };
    const close = async () => {
        if (closed) return cleanup;
        closed = true;
        try {
            if (server?.listening) await new Promise(resolve => server.close(resolve));
            if (database?.open) database.close();
        } finally {
            restoreEnvironment();
            fs.rmSync(directory, { recursive: true, force: true });
        }
        cleanup.server_stopped = !server?.listening;
        cleanup.database_closed = !database?.open;
        cleanup.owned_state_removed = !fs.existsSync(directory);
        if (!Object.values(cleanup).every(Boolean)) throw new Error('WA operational fixture cleanup failed');
        return cleanup;
    };
    try {
        globalThis.fetch = guardedFetch;
        // Check the independently developed owner-journey modules before
        // opening the singleton needed by the actual auth router. A missing
        // early handoff must not race a database import after cleanup.
        const [{ createOperationalReadServices }, { createOperationalReadSetupRouter }] = await Promise.all([
            import('../services/operationalReadSetup.js'), import('../routes/operationalReadSetup.js'),
        ]);
        const ownerRouter = config.ownerPortalEnabled === true
            ? await import('../routes/operationalOwnerPortal.js') : null;
        database = (await import('../db/database.js')).default;
        const [{ default: authRouter }, { authMiddleware }, { tenantMiddleware },
            { initEncryption, encrypt, decrypt }, { createSharedProductReadsRouter }, { JWT_SECRET }] = await Promise.all([
            import('../routes/auth.js'), import('../middleware/auth.js'), import('../middleware/tenant.js'),
            import('../services/encryption.js'), import('../routes/sharedProductReads.js'), import('../config/index.js'),
        ]);
        if (database.name !== process.env.DATABASE_PATH || JWT_SECRET !== process.env.JWT_SECRET) {
            throw new Error('Start the official WA fixture in a fresh dedicated Node22.23.5 process');
        }
        initEncryption();
        database.exec(`INSERT INTO tenants (id, name, phone, status) VALUES
            (1, 'Synthetic WA operational activity', '15550000001', 'Active'),
            (2, 'Synthetic WA unrelated activity', '15550000002', 'Active')`);
        const insert = database.prepare(`INSERT INTO users
            (id, username, password_hash, name, role, tenant_id, is_active, auth_version)
            VALUES (?, ?, ?, ?, 'tenant', ?, 1, 0)`);
        for (const [kind, identity] of Object.entries(localCredentials)) {
            insert.run(identity.id, identity.username, await bcrypt.hash(identity.password, 10),
                `Synthetic ${kind}`, kind === 'foreign' ? 2 : 1);
        }
        database.exec(`INSERT INTO bot_products (tenant_id, name, sku, price, currency,
            savana_projection_key, is_active, availability, approval_status)
            VALUES (1, 'Synthetic preserved quarantined copy', 'SYN-LEGACY', 99, 'USD',
                'barcode:unqualified-synthetic-origin', 0, 'hidden', 'draft')`);
        const app = express();
        app.use(express.json({ limit: '256kb' }));
        app.use((req, res, next) => {
            res.set('Cache-Control', 'no-store');
            if (/\/(messages|campaigns|publications|payments|billing|broadcast)(\/|$)/i.test(req.path)) {
                effects.channel_requests++;
                if (channelSendAttempt(req.path, req.method)) effects.send_attempts++;
                return res.status(403).json({ error: 'Synthetic operational fixture: external effects are disabled' });
            }
            next();
        });
        server = http.createServer(app);
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const listenPort = server.address().port;
        const baseUrl = `http://127.0.0.1:${listenPort}`;
        const callbackUri = `${baseUrl}/api/portal/integrations/shared-read-setup/callback`;
        let oidcConfiguration = {};
        if (config.deferOidcConfiguration === true) {
            if (typeof afterListen !== 'function') throw new Error('Two-stage fixture start requires its private configuration continuation');
            oidcConfiguration = await afterListen({ baseUrl, callbackUri, ownedDirectory: directory });
            const accepted = ['oidcClientId', 'oidcClientSecret', 'oidcAuthorizationEndpoint',
                'oidcTokenEndpoint', 'oidcJwksUri', 'oidcUserInfoEndpoint'];
            if (!oidcConfiguration || typeof oidcConfiguration !== 'object' || Array.isArray(oidcConfiguration)
                || Object.keys(oidcConfiguration).some(key => !accepted.includes(key))) {
                throw new Error('The private continuation accepts OIDC application configuration only, never grants');
            }
            operations.push(...allowedOperations({ ...config, ...oidcConfiguration }, centerOrigin, contractHashes));
        }
        const { setupService, readService, ownerPortalService } = await createOperationalReadServices({
            database,
            config: { ...config, ...oidcConfiguration, enabled: true, sharedReadsEnabled: true, centerOrigin, allowLoopback: true,
                oidcRedirectUri: callbackUri },
            fetchImpl: guardedFetch, encryption: { encrypt, decrypt },
        });
        app.use('/api/auth', authRouter);
        if (ownerRouter) {
            if (!ownerPortalService) throw new Error('The explicit native owner portal factory is not ready');
            app.use('/api/portal/integrations', authMiddleware, tenantMiddleware,
                ownerRouter.createOperationalOwnerPortalRouter({ service: ownerPortalService, appOrigin: setupService.appOrigin }));
        }
        app.use('/api/portal/integrations', authMiddleware, tenantMiddleware,
            createOperationalReadSetupRouter({ service: setupService }));
        app.use('/api/portal/integrations', authMiddleware, tenantMiddleware,
            createSharedProductReadsRouter({ service: readService }));
        const effectBaseline = countEffects(database);
        const legacyBefore = database.prepare('SELECT * FROM bot_products ORDER BY id').all();
        const diagnostics = () => {
            const after = countEffects(database);
            const schemaTables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all().map(row => row.name);
            const businessModelTables = {
                orders: schemaTables.filter(name => /(^|_)(orders?|order_lines?|order_items?)(_|$)/i.test(name)),
                stock: schemaTables.filter(name => /(^|_)(stock|inventory)(_|$)/i.test(name)),
                measurement: schemaTables.filter(name => /(^|_)(measurements?|business_measurements?)(_|$)/i.test(name)),
            };
            const setupTables = database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
                AND (name LIKE 'savana_operational_%' OR name LIKE 'savana_shared_read_%'
                    OR name LIKE 'savana_delegated_read_%' OR name LIKE 'savana_owner_portal_%') ORDER BY name`).all();
            const ownerStates = ['savana_owner_portal_sessions', 'savana_owner_portal_intents']
                .filter(table => setupTables.some(({ name }) => name === table));
            return {
                fixture_kind: 'wa_owned_operational_http',
                contract_sha256: { ...contractHashes },
                effects: { ...effects }, effect_tables_before: effectBaseline, effect_tables_current: after,
                business_effects: {
                    outbound_messages: database.prepare("SELECT COUNT(*) AS count FROM messages WHERE direction='outgoing'").get().count,
                    outbound_send_successes: database.prepare("SELECT COUNT(*) AS count FROM messages WHERE direction='outgoing' AND status IN ('sent','delivered','read')").get().count,
                },
                native_effect_tables_unchanged: JSON.stringify(effectBaseline) === JSON.stringify(after),
                owned_entry_structure: {
                    schema_table_count: schemaTables.length,
                    schema_table_names_sha256: crypto.createHash('sha256').update(JSON.stringify(schemaTables)).digest('hex'),
                    matching_business_model_tables: {
                        orders: businessModelTables.orders,
                        stock: businessModelTables.stock,
                        business_measurement: businessModelTables.measurement,
                    },
                    schema_domains_absent: Object.fromEntries(Object.entries(businessModelTables)
                        .map(([domain, names]) => [domain, names.length === 0])),
                    mounted_router_modules: ['server/routes/auth.js', 'server/routes/operationalReadSetup.js',
                        'server/routes/sharedProductReads.js', ...(ownerRouter ? ['server/routes/operationalOwnerPortal.js'] : [])],
                },
                legacy_rows_unchanged: JSON.stringify(legacyBefore) === JSON.stringify(database.prepare('SELECT * FROM bot_products ORDER BY id').all()),
                setup_row_counts: Object.fromEntries(setupTables.map(({ name }) => [name,
                    database.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count])),
                owner_portal_state_counts: Object.fromEntries(ownerStates.map(table => [table, Object.fromEntries(
                    database.prepare(`SELECT state,COUNT(*) AS count FROM ${table} GROUP BY state ORDER BY state`).all()
                        .map(row => [row.state, row.count]))])),
            };
        };
        const setNetwork = ({ disconnected = false, dropNextAck = null } = {}) => {
            if (typeof disconnected !== 'boolean') throw new Error('Use an explicit synthetic network state');
            if (dropNextAck && (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(dropNextAck.method)
                || typeof dropNextAck.path !== 'string'
                || !operations.some(operation => operation.method === dropNextAck.method && operation.match.test(dropNextAck.path)))) {
                throw new Error('Lost-ack simulation requires an exact published mutation operation');
            }
            network.disconnected = disconnected;
            network.dropNextAck = dropNextAck;
        };
        const pauseHttp = async () => {
            if (closed) throw new Error('The owned WA lifecycle has already ended');
            if (server.listening) await new Promise(resolve => server.close(resolve));
            if (!database.open || !fs.existsSync(directory)) throw new Error('WA pause lost its owned database');
            return { http_listening: false, database_preserved: true, origin_unchanged: true,
                note: 'HTTP listener pause, not a process-restart claim' };
        };
        const resumeHttp = async () => {
            if (closed || !database.open || !fs.existsSync(directory)) throw new Error('Cannot resume an ended WA fixture');
            if (!server.listening) {
                server.listen(listenPort, '127.0.0.1');
                await once(server, 'listening');
            }
            return { http_listening: true, database_preserved: true, origin_unchanged: true,
                note: 'HTTP listener resume reuses actual services and durable state' };
        };
        return {
            baseUrl, callbackUri, localCredentials, ownedDirectory: directory, contractHashes: { ...contractHashes },
            setupService, readService, ownerPortalService, database, effects, cleanup, diagnostics, setNetwork, pauseHttp, resumeHttp, close,
        };
    } catch (error) {
        await close();
        throw error;
    }
}
