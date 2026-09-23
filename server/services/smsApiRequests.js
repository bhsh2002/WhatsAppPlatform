import crypto from 'node:crypto';

import { SmsGatewayError } from './smsGateway.js';

const LEASE_MILLISECONDS = 120_000;

const parseJson = (value, fallback = null) => {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
};

const canonicalRequest = ({ smsAccountSelector, recipient, message }) => JSON.stringify({
    sms_account_id: smsAccountSelector == null ? null : Number(smsAccountSelector),
    recipient: String(recipient ?? '').trim().replace(/[\s()-]/g, '').replace(/^\+/, ''),
    message: String(message ?? '').trim(),
});

export const smsApiRequestHash = input => crypto.createHash('sha256')
    .update(canonicalRequest(input))
    .digest('hex');

export class SmsApiRequestStore {
    constructor({ database, now = () => Date.now(), leaseMilliseconds = LEASE_MILLISECONDS } = {}) {
        if (!database) throw new TypeError('SmsApiRequestStore requires database');
        this.db = database;
        this.now = now;
        this.leaseMilliseconds = Math.max(30_000, Number(leaseMilliseconds) || LEASE_MILLISECONDS);
    }

    billingUsage(id) {
        if (!id) return null;
        return this.db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(id) || null;
    }

    billingUsageForAttempt(tenantId, idempotencyKey, attempt) {
        return this.db.prepare(`
            SELECT * FROM billing_usage_events
            WHERE tenant_id = ? AND idempotency_key = ?
        `).get(
            tenantId,
            `billing:${tenantId}:api-sms:${idempotencyKey}:attempt:${attempt}`,
        ) || null;
    }

    inspect({ tenantId, idempotencyKey, requestHash }) {
        const existing = this.db.prepare(`
            SELECT * FROM sms_api_requests
            WHERE tenant_id = ? AND idempotency_key = ?
        `).get(tenantId, idempotencyKey) || null;
        if (!existing) return null;
        if (existing.request_hash !== requestHash) {
            throw new SmsGatewayError(
                'أعيد استخدام Idempotency-Key لطلب SMS مختلف',
                409,
                'SMS_IDEMPOTENCY_CONFLICT',
            );
        }
        return {
            ...existing,
            response: existing.status === 'accepted'
                ? parseJson(existing.response_json, null)
                : null,
        };
    }

    claim({ tenantId, idempotencyKey, requestHash, smsAccountId }) {
        const now = new Date(this.now()).toISOString();
        const leaseExpiresAt = new Date(this.now() + this.leaseMilliseconds).toISOString();
        const transaction = this.db.transaction(() => {
            const existing = this.db.prepare(`
                SELECT * FROM sms_api_requests
                WHERE tenant_id = ? AND idempotency_key = ?
            `).get(tenantId, idempotencyKey);
            if (!existing) {
                const inserted = this.db.prepare(`
                    INSERT INTO sms_api_requests (
                        tenant_id, idempotency_key, request_hash, sms_account_id,
                        status, attempt, lease_expires_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'processing', 1, ?, ?)
                `).run(
                    tenantId,
                    idempotencyKey,
                    requestHash,
                    smsAccountId,
                    leaseExpiresAt,
                    now,
                );
                return {
                    mode: 'claimed',
                    request: this.db.prepare('SELECT * FROM sms_api_requests WHERE id = ?')
                        .get(inserted.lastInsertRowid),
                    reservation: null,
                };
            }
            if (existing.request_hash !== requestHash) {
                throw new SmsGatewayError(
                    'أعيد استخدام Idempotency-Key لطلب SMS مختلف',
                    409,
                    'SMS_IDEMPOTENCY_CONFLICT',
                );
            }
            if (existing.status === 'accepted') {
                return {
                    mode: 'accepted',
                    response: parseJson(existing.response_json, null),
                };
            }
            if (existing.status === 'processing'
                && Date.parse(existing.lease_expires_at) > this.now()) {
                throw new SmsGatewayError(
                    'طلب SMS بهذا المفتاح قيد التنفيذ',
                    409,
                    'SMS_REQUEST_IN_PROGRESS',
                );
            }

            const previousUsage = this.billingUsage(existing.billing_usage_id)
                || this.billingUsageForAttempt(tenantId, idempotencyKey, existing.attempt);
            const reusableUsage = previousUsage
                && ['reserved', 'committed'].includes(previousUsage.status)
                ? previousUsage
                : null;
            const attempt = reusableUsage ? existing.attempt : existing.attempt + 1;
            this.db.prepare(`
                UPDATE sms_api_requests
                SET status = 'processing', attempt = ?, billing_usage_id = ?,
                    response_json = NULL, last_error_code = NULL,
                    lease_expires_at = ?, updated_at = ?
                WHERE id = ?
            `).run(attempt, reusableUsage?.id || null, leaseExpiresAt, now, existing.id);
            return {
                mode: 'claimed',
                request: this.db.prepare('SELECT * FROM sms_api_requests WHERE id = ?')
                    .get(existing.id),
                reservation: reusableUsage,
            };
        });
        return transaction.immediate();
    }

