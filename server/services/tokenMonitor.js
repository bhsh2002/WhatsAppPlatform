import db from '../db/database.js';
import { META_API_BASE, META_APP_ID, META_APP_SECRET } from '../config/index.js';
import { decryptIfEncrypted } from './encryption.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function checkTokenHealth() {
    if (!META_APP_ID || !META_APP_SECRET) {
        console.warn('[TokenMonitor] META_APP_ID or META_APP_SECRET not set — skipping token health check');
        return;
    }

    const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
    let checked = 0;
    let errors = 0;

    const tenants = db.prepare(
        "SELECT id, name, access_token, access_token_encrypted, status FROM tenants WHERE status != 'Suspended'"
    ).all();

    for (const tenant of tenants) {
        const token = tenant.access_token_encrypted
            ? decryptIfEncrypted(tenant.access_token_encrypted)
            : tenant.access_token;

        if (!token) {
            db.prepare(
                "UPDATE tenants SET token_status = 'invalid', token_checked_at = datetime('now', 'localtime') WHERE id = ?"
            ).run(tenant.id);
            continue;
        }

        try {
            const response = await fetch(
                `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}`,
                { headers: { Authorization: `Bearer ${appAccessToken}` } }
            );
            const data = await response.json();

            if (data.error) {
                db.prepare(
                    "UPDATE tenants SET token_status = 'invalid', token_checked_at = datetime('now', 'localtime') WHERE id = ?"
                ).run(tenant.id);
                errors++;
                continue;
            }

            const tokenData = data.data || {};
            const isValid = tokenData.is_valid === true;
            const expiresAt = tokenData.expires_at;

            let status;
            if (!isValid) {
                status = 'invalid';
            } else if (expiresAt && expiresAt > 0) {
                const expiresDate = new Date(expiresAt * 1000);
                const now = new Date();
                if (expiresDate <= now) {
                    status = 'expired';
                } else if (expiresDate <= new Date(now.getTime() + SEVEN_DAYS_MS)) {
                    status = 'expiring';
                } else {
                    status = 'valid';
                }
            } else {
                status = 'valid';
            }

            db.prepare(
                `UPDATE tenants SET token_status = ?, token_expires_at = ?, token_checked_at = datetime('now', 'localtime') WHERE id = ?`
            ).run(status, expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null, tenant.id);
            checked++;
        } catch (err) {
            console.error(`[TokenMonitor] Error checking tenant ${tenant.id}:`, err.message);
            errors++;
        }
    }

    const pages = db.prepare(
        "SELECT id, tenant_id, page_id, page_name, page_access_token_encrypted FROM tenant_pages"
    ).all();

    for (const page of pages) {
        const token = page.page_access_token_encrypted
            ? decryptIfEncrypted(page.page_access_token_encrypted)
            : null;

        if (!token) {
            db.prepare(
                "UPDATE tenant_pages SET token_status = 'invalid', token_checked_at = datetime('now', 'localtime') WHERE id = ?"
            ).run(page.id);
            continue;
        }

        try {
            const response = await fetch(
                `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}`,
                { headers: { Authorization: `Bearer ${appAccessToken}` } }
            );
            const data = await response.json();

            if (data.error) {
                db.prepare(
                    "UPDATE tenant_pages SET token_status = 'invalid', token_checked_at = datetime('now', 'localtime') WHERE id = ?"
                ).run(page.id);
                continue;
            }

            const tokenData = data.data || {};
            const isValid = tokenData.is_valid === true;
            const expiresAt = tokenData.expires_at;

            let status;
            if (!isValid) {
                status = 'invalid';
            } else if (expiresAt && expiresAt > 0) {
                const expiresDate = new Date(expiresAt * 1000);
                const now = new Date();
                if (expiresDate <= now) {
                    status = 'expired';
                } else if (expiresDate <= new Date(now.getTime() + SEVEN_DAYS_MS)) {
                    status = 'expiring';
                } else {
                    status = 'valid';
                }
            } else {
                status = 'valid';
            }

            db.prepare(
                `UPDATE tenant_pages SET token_status = ?, token_expires_at = ?, token_checked_at = datetime('now', 'localtime') WHERE id = ?`
            ).run(status, expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null, page.id);
            checked++;
        } catch (err) {
            console.error(`[TokenMonitor] Error checking page ${page.id}:`, err.message);
        }
    }

    console.log(`[TokenMonitor] Checked ${checked} tokens, ${errors} errors`);
}

export async function checkSingleTenant(tenantId) {
    if (!META_APP_ID || !META_APP_SECRET) {
        throw new Error('META_APP_ID and META_APP_SECRET must be configured for token health checks');
    }

    const tenant = db.prepare('SELECT id, name, access_token, access_token_encrypted, status FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
    const token = tenant.access_token_encrypted
        ? decryptIfEncrypted(tenant.access_token_encrypted)
        : tenant.access_token;

    if (!token) {
        db.prepare("UPDATE tenants SET token_status = 'invalid', token_checked_at = datetime('now', 'localtime') WHERE id = ?").run(tenantId);
        return { status: 'invalid', expires_at: null };
    }

    const response = await fetch(
        `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}`,
        { headers: { Authorization: `Bearer ${appAccessToken}` } }
    );
    const data = await response.json();

    if (data.error) {
        db.prepare("UPDATE tenants SET token_status = 'invalid', token_checked_at = datetime('now', 'localtime') WHERE id = ?").run(tenantId);
        return { status: 'invalid', error: data.error.message, expires_at: null };
    }

    const tokenData = data.data || {};
    const isValid = tokenData.is_valid === true;
    const expiresAt = tokenData.expires_at;

    let status;
    if (!isValid) {
        status = 'invalid';
    } else if (expiresAt && expiresAt > 0) {
        const expiresDate = new Date(expiresAt * 1000);
        const now = new Date();
        if (expiresDate <= now) {
            status = 'expired';
        } else if (expiresDate <= new Date(now.getTime() + SEVEN_DAYS_MS)) {
            status = 'expiring';
        } else {
            status = 'valid';
        }
    } else {
        status = 'valid';
    }

    db.prepare(
        `UPDATE tenants SET token_status = ?, token_expires_at = ?, token_checked_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(status, expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null, tenantId);

    return {
        status,
        expires_at: expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null,
        scopes: tokenData.scopes || [],
        app_id: tokenData.app_id || null,
        is_valid: isValid,
    };
}

export function startTokenHealthScheduler() {
    if (!META_APP_ID || !META_APP_SECRET) {
        console.log('[TokenMonitor] META_APP_ID or META_APP_SECRET not set — token health monitoring disabled');
        return;
    }

    setTimeout(() => {
        checkTokenHealth().catch(err => console.error('[TokenMonitor] Initial check failed:', err.message));
    }, 30000);

    const interval = setInterval(() => {
        checkTokenHealth().catch(err => console.error('[TokenMonitor] Scheduled check failed:', err.message));
    }, TOKEN_CHECK_INTERVAL_MS);

    interval.unref();
    console.log('[TokenMonitor] Scheduler started — checking every 6 hours');
}