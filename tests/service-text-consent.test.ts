import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerCrm} from '../server/crm/routes';
Object.assign(process.env,{SUPABASE_URL:'https://service-consent.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic'});
const originalFetch=globalThis.fetch;
let profile:any,prefs:any,suppressed:boolean,writes:any[];
const json=(value:any)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
globalThis.fetch=async(input:any,init:any={})=>{
  const u=new URL(typeof input==='string'?input:input.url||String(input));
  assert.equal(u.hostname,'service-consent.supabase.invalid','No live/provider requests');
  if(u.pathname==='/auth/v1/user')return json({id:'staff',aud:'authenticated'});
  const table=u.pathname.split('/').at(-1);
  if(table==='profiles')return json(profile);
  if((init.method||'GET')!=='GET'){
    assert.equal(init.method,'POST');assert.ok(['customer_communication_preferences','communication_events'].includes(table!),'No sends, customer edits or suppression writes');
    const body=JSON.parse(init.body);assert.equal(body.company_id,'co');assert.equal(body.customer_id,'c');writes.push({table,body});
    if(table==='customer_communication_preferences')prefs={...prefs,...body};
    return json({id:'synthetic-event',...body});
  }
  assert.equal(u.searchParams.get('company_id'),'eq.'+profile.company_id);
  if(table==='customers')return json(profile.company_id==='co'?{id:'c',company_id:'co',data:{contacts:[{role:'Primary',phone:'+18165550105'}]}}:null);
  if(table==='customer_communication_preferences')return json(prefs);
  if(table==='sms_phone_suppressions')return json(suppressed?{phone:'+18165550105'}:null);
  throw Error('Unexpected table '+table);
};
const app=express();app.use(express.json());registerCrm(app);let server:any,base:string;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{globalThis.fetch=originalFetch;await new Promise<void>(r=>server.close(r));});
beforeEach(()=>{profile={company_id:'co',role:'dispatcher',permissions:{}};prefs={email_transactional:false,sms_transactional:false,email_marketing:true,sms_marketing:false};suppressed=false;writes=[];});
const request=(body:any={confirmed:true},auth=true)=>originalFetch(base+'/api/crm/customers/c/service-text-consent',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer synthetic'}:{})},body:JSON.stringify(body)});
test('explicit new-customer confirmation changes only service SMS and records an audit without inventing consent dates',async()=>{
  assert.equal((await request()).status,200);
  assert.equal(prefs.sms_transactional,true);assert.equal(prefs.email_transactional,false);assert.equal(prefs.email_marketing,true);assert.equal(prefs.sms_marketing,false);
  const change=writes.find(w=>w.table==='customer_communication_preferences').body;
  assert.deepEqual(Object.keys(change).sort(),['company_id','consent_source','customer_id','sms_transactional','updated_at']);
  assert.match(change.consent_source,/Original agreement date was not supplied/);
  assert.equal(writes.find(w=>w.table==='communication_events').body.metadata.original_consent_date,null);
  const before=writes.length;assert.equal((await request()).status,200);assert.equal(writes.length,before,'Repeated confirmed saves preserve existing permission evidence');
});
test('confirmation never clears STOP or phone suppression',async()=>{
  prefs.sms_stopped=true;assert.equal((await request()).status,400);assert.equal(writes.length,0);
  prefs.sms_stopped=false;suppressed=true;assert.equal((await request()).status,400);assert.equal(writes.length,0);
});
test('confirmation requires explicit true, staff customer access and same-company customer',async()=>{
  assert.equal((await request({},false)).status,401);
  for(const body of [{},{confirmed:false},{confirmed:true,sms_marketing:true}])assert.equal((await request(body)).status,400);
  profile.permissions={customers:false};assert.equal((await request()).status,403);
  profile.permissions={};profile.company_id='foreign';assert.equal((await request()).status,404);
  assert.equal(writes.length,0);
});
