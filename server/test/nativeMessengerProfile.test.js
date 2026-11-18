import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Database from 'better-sqlite3';
import {createNativeMessengerProfileReader} from '../services/nativeMessengerProfile.js';

const fixture=t=>{
    const database=new Database(':memory:');t.after(()=>database.close());
    database.exec(`CREATE TABLE tenants(id INTEGER PRIMARY KEY,status TEXT);
        CREATE TABLE tenant_pages(id INTEGER PRIMARY KEY,tenant_id INTEGER,page_id TEXT,page_access_token_encrypted TEXT,is_active INTEGER);
        CREATE TABLE fb_conversations(id INTEGER PRIMARY KEY,tenant_id INTEGER,linked_page_id INTEGER,user_psid TEXT,user_name TEXT,user_profile_pic TEXT,updated_at TEXT);
        INSERT INTO tenants VALUES(1,'Active'),(2,'Active');INSERT INTO tenant_pages VALUES(1,1,'synthetic-page','synthetic-encrypted-token',1),(2,2,'foreign-page','foreign-encrypted-token',1);
        INSERT INTO fb_conversations VALUES(1,1,1,'synthetic/sender','Previous name',NULL,NULL),(2,2,2,'foreign-sender','Foreign name',NULL,NULL);`);
    return {database,input:{conversationId:1,tenantId:1,senderId:'synthetic/sender',pageToken:'synthetic-profile-fixture'}};
};

test('native profile reader uses the exact owned HTTP GET and header, storing only the matching actual account profile fields',async t=>{
    const f=fixture(t);let count=0;let origin;
    const server=http.createServer((req,res)=>{count++;const url=new URL(req.url,origin);
        assert.equal(req.method,'GET');assert.equal(url.pathname,'/graph/v25.0/synthetic%2Fsender');assert.equal(url.search,'?fields=name,profile_pic');
        assert.equal(req.headers.authorization,'Bearer synthetic-profile-fixture');assert.equal(url.searchParams.has('access_token'),false);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({name:'Current synthetic name',profile_pic:origin+'/avatar.png',ignored:'not stored'}));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    origin=`http://127.0.0.1:${server.address().port}`;
    const read=createNativeMessengerProfileReader({database:f.database,fetchImpl:fetch,apiBase:origin+'/graph/v25.0',allowLoopback:true});
    assert.deepEqual(await read(f.input),{updated:true});assert.equal(count,1);
    assert.deepEqual(f.database.prepare('SELECT user_name,user_profile_pic FROM fb_conversations WHERE id=1').get(),{user_name:'Current synthetic name',user_profile_pic:origin+'/avatar.png'});
    assert.equal(f.database.prepare('SELECT user_name FROM fb_conversations WHERE id=2').get().user_name,'Foreign name');
});

test('foreign tenant/sender, inactive page and disabled tenant cannot issue a profile request',async t=>{
    const f=fixture(t);let count=0;const read=createNativeMessengerProfileReader({database:f.database,apiBase:'https://owned-provider.invalid/graph',fetchImpl:async()=>{count++;return Response.json({name:'must not store'});}});
    assert.deepEqual(await read({...f.input,tenantId:2}),{updated:false});assert.deepEqual(await read({...f.input,senderId:'foreign-sender'}),{updated:false});
    f.database.exec('UPDATE tenant_pages SET is_active=0 WHERE id=1');assert.deepEqual(await read(f.input),{updated:false});
    f.database.exec("UPDATE tenant_pages SET is_active=1 WHERE id=1;UPDATE tenants SET status='Suspended' WHERE id=1");assert.deepEqual(await read(f.input),{updated:false});
    assert.equal(count,0);
});

test('page credential or conversation ownership changes during the profile await prevent stale writes',async t=>{
    const f=fixture(t);const read=createNativeMessengerProfileReader({database:f.database,apiBase:'https://owned-provider.invalid/graph',fetchImpl:async()=>{
        f.database.exec("UPDATE tenant_pages SET page_access_token_encrypted='synthetic-new-credential' WHERE id=1");return Response.json({name:'stale profile'});}});
    assert.deepEqual(await read(f.input),{updated:false});assert.equal(f.database.prepare('SELECT user_name FROM fb_conversations WHERE id=1').get().user_name,'Previous name');
});

test('untrusted profile shapes, unsafe pictures, oversize bodies and transport details are never persisted or returned',async t=>{
    const f=fixture(t);let response=()=>Response.json({name:{private:'invalid'},profile_pic:'javascript:alert(1)'});
    const read=createNativeMessengerProfileReader({database:f.database,apiBase:'https://owned-provider.invalid/graph',fetchImpl:async()=>response()});
    for(const source of [()=>Response.json({name:{private:'invalid'},profile_pic:'javascript:alert(1)'}),
        ()=>Response.json({name:'x'.repeat(201),profile_pic:'https://user:password@example.invalid/picture'}),
        ()=>Response.json({profile_pic:'https://example.invalid/picture?access_token=synthetic-private'}),
        ()=>new Response('x'.repeat(65_537)),()=>{throw new Error('Authorization synthetic-private in request URL');}]){
        response=source;assert.deepEqual(await read(f.input),{updated:false});
    }
    assert.equal(f.database.prepare('SELECT user_name,user_profile_pic FROM fb_conversations WHERE id=1').get().user_name,'Previous name');
    for(const apiBase of ['http://external.invalid/graph','https://user:password@owned.invalid/graph','https://owned.invalid/graph?override=1']){
        assert.throws(()=>createNativeMessengerProfileReader({database:f.database,apiBase,allowLoopback:true}),TypeError);
    }
});
