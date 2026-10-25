import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerCrm} from '../server/crm/routes';

Object.assign(process.env,{SUPABASE_URL:'https://document-readiness.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',SMS_PROVIDER:'twilio',TWILIO_ACCOUNT_SID:'synthetic',TWILIO_AUTH_TOKEN:'synthetic',TWILIO_MESSAGING_SERVICE_SID:'synthetic'});
const originalFetch=globalThis.fetch;
let profile:any,prefs:any,suppressed:boolean,contact:string,queries:string[];
const response=(value:any)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input:any,init:any={})=>{
  const u=new URL(typeof input==='string'?input:input.url||String(input));
  assert.equal(u.hostname,'document-readiness.supabase.invalid','No live/provider requests');
  assert.equal(init.method||'GET','GET','Readiness cannot write data');
  if(u.pathname==='/auth/v1/user')return response({id:'staff',aud:'authenticated'});
  const table=u.pathname.split('/').at(-1);
  if(table==='profiles')return response(profile);
  queries.push(table!);
  assert.equal(u.searchParams.get('company_id'),'eq.'+profile.company_id,'Every data read is company-scoped');
  if(table==='quotes'||table==='invoices')return response(profile.company_id==='co'&&u.searchParams.get('id')==='eq.document'?{id:'document',company_id:'co',customer_id:'customer-one',data:{}}:null);
  if(table==='customers'){
    assert.equal(u.searchParams.get('id'),'eq.customer-one','Document relationship chooses the customer');
    return response({id:'customer-one',company_id:'co',data:{name:'Synthetic Customer',contacts:[{role:'Primary',phone:contact}]}});
  }
  if(table==='customer_communication_preferences')return response(prefs);
  if(table==='crm_settings')return response({data:{sending_enabled:true,timezone:'America/Chicago',sms_start:8,sms_end:19}});
  if(table==='sms_phone_suppressions')return response(suppressed?{phone:'+18165550105'}:null);
  throw Error('Unexpected table '+table);
};
const app=express();app.use(express.json());registerCrm(app);
let server:any,base:string;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{globalThis.fetch=originalFetch;await new Promise<void>(r=>server.close(r));});
beforeEach(()=>{profile={company_id:'co',role:'dispatcher',permissions:{}};prefs=null;suppressed=false;contact='+18165550105';queries=[];});
const request=(kind='quote',auth=true,suffix='')=>originalFetch(`${base}/api/crm/${kind}/document/sms-readiness${suffix}`,{headers:auth?{authorization:'Bearer synthetic'}:{}});

test('quote and invoice readiness use the verified document customer, without writes or history permissions',async()=>{
  for(const kind of ['quote','invoice']){
    profile.permissions={customers:false,schedule:false,[kind==='quote'?'invoices':'quotes']:false};
    const r=await request(kind,true,'?customer_id=foreign&company_id=foreign');
    assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
    const b=await r.json();assert.equal(b.customer_id,'customer-one');assert.equal(b.ready,false);assert.equal(b.consent_required,true);assert.match(b.issues.join(' '),/consent/);
  }
  assert.ok(!queries.includes('communications')&&!queries.includes('communication_events'));
});
test('document readiness preserves matching send permissions and tenant isolation',async()=>{
  assert.equal((await request('quote',false)).status,401);
  for(const kind of ['quote','invoice'])for(const permission of [kind+'s','communications']){
    profile.permissions={[permission]:false};assert.equal((await request(kind)).status,403);
  }
  assert.equal(queries.length,0);
  profile.permissions={};profile.company_id='foreign';assert.equal((await request()).status,404);
});
test('document readiness distinguishes valid consent from stopped, suppressed and missing-primary-phone states',async()=>{
  prefs={sms_transactional:true};assert.equal((await(await request()).json()).ready,true);
  suppressed=true;assert.match((await(await request()).json()).issues.join(' '),/suppressed/);
  suppressed=false;prefs.sms_stopped=true;
  let b=await(await request()).json();assert.equal(b.ready,false);assert.equal(b.consent_required,false);
  prefs.sms_stopped=false;contact='';b=await(await request()).json();assert.equal(b.ready,false);assert.match(b.issues.join(' '),/valid phone/);
});
