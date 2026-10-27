import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuotePricing, buildQuoteDraft, buildQuoteOptions } from "../client/src/lib/quote-pricing";
import { getQuoteEquipment, pricebook } from "../client/src/data/pricebook";
import { publicFields } from "../server/crm/core";
import { readFileSync } from "node:fs";

test("purchase tax includes equipment and materials, excludes labor, and precedes margin", () => {
  const p = calculateQuotePricing(5000, 1200, 400);
  assert.deepEqual(p, { equipmentCost: 5000, laborCost: 1200, materialsCost: 400, taxRate: .09, purchaseTax: 486, totalCost: 7086, customerPrice: 8857.5 });
  assert.equal(calculateQuotePricing(0, 1200, 0).purchaseTax, 0);
  assert.equal(calculateQuotePricing(0, 0, 400).purchaseTax, 36);
  assert.equal(calculateQuotePricing(4974, 1000, 300).customerPrice, 8435.83);
  assert.equal(calculateQuotePricing(5242, 1000, 300).customerPrice, 8800.98);
  assert.equal(calculateQuotePricing(.05, 0, 0).purchaseTax, 0);
  assert.equal(calculateQuotePricing(.06, 0, 0).purchaseTax, .01);
  assert.throws(() => calculateQuotePricing(-1, 0, 0));
  assert.throws(() => calculateQuotePricing(0, Infinity, 0));
});
test("draft factory preserves pricing inputs, saves one factual option, and does not mutate inputs", () => {
  const input = {customerId:"synthetic-customer",customerName:"Test Customer",jobType:"Changeout",title:"Selected system",equipmentCost:5000,laborCost:1200,materialsCost:400,equipmentItems:["synthetic-item"],selectedAddOns:[],laborDescription:"Replace selected equipment"};
  const before = structuredClone(input);
  const q = buildQuoteDraft(input, "Q-TEST", "2026-09-30", [{id:"synthetic-item",brand:"Champion",category:"Accessory",model:"TEST",cost:5000,description:"Synthetic accessory"}]);
  assert.deepEqual(input, before);
  assert.equal(q.status, "Draft");
  assert.equal(q.laborCost, 1200); assert.equal(q.materialsCost, 400);
  assert.equal(q.purchaseTax, 486); assert.equal(q.taxRate, .09);
  assert.equal(q.options.length, 1); assert.equal(q.options[0].customerPrice, 8857.5);
  assert.doesNotMatch(JSON.stringify(q.options), /13 SEER|14 SEER|16 SEER|Wi-Fi/);
  assert.deepEqual(q.options[0].equipmentItems,input.equipmentItems);
  const publicQuote = publicFields("quote", {...q, internalReviewNote:"Private review"});
  assert.equal(publicQuote.equipmentSelectionMode, "explicit");
  assert.equal(publicQuote.options[0].customerPrice, q.options[0].customerPrice);
  for (const field of ["equipmentCost","laborCost","materialsCost","purchaseTax","taxRate","internalReviewNote"]) assert.equal(publicQuote[field], undefined);
  assert.equal(publicQuote.options[0].totalCost, undefined);
});
test("legacy options and prices are not repriced when rendered", () => {
  const legacy={status:"Won",equipmentItems:["chp-xc342"],options:[{tier:"Better",customerPrice:7654,totalCost:6000}]};
  const before=JSON.stringify(legacy);
  getQuoteEquipment(legacy,"Better"); publicFields("quote",legacy);
  assert.equal(JSON.stringify(legacy),before);
});
test("both quote builders use shared pricing and persist separate labor/material inputs", () => {
  for (const name of ["customer-detail", "quote-builder"]) {
    const source=readFileSync(`client/src/pages/${name}.tsx`,"utf8");
    assert.match(source,/calculateQuotePricing\(/);
    assert.match(source,/laborCost: labor/); assert.match(source,/materialsCost: materials/);
    assert.match(source,/Purchase tax \(9% equipment \+ materials\)/);
    assert.doesNotMatch(source,/sellingPriceFromCost/);
  }
});

test("available AC options retain the selected furnace and coil; unavailable options explain blockers", () => {
  const equipmentItems=["chp-z9e080c20","chp-ec42","chp-xc342"];
  const input={customerId:"synthetic",customerName:"Test",jobType:"Changeout",title:"Test",equipmentCost:4974,laborCost:1000,materialsCost:300,equipmentItems};
  const q=buildQuoteDraft(input,"Q-TEST","2026-09-30");
  assert.deepEqual(q.options.map(o=>o.tier),["Good","Better"]);
  assert.deepEqual(q.options.map(o=>o.equipmentItems), [equipmentItems,["chp-z9e080c20","chp-ec42","chp-xc442"]]);
  for (const o of q.options) {
    assert.equal(o.laborWarrantyCost,250);
    assert.equal(o.customerPrice,calculateQuotePricing(o.equipmentCost!,1250,300).customerPrice);
    assert.deepEqual(getQuoteEquipment(q,o.tier).map(i=>i.id),o.equipmentItems);
    assert.match(o.features.join(),/10-year parts and labor/);
  }
  assert.match(q.options[0].efficiency,/13.4 SEER2/);
  assert.match(q.options[1].efficiency,/14.3 SEER2/);
  assert.match(q.internalReviewNote!,/Guardian/);
  assert.match(q.internalReviewNote!,/two-stage furnace retaining 96% AFUE/);
  const partial=buildQuoteOptions(input,pricebook.filter(item=>item.id!=="chp-xc442"));
  assert.deepEqual(partial.options.map(o=>o.tier),["Good"]);
  assert.match(partial.unavailable.join(),/3.5-ton XC4/);
  assert.throws(()=>buildQuoteOptions(input,pricebook.map(i=>i.id==='chp-ec42'?{...i,cost:0}:i)),/missing or invalid price/);
});
test("heat pumps and non-XC selections remain their selected equipment without invented tiers",()=>{
  const ids=["chp-xh436"];
  const q=buildQuoteDraft({customerId:"synthetic",customerName:"Test",jobType:"Changeout",title:"Test",equipmentCost:2503,laborCost:1000,materialsCost:300,equipmentItems:ids},"Q-TEST","2026-09-30");
  assert.equal(q.options.length,1);assert.deepEqual(q.options[0].equipmentItems,ids);
});

test("invoice and ordering paths respect the saved selected option equipment", () => {
  const schedule=readFileSync("client/src/pages/schedule.tsx","utf8");
  assert.match(schedule,/getQuoteEquipment\(quote, option.tier\)/);
  assert.doesNotMatch(schedule,/getTieredEquipment/);
  const dashboard=readFileSync("client/src/pages/dashboard.tsx","utf8");
  assert.match(dashboard,/options.find\(option => option.tier === quote.selectedOption\)\?\.equipmentItems/);
  const staff=readFileSync("client/src/pages/proposal.tsx","utf8");
  assert.match(staff,/quoteMoney\(option.customerPrice\)/);
  assert.match(staff,/quoteMoney\(grandTotal\)/);
});

test("XC6-only selections preserve their exact baseline rather than silently upsizing",()=>{
  const ids=["chp-xc618"];
  const q=buildQuoteDraft({customerId:"synthetic",customerName:"Test",jobType:"Changeout",title:"Test",equipmentCost:2034,laborCost:1000,materialsCost:300,equipmentItems:ids},"Q-TEST","2026-09-30");
  assert.equal(q.options.length,1);assert.deepEqual(q.options[0].equipmentItems,ids);
  assert.equal(q.equipmentCost,q.options[0].equipmentCost);
});
