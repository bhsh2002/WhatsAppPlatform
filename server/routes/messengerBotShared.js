export function toInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

export function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return fallback;
    }
}

export function serializeJson(value) {
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return JSON.stringify({ unparseable: true });
    }
}

export function resolvePublicApiBase(req, webhookCallbackUrl = '') {
    if (webhookCallbackUrl) {
        return webhookCallbackUrl.replace(/\/webhook\/?$/i, '').replace(/\/$/, '');
    }
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}`;
}

export function resolveTenantId(req) {
    if (req.user?.role === 'admin') {
        return toInt(req.query.tenant_id ?? req.body?.tenant_id, null);
    }
    return req.user?.tenant_id || null;
}

export function requireTenant(database, req, res) {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
        res.status(400).json({ error: 'tenant_id مطلوب' });
        return null;
    }
    const tenant = database.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
        res.status(404).json({ error: 'العميل غير موجود' });
        return null;
    }
    return tenant;
}

export function validateLinkedPage(database, tenantId, linkedPageId) {
    if (!linkedPageId) return null;
    return database.prepare(
        'SELECT id, page_id, page_name FROM tenant_pages WHERE id = ? AND tenant_id = ? AND is_active = 1',
    ).get(linkedPageId, tenantId);
}
