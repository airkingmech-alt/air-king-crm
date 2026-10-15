import {test,before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {createHmac} from "node:crypto";
import {registerCrm} from "../server/crm/routes";

process.env.SUPABASE_URL="https://sent-launch-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-only";
const nativeFetch=globalThis.fetch;
const employee="11111111-1111-4111-8111-111111111111";
const replyId="22222222-2222-4222-8222-222222222222";
let profile: any, writes: any[], queries: URL[], failStorage=false;
let rows: any[]=[];
const response=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
globalThis.fetch=async(input:any,init:any={})=>{
  const url=new URL(typeof input==="string"?input:input.url||String(input));
  assert.equal(url.hostname,"sent-launch-test.supabase.invalid","Provider and production calls prohibited");
  if(url.pathname==="/auth/v1/user")return response({id:employee,aud:"authenticated"});
  if(url.pathname==="/rest/v1/profiles")return response(profile);
  if(url.pathname==="/rest/v1/rpc/crm_store_sent_callback"){
    if(failStorage)return response({message:"synthetic storage outage"},503);
    writes.push(JSON.parse(init.body));return response(null);
  }
  assert.equal(url.pathname,"/rest/v1/communication_events","No processing or sends on the webhook request path");
  assert.equal(url.searchParams.get("company_id"),"eq.co");
  assert.equal(url.searchParams.get("channel"),"eq.sms");
  assert.equal(url.searchParams.get("event_type"),'in.(sms.received,customer.opted_out)');
  queries.push(url);
  if(init.method==="PATCH"){
    const body=JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(),["read_at","read_by"]);
    assert.equal(body.read_by,employee);
    assert.ok(Number.isFinite(Date.parse(body.read_at)));
    writes.push(body);
    return response(url.searchParams.get("id")==="eq."+replyId?[{id:replyId}]:[]);
  }
  return response(rows);
};
const app=express();app.use(express.json({verify:(req,_res,raw)=>{(req as any).rawBody=raw;}}));registerCrm(app);
let server:ReturnType<typeof app.listen>,base:string;
before(async()=>{
  server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.on("listening",resolve));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
  Object.assign(process.env,{SENT_DM_API_KEY:"synthetic-only",SENT_DM_ACCOUNT_ID:"account",SENT_DM_COMPANY_ID:"co",
    SENT_DM_WEBHOOK_SECRET:"whsec_"+Buffer.from("synthetic-secret").toString("base64"),SENT_DM_WEBHOOK_ID:"endpoint"});
});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{profile={company_id:"co",role:"technician",permissions:{}};writes=[];queries=[];rows=[];failStorage=false;});
async function inbox(method="GET",id?:string,token=true){
  return nativeFetch(base+"/api/crm/replies"+(id?`/${id}/read`:""),{method,headers:token?{authorization:"Bearer synthetic"}:{}});
}
async function webhook(body:any,options:{event?:string;timestamp?:number;valid?:boolean}={}){
  const raw=JSON.stringify(body);const t=String(options.timestamp||Math.floor(Date.now()/1000));
  const signature=createHmac("sha256","synthetic-secret").update(`endpoint.${t}.${raw}`).digest("base64");
  return nativeFetch(base+"/api/webhooks/sentdm",{method:"POST",body:raw,headers:{"content-type":"application/json",
    "x-webhook-id":"endpoint","x-webhook-event-id":options.event||"event-one","x-webhook-timestamp":t,
    "x-webhook-signature":options.valid===false?"invalid":`v1,${signature}`}});
}
const optOut=()=>({field:"contact",event:"contact.opt_out",timestamp:"2026-10-15T12:00:00Z",
  payload:{account_id:"account",contact_id:"synthetic-contact",from:"+18165551234",to:null,opt_out:true,
    source:"PROVIDER_SIGNAL",channel:"sms",text:null,message_id:null,template_id:null}});

