import { SmsApiRequestStore, smsApiRequestHash } from './smsApiRequests.js';
import { SmsGatewayError } from './smsGateway.js';

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const postAcceptanceError = error => {
    if (error?.deliveryUncertain) return error;
    const wrapped = new SmsGatewayError('SMS was accepted but local confirmation is incomplete; retry the same request',
        503, 'SMS_POST_ACCEPT_RECOVERY_REQUIRED');
    wrapped.deliveryUncertain = true; wrapped.cause = error;
    return wrapped;
};

// The public SMS API and collaborative adapter share this native command. The
// gateway account, request lease/history and billing retain their existing roles.
export const createNativeSmsMessageCommand = ({ database, service, billing,
    requestStore = new SmsApiRequestStore({ database }), callbackSender = () => undefined,
    logger = console }) => async ({ tenantId: rawTenantId, accountId: rawAccountId = null,
    recipient, message, idempotencyKey, maxCostCredits, retainUncertainBudget = false, beforeDispatch }) => {
    let reservation = null; let gatewayAccepted = false; let apiRequest = null; let gatewayAttempted = false;
    try {
        const tenantId = Number(rawTenantId);
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new SmsGatewayError('Invalid tenant context', 401, 'INVALID_TENANT_CONTEXT');
        const tenant = database.prepare('SELECT id, name, status FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) throw new SmsGatewayError('Tenant not found', 404, 'TENANT_NOT_FOUND');
        if (tenant.status === 'Suspended') throw new SmsGatewayError('Tenant account is suspended', 403, 'TENANT_SUSPENDED');
        const key = String(idempotencyKey || '').trim();
        if (!IDEMPOTENCY_PATTERN.test(key)) throw new SmsGatewayError('A valid Idempotency-Key header is required (8-128 characters)', 400, 'INVALID_IDEMPOTENCY_KEY');
        const accountId = rawAccountId == null || rawAccountId === '' ? null : Number(rawAccountId);
        if (accountId !== null && (!Number.isSafeInteger(accountId) || accountId <= 0)) throw new SmsGatewayError('sms_account_id is invalid', 422, 'SMS_ACCOUNT_INVALID');
        const requestHash = smsApiRequestHash({ smsAccountSelector: accountId, recipient, message });
        const previous = requestStore.inspect({ tenantId, idempotencyKey: key, requestHash });
        if (previous?.status === 'accepted') {
            if (!previous.response) throw new SmsGatewayError('تعذر استعادة نتيجة طلب SMS السابق', 500, 'SMS_REQUEST_RESULT_INVALID');
            return previous.response;
        }
        const resolvedAccountId = previous?.sms_account_id || service.requireActiveAccount(tenantId, accountId).id;
        const claim = requestStore.claim({ tenantId, idempotencyKey: key, smsAccountId: resolvedAccountId, requestHash });
        if (claim.mode === 'accepted') {
            if (!claim.response) throw new SmsGatewayError('تعذر استعادة نتيجة طلب SMS السابق', 500, 'SMS_REQUEST_RESULT_INVALID');
            return claim.response;
        }
        apiRequest = claim.request;
        const resolvedAccount = service.requireActiveAccount(tenantId, apiRequest.sms_account_id);
        reservation = claim.reservation;
        if (!reservation) {
            reservation = billing.reserve({ tenantId, operationKey: billing.operations.SMS_TEXT, quantity: 1,
                referenceType: 'api_sms_message', idempotencyKey: `billing:${tenantId}:api-sms:${key}:attempt:${apiRequest.attempt}`,
                metadata: { channel: 'sms', api_version: 'v1', sms_account_id: resolvedAccount.id,
                    api_request_id: apiRequest.id, attempt: apiRequest.attempt } });
            requestStore.attachBilling(apiRequest.id, reservation?.id);
        }
        if (maxCostCredits !== undefined && (!Number.isSafeInteger(reservation?.total_credits)
            || reservation.total_credits > maxCostCredits)) {
            throw new SmsGatewayError('Approved message budget exceeded', 409, 'APPROVED_BUDGET_EXCEEDED');
        }
        if (beforeDispatch && beforeDispatch() !== true) throw new SmsGatewayError('Native requirements changed', 409, 'NATIVE_RESOURCES_CHANGED');
        gatewayAttempted = true;
        const result = await service.send(tenantId, { accountId: resolvedAccount.id, recipient, message, idempotencyKey: key,
            ...(retainUncertainBudget ? { maxAttempts: 1 } : {}) });
        gatewayAccepted = true;
        billing.commit(reservation, { referenceId: result.message.message_id, description: 'خصم رسالة SMS عبر API' });
        const stored = service.storeMessage(result.account, result.message);
        try {
            await callbackSender(tenantId, 'sms_message_accepted', {
                message_id: stored.id, gateway_message_id: stored.gateway_message_id, sms_account_id: stored.sms_account_id,
                recipient: stored.recipient, status: stored.status,
            }, { dedupeKey: `sms-api-accepted:${tenantId}:${key}` });
        } catch (error) { logger.error('[ApiV1Sms] Callback failed:', error); }
        try {
            database.prepare(`INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'api_sms_sent', ?, 'success')`).run(tenantId, tenant.name || 'Unknown', `SMS API message ${stored.id} accepted`);
        } catch (error) { logger.error('[ApiV1Sms] Activity log failed:', error); }
        const response = { success: true, data: {
            message_id: stored.id, gateway_message_id: stored.gateway_message_id, external_id: stored.external_id,
            sms_account_id: stored.sms_account_id, sms_account_name: stored.sms_account_name,
            recipient: stored.recipient, status: stored.status,
        } };
        requestStore.accept(apiRequest.id, response);
        return response;
    } catch (error) {
        const responseError = gatewayAccepted ? postAcceptanceError(error) : error;
        if (!gatewayAttempted) responseError.dispatched = false;
        else if (!gatewayAccepted && responseError instanceof SmsGatewayError
            && responseError.status >= 400 && responseError.status < 500 && !responseError.deliveryUncertain) {
            responseError.confirmedFailure = true;
        }
        if (retainUncertainBudget && gatewayAttempted && !responseError.confirmedFailure && responseError.dispatched !== false) {
            responseError.deliveryUncertain = true;
        }
        if (reservation && !gatewayAccepted && reservation.status !== 'committed' && !responseError.deliveryUncertain) {
            try { billing.release(reservation, responseError.message); }
            catch (releaseError) { logger.error('[ApiV1Sms] Billing release failed:', releaseError); }
        }
        if (apiRequest) {
            try { requestStore.fail(apiRequest.id, responseError); }
            catch (stateError) { logger.error('[ApiV1Sms] Request state update failed:', stateError); }
        }
        throw responseError;
    }
};
