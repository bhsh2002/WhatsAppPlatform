import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import { getEgressInflightInventory } from '../services/egressInflightInventory.js';

const MARKER = Symbol.for('wa-savana.egress-maintenance');
export const parseEgressMaintenance = (value, name = 'SAVANA_EGRESS_MAINTENANCE') => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['', 'false', '0', 'off'].includes(normalized)) return false;
    if (['true', '1', 'on'].includes(normalized)) return true;
    throw new Error(`${name} must be true or false`);
};

// Startup mode is fixed for the process. Resume requires a controlled restart,
// not an HTTP toggle that an old client could invoke.
export const isEgressMaintenanceActive = () => globalThis[MARKER]?.active
    ?? (parseEgressMaintenance(process.env.SAVANA_EGRESS_MAINTENANCE)
        || parseEgressMaintenance(process.env.SAVANA_EGRESS_REQUIRE_IDLE, 'SAVANA_EGRESS_REQUIRE_IDLE'));

export class EgressMaintenanceError extends Error {
    constructor() {
        super('Outbound execution is paused for coordinated maintenance');
        this.code = 'WA_EGRESS_MAINTENANCE';
        this.status = 503;
        this.retryable = true;
        this.dispatched = false;
    }
}
export const assertEgressAvailable = () => {
    if (isEgressMaintenanceActive()) throw new EgressMaintenanceError();
};

export const egressMaintenanceStatus = () => ({
    active: isEgressMaintenanceActive(),
    requested: globalThis[MARKER]?.requested ?? parseEgressMaintenance(process.env.SAVANA_EGRESS_MAINTENANCE),
    enforced: globalThis[MARKER]?.installed === true,
    resume_check: { required: globalThis[MARKER]?.resumeRequired ?? false, passed: globalThis[MARKER]?.resumePassed ?? null },
    blocked_attempts: { ...(globalThis[MARKER]?.blocked || {}) },
});

export const installEgressMaintenance = () => {
    if (globalThis[MARKER]?.installed) return egressMaintenanceStatus();
    const state = {
        requested: parseEgressMaintenance(process.env.SAVANA_EGRESS_MAINTENANCE),
        resumeRequired: parseEgressMaintenance(process.env.SAVANA_EGRESS_REQUIRE_IDLE, 'SAVANA_EGRESS_REQUIRE_IDLE'),
        resumePassed: null, installed: false, blocked: {},
        get active() { return this.requested || (this.resumeRequired && this.resumePassed !== true); },
    };
    globalThis[MARKER] = state;
    const guard = (original, transport) => function (...args) {
        if (state.active) {
            state.blocked[transport] = (state.blocked[transport] || 0) + 1;
            throw new EgressMaintenanceError();
        }
        return Reflect.apply(original, this, args);
    };
    if (typeof globalThis.fetch !== 'function') throw new Error('Global fetch is required for the egress maintenance guard');
    globalThis.fetch = guard(globalThis.fetch, 'fetch');
    http.request = guard(http.request, 'http');
    http.get = guard(http.get, 'http');
    https.request = guard(https.request, 'https');
    https.get = guard(https.get, 'https');
    // The socket boundary also covers captured request functions, custom
    // agents, TLS, undici and provider libraries bypassing the fetch wrapper.
    net.Socket.prototype.connect = guard(net.Socket.prototype.connect, 'socket');
    net.connect = guard(net.connect, 'net');
    net.createConnection = guard(net.createConnection, 'net');
    tls.connect = guard(tls.connect, 'tls');
    dgram.Socket.prototype.send = guard(dgram.Socket.prototype.send, 'datagram');
    syncBuiltinESMExports();
    state.installed = true;
    return egressMaintenanceStatus();
};

// A resume preflight is performed under the already-installed hard barrier.
// Only a complete, idle actual DB snapshot releases the startup preflight.
// An explicitly requested maintenance mode can never be released in process.
export const verifyEgressResumeReady = database => {
    const state = globalThis[MARKER];
    if (!state?.installed) throw new Error('Install the egress guard before resume preflight');
    if (state.requested || !state.resumeRequired || state.resumePassed === true) return egressMaintenanceStatus();
    const inventory = getEgressInflightInventory(database);
    if (!inventory.schema_complete || inventory.unresolved_count !== 0) {
        const error = new Error('Egress resume blocked: inspect aggregate inflight inventory and reconcile; no automatic replay');
        error.code = 'WA_EGRESS_RESUME_BLOCKED';
        error.summary = { schema_complete: inventory.schema_complete, unresolved_count: inventory.unresolved_count };
        throw error;
    }
    state.resumePassed = true;
    return egressMaintenanceStatus();
};

export const createEgressMaintenanceMiddleware = () => (req, res, next) => {
    if (!isEgressMaintenanceActive() || (['GET', 'HEAD'].includes(req.method) && req.path === '/health')) return next();
    // Do not acknowledge or ingest new mutations/webhooks during the window.
    // Existing durable queues are left untouched; upstream delivery/retry must
    // be coordinated. This response does not claim to have queued a webhook.
    return res.status(503).set({ 'Cache-Control': 'no-store', 'Retry-After': '60', Connection: 'close' }).json({
        error: { code: 'WA_EGRESS_MAINTENANCE', message: 'الخدمة متوقفة مؤقتًا للصيانة المنسقة. لم يُقبل الطلب للتنفيذ.' },
        maintenance: true, accepted: false, execution_ready: false,
    });
};
