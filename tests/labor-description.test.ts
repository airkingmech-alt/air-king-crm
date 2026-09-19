import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {laborInputSchema,laborTemplates,templateDraft,laborSystemPrompt} from '../shared/labor-descriptions';
import {registerLaborDescription,generateLaborDescription} from '../server/crm/labor-description';
process.env.SUPABASE_URL='https://labor-test.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
const nativeFetch=globalThis.fetch;let role='owner',permissions={},calls=0;
globalThis.fetch=async(input:any,init?:any)=>{
 const u=new URL(String(input));if(u.hostname!=='labor-test.invalid')return nativeFetch(input,init);
 return new Response(JSON.stringify(u.pathname==='/auth/v1/user'?{id:'staff'}:{id:'staff',role,permissions,company_id:'airking'}),{status:200,headers:{'content-type':'application/json'}});
};
const app=express();app.use(express.json());registerLaborDescription(app,async()=>{calls++;return 'Professional draft for review.';});
let server:ReturnType<typeof app.listen>,base:string;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));base=`http://127.0.0.1:${(server.address() as any).port}`;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>server.close(()=>r()));});
const input={equipment:[{brand:'Champion',model:'Example model',category:'Condenser',description:'3-ton condenser',cost:999}],scope:'Replace condenser. Reuse thermostat. No duct work.',templateId:'ac-coil'};
const call=(body:any,auth=true)=>nativeFetch(base+'/api/crm/quotes/labor-description',{method:'POST',headers:{'content-type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify(body)});
test('six templates and scopes preserve equipment facts without internal costs',()=>{
 assert.equal(laborTemplates.length,6);const parsed=laborInputSchema.parse({...input,customerEmail:'private@example.invalid'});
 assert.ok(!JSON.stringify(parsed).includes('999'));assert.ok(!JSON.stringify(parsed).includes('private@example'));
 const draft=templateDraft('ac-coil',parsed.equipment,parsed.scope);assert.match(draft,/Example model/);assert.match(draft,/Reuse thermostat/);
 assert.match(laborSystemPrompt,/scope and exclusions override/);assert.match(laborSystemPrompt,/Do not add prices/);
});
test('AI endpoint requires login, quotes permission, equipment and scope',async()=>{
 assert.equal((await call(input,false)).status,401);
 role='technician';permissions={quotes:false};assert.equal((await call(input)).status,403);
 permissions={};assert.equal((await call({...input,equipment:[]})).status,400);assert.equal((await call({...input,scope:''})).status,400);
 assert.equal(calls,0);const r=await call(input);assert.equal(r.status,200);assert.equal((await r.json()).description,'Professional draft for review.');assert.equal(calls,1);
});
test('AI requests are bounded and missing connection reports a usable fallback',async()=>{
 for(let i=0;i<4;i++)assert.equal((await call(input)).status,200);
 assert.equal((await call(input)).status,429);assert.equal(calls,5);
 const old=process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_API_KEY;
 try{await assert.rejects(generateLaborDescription(laborInputSchema.parse(input)),/use a labor template/);}finally{if(old)process.env.ANTHROPIC_API_KEY=old;}
});
