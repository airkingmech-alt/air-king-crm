import { approximateEfficiencyDisclosure, quoteEfficiencyDeliveryBody } from '../shared/quote-efficiency';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricebook, type PricebookItem } from '../client/src/data/pricebook';
import { buildQuoteDraft, calculateQuotePricing } from '../client/src/lib/quote-pricing';
import { publicFields } from '../server/crm/core';
import { quoteEditForm, quoteEditChanges, recalculateQuoteOption } from '../client/src/lib/document-editing';
import { planAcOptions } from '../client/src/lib/ac-quote-options';
import type { ReviewedQuoteMatch } from '../client/src/lib/quote-matches';

const byId = (id: string) => pricebook.find(i => i.id === id)!;
test('all four options preserve equipment constraints and choose lowest actual Guardian cost', () => {
  // Synthetic review evidence only. Never add these to the production match registry.
  // Synthetic model identity keeps optional certification evidence isolated.
  const catalog = pricebook.map(i=>i.id==='chp-z9t080c16'?{...i,model:'Z9ET080C16SYNTHETIC',tier:'97% AFUE'}:i);
  const selected = ['chp-xc336','chp-z9e080c16','chp-ec36cs','chp-hs08'].map(byId);
  const models = ['RC336E2S11','RC436E2S11','XC336E2S11','XC436E2S11','XC636E2S11'];
  const matches: ReviewedQuoteMatch[] = models.map((condenser,index) => ({condenser,coil:'CTM36C5ADS1',furnace:index<2?'RG19080C16MPS1':index===4?'Z9ET080C16SYNTHETIC':'Z9ES080C16SMPS1',ahri:'SYNTHETIC',seer2:13.4,heatingStages:index===4?2:1,furnaceAfue:96}));
  const input={customerId:'synthetic',customerName:'Test',jobType:'Changeout',title:'Four synthetic options',equipmentItems:selected.map(i=>i.id),equipmentCost:0,laborCost:960,materialsCost:200,selectedAddOns:[],laborDescription:'Same location and scope'};
  const draft=buildQuoteDraft(input,'TEST','2026-10-27',catalog,matches);
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
  const plans = planAcOptions(selected,catalog,matches)!;
  assert.equal(plans.length,4);
  assert.ok(plans.every(p=>p.items),JSON.stringify(plans));
  assert.equal(plans[0].items![0].model,'RC336E2S11');
  assert.equal(plans[0].items![1].brand,'Guardian');
  assert.equal(plans[3].items![1].model,'Z9ET080C16SYNTHETIC');
  for(const plan of plans) {
    assert.equal(plan.items![0].tonnage,3);
    assert.equal(plan.items![2],selected[2]);
    assert.equal(plan.items![3],selected[3]);
  }
  assert.equal(plans[1].items![1],plans[2].items![1]);
  const cheaper = catalog.map(i=>i.model==='RC436E2S11'?{...i,cost:100}:i);
  assert.equal(planAcOptions(selected,cheaper,matches)![0].items![0].model,'RC436E2S11');
  // Missing certification does not exclude a priced candidate under the approved policy.
  assert.equal(planAcOptions(selected,cheaper,matches.filter(m=>m.condenser!=='RC436E2S11'))![0].items![0].model,'RC436E2S11');
  for(const cost of [0,-1,NaN,Infinity]) {
    const invalid = catalog.map(i=>i.model==='XC636E2S11'?{...i,cost}:i);
    assert.match(planAcOptions(selected,invalid,matches)![3].blocker!,/No priced/);
  }
  const conflict = matches.map(m=>m.heatingStages===2?{...m,furnaceAfue:97}:m);
  assert.ok(planAcOptions(selected,catalog,conflict)![3].items);
});
test('real catalog rounds only authorized half-ton top options and preserves other assumptions',()=>{
  for(const capacity of [1.5,2,2.5,3,3.5,4,5]) {
    const ac=pricebook.find(i=>i.category==='Condenser'&&i.model.startsWith('XC3')&&i.tonnage===capacity)!;
    for(const furnace of [byId('chp-z8e100c16'),byId('chp-z9e080c16')]) {
      const coil=pricebook.find(i=>i.category==='Evaporator Coil'&&i.brand==='Champion'&&i.tonnage===capacity)!;
      const selected=[ac,furnace,coil];const before=structuredClone(selected);
      const plans=planAcOptions(selected,pricebook)!;
      assert.equal(plans.length,4);
      assert.ok(plans[3].items);
      assert.deepEqual(selected,before);
      assert.ok(plans.every(p=>!p.items||p.items[0].tonnage===(p.tier==='Best'&&[2.5,3.5].includes(capacity)?Math.ceil(capacity):capacity)));
    }
  }
});
test('matching requires exact coil, furnace, and unique pricebook model records',()=>{
  const selected=['chp-xc342','chp-z9e080c20','chp-ec42'].map(byId);
  assert.equal(planAcOptions(selected,pricebook)![1].items?.[2],selected[2]);
  assert.equal(planAcOptions([selected[0],selected[1],byId('chp-ec48c')],pricebook)![1].items?.[2].model,'CTM48C5CFS1');
  assert.match(planAcOptions(selected,[...pricebook,{...selected[2],id:'duplicate'}])![1].blocker!,/Duplicate/);
});

