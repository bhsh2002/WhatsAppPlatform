import { SharedProductReadError } from './centralProductRead.js';

const fail = () => { throw new SharedProductReadError('workspace_context_changed', 403); };
const rejectionStatuses = new Set([401, 403, 404, 409, 422, 423, 428, 429]);
const sameIdentity = (context, identity) => context.actorId === identity.actorId
    && context.organizationId === identity.organizationId && context.nativeAccountId === identity.nativeAccountId
    && (context.coreAccountId ?? context.identity?.coreAccountId ?? null) === (identity.coreAccountId ?? null)
    && context.identityGeneration === identity.generation;

// A planner is a source-owned Core protocol adapter, never a browser route or
// caller-provided URL. It validates the actual operation and result schemas.
export class WorkspaceMutations {
    constructor({ choices, transport, intents, planners }) {
        if (typeof choices?.resolveReview !== 'function' || typeof transport?.currentIdentity !== 'function'
            || typeof transport.request !== 'function' || typeof intents?.prepare !== 'function'
            || typeof intents.finish !== 'function' || !planners || typeof planners !== 'object'
            || !Object.keys(planners).length || Object.entries(planners).some(([operation, planner]) =>
                !/^[a-z][a-z0-9_.]{0,99}$/.test(operation) || typeof planner?.request !== 'function'
                || typeof planner?.result !== 'function' || (planner.includeConsumer !== undefined && typeof planner.includeConsumer !== 'boolean')
                || (planner.dispatch !== undefined && typeof planner.dispatch !== 'function')
                || (planner.rejected !== undefined && typeof planner.rejected !== 'function'))) throw new TypeError('Workspace mutations require verified protocol planners and durable intents');
        this.choices = choices; this.transport = transport; this.intents = intents; this.planners = Object.freeze({ ...planners });
    }
    async submit(principal, { review }) {
        const operations = Object.keys(this.planners);
        const reviewed = await this.choices.resolveReview(principal, review, operations);
        const planner = this.planners[reviewed.operation];
        const request = await planner.request({ principal, ...reviewed });
        // Planning may await source/version facts. Resolve the unchanged review
        // again before the atomic claim; any policy change requires new review.
        const current = await this.choices.resolveReview(principal, review, operations);
        if (current.payloadHash !== reviewed.payloadHash || current.idempotencyKey !== reviewed.idempotencyKey) fail();
        const identityOptions = ['binding', 'activity'].includes(current.operation) ? { allowUnbound: true } : undefined;
        const identity = await this.transport.currentIdentity(principal, identityOptions);
        if (!sameIdentity(current.context, identity)) fail();
        const prepared = this.intents.prepare(principal, identity, { operation: current.operation,
            idempotencyKey: current.idempotencyKey, inputHash: current.payloadHash, request, reviewExpiresAt: current.expiresAt });
        if (!prepared.dispatch) return { intent: prepared.intent, result: null };
        const claimedRequest = { method: prepared.dispatch.method, path: prepared.dispatch.path,
            ...(prepared.dispatch.body === undefined ? {} : { body: prepared.dispatch.body }) };
        let result, sendInvoked = false;
        try {
            const send = () => {
                if (sendInvoked) fail();
                sendInvoked = true;
                return this.transport.request(principal, { ...claimedRequest, expectedIdentity: identity, notAfter: current.expiresAt,
                    consumerInstallation: planner.includeConsumer === false ? null : current.context.consumerInstallationId ?? null });
            };
            const response = planner.dispatch ? await planner.dispatch({ principal, reviewed: current, request: claimedRequest, send }) : await send();
            result = await planner.result({ principal, reviewed: current, request: claimedRequest, response: response.payload });
            // Result validation may also await current evidence. A changed
            // session cannot leave an approval/result visible in the old view.
            const latest = await this.transport.currentIdentity(principal, identityOptions);
            if (JSON.stringify(latest) !== JSON.stringify(identity)) fail();
        } catch (error) {
            let definitive = false;
            if (error instanceof SharedProductReadError && error.code === 'workspace_rejected'
                && rejectionStatuses.has(error.status) && planner.rejected) {
                try { definitive = await planner.rejected({ error, reviewed: current, request: claimedRequest }) === true; }
                catch { /* An unverified rejection remains an unknown outcome. */ }
            }
            const notDispatched = (planner.dispatch && !sendInvoked)
                || (error instanceof SharedProductReadError && error.requestDispatched === false);
            const localReason = ['workspace_review_expired', 'workspace_request_invalid', 'workspace_configuration_required'].includes(error?.code)
                ? error.code : 'workspace_context_changed';
            this.intents.finish(principal, identity, prepared.intent.id, { state: definitive || notDispatched ? 'failed' : 'unknown',
                errorCode: notDispatched ? localReason : definitive ? 'workspace_rejected' : 'workspace_outcome_unknown',
                remoteStatus: definitive ? error.status : null, ...(notDispatched ? { definitiveNoEffect: true, dispatchAttempted: false } : {}) });
            throw error;
        }
        return this.intents.finish(principal, identity, prepared.intent.id, { state: 'completed', result });
    }
}
