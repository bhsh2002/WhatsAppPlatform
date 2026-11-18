import { SharedProductReadError } from './centralProductRead.js';

const fail = code => { throw new SharedProductReadError(code, 403); };

export const createNativePlatformBindingReader = ({ centerOrigin, platformToken, fetchImpl = globalThis.fetch, allowLoopback = false }) => {
    const center = new URL(centerOrigin);
    const privateCore = center.protocol === 'http:' && center.hostname === 'savana-connect' && center.port === '8010';
    const loopback = allowLoopback === true && center.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(center.hostname);
    if (!(center.protocol === 'https:' || privateCore || loopback) || center.username || center.password
        || center.pathname !== '/' || center.search || center.hash || typeof platformToken !== 'string' || !platformToken
        || typeof fetchImpl !== 'function') throw new TypeError('Native binding requires a trusted Core service and platform credential');
    return async ({ nativeTenantId, organizationId }) => {
        if (!Number.isSafeInteger(nativeTenantId) || nativeTenantId < 1 || typeof organizationId !== 'string'
            || !organizationId || organizationId.length > 255) fail('native_platform_binding_changed');
        const externalTenant = `wa_savana:tenant:${nativeTenantId}`;
        const url = new URL('/v1/platform-bindings', center.origin); url.searchParams.set('external_tenant_id', externalTenant);
        let rows;
        try {
            const response = await fetchImpl(url.href, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
                headers: { 'X-Savana-Platform-Code': 'wa_savana', 'X-Savana-Platform-Token': platformToken } });
            if (Number(response.headers.get('content-length')) > 1_048_576) throw new Error();
            const reader = response.body?.getReader(); if (!reader) throw new Error();
            const chunks = []; let size = 0;
            try {
                while (true) {
                    const next = await reader.read(); if (next.done) break;
                    size += next.value.byteLength;
                    if (size > 1_048_576) { await reader.cancel(); throw new Error(); }
                    chunks.push(Buffer.from(next.value));
                }
            } finally { reader.releaseLock(); }
            if (!response.ok) throw new Error(); rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch { fail('native_platform_binding_unavailable'); }
        if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.id !== 'string' || !rows[0].id || rows[0].id.length > 255
            || rows[0].platform_code !== 'wa_savana' || rows[0].external_tenant_id !== externalTenant
            || rows[0].organization_id !== organizationId || rows[0].status !== 'active') fail('native_platform_binding_changed');
        return { id: rows[0].id, platform_code: 'wa_savana', external_tenant_id: externalTenant, organization_id: organizationId, status: 'active' };
    };
};
