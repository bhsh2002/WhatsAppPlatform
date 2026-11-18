import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import express from 'express';
import {createCollaborativeNativeRouter} from '../routes/collaborativeNative.js';
import {SharedProductReadError} from '../services/centralProductRead.js';

// HTTP error-boundary fixtures only: source services and native/Core grants are
// exercised separately. No provider, database, login or acceptance is invented.
const fixture=async t=>{
    let failure;const calls=[];
    const service=Object.fromEntries(['options','preview'].map(method=>[method,async(principal,input)=>{
        calls.push({method,principal,input});throw failure;
    }]));
    const app=express();app.use(express.json());app.use((req,_res,next)=>{
        req.user={id:8,tenant_id:4,jti:'synthetic-native-session',auth_version:2,role:'tenant',exp:2_000_000_000};next();
    });
    app.use('/api/portal/integrations',createCollaborativeNativeRouter({service,businessService:service,mediaService:service,appOrigin:'https://wa.invalid'}));
    const server=app.listen(0,'127.0.0.1');await once(server,'listening');
    t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
    const base=`http://127.0.0.1:${server.address().port}/api/portal/integrations/collaborative`;
    const post=(path,body)=>fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json',
        'X-Savana-Owner-Intent':'connections-data-v1',Origin:'https://wa.invalid'},body:JSON.stringify(body)});
    return {base,post,calls,fail:error=>{failure=error;}};
};

test('actual known workspace permission denial remains403 across native, business and media owner HTTP options',async t=>{
    const f=await fixture(t);const error=new SharedProductReadError('workspace_native_permission_required',403);
    error.message='synthetic-private-cookie-and-request-body';error.cause={private:'synthetic-internal-cause'};f.fail(error);
    for(const path of ['/options?activity_ref=opaque&capability=messaging.send','/business/options?activity_ref=opaque&capability=customers.manage','/media/options?activity_ref=opaque']){
        const response=await fetch(f.base+path);assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');
        const body=await response.json();assert.equal(body.error.code,'workspace_native_permission_required');assert.equal(body.clear_previous,true);
        assert.match(body.error.message,/الصلاحية الحالية/);assert.doesNotMatch(JSON.stringify(body),/private-cookie|request-body|internal-cause|stack|cause/);
    }
    assert.equal(f.calls.length,3);assert.equal(f.calls[0].principal.tenantId,4);
});

test('changed opaque workspace context preserves known409 and clears previous preview without exposing internal context',async t=>{
    const f=await fixture(t);const error=new SharedProductReadError('workspace_choice_changed',409);error.message='synthetic-private-identity-context';f.fail(error);
    for(const path of ['/preview','/business/preview','/media/preview']){
        const response=await f.post(path,{activity_ref:'changed-opaque-context',capability:'media.manage',action:'media.asset.upload',parameters:{}});
        assert.equal(response.status,409);const body=await response.json();assert.equal(body.error.code,'workspace_choice_changed');
        assert.equal(body.clear_previous,true);assert.match(body.error.message,/تغيرت/);assert.doesNotMatch(JSON.stringify(body),/private-identity|stack/);
    }
});

test('unexpected exceptions cannot spoof a permission response or expose provider credentials and internal payloads',async t=>{
    const f=await fixture(t);f.fail(Object.assign(new Error('synthetic-private-token-cookie-SQL-payload'),{
        code:'workspace_native_permission_required',status:403,request:{authorization:'synthetic-private-authorization'},cause:new Error('synthetic-private-cause')}));
    const response=await fetch(`${f.base}/media/options?activity_ref=opaque`);assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:{code:'native_owner_unavailable',message:'تعذر تأكيد المتطلبات الحالية. حدّث الاختيارات قبل المتابعة.'},clear_previous:true});
});
