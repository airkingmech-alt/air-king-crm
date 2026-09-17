import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerScheduling } from "../server/crm/scheduling";
import { registerEquipmentAnalysis } from "../server/crm/equipment-analysis";
import { hash } from "../server/crm/core";
process.env.SUPABASE_URL="https://dispatch-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY="local-test-only";
const nativeFetch=globalThis.fetch;
const employee="11111111-1111-4111-8111-111111111111";
let permission=true, collision=false, stale=false, written:any;
const job={id:"job-one",company_id:"airking",updated_at:"2026-09-17T00:00:00Z",data:{id:"job-one",customerId:"customer",customerName:"Test",status:"Scheduled",scheduledDate:"2026-09-17",scheduledTime:"09:00",technician:"Test",durationMinutes:60,description:"Preserve scope",selectedAddOns:["addon"]}};
const app=express();app.use(express.json());registerScheduling(app);registerEquipmentAnalysis(app);
let server:ReturnType<typeof app.listen>,base:string;
globalThis.fetch=async(input:any,init?:any)=>{
  const url=new URL(typeof input==="string"?input:input.url || String(input));
  assert.equal(url.hostname,"dispatch-test.supabase.invalid","Only mocked requests permitted");
  const reply=(data:any)=>new Response(JSON.stringify(data),{status:200,headers:{"content-type":"application/json"}});
  if(url.pathname==="/auth/v1/user")return reply({id:employee,aud:"authenticated"});
  if(url.pathname==="/rest/v1/profiles") {
    if(url.searchParams.get("select")==="id,full_name,role") {assert.equal(url.searchParams.get("company_id"),"eq.airking");return reply([{id:employee,full_name:"Test",role:"technician"}]);}
    return reply({id:employee,company_id:"airking",role:"technician",permissions:{schedule:permission,customers:permission},full_name:"Test"});
  }
  assert.equal(url.searchParams.get("company_id"),"eq.airking");
  if(url.pathname==="/rest/v1/work_orders") {
    if(init?.method==="PATCH") {assert.equal(url.searchParams.get("updated_at"),"eq."+job.updated_at);written=JSON.parse(init.body);return reply(stale?null:{...job,...written});}
    if(url.searchParams.has("id"))return reply(job);
    return reply([job,...(collision?[{...job,id:"job-two",data:{...job.data,id:"job-two"}}]:[])]);
  }
  throw new Error("Unexpected request");
};
before(async()=>{server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));base=`http://127.0.0.1:${(server.address() as any).port}`;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>server.close(()=>r()));});
const change={scheduledDate:"2026-09-17",scheduledTime:"09:15",technician:"Test",durationMinutes:90};
const send=(body:any)=>nativeFetch(base+"/api/scheduling/job-one",{method:"PATCH",headers:{Authorization:"Bearer test","content-type":"application/json"},body:JSON.stringify(body)});
const payload=()=>({change,version:hash(JSON.stringify(job.data))});
test("calendar and AI reject anonymous and disabled staff",async()=>{
  assert.equal((await nativeFetch(base+"/api/scheduling")).status,401);
  assert.equal((await nativeFetch(base+"/api/equipment/analyze",{method:"POST"})).status,401);
  permission=false;try{assert.equal((await send(payload())).status,403);}finally{permission=true;}
});
test("schedule changes preserve scope and add-ons, audit actor, and compare existing data",async()=>{
  assert.equal((await send(payload())).status,200);
  assert.equal(written.data.description,"Preserve scope");assert.deepEqual(written.data.selectedAddOns,["addon"]);
  assert.equal(written.data.durationMinutes,90);assert.equal(written.data.scheduleHistory[0].actorId,employee);
  assert.equal((await send({...payload(),version:"old"})).status,409);
  stale=true;try{assert.equal((await send(payload())).status,409);}finally{stale=false;}
});
test("conflicts require explicit override and invalid appointments cannot save",async()=>{
  collision=true;try{assert.equal((await send(payload())).status,409);assert.equal((await send({...payload(),allowConflict:true})).status,200);}finally{collision=false;}
  assert.equal((await send({...payload(),change:{...change,scheduledDate:"2026-02-30"}})).status,400);
  assert.equal((await send({...payload(),change:{...change,technician:"Unverified"}})).status,400);
});