    attachBilling(requestId, billingUsageId) {
        if (!billingUsageId) return;
        const result = this.db.prepare(`
            UPDATE sms_api_requests
            SET billing_usage_id = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'
        `).run(billingUsageId, new Date(this.now()).toISOString(), requestId);
        if (result.changes !== 1) {
            throw new SmsGatewayError(
                'تعذر تثبيت حجز فوترة طلب SMS',
                409,
                'SMS_REQUEST_STATE_CONFLICT',
            );
        }
    }

    accept(requestId, response) {
        const result = this.db.prepare(`
            UPDATE sms_api_requests
            SET status = 'accepted', response_json = ?, last_error_code = NULL,
                lease_expires_at = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'
        `).run(
            JSON.stringify(response),
            new Date(this.now()).toISOString(),
            new Date(this.now()).toISOString(),
            requestId,
        );
        if (result.changes !== 1) {
            throw new SmsGatewayError(
                'تعذر حفظ نتيجة طلب SMS',
                409,
                'SMS_REQUEST_STATE_CONFLICT',
            );
        }
    }

    acceptReconciled(requestId, response) {
        this.db.prepare(`
            UPDATE sms_api_requests
            SET status = 'accepted', response_json = ?, last_error_code = NULL,
                lease_expires_at = ?, updated_at = ?
            WHERE id = ? AND status != 'accepted'
        `).run(
            JSON.stringify(response),
            new Date(this.now()).toISOString(),
            new Date(this.now()).toISOString(),
            requestId,
        );
    }

    fail(requestId, error) {
        this.db.prepare(`
            UPDATE sms_api_requests
            SET status = 'failed', last_error_code = ?, lease_expires_at = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'
        `).run(
            String(error?.code || 'SMS_REQUEST_FAILED').slice(0, 120),
            new Date(this.now()).toISOString(),
            new Date(this.now()).toISOString(),
            requestId,
        );
    }
}

const acceptedResponse = message => ({
    success: true,
    data: {
        message_id: message.id,
        gateway_message_id: message.gateway_message_id,
        external_id: message.external_id,
        sms_account_id: message.sms_account_id,
        sms_account_name: message.sms_account_name,
        recipient: message.recipient,
        status: message.status,
    },
});

export const smsCallbackDedupeKey = (event, message) => [
    'sms-event',
    message.sms_account_id,
    message.gateway_message_id,
    event,
    message.status,
].join(':');

// Gateway message identifiers are unique only inside one SMS account. Include
// the account in browser-notification sources so two accounts owned by the
// same tenant can never collapse each other's outbox event.
export const smsBrowserNotificationSource = (message, accountId = null) => [
    'sms-account',
    message?.sms_account_id ?? accountId,
    'message',
    message?.gateway_message_id || message?.id,
].join(':');

