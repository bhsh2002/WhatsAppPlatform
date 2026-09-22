import crypto from 'node:crypto';

import { safeOutboundFetch } from '../security/outboundUrl.js';
import { decryptIfEncrypted } from './encryption.js';

const clampInteger = (value, fallback, minimum, maximum) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
};

const asDate = value => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Callback outbox clock returned an invalid date');
    return date;
};

export class TenantCallbackOutbox {
    constructor({
        database,
        fetchImpl = safeOutboundFetch,
        decryptSecret = decryptIfEncrypted,
        now = () => new Date(),
        deliveryId = () => crypto.randomUUID(),
        maxAttempts = process.env.TENANT_CALLBACK_OUTBOX_MAX_ATTEMPTS,
        leaseMs = process.env.TENANT_CALLBACK_OUTBOX_LEASE_MS,
        baseDelayMs = process.env.TENANT_CALLBACK_OUTBOX_BASE_DELAY_MS,
        maxDelayMs = process.env.TENANT_CALLBACK_OUTBOX_MAX_DELAY_MS,
        concurrency = process.env.TENANT_CALLBACK_OUTBOX_CONCURRENCY,
    } = {}) {
        if (!database) throw new Error('TenantCallbackOutbox requires a database');
        this.db = database;
        this.fetch = fetchImpl;
        this.decryptSecret = decryptSecret;
        this.now = now;
        this.deliveryId = deliveryId;
        this.maxAttempts = clampInteger(maxAttempts, 8, 1, 100);
        this.leaseMs = clampInteger(leaseMs, 5 * 60_000, 1_000, 60 * 60_000);
        this.baseDelayMs = clampInteger(baseDelayMs, 2_000, 100, 60 * 60_000);
        this.maxDelayMs = clampInteger(maxDelayMs, 60 * 60_000, 1_000, 24 * 60 * 60_000);
        this.concurrency = clampInteger(concurrency, 5, 1, 20);
    }

