import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Controlled synthetic Core producer, not a replacement for the native state
// helper. Tests explicitly publish complete current documents and versions;
// the actual service still fetches, authenticates and applies them normally.
export const createSavanaLifecycleFixture = ({ fetchImpl = async () => Response.json({ error: 'unexpected fixture request' }, { status: 500 }),
    connectOrigin = 'https://connect.test', connections = [] } = {}) => {
    const current = new Map();
    const setConnection = connection => {
        assert.equal(Number.isSafeInteger(connection.lifecycle_version) && connection.lifecycle_version >= 0, true);
        for (const key of ['id', 'organization_id', 'source_platform', 'target_platform', 'source_tenant_id', 'target_tenant_id',
            'source_external_tenant_id', 'target_external_tenant_id', 'status']) assert.equal(typeof connection[key], 'string', key);
        assert.equal(Array.isArray(connection.scopes), true);
        current.set(connection.id, structuredClone(connection));
        return structuredClone(connection);
    };
    for (const connection of connections) setConnection(connection);
    const getConnection = id => structuredClone(current.get(id));
    const fetch = async (url, options = {}) => {
        const target = new URL(url), method = options.method || 'GET';
        const route = /^\/v1\/platform-connections\/([^/]+)(?:\/(pause|resume|revoke))?$/.exec(target.pathname);
        if (target.origin === connectOrigin && route && !(route[1] === 'requests' && method === 'POST')) {
            const id = decodeURIComponent(route[1]), connection = current.get(id);
            if (!connection) return Response.json({ error: 'fixture connection not found' }, { status: 404 });
            const local = connection.source_platform === 'wa_savana' ? 'source' : 'target';
            assert.equal(new Headers(options.headers).get('X-Savana-Platform-Code'), 'wa_savana');
            assert.equal(typeof new Headers(options.headers).get('X-Savana-Platform-Token'), 'string');
            if (!route[2] && method === 'GET') {
                assert.equal(target.searchParams.get('external_tenant_id'), connection[`${local}_external_tenant_id`]);
                assert.equal(target.searchParams.size, 1); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
                return Response.json(structuredClone(connection));
            }
            if (route[2] && method === 'POST') {
                const body = JSON.parse(options.body);
                assert.equal(body.external_tenant_id, connection[`${local}_external_tenant_id`]);
                const next = setConnection({ ...connection, status: { pause: 'paused', resume: 'active', revoke: 'revoked' }[route[2]],
                    lifecycle_version: connection.lifecycle_version + 1 });
                return Response.json(next);
            }
        }
        const response = await fetchImpl(url, options);
        if (target.origin === connectOrigin && target.pathname === '/v1/platform-connections/requests' && method === 'POST' && response.ok) {
            setConnection((await response.clone().json()).connection);
        }
        return response;
    };
    return Object.assign(fetch, { setConnection, getConnection });
};

export const savanaLifecycleDelivery = connection => ({ deliveryId: crypto.randomUUID(), version: String(connection.lifecycle_version) });
