import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {registerCardCheckout} from "../server/crm/card-checkout";

Object.assign(process.env,{SUPABASE_URL:"https://checkout-test.supabase.invalid",SUPABASE_SERVICE_ROLE_KEY:"test-only",STRIPE_SECRET_KEY:"sk_test_fake",STRIPE_PUBLISHABLE_KEY:"pk_test_fake",STRIPE_WEBHOOK_SECRET:"fake",STRIPE_DIRECT_CHECKOUT_COMPANY_ID:"air-king"});
const realFetch=globalThis.fetch;
const token="a".repeat(43), attemptId="11111111-1111-4111-8111-111111111111";
let attempt:any, intent:any, invoice:any, paid:any[], confirms=0, creates=0, recordCalls=0;
let funding="credit", nextStatus="succeeded";
function reset(){attempt=null;intent=null;paid=[];confirms=creates=recordCalls=0;funding="credit";nextStatus="succeeded";invoice={id:"INV-test",company_id:"air-king",data:{amount:1000,status:"Sent"}};}
function json(body:any,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","request-id":"req_test"}});}
globalThis.fetch=async(input:any,init:any={})=>{
 const url=new URL(typeof input==="string"?input:input.url),path=url.pathname;
 if(url.hostname==="api.stripe.com") {
  if(path.includes("payment_intents")) assert.equal(new Headers(init.headers).get("stripe-version"),"2026-08-26.preview");
  const form=new URLSearchParams(init.body);
  if(path.includes("confirmation_tokens/"))return json({id:path.split("/").at(-1),livemode:false,expires_at:Math.floor(Date.now()/1000)+3600,payment_method_preview:{type:"card",card:{funding,brand:"visa",last4:"4242"}}});
  if(path==="/v1/payment_intents" && init.method==="POST") {
   creates++;assert.equal(form.get("confirm"),null);assert.equal(form.get("payment_method_types[0]"),null);
   intent={id:"pi_test",status:"requires_payment_method",currency:"usd",livemode:false,amount:Number(form.get("amount")),amount_received:0,
    metadata:{attempt_id:form.get("metadata[attempt_id]"),invoice_id:form.get("metadata[invoice_id]"),checkout_kind:"direct"},
    amount_details:attempt.fee_cents?{surcharge:{amount:attempt.fee_cents,maximum_amount:3000,status:"available",enforce_validation:"enabled"}}:{},
    client_secret:"pi_test_secret_test",latest_charge:{payment_method_details:{type:"card",card:{funding,brand:"visa",last4:"4242"}},receipt_url:"https://example.invalid/receipt"}};
   return json(intent);
  }
  if(path.endsWith("/confirm")) {
   assert.equal(new Headers(init.headers).get("idempotency-key"),`direct-confirm:${attemptId}`);
   confirms++;intent.status=nextStatus;intent.amount_received=nextStatus==="succeeded"?intent.amount:0;return json(intent);
  }
  if(path.endsWith("/cancel")){assert.notEqual(intent.status,"succeeded");intent.status="canceled";return json(intent);}
  if(path==="/v1/payment_intents/pi_test")return json(intent);
  throw new Error("Unexpected Stripe request "+path);
 }
 assert.equal(url.hostname,"checkout-test.supabase.invalid","No external provider calls allowed");
 const body=init.body?JSON.parse(init.body):{};
 if(path.endsWith("/document_links"))return json({invoice_id:"INV-test",company_id:"air-king"});
 if(path.endsWith("/invoices"))return json(invoice);
 if(path.endsWith("/crm_settings"))return json({data:{payments_enabled:true,fee_enabled:true,fee_basis_points:300}});
 if(path.endsWith("/payments"))return json(paid);
 if(path.endsWith("/rpc/crm_reserve_direct_payment")) {
   assert.equal(body.p_amount,100000);attempt={id:attemptId,company_id:"air-king",invoice_id:"INV-test",amount_cents:body.p_amount,fee_cents:body.p_fee,confirmation_token:body.p_token,checkout_kind:"direct",state:"reserved",created_at:new Date().toISOString()};return json(attempt);
 }
 if(path.endsWith("/rpc/crm_record_surcharge_payment")) {
   recordCalls++;assert.equal(body.p_amount,100000);assert.equal(body.p_fee,attempt.fee_cents);
   if(!paid.length)paid.push({amount_cents:100000,fee_cents:body.p_fee});attempt.state="paid";invoice.data.status="Paid";return json({id:"pay-test"});
 }
 if(path.endsWith("/checkout_attempts")) {
   if(init.method==="PATCH"){Object.assign(attempt,body);return json(null);}
   let found=attempt;
   if(url.searchParams.has("confirmation_token") && url.searchParams.get("confirmation_token")!=="eq."+attempt?.confirmation_token)found=null;
   if(url.searchParams.has("state") && !["reserved","open"].includes(attempt?.state))found=null;
   if(url.searchParams.has("order") && !url.searchParams.has("limit"))return json(found?[found]:[]);
   if(url.searchParams.get("limit")==="20")return json(found?[found]:[]);
   return json(found);
 }
 throw new Error("Unexpected database request "+path);
};
const app=express();app.use(express.json());
registerCardCheckout(app,fn=>async(req:any,res:any)=>{try{await fn(req,res)}catch(e:any){res.status(400).json({error:e.message})}});
let server:any,base:string;
before(async()=>{server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));base=`http://127.0.0.1:${server.address().port}/api/public/documents/${token}`;});
after(async()=>{globalThis.fetch=realFetch;await new Promise<void>(r=>server.close(r));});
async function call(route:string,body?:any){const r=await realFetch(base+route,{method:body?"POST":"GET",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}

test("review does not charge; confirmed credit fee settles separately and retries cannot charge again",async()=>{
 reset();let r=await call("/payment-review",{confirmationToken:"ctoken_credit"});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.total,103000);assert.equal(creates,0);
 const body={confirmationToken:"ctoken_credit",amount:100000,fee:3000,confirmed:true};
 r=await call("/payment-confirm",body);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.status,"succeeded");assert.equal(r.body.clientSecret,undefined);
 r=await call("/payment-confirm",body);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(creates,1);assert.equal(confirms,1);assert.equal(paid.length,1);assert.equal(paid[0].fee_cents,3000);
});
test("debit charges only principal and altered client totals are rejected before an intent exists",async()=>{
 reset();funding="debit";
 const review=await call("/payment-review",{confirmationToken:"ctoken_debit"});assert.equal(review.body.fee,0);
 const bad=await call("/payment-confirm",{confirmationToken:"ctoken_debit",amount:100000,fee:3000,confirmed:true});assert.equal(bad.status,400);assert.equal(creates,0);
 const good=await call("/payment-confirm",{confirmationToken:"ctoken_debit",amount:100000,fee:0,confirmed:true});assert.equal(good.status,200,JSON.stringify(good.body));assert.equal(intent.amount,100000);assert.equal(paid[0].fee_cents,0);
});
test("3DS can be resumed; cancellation cancels Stripe before releasing reservation",async()=>{
 reset();nextStatus="requires_action";
 const r=await call("/payment-confirm",{confirmationToken:"ctoken_credit",amount:100000,fee:3000,confirmed:true});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.clientSecret,"pi_test_secret_test");assert.equal(paid.length,0);
 const resumed=await call("/payment-status");assert.equal(resumed.body.status,"requires_action");
 const cancelled=await call("/payment-cancel",{attemptId});assert.equal(cancelled.body.status,"canceled");assert.equal(attempt.state,"cancelled");assert.equal(paid.length,0);
});
