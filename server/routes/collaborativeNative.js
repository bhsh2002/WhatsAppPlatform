import express from 'express';
import multer from 'multer';
import {MAX_FILE_SIZE} from '../config/index.js';
import { localReadPrincipal,SharedProductReadError } from '../services/centralProductRead.js';
import { CollaborativeExecutionError } from '../services/collaborativeExecution.js';
import { NativeCommandProtocolError } from '../services/nativeCommandProtocol.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
const ownerMessages=Object.freeze({
    workspace_native_permission_required:'لا تملك الصلاحية الحالية لهذا الإجراء. اطلب من مالك النشاط مراجعة صلاحياتك.',
    workspace_native_grant_selection_required:'يلزم أن يحدد مالك النشاط صلاحيات متوافقة لهذا الإجراء.',
    workspace_choice_changed:'تغيرت حالة الاختيارات الحالية. حدّث الاختيارات قبل المتابعة.',
});
export const createCollaborativeNativeRouter = ({ service, businessService = null,mediaService=null, appOrigin }) => {
    if (!service || typeof appOrigin !== 'string' || new URL(appOrigin).origin !== appOrigin) throw new TypeError('Native owner API requires explicit app origin');
    const router = express.Router();
    router.use('/collaborative', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const intent = (req, res, next) => req.get('X-Savana-Owner-Intent') === 'connections-data-v1'
        && (!req.get('Origin') || req.get('Origin') === appOrigin) ? next()
        : res.status(403).json({ error: { code: 'native_owner_intent_required', message: 'يلزم إجراء صريح من صفحة الربط الحالية.' }, clear_previous: true });
    const query = (req, keys) => {
        if (!exact(req.query, keys) || Object.values(req.query).some(value => typeof value !== 'string' || value.length > 16384)) throw new NativeCommandProtocolError('native_owner_input_invalid', 422);
        return req.query;
    };
    const body = (req, keys) => {
        if (Object.keys(req.query).length || !exact(req.body, keys)) throw new NativeCommandProtocolError('native_owner_input_invalid', 422);
        return req.body;
    };
    const call = callback => async (req, res) => {
        try { return res.json(await callback(localReadPrincipal(req.user), req)); }
        catch (error) {
            const known = error instanceof CollaborativeExecutionError || error instanceof NativeCommandProtocolError || error instanceof SharedProductReadError;
            const message=known&&Object.hasOwn(ownerMessages,error.code)?ownerMessages[error.code]:'تعذر تأكيد المتطلبات الحالية. حدّث الاختيارات قبل المتابعة.';
            return res.status(known ? error.status : 503).json({ error: { code: known ? error.code : 'native_owner_unavailable',
                message }, clear_previous: true });
        }
    };
    router.get('/collaborative/options', call((principal, req) => service.options(principal, query(req,
        ['activity_ref','capability', 'channel', 'account_ref', 'recipient_q', 'recipient_cursor']))));
    router.post('/collaborative/preview', intent, call((principal, req) => service.preview(principal, body(req, ['activity_ref', 'capability', 'action', 'parameters']))));
    router.get('/collaborative/consents', call((principal, req) => service.listConsents(principal, query(req, ['activity_ref', 'channel', 'account_ref', 'recipient_ref', 'purpose']))));
    router.get('/collaborative/consents/lookup',call((principal,req)=>service.lookupConsent(principal,query(req,['activity_ref','channel','account_ref','recipient_ref','purpose','idempotency_key']))));
    router.post('/collaborative/consents', intent, call((principal, req) => service.recordConsent(principal, body(req,
        ['activity_ref', 'channel', 'account_ref', 'recipient_ref', 'purpose', 'evidence', 'valid_until', 'idempotency_key']))));
    router.post('/collaborative/consents/:ref/revoke', intent, call((principal, req) => service.revokeConsent(principal, req.params.ref,
        body(req, ['activity_ref', 'expected_version']))));
    if(businessService) {
        router.get('/collaborative/business/options',call((principal,req)=>businessService.options(principal,query(req,['activity_ref','capability','contact_q','contact_cursor','operation_cursor']))));
        router.post('/collaborative/business/preview',intent,call((principal,req)=>businessService.preview(principal,body(req,['activity_ref','capability','action','parameters']))));
    }
    if(mediaService){
        router.get('/collaborative/media/assets/lookup',call((principal,req)=>mediaService.lookupStage(principal,query(req,['activity_ref','idempotency_key']))));
        router.get('/collaborative/media/options',call((principal,req)=>mediaService.options(principal,query(req,['activity_ref','account_ref']))));
        router.post('/collaborative/media/preview',intent,call((principal,req)=>mediaService.preview(principal,body(req,['activity_ref','capability','action','parameters']))));
        const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_FILE_SIZE,files:1,fields:10}}).single('file');
        router.post('/collaborative/media/assets',intent,(req,res,next)=>upload(req,res,error=>error
            ?res.status(413).json({error:{code:'native_media_upload_invalid',message:'تعذر قبول الملف المحدد. راجع نوع الملف وحجمه.'},clear_previous:true}):next()),
            call((principal,req)=>mediaService.stage(principal,body(req,['activity_ref','channel','account_ref','purpose','evidence_reference','rights_note','rights_recorded_at','rights_valid_until','idempotency_key']),req.file)));
    }
    return router;
};
