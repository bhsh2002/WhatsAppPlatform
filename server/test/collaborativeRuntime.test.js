import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { createCollaborativeRuntime, loadNativeSubscriptionFacts } from '../services/collaborativeRuntime.js';
import { SavanaIntegrationService, canonicalJson } from '../services/savanaIntegration.js';

const secret = ['synthetic','signed','subscription','fixture'].join(':');
const future = () => new Date(Date.now()+60000).toISOString();
const subscription = (changes={}) => {
    const payload={organization_id:'synthetic-org',platform_code:'wa_savana',subscription_status:'active',valid_until:future(),
        entitlements:{'wa_savana.integration.catalog.enabled':false},...changes};
    return {payload,signature:`v1=${crypto.createHmac('sha256',secret).update(canonicalJson(payload)).digest('hex')}`};
};
const fixture=t=>{
    const database=new Database(':memory:');runMigrationsSync(database);t.after(()=>database.close());
    database.exec("INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic owner','218910000091','Active')");
    let snapshot=subscription();let binding={id:'synthetic-native-account',organization_id:'synthetic-org',platform_code:'wa_savana',external_tenant_id:'wa_savana:tenant:1',status:'active'};
    const service=new SavanaIntegrationService({database,config:{enabled:true,subscriptionsMode:'central',connectUrl:'https://core.invalid',
        subscriptionsUrl:'https://subscription.invalid',connectPlatformToken:'synthetic-platform-fixture',subscriptionsPlatformToken:'synthetic-platform-fixture',
        subscriptionsSigningSecret:secret,timeoutMs:1000},fetchImpl:async url=>new URL(url).pathname==='/v1/platform-bindings'
        ?Response.json([binding]):Response.json({data:{managed_centrally:true,organization:{id:'synthetic-org'},entitlement_snapshot:snapshot}})});
    return{database,service,setSnapshot:value=>{snapshot=value;},setBinding:value=>{binding=value;}};
};

test('runtime module import never opens a default database or reads production configuration',t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wa-runtime-import-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const forbidden=path.join(directory,'absent','never-open.db');const env={...process.env,NODE_ENV:'production',DATABASE_PATH:forbidden,NODE_OPTIONS:''};
    delete env.CRYPTO_KEY;delete env.JWT_SECRET;
    const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../services/collaborativeRuntime.js',import.meta.url).href)}); await import(${JSON.stringify(new URL('../services/nativeCollaborativeDependencies.js',import.meta.url).href)});`],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(fs.existsSync(forbidden),false);assert.equal(fs.existsSync(path.dirname(forbidden)),false);
});

test('actual signed WA native subscription does not depend on bilateral integration booleans',async t=>{
    const f=fixture(t);const facts=await loadNativeSubscriptionFacts({integrationService:f.service,nativeTenantId:1,organizationId:'synthetic-org'});
    assert.equal(facts.verified,true);assert.equal(facts.entitled,true);assert.equal(facts.bound,true);
    f.setSnapshot(subscription({subscription_status:'cancelled',entitlements:{'savana.integrations.enabled':true}}));
    assert.equal((await loadNativeSubscriptionFacts({integrationService:f.service,nativeTenantId:1,organizationId:'synthetic-org'})).entitled,false);
});

test('tampered/expired/wrong-platform snapshot and foreign native binding remain unknown instead of an invented missing license',async t=>{
    const f=fixture(t);const read=()=>loadNativeSubscriptionFacts({integrationService:f.service,nativeTenantId:1,organizationId:'synthetic-org'});
    const invalid=subscription();invalid.signature='v1='+ '0'.repeat(64);f.setSnapshot(invalid);
    assert.equal((await read()).verified,false);assert.equal((await read()).entitled,null);
    for(const changes of [{valid_until:new Date(Date.now()-1000).toISOString()},{platform_code:'catalog'},{organization_id:'foreign'}]){
        f.setSnapshot(subscription(changes));assert.equal((await read()).verified,false);
    }
    f.setSnapshot(subscription());f.setBinding({id:'foreign',organization_id:'synthetic-org',platform_code:'wa_savana',external_tenant_id:'wa_savana:tenant:9',status:'active'});
    assert.equal((await read()).verified,false);
});

test('missing owner authority creates no owner router and never advertises a configured owner form',async t=>{
    const f=fixture(t);const runtime=createCollaborativeRuntime({database:f.database,encryption:{encrypt:v=>'cipher:'+v,decrypt:v=>v.slice(7)},
        config:{centerOrigin:'https://core.invalid',platformToken:'synthetic-platform-fixture',callbackToken:'synthetic-callback-fixture',appOrigin:'https://wa.invalid'},
        nativeOwnerProofs:{authority:async()=>({verified:true,nativeTenantId:1,grantApprovedBy:'synthetic-owner',nativeAuthorityRevision:'synthetic-current-owner-proof',validUntil:future()})},
        integrationService:f.service,nativeEnrollmentService:{read:()=>assert.fail('not called'),enroll:()=>assert.fail('not called')},
        ownerActions:{'messaging.send':{registered:true,contractVersion:'1.0',path:'/portal/integrations?workspace=shared&action=messaging.send'}},
        nativeDependencies:{billing:{quote:()=>assert.fail('not called'),operations:{}}}});
    assert.equal(runtime.ownerApiReady,false);assert.equal(runtime.ownerRouter,null);assert.equal(runtime.ownerService,null);
    const result=await runtime.discovery.discovery({organization_id:'synthetic-org',activity_id:'synthetic-activity',external_tenant_id:'wa_savana:tenant:1',actor_id:'synthetic-owner'});
    assert.ok(result.providers[0].capabilities.every(row=>row.owner_action_path===null&&row.configured===false));
    assert.ok(result.providers[0].capabilities.every(row=>row.permission_contract==='parameters_v1'
        && row.cancellation_supported===false && !Object.hasOwn(row,'creates_resource_actions')));
    assert.deepEqual((await runtime.discovery.products({organization_id:'synthetic-org',activity_id:'synthetic-activity',external_tenant_id:'wa_savana:tenant:1',actor_id:'synthetic-owner'})).products,[]);
});