    enqueue(tenantId, event, data, { dedupeKey = null } = {}) {
        const normalizedTenantId = Number(tenantId);
        if (!Number.isSafeInteger(normalizedTenantId) || normalizedTenantId <= 0) {
            throw new Error('A valid tenant id is required for callback delivery');
        }
        const eventType = String(event || '').trim();
        if (!eventType) throw new Error('A callback event type is required');

        const settings = this.db.prepare(`
            SELECT callback_url, webhook_secret
            FROM tenant_api_settings
            WHERE tenant_id = ? AND callback_url IS NOT NULL
        `).get(normalizedTenantId);
        if (!settings?.callback_url) return { queued: false, reason: 'callback_not_configured' };

        const createdAt = asDate(this.now()).toISOString();
        const id = this.deliveryId();
        const body = JSON.stringify({
            event: eventType,
            timestamp: createdAt,
            tenant_id: normalizedTenantId,
            data,
        });
        const secret = this.decryptSecret(settings.webhook_secret);
        const signature = secret
            ? `v1=${crypto.createHmac('sha256', secret).update(`${id}.${body}`).digest('hex')}`
            : null;
        const legacySignature = secret
            ? `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
            : null;
        const normalizedDedupeKey = dedupeKey == null || dedupeKey === ''
            ? null
            : `${normalizedTenantId}:${eventType}:${String(dedupeKey).slice(0, 300)}`;

        const result = this.db.prepare(`
            INSERT INTO tenant_api_callback_outbox (
                delivery_id, dedupe_key, tenant_id, event_type, callback_url,
                body_json, signature, legacy_signature, status, attempts, available_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
            ON CONFLICT(dedupe_key) DO NOTHING
        `).run(
            id,
            normalizedDedupeKey,
            normalizedTenantId,
            eventType,
            settings.callback_url,
            body,
            signature,
            legacySignature,
            createdAt,
            createdAt,
            createdAt,
        );
        if (result.changes === 0) {
            const existing = this.db.prepare(`
                SELECT id, delivery_id, status FROM tenant_api_callback_outbox
                WHERE dedupe_key = ?
            `).get(normalizedDedupeKey);
            return {
                queued: true,
                duplicate: true,
                id: existing.id,
                delivery_id: existing.delivery_id,
                status: existing.status,
            };
        }
        return {
            queued: true,
            duplicate: false,
            id: Number(result.lastInsertRowid),
            delivery_id: id,
        };
    }

    reclaimExpiredLeases(now) {
        const staleBefore = new Date(now.getTime() - this.leaseMs).toISOString();
        return this.db.prepare(`
            UPDATE tenant_api_callback_outbox
            SET status = 'failed', locked_at = NULL, available_at = ?,
                last_error = COALESCE(last_error, 'Delivery lease expired before completion'),
                updated_at = ?
            WHERE status = 'processing' AND locked_at <= ?
        `).run(now.toISOString(), now.toISOString(), staleBefore).changes;
    }

    claim(recordId, now) {
        const claimed = this.db.prepare(`
            UPDATE tenant_api_callback_outbox
            SET status = 'processing', attempts = attempts + 1,
                locked_at = ?, updated_at = ?
            WHERE id = ? AND status IN ('pending', 'failed') AND available_at <= ?
        `).run(now.toISOString(), now.toISOString(), recordId, now.toISOString());
        if (claimed.changes !== 1) return null;
        return this.db.prepare(`
            SELECT * FROM tenant_api_callback_outbox WHERE id = ?
        `).get(recordId);
    }

    retryDelayMs(attempt) {
        return Math.min(
            this.maxDelayMs,
            this.baseDelayMs * (2 ** Math.min(Math.max(0, attempt - 1), 16)),
        );
    }

    diagnostics() {
        const row = this.db.prepare(`
            SELECT
                SUM(CASE WHEN status IN ('pending', 'failed', 'processing') THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
                MIN(CASE WHEN status IN ('pending', 'failed', 'processing') THEN created_at END) AS oldest_pending_at
            FROM tenant_api_callback_outbox
        `).get();
        return {
            pending: Number(row?.pending || 0),
            dead_letter: Number(row?.dead_letter || 0),
            oldest_pending_at: row?.oldest_pending_at || null,
        };
    }

    async dispatch({ limit = 100 } = {}) {
        const startedAt = asDate(this.now());
        this.reclaimExpiredLeases(startedAt);
        const deliveryLimit = clampInteger(limit, 100, 1, 500);
        const results = [];
        const blockedTenants = new Set();

        const deliver = async record => {
            try {
                const headers = {
                    'Content-Type': 'application/json',
                    'X-Tenant-Id': String(record.tenant_id),
                    'X-Savana-Delivery-Id': record.delivery_id,
                };
                if (record.signature) headers['X-Savana-Signature'] = record.signature;
                if (record.legacy_signature) headers['X-Signature'] = record.legacy_signature;
                const response = await this.fetch(record.callback_url, {
                    method: 'POST',
                    headers,
                    body: record.body_json,
                    timeoutMs: 10_000,
                });
                if (!response?.ok) {
                    throw new Error(`Callback returned HTTP ${response?.status || 'unknown'}`);
                }
                const completedAt = asDate(this.now()).toISOString();
                this.db.prepare(`
                    UPDATE tenant_api_callback_outbox
                    SET status = 'delivered', delivered_at = ?, locked_at = NULL,
                        response_status = ?, last_error = NULL, updated_at = ?
                    WHERE id = ? AND status = 'processing'
                `).run(completedAt, response.status || null, completedAt, record.id);
                return {
                    delivery_id: record.delivery_id,
                    status: 'delivered',
                    response_status: response.status || null,
                };
            } catch (error) {
                const failedAt = asDate(this.now());
                const terminal = Number(record.attempts) >= this.maxAttempts;
                const nextAttempt = new Date(
                    failedAt.getTime() + this.retryDelayMs(Number(record.attempts)),
                ).toISOString();
                const status = terminal ? 'dead_letter' : 'failed';
                this.db.prepare(`
                    UPDATE tenant_api_callback_outbox
                    SET status = ?, available_at = ?, locked_at = NULL,
                        response_status = NULL, last_error = ?, updated_at = ?
                    WHERE id = ? AND status = 'processing'
                `).run(
                    status,
                    nextAttempt,
                    String(error?.message || error).slice(0, 4000),
                    failedAt.toISOString(),
                    record.id,
                );
                return {
                    delivery_id: record.delivery_id,
                    status,
                    error: String(error?.message || error),
                };
            }
        };

        // Drain in fair rounds: at most one callback per tenant is in flight,
        // while different tenants can progress concurrently. A failed head
        // blocks that tenant for this dispatch so later events never overtake it.
        while (results.length < deliveryLimit) {
            const now = asDate(this.now());
            const excludedTenants = [...blockedTenants];
            const exclusion = excludedTenants.length > 0
                ? `AND tenant_id NOT IN (${excludedTenants.map(() => '?').join(', ')})`
                : '';
            const records = this.db.prepare(`
                WITH ranked AS (
                    SELECT id, tenant_id, status, available_at,
                        ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id ASC) AS tenant_rank
                    FROM tenant_api_callback_outbox
                    WHERE status IN ('pending', 'failed', 'processing')
                )
                SELECT id, tenant_id FROM ranked
                WHERE tenant_rank = 1
                  AND status IN ('pending', 'failed')
                  AND available_at <= ?
                  ${exclusion}
                ORDER BY id ASC
                LIMIT ?
            `).all(
                now.toISOString(),
                ...excludedTenants,
                deliveryLimit - results.length,
            );
            if (records.length === 0) break;

            const claimed = records.map(candidate => ({
                tenantId: candidate.tenant_id,
                record: this.claim(candidate.id, asDate(this.now())),
            })).filter(candidate => candidate.record);
            if (claimed.length === 0) break;

            for (let offset = 0; offset < claimed.length; offset += this.concurrency) {
                const batch = claimed.slice(offset, offset + this.concurrency);
                const delivered = await Promise.all(batch.map(async candidate => ({
                    tenantId: candidate.tenantId,
                    result: await deliver(candidate.record),
                })));
                for (const outcome of delivered) {
                    results.push(outcome.result);
                    if (outcome.result.status !== 'delivered') {
                        blockedTenants.add(outcome.tenantId);
                    }
                }
            }
        }
        return results;
    }
}

export default TenantCallbackOutbox;
