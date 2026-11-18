import express from 'express';
import { NativeCommandProtocolError } from '../services/nativeCommandProtocol.js';
import { validateNativeCommandModel } from '../services/nativeCommandModels.js';
import { CollaborativeExecutionError } from '../services/collaborativeExecution.js';

const invalid = () => { throw new NativeCommandProtocolError('native_command_request_invalid', 422); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
const scalarKeys = ['organization_id', 'activity_id', 'branch_id', 'warehouse_id', 'actor_id', 'external_tenant_id',
    'session_version', 'grant_approved_by', 'native_authority_revision', 'capability_grant_revision',
    'authorization_revision', 'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs',
    'namespace_installation_id', 'namespace_epoch', 'namespace_version','authority_domain','ownership_epoch'];
// Enrollment/discovery retain their existing authenticated owner context;
// only command validation has the new closed NativeValidationContext DTO.
const ownerKeys = scalarKeys;
const resultKeys = ['organization_id', 'activity_id', 'external_tenant_id', 'actor_id', 'grant_approved_by',
    'native_authority_revision', 'capability_grant_revision', 'authorization_revision', 'allowed_fields',
    'resource_policy', 'resource_refs', 'authority_domain', 'ownership_epoch',
    'namespace_installation_id', 'namespace_epoch', 'namespace_version'];
const queryContext = (query, selectors = [], keys = scalarKeys) => {
    if (!exact(query, [...keys, ...selectors]) || Object.values(query).some(value =>
        typeof value !== 'string' || value.length > 65536)) invalid();
    const context = {};
    for (const key of keys) if (Object.hasOwn(query, key)) {
        if (['allowed_fields', 'resource_refs', 'scope_epochs'].includes(key)) {
            try { context[key] = JSON.parse(query[key]); } catch { invalid(); }
            if (!Array.isArray(context[key])) invalid();
        } else if (['session_version', 'capability_grant_revision', 'namespace_epoch', 'namespace_version','ownership_epoch'].includes(key)) {
            if (!/^[1-9][0-9]*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key]))) invalid();
            context[key] = Number(query[key]);
        } else context[key] = query[key];
    }
    return context;
};

// Mount outside local-JWT middleware: every exact byte is authenticated with
// Core's callback key and a durable nonce before any native handler is invoked.
export const createNativeCommandAdapterRouter = ({ protocol, service, discovery, enrollments, products,
    executeCommand = (command, context) => service.execute(command, context),
    reconcileCommand = (command, context) => service.reconcile(command, context),
    validateCommand = (proposal, context) => service.validate(proposal, context),
    getResult = (commandId, context, options) => service.result(commandId, context, options) }) => {
    if (typeof protocol?.authenticate !== 'function' || typeof protocol?.response !== 'function') {
        throw new TypeError('Native adapter requires exact-byte authenticated protocol');
    }
    const router = express.Router();
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const route = (handler, model) => async (req, res) => {
        let verified;
        try {
            const raw = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
            if (req.method !== 'GET' && !Buffer.isBuffer(req.rawBody) && !Buffer.isBuffer(req.body)) invalid();
            if (req.method === 'GET' && raw.length) invalid();
            verified = protocol.authenticate({ method: req.method, pathAndQuery: req.originalUrl, headers: req.headers, body: raw });
            req.rawBody = raw;
            const value = await handler(req);
            if (model) validateNativeCommandModel(model, value);
            const signed = protocol.response(verified, 200, value);
            res.set('Content-Type', 'application/json; charset=utf-8');
            res.set('X-Savana-Command-Timestamp', signed.timestamp);
            res.set('X-Savana-Command-Nonce', signed.nonce);
            res.set('X-Savana-Command-Signature', signed.signature);
            return res.status(200).send(signed.body);
        } catch (error) {
            const known = error instanceof NativeCommandProtocolError || error instanceof CollaborativeExecutionError;
            const status = known ? error.status : 503;
            const value = { error: { code: known ? error.code : 'native_command_unavailable' } };
            if (!verified) return res.status(status).json(value);
            const signed = protocol.response(verified, status, value);
            return res.status(status).set('Content-Type', 'application/json; charset=utf-8')
                .set('X-Savana-Command-Timestamp', signed.timestamp).set('X-Savana-Command-Nonce', signed.nonce)
                .set('X-Savana-Command-Signature', signed.signature).send(signed.body);
        }
    };
    const readJson = req => {
        if (Object.keys(req.query).length) invalid();
        let body;
        try { body = JSON.parse(req.rawBody.toString('utf8')); } catch { invalid(); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || !exact(body.context, scalarKeys)) invalid();
        return body;
    };
    const call = (fn, ...args) => {
        if (typeof fn !== 'function') throw new NativeCommandProtocolError('native_command_unavailable', 503);
        return fn(...args);
    };
    router.get('/discovery', route(req => call(discovery, queryContext(req.query)), 'AdapterDiscovery'));
    router.get('/enrollments', route(req => call(enrollments?.read, queryContext(req.query, [], ownerKeys)), 'AdapterEnrollments'));
    router.post('/enrollments', route(req => {
        const body = readJson(req);
        if (!exact(body, ['context']) || !exact(body.context, ownerKeys)) invalid();
        return call(enrollments?.enroll, body.context);
    }, 'AdapterEnrollment'));
    router.get('/products', route(req => call(products, queryContext(req.query, ['q', 'cursor']),
        { q: req.query.q, cursor: req.query.cursor }), 'AdapterProducts'));
    router.post('/commands/validate', route(req => {
        const body = readJson(req); if (!exact(body, ['capability', 'action', 'payload', 'context'])) invalid();
        const { context, ...proposal } = body;
        validateNativeCommandModel('NativeValidationContext', context);
        return validateCommand(proposal, context);
    }, 'AdapterValidation'));
    router.post('/commands', route(req => {
        const { context, ...command } = readJson(req); validateNativeCommandModel('AdapterCommand', command);
        return executeCommand(command, context);
    }, 'AdapterReceipt'));
    router.post('/commands/:commandId/reconcile', route(req => {
        const { context, ...command } = readJson(req); validateNativeCommandModel('AdapterCommand', command);
        if (command.command_id !== req.params.commandId) invalid();
        return reconcileCommand(command, context);
    }, 'AdapterReceipt'));
    router.get('/commands/:commandId/result', route(req => getResult(req.params.commandId,
        queryContext(req.query, ['version', 'fingerprint', 'provider_ref', 'format'], resultKeys), {
            format: req.query.format || 'json', version: req.query.version,
            fingerprint: req.query.fingerprint, providerRef: req.query.provider_ref,
        }), 'NativeResult'));
    return router;
};
