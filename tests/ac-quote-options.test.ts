import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricebook, type PricebookItem } from '../client/src/data/pricebook';
import { buildQuoteDraft, calculateQuotePricing } from '../client/src/lib/quote-pricing';
import { publicFields } from '../server/crm/core';
import { quoteEditForm, quoteEditChanges, recalculateQuoteOption } from '../client/src/lib/document-editing';
import { planAcOptions } from '../client/src/lib/ac-quote-options';
import type { ReviewedQuoteMatch } from '../client/src/lib/quote-matches';

const byId = (id: string) => pricebook.find(i => i.id === id)!;
test('all four options use exact reviewed combinations; Guardian is cheapest compatible combination', () => {
  // Synthetic review evidence only. Never add these to the production match registry.
  const selected = ['chp-xc336','chp-z9e080c16','chp-ec36cs','chp-hs08'].map(byId);
  const models = ['RC336E2S11','RC436E2S11','XC336E2S11','XC436E2S11','XC636E2S11'];
  const matches: ReviewedQuoteMatch[] = models.map((condenser,index) => ({condenser,coil:'CTM36C5ADS1',furnace:index<2?'RG19080C16MPS':index===4?'Z9ET080C16SMPS1':'Z9ES080C16SMPS1',ahri:'SYNTHETIC',seer2:13.4,heatingStages:index===4?2:1,furnaceAfue:96}));
  const input={customerId:'synthetic',customerName:'Test',jobType:'Changeout',title:'Four synthetic options',equipmentItems:selected.map(i=>i.id),equipmentCost:0,laborCost:960,materialsCost:200,selectedAddOns:[],laborDescription:'Same location and scope'};
  const draft=buildQuoteDraft(input,'TEST','2026-10-27',pricebook,matches);
  assert.deepEqual(draft.options.map(o=>o.tier),['Value','Good','Better','Best']);
  assert.equal(draft.laborCost,960);assert.equal(draft.materialsCost,200);
  assert.equal(draft.laborDescription,input.laborDescription);
  for(const option of draft.options) {
    const warranty=option.tier==='Value'?0:250;
    assert.equal(option.laborWarrantyCost,warranty);
    assert.equal(option.customerPrice,calculateQuotePricing(option.equipmentCost!,960+warranty,200).customerPrice);
    assert.match(option.features.join(),option.tier==='Value'?/parts-only.*labor coverage not included/:/parts and labor/);
  }
  const publicQuote=publicFields('quote',draft);
  assert.equal(publicQuote.options.length,4);
  assert.ok(publicQuote.options.every((o:any)=>o.laborWarrantyCost===undefined));
  const form=quoteEditForm(draft);form.title='Updated title';
  assert.equal(quoteEditChanges(draft,form).options,undefined);
  const recalculated=recalculateQuoteOption(form.options[1],draft.options[1].equipmentItems!,'960','200');
  assert.equal(Number(recalculated.customerPrice),draft.options[1].customerPrice);
  const plans = planAcOptions(selected,pricebook,matches)!;
  assert.equal(plans.length,4);
  assert.ok(plans.every(p=>p.items),JSON.stringify(plans));
  assert.equal(plans[0].items![0].model,'RC336E2S11');
  assert.equal(plans[0].items![1].brand,'Guardian');
  assert.equal(plans[3].items![1].model,'Z9ET080C16SMPS1');
  for(const plan of plans) {
    assert.equal(plan.items![0].tonnage,3);
    assert.equal(plan.items![2],selected[2]);
    assert.equal(plan.items![3],selected[3]);
  }
  assert.equal(plans[1].items![1],plans[2].items![1]);
  const cheaper = pricebook.map(i=>i.model==='RC436E2S11'?{...i,cost:100}:i);
  assert.equal(planAcOptions(selected,cheaper,matches)![0].items![0].model,'RC436E2S11');
  // Price alone never establishes compatibility.
  assert.equal(planAcOptions(selected,cheaper,matches.filter(m=>m.condenser!=='RC436E2S11'))![0].items![0].model,'RC336E2S11');
  for(const cost of [0,-1,NaN,Infinity]) {
    const invalid = pricebook.map(i=>i.model==='XC636E2S11'?{...i,cost}:i);
    assert.match(planAcOptions(selected,invalid,matches)![3].blocker!,/No priced/);
  }
  const conflict = matches.map(m=>m.heatingStages===2?{...m,furnaceAfue:97}:m);
  assert.match(planAcOptions(selected,pricebook,conflict)![3].blocker!,/96% AFUE/);
});
test('real catalog blocks unavailable 80% two-stage and half-ton XC6 without changing assumptions',()=>{
  for(const capacity of [1.5,2,2.5,3,3.5,4,5]) {
    const ac=pricebook.find(i=>i.category==='Condenser'&&i.model.startsWith('XC3')&&i.tonnage===capacity)!;
    for(const furnace of [byId('chp-z8e100c16'),byId('chp-z9e080c16')]) {
      const coil=pricebook.find(i=>i.category==='Evaporator Coil'&&i.brand==='Champion'&&i.tonnage===capacity)!;
      const selected=[ac,furnace,coil];const before=structuredClone(selected);
      const plans=planAcOptions(selected,pricebook)!;
      assert.equal(plans.length,4);assert.ok(plans[3].blocker);
      if([2.5,3.5].includes(capacity)) assert.match(plans[3].blocker!,/Capacity will not be increased/);
      else if(furnace.tier==='80% AFUE') assert.match(plans[3].blocker!,/two-stage.*80%/);
      assert.deepEqual(selected,before);
      assert.ok(plans.every(p=>!p.items||p.items[0].tonnage===capacity));
    }
  }
});
test('matching requires exact coil, furnace, and unique pricebook model records',()=>{
  const selected=['chp-xc342','chp-z9e080c20','chp-ec42'].map(byId);
  assert.equal(planAcOptions(selected,pricebook)![1].items?.[2],selected[2]);
  assert.match(planAcOptions([selected[0],selected[1],byId('chp-ec48c')],pricebook)![1].blocker!,/unchanged CTM48/);
  assert.match(planAcOptions(selected,[...pricebook,{...selected[2],id:'duplicate'}])![1].blocker!,/Duplicate/);
});
