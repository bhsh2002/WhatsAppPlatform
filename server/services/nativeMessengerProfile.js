import {META_API_BASE} from '../config/index.js';
import {fetchMetaWithAccessToken} from './metaAuthorizedFetch.js';
import {readMetaResponse} from './metaHttp.js';

const MAX_PROFILE_BYTES=65_536;
const snapshot=row=>row?JSON.stringify([row.id,row.tenant_id,row.user_psid,row.linked_page_id,row.page_id,row.page_access_token_encrypted,row.is_active,row.tenant_status]):null;
// This is the ordinary native profile GET. Its fixed transport is supplied by
// the server assembly, never by a webhook/header/browser request.
export const createNativeMessengerProfileReader=({database,fetchImpl=globalThis.fetch,apiBase=META_API_BASE,allowLoopback=false})=>{
    if(!database||typeof fetchImpl!=='function')throw new TypeError('Native profile reader requires owned DB and transport');
    const base=new URL(apiBase);const loopback=allowLoopback===true&&base.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(base.hostname);
    if(!(base.protocol==='https:'||loopback)||base.username||base.password||base.search||base.hash)throw new TypeError('Native profile base must be a fixed trusted server URL');
    const load=({conversationId,tenantId,senderId})=>database.prepare(`SELECT c.id,c.tenant_id,c.user_psid,c.linked_page_id,p.page_id,
        p.page_access_token_encrypted,p.is_active,t.status tenant_status FROM fb_conversations c
        JOIN tenant_pages p ON p.id=c.linked_page_id AND p.tenant_id=c.tenant_id JOIN tenants t ON t.id=c.tenant_id
        WHERE c.id=? AND c.tenant_id=? AND c.user_psid=?`).get(conversationId,tenantId,senderId);
    const picture=value=>{
        if(typeof value!=='string'||value.length>2048)return null;
        try{const url=new URL(value);return !url.username&&!url.password
            &&(url.protocol==='https:'||(loopback&&url.origin===base.origin))
            &&![...url.searchParams.keys()].some(key=>/access.?token|authorization|password|secret/i.test(key))?url.href:null;}catch{return null;}
    };
    return async input=>{
        try{
            if(!Number.isSafeInteger(input.conversationId)||!Number.isSafeInteger(input.tenantId)||typeof input.senderId!=='string'
                ||!input.senderId||input.senderId.length>255||typeof input.pageToken!=='string'||!input.pageToken)return {updated:false};
            const before=load(input);if(!before||before.is_active!==1||!['Active','Warning'].includes(before.tenant_status))return {updated:false};
            const response=await fetchMetaWithAccessToken(`${base.href.replace(/\/+$/,'')}/${encodeURIComponent(input.senderId)}?fields=name,profile_pic`,input.pageToken,
                {method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)},fetchImpl);
            if(!response.ok||Number(response.headers.get('content-length'))>MAX_PROFILE_BYTES){await response.body?.cancel();return {updated:false};}
            const reader=response.body?.getReader();if(!reader)return {updated:false};let size=0;const chunks=[];
            try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
                if(size>MAX_PROFILE_BYTES){await reader.cancel();return {updated:false};}chunks.push(Buffer.from(next.value));}}finally{reader.releaseLock();}
            const result=await readMetaResponse(new Response(Buffer.concat(chunks),{status:response.status,headers:{'content-type':'application/json'}}));
            if(!result.ok)return {updated:false};
            const name=typeof result.data?.name==='string'&&result.data.name.trim()&&result.data.name.length<=200?result.data.name.trim():null;
            const pic=picture(result.data?.profile_pic);if(!name&&!pic)return {updated:false};
            return database.transaction(()=>{
                const current=load(input);if(snapshot(current)!==snapshot(before)||current?.is_active!==1||!['Active','Warning'].includes(current.tenant_status))return {updated:false};
                const changed=database.prepare(`UPDATE fb_conversations SET user_name=COALESCE(?,user_name),user_profile_pic=COALESCE(?,user_profile_pic),
                    updated_at=datetime('now','localtime') WHERE id=? AND tenant_id=? AND user_psid=? AND linked_page_id=?`)
                    .run(name,pic,input.conversationId,input.tenantId,input.senderId,before.linked_page_id);
                return {updated:changed.changes===1};
            }).immediate();
        }catch{return {updated:false};}
    };
};
