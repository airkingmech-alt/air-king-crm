import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerCrm } from "../server/crm/routes";
import { defaultCrownCatalog } from "../shared/crown-tiers";
process.env.SUPABASE_URL="https://crown-intake.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
const nativeFetch=globalThis.fetch;
let inserted:any[]=[], catalog=structuredClone(defaultCrownCatalog), catalogUnavailable=false;
globalThis.fetch=async(input:any,init?:any)=>{
 const url=new URL(typeof input==="string"?input:input.url||String(input));
 assert.equal(url.hostname,"crown-intake.supabase.invalid");
 const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
 if(url.pathname==="/rest/v1/lead_sources")return reply([{id:"source",company_id:"synthetic-company",source_key:"website",secret:"synthetic-intake-token",enabled:true}]);
 if(url.pathname==="/rest/v1/crown_care_catalogs"){assert.equal(url.searchParams.get("company_id"),"eq.synthetic-company");return catalogUnavailable?reply({code:"42P01",message:"missing"},500):reply({version:catalog.version,catalog,history:[]});}
 if(url.pathname==="/rest/v1/leads"&&init?.method==="POST"){
  const body=JSON.parse(init.body);
  if(inserted.some(l=>l.source_ref===body.source_ref))return reply({code:"23505",message:"duplicate"},409);
  inserted.push(body);return reply({id:"synthetic-lead"});
 }
 throw Error("Unexpected write or request: "+url.pathname);
};
const app=express();app.use(express.json());registerCrm(app);
let server:ReturnType<typeof app.listen>,base:string;
before(async()=>{server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));base=`http://127.0.0.1:${(server.address() as any).port}`;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>server.close(()=>r()));});
const send=(body:any,token="synthetic-intake-token")=>nativeFetch(base+"/api/public/leads/website",{method:"POST",headers:{"content-type":"application/json","X-Lead-Token":token},body:JSON.stringify(body)});
const body=()=>({name:"Synthetic inquiry",source_ref:"synthetic-"+crypto.randomUUID(),service_type:"Crown Care inquiry",metadata:{campaign:"preserved",crownCare:{tier:"gold",catalogVersion:defaultCrownCatalog.version,systemCount:2}}});
test("website inquiry creates only a scoped lead, stamps trusted published benefits, and deduplicates retries",async()=>{
 inserted=[];const payload=body();const response=await send(payload);assert.equal(response.status,201);
 assert.equal(inserted.length,1);assert.equal(inserted[0].company_id,"synthetic-company");assert.equal(inserted[0].status,"new");
 assert.equal(inserted[0].metadata.crownCare.intent,"inquiry");assert.equal(inserted[0].metadata.crownCare.annualTotalCents,69800);assert.equal(inserted[0].metadata.crownCare.enrollmentAvailable,false);assert.equal(inserted[0].metadata.campaign,"preserved");
 const retry=await send(payload);assert.equal(retry.status,200);assert.equal((await retry.json()).duplicate,true);assert.equal(inserted.length,1);
});
test("invalid token, tampered benefits, invalid tier or count cannot insert",async()=>{
 const count=inserted.length;assert.equal((await send(body(),"bad-token")).status,401);
 for(const patch of [{tier:"other"},{systemCount:0},{status:"active"},{annualTotalCents:1}]){const payload=body();Object.assign(payload.metadata.crownCare,patch);assert.equal((await send(payload)).status,400);}
 assert.equal(inserted.length,count);
});
test("generic website submissions remain compatible and do not acquire Crown Care benefits",async()=>{
 const response=await send({name:"Synthetic generic",source_ref:"generic-"+crypto.randomUUID(),metadata:{service:"repair"}});assert.equal(response.status,201);assert.equal(inserted.at(-1).metadata.crownCare,undefined);
});


test("public catalog uses the website token, omits secrets, and reflects current edits",async()=>{
 const read=(token:string)=>nativeFetch(base+"/api/public/crown-care/catalog",{headers:{"X-Lead-Token":token}});
 assert.equal((await read("wrong")).status,401);assert.equal((await read("")).status,401);
 const response=await read("synthetic-intake-token");assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
 const payload=await response.json();assert.equal(payload.catalogVersion,defaultCrownCatalog.version);assert.deepEqual(payload.plans.map((p:any)=>p.annualPrice),[199,279,349]);
 assert.equal(JSON.stringify(payload).includes("synthetic-intake-token"),false);
 catalog={...catalog,version:"edited-2",tiers:{...catalog.tiers,gold:{...catalog.tiers.gold,annualPerSystemCents:39900}}};
 assert.equal((await (await read("synthetic-intake-token")).json()).plans[2].annualPrice,399);
});

test("stale draft or published inquiry versions return actionable 409 and never insert",async()=>{
 const count=inserted.length;
 for(const version of [defaultCrownCatalog.version,"2026-10-draft-1"]){const payload=body();payload.metadata.crownCare.catalogVersion=version;const response=await send(payload);assert.equal(response.status,409);const error=await response.json();assert.equal(error.code,"CROWN_CATALOG_STALE");assert.match(error.error,/Refresh/);}
 assert.equal(inserted.length,count);
 const payload=body();payload.metadata.crownCare.catalogVersion=catalog.version;assert.equal((await send(payload)).status,201);assert.equal(inserted.at(-1).metadata.crownCare.annualTotalCents,79800);
});

test("inquiry count remains optional and catalog outages do not block generic intake",async()=>{
 const payload:any=body();payload.metadata.crownCare.catalogVersion=catalog.version;delete payload.metadata.crownCare.systemCount;
 assert.equal((await send(payload)).status,201);assert.equal(inserted.at(-1).metadata.crownCare.annualTotalCents,null);assert.equal(inserted.at(-1).metadata.crownCare.enrollmentAvailable,false);
 catalogUnavailable=true;try{assert.equal((await send(payload)).status,503);assert.equal((await send({name:"Generic during outage",source_ref:crypto.randomUUID()})).status,201);}finally{catalogUnavailable=false;}
});