test('80% top option retains the selected single-stage furnace and coil with reviewed evidence',()=>{
  const selected=['chp-xc336','chp-z8e100c16','chp-ec36cs'].map(byId);
  const matches: ReviewedQuoteMatch[]=['XC336E2S11','XC436E2S11','XC636E2S11'].map(condenser=>({condenser,furnace:selected[1].model,coil:selected[2].model,ahri:'SYNTHETIC',seer2:13.4,heatingStages:1,furnaceAfue:80}));
  const plans=planAcOptions(selected,pricebook,matches)!;
  for(const plan of plans.slice(1)) {
    assert.equal(plan.items?.[1],selected[1]);
    assert.equal(plan.items?.[2],selected[2]);
  }
  assert.match(plans[3].label,/same 80% furnace/);
  assert.doesNotMatch(plans[3].label,/two-stage/);
  assert.ok(planAcOptions(selected,pricebook,[])![3].items);
});
test('unavailable Guardian furnace stays excluded even if later present with a price and reviewed match',()=>{
  const selected=['chp-xc342','chp-z9e080c20','chp-ec42'].map(byId);
  const excluded: PricebookItem={...byId('grd-rg080c'),id:'synthetic-unavailable',model:'RG19080C20MPS1',cost:1};
  const match: ReviewedQuoteMatch={condenser:'RC342E2S11',furnace:excluded.model,coil:selected[2].model,ahri:'SYNTHETIC',seer2:13.75};
  const value=planAcOptions(selected,[...pricebook,excluded],[match])![0];
  assert.equal(value.tier,'Value');
  assert.equal(value.items,undefined);
  assert.match(value.blocker!,/080C20/);
});

test('verified three-ton Guardian combination retains selected furnace size and coil',()=>{
  const selected=['chp-xc336','chp-z9e060b','chp-ec36cds'].map(byId);
  const value=planAcOptions(selected,pricebook)![0];
  assert.equal(value.match?.ahri,'214727326');
  assert.equal(value.items?.[1].model,'RG19060B12MPS1');
  assert.equal(value.items?.[2],selected[2]);
  assert.equal(value.items?.[0].tonnage,3);
  assert.ok(planAcOptions([selected[0],byId('chp-z9e080c20'),selected[2]],pricebook)![0].blocker);
});

test('actual 80% catalog generates four options without AHRI and persists disclosure and review notes',()=>{
  for(const capacity of [1.5,2,2.5,3,3.5,4,5]) {
    const ac=pricebook.find(i=>i.model.startsWith('XC3')&&i.tonnage===capacity)!;
    const furnace=byId('chp-z8e100c20');
    const coil=pricebook.find(i=>i.category==='Evaporator Coil'&&i.brand==='Champion'&&i.tonnage===capacity)!;
    const input={customerId:'synthetic',customerName:'Test',jobType:'Changeout',title:'Approximate',equipmentItems:[ac.id,furnace.id,coil.id],equipmentCost:0,laborCost:960,materialsCost:200};
    const draft=buildQuoteDraft(input,'TEST','2026-10-27',pricebook,[]);
    assert.equal(draft.options.length,4);
    for(const option of draft.options) {
      assert.match(option.efficiency,/Approx.*SEER2 series/);
      assert.match(option.features.join(),/An AHRI-certified rating is not represented unless specifically provided/);
      assert.match(option.features.join(),/Installer review required/);
    }
    assert.equal(draft.options[3].equipmentItems?.[1],furnace.id);
    assert.equal(draft.options[3].rebateOffer?.items[0].base,300);
    const publicQuote=publicFields('quote',draft);
    assert.ok(publicQuote.options[3].features.includes(approximateEfficiencyDisclosure));
    assert.ok(publicQuote.options[3].features.includes("10-year parts and labor warranty"));
    assert.ok(publicQuote.options[3].features.includes("Equipment fit and installation requirements will be confirmed before installation."));
  }
});
test('known refrigerant mismatch blocks while unknown physical requirements are disclosed',()=>{
  const selected=['chp-xc336','chp-z8e100c16','chp-ec36cs'].map(byId);
  const bad={...selected[2],model:'INCOMPATIBLE-COIL',description:'R-410A only evaporator coil'};
  assert.ok(planAcOptions([selected[0],selected[1],bad],pricebook)!.every(p=>/refrigerant mismatch/.test(p.blocker||'')));
  const unknown={...selected[2],model:'UNVERIFIED-COIL'};
  const catalog=pricebook.map(i=>i.id===unknown.id?unknown:i);
  assert.match(planAcOptions([selected[0],selected[1],unknown],catalog)![1].reviewNotes!.join(),/not established/);
});

