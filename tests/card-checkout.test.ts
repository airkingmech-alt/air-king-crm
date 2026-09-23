import {test} from "node:test";
import assert from "node:assert/strict";
import {calculateCardFee,invoiceFeeBps,directCheckoutReady,nativeIntentParams,verifyDirectPayment} from "../server/crm/card-fee";

test("only verified credit funding adds a rounded fee; every other method stays at invoice balance",()=>{
  const card=(funding:string)=>({type:"card",card:{funding}});
  assert.equal(calculateCardFee(100000,300,card("credit")),3000);
  assert.equal(calculateCardFee(2999,300,card("credit")),90);
  assert.equal(calculateCardFee(100000,250,card("credit")),2500);
  for(const m of [card("debit"),card("prepaid"),card("unknown"),{type:"us_bank_account"},{type:"link"},null]) assert.equal(calculateCardFee(100000,300,m),0);
  assert.equal(calculateCardFee(100000,0,card("credit")),0);
  assert.throws(()=>calculateCardFee(100000,350,card("credit")));
  assert.throws(()=>calculateCardFee(49,300,card("credit")));
});
test("invoice fee policy supports opt-out, lower rates, existing invoices, and avoids double fees",()=>{
  const config={fee_enabled:true,fee_basis_points:300};
  assert.equal(invoiceFeeBps({},config),300);
  assert.equal(invoiceFeeBps({cardFeePercent:0},config),0);
  assert.equal(invoiceFeeBps({cardFeePercent:2.5},config),250);
  assert.equal(invoiceFeeBps({items:[{description:"Credit-card fee (3%)",amount:30}]},config),0);
  assert.equal(invoiceFeeBps({cardFeePercent:3},{fee_enabled:false}),0);
  assert.throws(()=>invoiceFeeBps({cardFeePercent:3.5},config));
});
test("native intent never confirms during creation/recovery and tells Stripe to validate surcharge",()=>{
  const a={id:"a",invoice_id:"i",amount_cents:100000,fee_cents:3000};
  const p:any=nativeIntentParams(a);
  assert.equal(p.amount,103000);assert.equal(p.confirm,undefined);assert.equal(p.payment_method_types,undefined);
  assert.deepEqual(p.amount_details,{surcharge:{amount:3000,enforce_validation:"enabled"}});
  assert.equal((nativeIntentParams({...a,fee_cents:0}) as any).amount_details,undefined);
});
test("native reconciliation verifies totals, card type, Stripe cap, mode, and immutable invoice mapping",()=>{
  const a={id:"a",invoice_id:"i",checkout_kind:"direct",payment_intent_id:"pi_test",amount_cents:100000,fee_cents:3000};
  const p:any={id:"pi_test",metadata:{attempt_id:"a",invoice_id:"i",checkout_kind:"direct"},status:"succeeded",currency:"usd",livemode:false,
    amount:103000,amount_received:103000,amount_details:{surcharge:{amount:3000,enforce_validation:"enabled",maximum_amount:3000,status:"available"}},
    latest_charge:{payment_method_details:{type:"card",card:{funding:"credit"}}}};
  assert.equal(verifyDirectPayment(p,a,false),3000);
  for(const mutate of [
    (q:any)=>q.amount_received--,(q:any)=>q.amount--,(q:any)=>q.livemode=true,(q:any)=>q.currency="eur",
    (q:any)=>q.metadata.invoice_id="other",(q:any)=>q.metadata.attempt_id="other",(q:any)=>q.id="other",
    (q:any)=>q.status="processing",(q:any)=>q.latest_charge.payment_method_details.card.funding="debit",
    (q:any)=>q.amount_details.surcharge.maximum_amount=2999,(q:any)=>q.amount_details.surcharge.enforce_validation="disabled",
  ]){const q=structuredClone(p);mutate(q);assert.throws(()=>verifyDirectPayment(q,a,false));}
  const debit=structuredClone(p);debit.amount=debit.amount_received=100000;delete debit.amount_details;debit.latest_charge.payment_method_details.card.funding="debit";
  assert.equal(verifyDirectPayment(debit,{...a,fee_cents:0},false),0);
});
test("direct checkout requires matching live/test keys, company and webhook",()=>{
  const env={STRIPE_DIRECT_CHECKOUT_COMPANY_ID:"air-king",STRIPE_PUBLISHABLE_KEY:"pk_live_test",STRIPE_SECRET_KEY:"sk_live_test",STRIPE_WEBHOOK_SECRET:"whsec_test"};
  assert.equal(directCheckoutReady("air-king",env),true);
  assert.equal(directCheckoutReady("other",env),false);
  assert.equal(directCheckoutReady("air-king",{...env,STRIPE_PUBLISHABLE_KEY:"pk_test_test"}),false);
  assert.equal(directCheckoutReady("air-king",{...env,STRIPE_WEBHOOK_SECRET:""}),false);
});
