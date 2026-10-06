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
let permission=true, membershipPermission=true, collision=false, stale=false, written:any;
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
    if(url.searchParams.get("select")==="id,full_name")return reply([{id:employee,full_name:"Test"}]);
    return reply({id:employee,company_id:"airking",role:"technician",permissions:{schedule:permission,customers:permission,memberships:membershipPermission},full_name:"Test"});
  }
  if(url.pathname==="/rest/v1/rpc/crm_write_scheduled_work_order") {
    const args=JSON.parse(init.body);assert.equal(args.p_company_id,"airking");assert.equal(args.p_actor_id,employee);
    if(stale || (collision && !args.p_allow_conflict)) return new Response(JSON.stringify({code:stale?"40001":"23P01",message:stale?"This job changed":"This technician already has an overlapping job"}),{status:409,headers:{"content-type":"application/json"}});
    written={data:args.p_work_order};return reply({...job,id:args.p_work_order.id,...written});
  }
  assert.equal(url.searchParams.get("company_id"),"eq.airking");
  if(url.pathname==="/rest/v1/work_orders") {
    assert.notEqual(init?.method,"PATCH","All schedule writes must use the guarded transaction RPC");
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

test("list assignment validates priority and stores it with the appointment",async()=>{
 assert.equal((await send({...payload(),change:{...change,priority:"Emergency"}})).status,200);
 assert.equal(written.data.priority,"Emergency");
 assert.equal((await send({...payload(),change:{...change,priority:"invalid"}})).status,400);
});


test("linked Crown Care scheduling enforces membership access and preserves the durable link", async () => {
  const data = job.data as typeof job.data & { membershipId?: string; membershipSeason?: string };
  data.membershipId = "CC-test";
  data.membershipSeason = "fall";
  try {
    membershipPermission = false;
    written = undefined;
    assert.equal((await send(payload())).status, 403);
    assert.equal(written, undefined);
    membershipPermission = true;
    assert.equal((await send(payload())).status, 200);
    assert.equal(written.data.membershipId, "CC-test");
    assert.equal(written.data.membershipSeason, "fall");
  } finally {
    membershipPermission = true;
    delete data.membershipId;
    delete data.membershipSeason;
  }
});

const newJob=()=>({id:"new-job",customerId:"customer",customerName:"Test",property:"Test address",type:"Service Call",description:"Scope",status:"Scheduled",scheduledDate:"2026-09-17",scheduledTime:"09:15",technicianId:employee,technician:"Spoofed name",durationMinutes:60});
const create=(workOrder:any)=>nativeFetch(base+"/api/scheduling",{method:"POST",headers:{Authorization:"Bearer test","content-type":"application/json"},body:JSON.stringify({workOrder})});
test("New Job uses guarded creation, validates input, and resolves canonical technician identity",async()=>{
 assert.equal((await create(newJob())).status,201);
 assert.equal(written.data.technician,"Test");assert.equal(written.data.technicianId,employee);
 for(const patch of [{durationMinutes:0},{scheduledDate:"2026-02-30"},{scheduledTime:"24:01"},{technicianId:null,technician:"Unknown"}])assert.equal((await create({...newJob(),...patch})).status,400);
 collision=true;try{assert.equal((await create(newJob())).status,409);}finally{collision=false;}
 permission=false;try{assert.equal((await create(newJob())).status,403);}finally{permission=true;}
});
test("an unassigned draft can be created without inventing appointment details",async()=>{
 const draft:any={...newJob(),status:"Unscheduled"};delete draft.technician;delete draft.technicianId;delete draft.scheduledDate;delete draft.scheduledTime;
 assert.equal((await create(draft)).status,201);assert.equal(written.data.scheduledDate,undefined);assert.equal(written.data.technicianId,null);
});

test("new job API rejects unsupported link fields rather than silently losing them",async()=>{
 assert.equal((await create({...newJob(),membershipId:"member",membershipSeason:"spring"})).status,400);
 assert.equal((await create({...newJob(),quoteId:"quote"})).status,400);
});

test("calendar omits deleted records while malformed falsey legacy markers remain live",async()=>{
 const data=job.data as typeof job.data & {deletedAt?:unknown};
 try{
  for(const marker of ["2026-10-01T00:00:00Z",false,0,""]){
   data.deletedAt=marker;
   const response=await nativeFetch(base+"/api/scheduling",{headers:{Authorization:"Bearer test"}});
   assert.equal(response.status,200);assert.equal((await response.json()).jobs.length,marker?0:1);
  }
 }finally{delete data.deletedAt;}
});
