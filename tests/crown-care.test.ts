import { test,before,after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { registerCrownCare } from "../server/crm/crown-care";
import { crownConfiguration,configurationFor,membershipPriceCents,renewalFrom,serviceDetails } from "../shared/crown-care";
process.env.SUPABASE_URL="https://crown-test.supabase.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
const nativeFetch=globalThis.fetch;
const employee="11111111-1111-4111-8111-111111111111";
const equipment={id:"22222222-2222-4222-8222-222222222222",propertyId:"property",systemId:"system",type:"Furnace",description:"Champion upstairs",quantity:1,filterSize:"20x25x4",filterQuantity:1,filterNotes:"MERV 11",notes:"Attic access"};
const configuration={coveredEquipment:[equipment],notes:"Customer supplies filter",billingFrequency:"Annual",visitsIncluded:2,pricing:{baseAmountCents:18900,adjustmentCents:6000,adjustmentReason:"Additional service"}};
let row:any,inserted:any,permission=true,foreign=false,writes=0;
const reset=()=>{row={id:"CC-test",company_id:"airking",customer_id:"customer",updated_at:"2026-09-17T00:00:00Z",data:{id:"CC-test",customerId:"customer",customerName:"Test",status:"Active",paymentStatus:"Paid",visitsUsed:1,visitsIncluded:2,springVisit:{status:"Completed"},renewalDate:"2027-01-01",autoRenew:false,systemDescription:"Old coverage",billingFrequency:"Annual"}};};reset();
globalThis.fetch=async(input:any,init?:any)=>{
  const url=new URL(typeof input==="string"?input:input.url||String(input));assert.equal(url.hostname,"crown-test.supabase.invalid","Only mocked external requests allowed");
  const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
  if(url.pathname==="/auth/v1/user")return reply({id:employee,aud:"authenticated"});
  if(url.pathname==="/rest/v1/profiles")return reply({id:employee,role:"technician",company_id:"airking",permissions:{memberships:permission}});
  if(url.pathname==="/rest/v1/customers"){assert.equal(url.searchParams.get("company_id"),"eq.airking");return reply(foreign?null:{id:"customer",data:{name:"Test",properties:[{id:"property",address:"Test address",systems:[{id:"system"}]}]}});}
  if(url.pathname==="/rest/v1/memberships"){
    if(init?.method==="POST"){
      const body=JSON.parse(init.body);assert.equal(body.company_id,"airking");assert.equal(body.customer_id,"customer");
      if(inserted)return reply({code:"23505",message:"duplicate"},409);inserted=body;writes++;return reply({data:body.data});
    }
    assert.equal(url.searchParams.get("company_id"),"eq.airking");
    if(init?.method==="PATCH"){
      assert.equal(url.searchParams.get("updated_at"),"eq."+row.updated_at);row={...row,...JSON.parse(init.body),updated_at:"2026-09-17T01:00:00Z"};writes++;return reply(row);
    }
    return reply(foreign?null:url.searchParams.get("id")==="eq.CC-test"?row:inserted);
  }
  throw new Error("Unexpected request");
};
const app=express();app.use(express.json());registerCrownCare(app);let server:ReturnType<typeof app.listen>,base:string;
before(async()=>{server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));base=`http://127.0.0.1:${(server.address() as any).port}`;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>server.close(()=>r()));});
const send=(path:string,body?:any,key=crypto.randomUUID(),auth=true)=>nativeFetch(base+path,{method:body?(path.endsWith("CC-test")?"PATCH":"POST"):"GET",headers:{...(auth?{Authorization:"Bearer test"}:{}),"content-type":"application/json","Idempotency-Key":key},body:body?JSON.stringify(body):undefined});
test("Crown Care rejects missing auth, disabled access, and cross-company records",async()=>{
  assert.equal((await send("/api/crm/memberships/CC-test",undefined,crypto.randomUUID(),false)).status,401);
  permission=false;try{assert.equal((await send("/api/crm/memberships/CC-test")).status,403);}finally{permission=true;}
  foreign=true;try{assert.equal((await send("/api/crm/memberships/CC-test")).status,404);}finally{foreign=false;}
});
test("editing saves custom pricing and filters while preserving payment and visit history",async()=>{
  reset();const key=crypto.randomUUID(),body={version:row.updated_at,configuration};const count=writes;
  assert.equal((await send("/api/crm/memberships/CC-test",body,key)).status,200);
  assert.equal(row.data.pricing.totalAmountCents,24900);assert.equal(row.data.coveredEquipment[0].filterSize,"20x25x4");
  assert.equal(row.data.paymentStatus,"Paid");assert.equal(row.data.visitsUsed,1);assert.equal(row.data.springVisit.status,"Completed");assert.equal(row.data.autoRenew,false);assert.equal(row.data.renewalDate,"2027-01-01");
  assert.equal(row.data.configurationHistory[0].actorId,employee);
  assert.equal((await send("/api/crm/memberships/CC-test",body,key)).status,200);assert.equal(writes,count+1);
  assert.equal((await send("/api/crm/memberships/CC-test",body)).status,409);
});
test("unrelated equipment and invalid pricing never save",async()=>{
  reset();const count=writes;
  for(const patch of [{coveredEquipment:[{...equipment,systemId:"foreign"}]},{pricing:{baseAmountCents:100,adjustmentCents:-200,adjustmentReason:"discount"}},{pricing:{baseAmountCents:100,adjustmentCents:200,adjustmentReason:""}},{coveredEquipment:[equipment,equipment]}]){
    assert.equal((await send("/api/crm/memberships/CC-test",{version:row.updated_at,configuration:{...configuration,...patch}})).status,400);
  }assert.equal(writes,count);
});
test("enrollment respects start date and renewal choice and is retry-safe",async()=>{
  inserted=null;const key=crypto.randomUUID(),body={customerId:"customer",startDate:"2024-02-29",autoRenew:false,configuration};
  assert.equal((await send("/api/crm/memberships",body,key)).status,200);
  assert.equal(inserted.data.startDate,"2024-02-29");assert.equal(inserted.data.renewalDate,"2025-02-28");assert.equal(inserted.data.autoRenew,false);assert.equal(inserted.data.paymentStatus,"Pending");
  const count=writes;assert.equal((await send("/api/crm/memberships",body,key)).status,200);assert.equal(writes,count);
});
test("legacy prices, service notes, and zero-price plans are handled without guessing equipment",()=>{
  assert.equal(membershipPriceCents({billingFrequency:"Monthly"}),1575);assert.equal(membershipPriceCents({pricing:{totalAmountCents:0}}),0);
  assert.equal(configurationFor({systemDescription:"Unknown unit"}).coveredEquipment[0].type,"Other");
  assert.match(serviceDetails(configuration),/20x25x4/);assert.match(serviceDetails(configuration),/Customer supplies filter/);
  assert.equal(crownConfiguration.safeParse(configuration).success,true);assert.throws(()=>renewalFrom("2026-02-30"));
});
test("membership timestamp migration preserves rows and advances versions on legacy updates",async()=>{
  const pg=new PGlite();try{
    await pg.exec("create table memberships(id text,data jsonb,updated_at timestamptz); create function crm_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end $$;insert into memberships values('old','{\"paymentStatus\":\"Paid\"}','2020-01-01');");
    await pg.exec(await readFile("supabase/migrations/20260917183758_crown_care_configuration.sql","utf8"));
    assert.equal((await pg.query<any>("select extract(year from updated_at)::int as y from memberships")).rows[0].y,2020);
    await pg.exec("update memberships set data=data;");assert.equal((await pg.query<any>("select data->>'paymentStatus' as status from memberships")).rows[0].status,"Paid");
    assert.equal((await pg.query("update memberships set data='{}' where updated_at='2020-01-01' returning id")).rows.length,0);
  }finally{await pg.close();}
});