test('delivery copy includes saved bid disclosure once and leaves historical messages unchanged',()=>{
 const body='Review your options: https://example.test/proposal';
 const options=[{features:[approximateEfficiencyDisclosure]}];
 const delivered=quoteEfficiencyDeliveryBody(body,options);
 assert.ok(delivered.includes(approximateEfficiencyDisclosure));
 assert.equal(quoteEfficiencyDeliveryBody(delivered,options),delivered);
 assert.equal(quoteEfficiencyDeliveryBody(body,[{features:['Legacy warranty']}]),body);
});

test('selected real two-stage high-efficiency furnace is retained without certification; approved final-tier upgrade selects true 97%',()=>{
 const selected=['chp-xc336','chp-z9t080c16','chp-ec36cs'].map(byId);
 const plans=planAcOptions(selected,pricebook,[])!;
 for(const plan of plans.slice(1))assert.equal(plan.items?.[1],selected[1]);
 assert.equal(plans[3].items?.[1].tier,'97% AFUE · two-stage standard ECM');
 const baseline=[selected[0],byId('chp-z9e080c16'),selected[2]];
 assert.equal(planAcOptions(baseline,pricebook,[])![3].items?.find(i => i.category === 'Furnace')?.tier, '97% AFUE · two-stage standard ECM');
});

test('half-size top options visibly persist actual condenser, required coil and cost without further fallback',()=>{
 for(const [base,actual,acId,coilId,topId,newCoilId] of [[2.5,3,'chp-xc330','chp-ec30bs','chp-xc636','chp-ec36cs'],[3.5,4,'chp-xc342','chp-ec42','chp-xc648','chp-ec48c']] as const){
  const ids=[acId,'chp-z8e100c16',coilId];
  const draft=buildQuoteDraft({customerId:'synthetic',customerName:'Test',jobType:'Changeout',title:'Half size',equipmentItems:ids,equipmentCost:0,laborCost:960,materialsCost:200},'TEST','2026-10-27',pricebook,[]);
  assert.equal(draft.options.length,4);
  const best=draft.options[3];
  assert.deepEqual(best.equipmentItems,[topId,ids[1],newCoilId]);
  assert.ok(best.label.includes(`${actual}-ton AC (upsized from ${base} ton)`));
  assert.match(best.features.join(),/Coil changes from/);
  assert.equal(best.equipmentCost,[topId,ids[1],newCoilId].map(byId).reduce((n,i)=>n+i.cost,0));
  for(const o of draft.options.slice(0,3)){assert.equal(byId(o.equipmentItems![0]).tonnage,base);assert.equal(o.equipmentItems![2],coilId);}
  const selected=ids.map(byId);
  assert.match(planAcOptions(selected,pricebook.filter(i=>i.id!==topId))![3].blocker!,/No priced/);
 }
});

test('upsized XC6 retains a supported original coil, rejects missing replacement prices and flags limited airflow',()=>{
 const selected=['chp-xc330','chp-z8e080b','chp-ec42'].map(byId);
 const retained=planAcOptions(selected,pricebook)![3];
 assert.equal(retained.items?.[2],selected[2]);
 assert.match(retained.reviewNotes!.join(),/selected coil CTM42C5CES1 is retained/);
 const original=['chp-xc342','chp-z8e080b','chp-ec42'].map(byId);
 const best=planAcOptions(original,pricebook)![3];
 assert.match(best.reviewNotes!.join(),/1200 CFM/);
 const noCoils=pricebook.map(i=>/^CTM48[CD]5CF/.test(i.model)?{...i,cost:0}:i);
 assert.match(planAcOptions(original,noCoils)![3].blocker!,/No priced Champion coil/);
});

 test('saved draft policy keeps four priced real options and exposes unavailable true-97 cases',()=>{
 const input={customerId:'synthetic',customerName:'Test',jobType:'Changeout',title:'Repair fixture',equipmentItems:['chp-xc336','chp-ec36bn','chp-z9e080b'],equipmentCost:4365,laborCost:1200,materialsCost:450};
 const draft=buildQuoteDraft(input,'TEST','2026-10-27');
 assert.deepEqual(draft.options.map(o=>o.customerPrice),[6492.20,8372.94,8719.01,9454.76]);
 assert.match(draft.options[3].equipment,/Z9ET080B12SMPS1/);
 assert.ok(draft.options.slice(1,3).every(o=>o.equipment.includes('Z9ES080B12SMPS1')));
 for(const id of ['chp-z9e100c16','chp-z9e100c20']) {
  const q=buildQuoteDraft({...input,equipmentItems:['chp-xc336','chp-ec36bn',id]},'TEST','2026-10-27');
  assert.ok(!q.options.some(o=>o.tier==='Best'));
  assert.match(q.unavailableOptions!.find(o=>o.tier==='Best')!.reason,/97% AFUE/);
  assert.deepEqual(publicFields('quote',q).unavailableOptions.map((o:any)=>o.tier),q.unavailableOptions!.map(o=>o.tier));
  assert.equal(publicFields('quote',q).unavailableOptions[0].reason,'Equipment availability or installation requirements need review.');
 }
 });
