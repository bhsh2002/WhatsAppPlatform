// Real WA auth middleware and read router, using only an owned temporary DB.
// This is an acceptance harness, not a bootstrap or runtime credential loader.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';

export async function startAuthenticatedWaReadServer({ baseUrl, platformToken, binding }) {
    const central = new URL(baseUrl);
    if (central.protocol !== 'http:' || central.hostname !== '127.0.0.1' || !central.port) {
        throw new Error('Acceptance requires its owned loopback central service');
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-product-cycle-auth-'));
    const previous = Object.fromEntries(['DATABASE_PATH', 'NODE_ENV', 'JWT_SECRET'].map(key => [key, process.env[key]]));
    const secret = crypto.randomBytes(48).toString('base64url');
    process.env.DATABASE_PATH = path.join(directory, 'synthetic-wa.db');
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = secret;
    let database;
    let server;
    const effects = { external_network: 0, channel_requests: 0, central_read_requests: 0 };
    const cleanup = { wa_server_stopped: false, wa_temp_database_removed: false };
    try {
        const [{ default: loadedDatabase }, { authMiddleware }, { tenantMiddleware }, {
            CentralProductReadService, DelegatedReadBindings, createSqliteReadPrincipalVerifier,
        }, { createSharedProductReadsRouter }, { JWT_SECRET }] = await Promise.all([
            import('../db/database.js'), import('../middleware/auth.js'), import('../middleware/tenant.js'),
            import('../services/centralProductRead.js'), import('../routes/sharedProductReads.js'), import('../config/index.js'),
        ]);
        database = loadedDatabase;
        if (JWT_SECRET !== secret || database.name !== process.env.DATABASE_PATH) {
            throw new Error('Acceptance must run in its own test process before WA singleton imports');
        }
        database.exec(`
            INSERT INTO tenants (id, name, phone, status) VALUES
                (1, 'Synthetic WA reader', '15550000001', 'Active'),
                (2, 'Synthetic unrelated WA tenant', '15550000002', 'Active');
            INSERT INTO users (id, username, password_hash, role, tenant_id, is_active, auth_version)
            VALUES (1, 'synthetic-wa-reader', 'unused-synthetic-password-hash', 'tenant', 1, 1, 0),
                   (2, 'synthetic-unrelated-reader', 'unused-synthetic-password-hash', 'tenant', 2, 1, 0);
            INSERT INTO bot_products (tenant_id, name, sku, price, currency, savana_projection_key,
                is_active, availability, approval_status)
            VALUES (1, 'Preserve synthetic legacy copy', 'SHARED-LOOKALIKE', 99, 'USD',
                'barcode:legacy-unqualified', 0, 'hidden', 'draft');
        `);
        const principals = {
            reader: { userId: 1, tenantId: 1, sessionId: 'wa-reader-session', authVersion: 0 },
            unrelated: { userId: 2, tenantId: 2, sessionId: 'wa-unrelated-session', authVersion: 0 },
        };
        const bindings = new DelegatedReadBindings();
        bindings.bind(principals.reader, binding);
        const actualFetch = globalThis.fetch;
        const guardedFetch = async (url, options = {}) => {
            const target = new URL(url);
            if (target.origin !== central.origin || !target.pathname.startsWith('/v1/integration/')) {
                effects.external_network++;
                if (/messages|send|campaign|publication|billing|reserve/.test(target.pathname)) effects.channel_requests++;
                throw new Error('Acceptance denied a non-read/non-owned network target');
            }
            const method = options.method || 'GET';
            if (method !== 'GET' && !(method === 'POST' && target.pathname === '/v1/integration/eligibility')) {
                effects.external_network++;
                throw new Error('Acceptance denied a business mutation');
            }
            effects.central_read_requests++;
            return actualFetch(url, { ...options, redirect: 'error' });
        };
        const service = new CentralProductReadService({
            enabled: true, allowLoopback: true, baseUrl, platformToken, fetchImpl: guardedFetch,
            trustedBindings: bindings, verifyLocalPrincipal: createSqliteReadPrincipalVerifier(database),
        });
        const app = express();
        app.use(express.json());
        app.use('/portal/integrations', authMiddleware, tenantMiddleware, createSharedProductReadsRouter({ service }));
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const waBase = `http://127.0.0.1:${server.address().port}`;
        const localToken = principal => jwt.sign({
            id: principal.userId, tenant_id: principal.tenantId, role: 'tenant',
            jti: principal.sessionId, auth_version: principal.authVersion,
        }, secret, { expiresIn: '20m' });
        const headers = { Authorization: `Bearer ${localToken(principals.reader)}` };
        const unrelatedHeaders = { Authorization: `Bearer ${localToken(principals.unrelated)}` };
        const read = async (route, { auth = headers, extraHeaders = {}, ...options } = {}) => {
            const response = await actualFetch(`${waBase}/portal/integrations${route}`, {
                ...options, redirect: 'error', headers: { ...auth, ...extraHeaders },
            });
            return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
        };
        const baseline = countEffects(database);
        const legacyBefore = database.prepare('SELECT * FROM bot_products ORDER BY id').all();
        const close = async () => {
            if (server) await new Promise(resolve => server.close(resolve));
            if (database?.open) database.close();
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key]; else process.env[key] = value;
            }
            fs.rmSync(directory, { recursive: true, force: true });
            cleanup.wa_server_stopped = server.listening === false;
            cleanup.wa_temp_database_removed = database.open === false && !fs.existsSync(directory);
            if (!cleanup.wa_server_stopped || !cleanup.wa_temp_database_removed) {
                throw new Error('Owned WA server/database state survived cleanup');
            }
        };
        return { read, database, service, bindings, principals, effects, headers, unrelatedHeaders, baseline, legacyBefore, close, cleanup };
    } catch (error) {
        if (server) await new Promise(resolve => server.close(resolve));
        if (database?.open) database.close();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
    }
}

export const countEffects = database => Object.fromEntries([
    'messages', 'savana_service_requests', 'savana_integration_outbox',
    'billing_usage_events', 'billing_ledger', 'billing_payments', 'savana_product_projection',
    'facebook_content_campaigns', 'facebook_content_publications',
].map(table => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
