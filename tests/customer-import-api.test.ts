import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerCustomerImport } from "../server/crm/customer-import";
process.env.SUPABASE_URL="https://customer-import-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-test-only";
const nativeFetch=globalThis.fetch;
const actor="11111111-1111-4111-8111-111111111111";
let profile:any,authenticated:boolean,calls:any[];
const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
globalThis.fetch=async(input:any,init:any={})=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input));
 assert.equal(url.hostname,'customer-import-test.supabase.invalid','Only mocked transport allowed');
 if(url.pathname==='/auth/v1/user')return authenticated?reply({id:actor,aud:'authenticated'}):reply({message:'invalid',code:'bad_jwt'},401);
 if(url.pathname==='/rest/v1/profiles')return reply(profile);
 if(url.pathname.startsWith('/rest/v1/rpc/')){const body=JSON.parse(init.body);calls.push({path:url.pathname,body});return reply(url.pathname.endsWith('state')?{snapshot:'a'.repeat(32),customers:1}:{inserted:1,linked:0,communications:0});}
 throw new Error('Unexpected transport');
};
const app=express();app.use(express.json());registerCustomerImport(app);
let server:ReturnType<typeof app.listen>,base:string;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));base=`http://127.0.0.1:${(server.address() as any).port}/api/crm/customers/import`;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>server.close(()=>r()));});
beforeEach(()=>{profile={id:actor,company_id:'test-company',role:'owner',permissions:{}};authenticated=true;calls=[];});
const source={source:{system:'markate',customerId:'101',status:'Active',addedOn:'2024-01-01',exportedAt:'2026-10-01T00:00:00Z',exportSha256:'b'.repeat(64),csvRow:2},displayName:'Synthetic Person',firstName:'Synthetic',lastName:'Person',companyName:'',type:'Residential',email:'synthetic@example.test',mobile:'2025550101',phone:'',billingAddress:{street:'',unit:'',city:'',state:'',postalCode:''},serviceAddresses:[],additionalContacts:[]};
const request={batchId:'22222222-2222-4222-8222-222222222222',expectedSnapshot:'a'.repeat(32),expectedNew:1,expectedLinks:0,records:[{mode:'create',source}]};
async function post(body:any=request,token=true){return nativeFetch(base+'/markate',{method:'POST',headers:{'content-type':'application/json',...(token?{Authorization:'Bearer synthetic-token'}:{})},body:JSON.stringify(body)});}
test('only authenticated owner/admin with customer permission can use import or state',async()=>{
 assert.equal((await post(request,false)).status,401);authenticated=false;assert.equal((await post()).status,401);authenticated=true;
 for(const role of ['technician','dispatcher']){profile.role=role;assert.equal((await post()).status,403);assert.equal((await nativeFetch(base+'/state',{headers:{Authorization:'Bearer synthetic-token'}})).status,403);}
 profile.role='admin';profile.permissions={customers:false};assert.equal((await post()).status,403);assert.equal(calls.length,0);
});
test('verified caller identity reaches only the import RPC; no request can supply company or actor',async()=>{
 assert.equal((await post({...request,company:'other-company'})).status,400);assert.equal(calls.length,0);
 const r=await post();assert.equal(r.status,200);assert.deepEqual(await r.json(),{inserted:1,linked:0,communications:0});
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/rest/v1/rpc/crm_import_markate_customers');assert.equal(calls[0].body.p_company,'test-company');assert.equal(calls[0].body.p_actor,actor);
 const c=calls[0].body.p_records[0].customer;assert.ok(!('leadStatus' in c));assert.deepEqual(c.properties,[]);
});
test('no legacy history, questionable email, or count mismatch reaches the database',async()=>{
 for(const changed of [{...request,expectedNew:2},{...request,records:[{mode:'create',source:{...source,notes:'unauthorized'}}]},{...request,records:[{mode:'create',source:{...source,email:'bad@example.con'}}]}])assert.equal((await post(changed)).status,400);
 assert.equal(calls.length,0);
});
