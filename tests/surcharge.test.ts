import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedSurcharge, surchargeReady, surchargeCheckoutOptions } from "../server/crm/surcharge";
function payment(fee=3000, funding="credit", cap=300) {
  return {
    attempt: { id:"attempt", session_id:"cs_test", amount_cents:100000, surcharge_basis_points:cap },
    session: { id:"cs_test", mode:"payment", currency:"usd", livemode:false, payment_status:"paid", amount_subtotal:100000,
      amount_total:100000+fee, metadata:{attempt_id:"attempt",surcharge_cap_bps:String(cap)},payment_intent:"pi_test",
      automatic_surcharge:{enabled:true,status:"complete"},surcharge_cost:{amount_total:fee,amount_subtotal:fee,amount_tax:0}},
    intent: {id:"pi_test",currency:"usd",livemode:false,status:"succeeded",amount_received:100000+fee,metadata:{attempt_id:"attempt"},
      latest_charge:{payment_method_details:{type:"card",card:{funding}}}},
  };
}
function verify(p:ReturnType<typeof payment>) { return verifiedSurcharge(p.session as any,p.intent as any,p.attempt,false); }
test("3% credit fee reconciles separately; lower compliant fee is accepted",()=>{
  assert.equal(verify(payment()),3000);assert.equal(verify(payment(2500)),2500);
});
test("debit, prepaid, unknown and non-card methods must have zero fee",()=>{
  for(const funding of ["debit","prepaid","unknown"]) {
    assert.throws(()=>verify(payment(3000,funding)));assert.equal(verify(payment(0,funding)),0);
  }
  const p=payment();p.intent.latest_charge.payment_method_details.type="us_bank_account";
  assert.throws(()=>verify(p));
});
test("reject excess fee, negative fee, altered total, currency, mode, session or intent",()=>{
  assert.throws(()=>verify(payment(3001)));assert.throws(()=>verify(payment(-1)));assert.throws(()=>verify(payment(3000,"credit",0)));
  for(const modify of [
    (p:any)=>p.intent.amount_received--, (p:any)=>p.intent.currency="eur",(p:any)=>p.intent.livemode=true,
    (p:any)=>p.session.id="cs_wrong",(p:any)=>p.session.metadata.attempt_id="wrong",(p:any)=>p.intent.metadata.attempt_id="wrong",
    (p:any)=>p.session.payment_intent="pi_wrong",(p:any)=>p.session.amount_subtotal--,
    (p:any)=>p.session.automatic_surcharge.status="failed",(p:any)=>p.session.surcharge_cost.amount_tax=1,
    (p:any)=>p.session.surcharge_cost=null,(p:any)=>p.intent.status="processing",
  ]) { const p=payment();modify(p);assert.throws(()=>verify(p)); }
});
test("legacy zero-fee Checkout sessions remain payable without preview fields",()=>{
  const p:any=payment(0,"debit",0);delete p.session.automatic_surcharge;delete p.session.surcharge_cost;delete p.session.metadata.surcharge_cap_bps;
  assert.equal(verify(p),0);
});
test("surcharge activation requires correct company, Stripe configuration and reached start date",()=>{
  const env={STRIPE_SURCHARGE_COMPANY_ID:"air-king",STRIPE_SURCHARGE_READY_AT:"2026-10-25T00:00:00Z",STRIPE_SECRET_KEY:"test",STRIPE_WEBHOOK_SECRET:"test"};
  assert.equal(surchargeReady("air-king",env,Date.parse("2026-10-24")),false);
  assert.equal(surchargeReady("air-king",env,Date.parse("2026-10-26")),true);
  assert.equal(surchargeReady("other",env,Date.parse("2026-10-26")),false);
  assert.equal(surchargeReady("air-king",{...env,STRIPE_SURCHARGE_READY_AT:""}),false);
  assert.equal(surchargeReady("air-king",{...env,STRIPE_WEBHOOK_SECRET:""}),false);
  assert.deepEqual(surchargeCheckoutOptions(false),{});
  assert.equal(surchargeCheckoutOptions(true).automatic_surcharge?.enabled,true);
  assert.equal(surchargeCheckoutOptions(true).adaptive_pricing?.enabled,false);
});
