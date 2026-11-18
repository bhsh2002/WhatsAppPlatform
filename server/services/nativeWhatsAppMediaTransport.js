import FormData from 'form-data';
import {META_API_BASE} from '../config/index.js';
import {normalizeFilename} from './filenames.js';
import {readMetaResponse} from './metaHttp.js';

// Shared with the ordinary native media routes: same multipart fields, parser
// and known-ID metadata GET. No provider search or idempotency API is invented.
export const createNativeWhatsAppMediaTransport=({fetchImpl=globalThis.fetch,apiBase=META_API_BASE,parseMetaResponse=readMetaResponse,formDataFactory=()=>new FormData()}={})=>{
    if(typeof fetchImpl!=='function'||typeof parseMetaResponse!=='function'||typeof formDataFactory!=='function')throw new TypeError('Native media transport requires actual HTTP/parser');
    const url=new URL(apiBase);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new TypeError('Native media base must be server owned');
    const base=apiBase.replace(/\/+$/,'');
    return {
        upload:async({context,bytes,mimeType,filename,beforeDispatch=()=>undefined})=>{
            const displayFilename=normalizeFilename(filename,'upload');const form=formDataFactory();form.append('messaging_product','whatsapp');form.append('type',mimeType);
            form.append('file',bytes,{filename:displayFilename,contentType:mimeType});const body=form.getBuffer();beforeDispatch();
            const response=await fetchImpl(`${base}/${encodeURIComponent(context.phoneNumberId)}/media`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
                headers:{Authorization:`Bearer ${context.accessToken}`,...form.getHeaders()},body});
            return {displayFilename,result:await parseMetaResponse(response)};
        },
        read:async({context,mediaId,beforeDispatch=()=>undefined})=>{
            beforeDispatch();return parseMetaResponse(await fetchImpl(`${base}/${encodeURIComponent(mediaId)}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),
                headers:{Authorization:`Bearer ${context.accessToken}`}}));
        },
    };
};
