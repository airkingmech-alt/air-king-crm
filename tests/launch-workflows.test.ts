import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {registerCrm} from '../server/crm/routes';
import {updateVersioned} from '../shared/versioned-save';
import {prepareInvoiceLines,saveInvoiceThenSend} from '../shared/invoice-workflow';

process.env.SUPABASE_URL='https://workflow-test.supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
const nativeFetch=globalThis.fetch;
let row:any, writes=0;
function reset(table='message_templates') {
 row={id:'record',company_id:'airking',updated_at:'2026-09-18T00:00:00Z',name:'Original',channel:'email',category:'transactional',subject:'Hello',body:'Hi {{customer_name}}',active:true,archived:false,enabled:true,steps:[],table};writes=0;
}
globalThis.fetch=async(input:any,init?:any)=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input));
 assert.equal(url.hostname,'workflow-test.supabase.invalid','No provider calls allowed');
 const response=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 if(url.pathname==='/auth/v1/user')return response({id:'11111111-1111-4111-8111-111111111111',aud:'authenticated'});
 if(url.pathname==='/rest/v1/profiles')return response({role:'owner',company_id:'airking'});
 assert.equal(url.pathname,'/rest/v1/'+row.table);
 assert.equal(url.searchParams.get('company_id'),'eq.airking');
 if(init?.method==='PATCH') {
  const version=url.searchParams.get('updated_at');
  if(version&&version!=='eq.'+row.updated_at)return response(null);
  const changes=JSON.parse(init.body);row={...row,...changes,updated_at:changes.updated_at || new Date().toISOString()};writes++;
 }
 return response(row);
};
const client=createClient(process.env.SUPABASE_URL,'test-key',{auth:{persistSession:false,autoRefreshToken:false}});
const app=express();app.use(express.json());registerCrm(app);
let server:ReturnType<typeof app.listen>,base:string;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));base=`http://127.0.0.1:${(server.address() as any).port}`;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>server.close(()=>r()));});
const call=(path:string,body:any,method='PUT')=>nativeFetch(base+path,{method,headers:{Authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify(body)});

test('catalog and lead edits compare versions and reject stale or unversioned writes',async()=>{
 for(const table of ['price_book_items','leads'] as const){
  reset(table);const original={...row};
  await updateVersioned(client,table,original,{name:'Newer'});
  await assert.rejects(updateVersioned(client,table,original,{name:'Older'}),{status:409});
  await assert.rejects(updateVersioned(client,table,{...original,updated_at:''},{name:'Invalid'}),{status:409});
  assert.equal(row.name,'Newer');assert.equal(writes,1);
 }
});
test('template API rejects stale edits and archive requests without overwriting newer content',async()=>{
 reset();const original={...row};
 assert.equal((await call('/api/crm/templates/record',{...original,name:'Newer'})).status,200);
 assert.equal((await call('/api/crm/templates/record',{...original,archived:true})).status,409);
 assert.equal(row.name,'Newer');assert.equal(row.archived,false);assert.equal(writes,1);
});
test('turning an automation off works from a stale screen; stale turn-on cannot reverse it',async()=>{
 reset('automations');const old=row.updated_at;row.updated_at='2026-09-18T01:00:00Z';
 assert.equal((await call('/api/crm/automations/record/toggle',{enabled:false,updated_at:old},'POST')).status,200);
 assert.equal((await call('/api/crm/automations/record/toggle',{enabled:true,updated_at:old},'POST')).status,409);
 assert.equal(row.enabled,false);assert.equal(writes,1);
});
test('invoice amounts round each line to cents and reject invalid lines rather than dropping them',()=>{
 assert.deepEqual(prepareInvoiceLines([{description:' Labor ',quantity:'1.5',unitPrice:'19.99'},{description:'Included',quantity:'1',unitPrice:'0'},{description:'',quantity:'1',unitPrice:''}]),{items:[{description:'Labor',amount:29.99},{description:'Included',amount:0}],amount:29.99});
 for(const patch of [{quantity:'-1'},{quantity:'Infinity'},{unitPrice:'NaN'},{unitPrice:'-1'},{description:''},{unitPrice:''}])
  assert.throws(()=>prepareInvoiceLines([{description:'Part',quantity:'1',unitPrice:'10',...patch}]));
});
test('failed invoice email preserves the saved invoice and clears the create form first',async()=>{
 const events:string[]=[];
 const result=await saveInvoiceThenSend(async()=>{events.push('save');return {id:'INV-one'};},()=>events.push('clear form'),async()=>{events.push('send');throw new Error('Provider unavailable');});
 assert.deepEqual(events,['save','clear form','send']);assert.equal(result.invoice.id,'INV-one');assert.equal(result.deliveryError,'Provider unavailable');
});
test('failed invoice persistence never clears the form or attempts delivery',async()=>{
 await assert.rejects(saveInvoiceThenSend(async()=>{throw new Error('Offline');},()=>assert.fail('form cleared'),async()=>assert.fail('message sent')),/Offline/);
});