test("verified contact.opt_out without message_id is stored before ACK without customer scans or sends",async()=>{
  const r=await webhook(optOut());assert.equal(r.status,204);
  assert.equal(writes.length,1);assert.equal(queries.length,0);
  assert.equal(writes[0].p_payload.opt_out,true);assert.equal(writes[0].p_payload.company_id,"co");
  assert.equal(writes[0].p_payload.from,"+18165551234");assert.equal(writes[0].p_payload.message_id,null);
});
test("retry signing timestamp changes keep the same durable event identity",async()=>{
  const event=optOut();const t=Math.floor(Date.now()/1000);
  assert.equal((await webhook(event,{timestamp:t})).status,204);
  assert.equal((await webhook(event,{timestamp:t-1})).status,204);
  assert.equal(writes[0].p_id,writes[1].p_id);
});
test("forged, stale and foreign-account opt-outs never reach storage",async()=>{
  assert.equal((await webhook(optOut(),{valid:false})).status,403);
  assert.equal((await webhook(optOut(),{timestamp:Math.floor(Date.now()/1000)-301})).status,403);
  const foreign=optOut();foreign.payload.account_id="other";
  assert.equal((await webhook(foreign)).status,403);assert.equal(writes.length,0);
});
test("MMS STOP uses immediate suppression and START never clears it",async()=>{
  const event:any={event:"message.received",timestamp:"2026-10-15T12:00:00Z",payload:{
    account_id:"account",message_id:"sms",channel:"mms",inbound_number:"+18165551234",text:"STOP"}};
  assert.equal((await webhook(event)).status,204);assert.equal(writes[0].p_payload.opt_out,true);
  event.payload.text="START";
  assert.equal((await webhook(event)).status,204);assert.equal(writes[1].p_payload.opt_out,false);
});
test("storage outage returns retryable 503 without leaking database details",async()=>{
  failStorage=true;const r=await webhook(optOut());assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:"Webhook storage unavailable. Retry delivery."});
});
test("failure payload retains code-based explanation and discards arbitrary provider reason",async()=>{
  const event={event:"message.failed",timestamp:"2026-10-15T12:00:00Z",payload:{account_id:"account",message_id:"outbound",
    reason_code:"BUSINESS_003",reason:"private +18165551234 <script> api-key"}};
  assert.equal((await webhook(event)).status,204);
  assert.match(writes[0].p_payload.failure_reason,/balance/);
  assert.doesNotMatch(JSON.stringify(writes[0]),/private|api-key|<script>/);
});
test("inbox read and mark-read require sign-in and every history feature permission",async()=>{
  assert.equal((await inbox("GET",undefined,false)).status,401);
  assert.equal((await inbox("POST",replyId,false)).status,401);
  for(const feature of ["communications","customers","quotes","invoices","schedule"]){
    profile.permissions={[feature]:false};
    assert.equal((await inbox()).status,403);
    assert.equal((await inbox("POST",replyId)).status,403);
  }
  assert.equal(queries.length,0);assert.equal(writes.length,0);
});
test("shared unread inbox is bounded/company-scoped and read writes only server actor/time",async()=>{
  rows=[{id:replyId,metadata:{body:"Synthetic reply"}}];
  const list=await inbox();assert.equal(list.status,200);assert.deepEqual(await list.json(),rows);
  assert.equal(queries[0].searchParams.get("limit"),"100");
  assert.equal(queries[0].searchParams.get("read_at"),"is.null");
  const read=await inbox("POST",replyId);assert.equal(read.status,200);assert.deepEqual(await read.json(),{updated:1});
  assert.equal(writes.length,1);
  const foreign=await inbox("POST","33333333-3333-4333-8333-333333333333");
  assert.deepEqual(await foreign.json(),{updated:0});
});

test("reviewed unmatched replies remain accessible in bounded company history",async()=>{
  rows=[{id:replyId,read_at:"2026-10-15T12:00:00Z",metadata:{body:"Unmatched synthetic reply",unmatched:true}}];
  const r=await nativeFetch(base+"/api/crm/replies?history=true&page=2",{headers:{authorization:"Bearer synthetic"}});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),rows);
  assert.equal(queries[0].searchParams.get("offset"),"200");
  assert.equal(queries[0].searchParams.get("limit"),"100");
  assert.equal(queries[0].searchParams.has("read_at"),false);
});