export const reconcileSmsMessageBilling = ({
    database,
    billing,
    requestStore,
    message,
}) => {
    const externalId = String(message?.external_id || '').trim();
    if (!externalId) return { reconciled: false, reason: 'no_external_id' };
    const request = database.prepare(`
        SELECT * FROM sms_api_requests
        WHERE tenant_id = ? AND sms_account_id = ? AND idempotency_key = ?
        LIMIT 1
    `).get(message.tenant_id, message.sms_account_id, externalId);
    if (request) {
        const usage = requestStore.billingUsage(request.billing_usage_id)
            || requestStore.billingUsageForAttempt(
                request.tenant_id,
                request.idempotency_key,
                request.attempt,
            );
        if (usage?.status === 'released' || usage?.status === 'failed') {
            return { reconciled: false, reason: 'billing_already_released', request_id: request.id };
        }
        if (usage) {
            billing.commit(usage, {
                referenceId: message.gateway_message_id,
                description: 'خصم رسالة SMS تمت مطابقتها من سجل البوابة',
            });
        }
        requestStore.acceptReconciled(request.id, acceptedResponse(message));
        return { reconciled: true, request_id: request.id, billing_usage_id: usage?.id || null };
    }

    const usage = database.prepare(`
        SELECT * FROM billing_usage_events
        WHERE tenant_id = ? AND idempotency_key = ?
          AND reference_type = 'sms_message'
        LIMIT 1
    `).get(message.tenant_id, `billing:${message.tenant_id}:${externalId}`);
    if (!usage || ['released', 'failed'].includes(usage.status)) {
        return { reconciled: false, reason: usage ? 'billing_already_released' : 'no_billing_usage' };
    }
    billing.commit(usage, {
        referenceId: message.gateway_message_id,
        description: 'خصم رسالة SMS تمت مطابقتها من سجل البوابة',
    });
    return { reconciled: true, billing_usage_id: usage.id };
};

export const createSmsHistoryMessageHandler = ({
    reconcileMessage,
    presentMessage,
    broadcast,
    emitConversationUpdate,
    emitBrowserMessage = () => undefined,
    emitBrowserAlert = () => undefined,
    callbackSender,
    callbackDedupeKey = smsCallbackDedupeKey,
}) => async ({ account, message, phase, changed }) => {
    reconcileMessage(message);
    if (phase !== 'incremental') return;

    const tenantMessage = presentMessage(message, { account });
    const event = message.direction === 'incoming'
        ? 'sms_message_received'
        : 'sms_message_status_changed';
    if (changed) {
        broadcast(
            `tenant:${message.tenant_id}`,
            message.direction === 'incoming' ? 'sms_message:new' : 'sms_message:status',
            tenantMessage,
        );
        broadcast(
            'admin',
            message.direction === 'incoming' ? 'sms_message:new' : 'sms_message:status',
            message,
        );
        if (message.direction === 'incoming') {
            emitConversationUpdate(message.tenant_id);
        }
    }

    // The push outbox uses a stable source-based dedupe key. Re-enqueue on an
    // unchanged incremental replay to repair a crash between SMS storage and
    // the original projection without repeating SSE or conversation updates.
    if (message.direction === 'incoming') {
        emitBrowserMessage({
            tenantId: message.tenant_id,
            channel: 'sms',
            sourceId: smsBrowserNotificationSource(message, account?.id),
        });
    } else if (['failed', 'rejected', 'canceled', 'cancelled'].includes(
        String(message.status || '').toLowerCase()
    )) {
        emitBrowserAlert({
            tenantId: message.tenant_id,
            code: 'SMS_MESSAGE_FAILED',
            sourceId: smsBrowserNotificationSource(message, account?.id),
            severity: 'warning',
        });
    }

    // Storage is committed before this handler runs. Re-enqueue even when a
    // replay is unchanged so a crash between storage and enqueue cannot lose
    // the tenant callback; the stable producer key makes this idempotent.
    await callbackSender(message.tenant_id, event, tenantMessage, {
        dedupeKey: callbackDedupeKey(event, message),
    });
};

export const reconcileSmsUssdBilling = ({ database, billing, request }) => {
    const externalId = String(request?.idempotency_key || '').trim();
    if (!externalId) return { reconciled: false, reason: 'no_external_id' };
    const usage = database.prepare(`
        SELECT * FROM billing_usage_events
        WHERE tenant_id = ? AND idempotency_key = ?
          AND reference_type = 'sms_ussd'
        LIMIT 1
    `).get(
        request.tenant_id,
        `billing:${request.tenant_id}:sms-ussd:${request.sms_account_id}:${externalId}`,
    );
    if (!usage || ['released', 'failed'].includes(usage.status)) {
        return { reconciled: false, reason: usage ? 'billing_already_released' : 'no_billing_usage' };
    }
    billing.commit(usage, {
        referenceId: request.gateway_ussd_id,
        description: 'خصم طلب USSD تمت مطابقته من استجابة البوابة',
    });
    return { reconciled: true, billing_usage_id: usage.id };
};
