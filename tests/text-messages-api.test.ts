import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerTextMessages} from '../server/crm/text-messages';
process.env.SUPABASE_URL='https://text-messages-test.supabase.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
const nativeFetch=globalThis.fetch;
let profile:any,calls:any[],rows:any[],matches:any[],fail=false;
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input:any,init:any={})=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input));
 assert.equal(url.hostname,'text-messages-test.supabase.invalid','No production or provider calls');
 if(url.pathname==='/auth/v1/user')return json({id:'staff',aud:'authenticated'});
 if(url.pathname==='/rest/v1/profiles')return json(profile);
 assert.ok(url.pathname.startsWith('/rest/v1/rpc/crm_text_'),'No enqueue or customer mutations expected');
 const body=JSON.parse(init.body);assert.equal(body.p_company,profile.company_id);assert.ok(!JSON.stringify(body).includes('spoofed-company'));
 calls.push({path:url.pathname,body});if(fail)return json({message:'private SQL details'},500);
 return json(url.pathname.endsWith('crm_text_matches')?matches:rows);
};
const app=express();app.use(express.json());registerTextMessages(app);let server:any,base:string;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>server.close(r));});
beforeEach(()=>{profile={company_id:'co',role:'dispatcher',permissions:{}};calls=[];rows=[];matches=[];fail=false;});
function request(path='',method='GET',body?:any,auth=true){return nativeFetch(base+'/api/crm/text-messages'+path,{method,headers:{...(auth?{authorization:'Bearer synthetic'}:{}),'content-type':'application/json','idempotency-key':'11111111-1111-4111-8111-111111111111'},...(body?{body:JSON.stringify(body)}:{})});}
test('list, history and send require sign-in and all history permissions',async()=>{
 for(const path of ['', '/history?phone=%2B18165550101','/send']){
 assert.equal((await request(path,path==='/send'?'POST':'GET',undefined,false)).status,401);
 for(const permission of ['customers','quotes','invoices','schedule','communications']){profile.permissions={[permission]:false};assert.equal((await request(path,path==='/send'?'POST':'GET')).status,403);}
 }
 assert.equal(calls.length,0);
});
test('tenant scope comes from profile, bounded pages return a stable continuation cursor and no-store',async()=>{
 rows=Array.from({length:31},(_,n)=>({phone:'phone'+n,last_at:'2026-10-24T12:00:00Z'}));
 const r=await request('?company_id=spoofed-company');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const b=await r.json();assert.equal(b.items.length,30);assert.deepEqual(b.next,{at:rows[29].last_at,key:'phone29'});
 profile.company_id='second';rows=[];assert.equal((await request()).status,200);assert.equal(calls[1].body.p_company,'second');
});
test('history preserves original links and resolves current phone matches without writes',async()=>{
 rows=[{key:'in:one',customer_id:null,ambiguous:true}];matches=[{id:'one'},{id:'two'}];
 const r=await request('/history?phone=%2B18165550101');assert.equal(r.status,200);assert.deepEqual(await r.json(),{items:rows,customers:matches,next:null});assert.equal(calls.length,2);
});
test('invalid cursors and inputs fail before database or queue access',async()=>{
 for(const path of ['?before=not-json','?before='+encodeURIComponent(JSON.stringify({at:'invalid',key:'x'})),'/history','/history?phone='])assert.equal((await request(path)).status,400);
 for(const body of [{body:'x',customer_id:'one',recipient:'bad'},{body:'{{secret}}',customer_id:'one',recipient:'+18165550101'},{body:'x',customer_id:'one',recipient:'+18165550101',company_id:'spoofed-company'}])assert.equal((await request('/send','POST',body)).status,400);
 assert.equal(calls.length,0);
});
test('send rejects ambiguous, unmatched, additional and foreign-customer selection without enqueueing',async()=>{
 const input={body:'Synthetic reply',customer_id:'one',recipient:'+18165550101'};
 for(const current of [[],[{id:'one',is_primary:true},{id:'two',is_primary:true}],[{id:'one',is_primary:false}],[{id:'foreign',is_primary:true}]]){matches=current;assert.equal((await request('/send','POST',input)).status,409);}
 assert.equal(calls.length,4);assert.ok(calls.every(c=>c.path.endsWith('crm_text_matches')));
});
test('database failures are actionable without exposing private database details',async()=>{
 fail=true;const r=await request();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Text messages unavailable. Please retry.'});
});
