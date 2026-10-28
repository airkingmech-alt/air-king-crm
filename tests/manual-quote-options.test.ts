import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManualQuoteOption, buildManualQuoteOptions, manualOptionInput, type ManualQuoteOptionInput } from '../client/src/lib/manual-quote-options';
import { buildQuoteDraft, calculateQuotePricing } from '../client/src/lib/quote-pricing';
import { pricebook } from '../client/src/data/pricebook';
import { publicFields } from '../server/crm/core';
import { quoteEfficiencyDeliveryBody, approximateEfficiencyDisclosure } from '../shared/quote-efficiency';
const input=(changes:Partial<ManualQuoteOptionInput>={}):ManualQuoteOptionInput=>({tier:'Value',label:'My Guardian package',equipmentItems:['grd-rc336','grd-rg080b','chp-ec36bn'],laborCost:1200,materialsCost:450,partsWarranty:true,laborWarranty:false,rebateConfirmed:false,...changes});
// Resolve Guardian IDs from models so this test checks actual catalog models.
const guardianIds=['RC336E2S11','RG19080B12MPS1','CTM36B5ADN1'].map(model=>pricebook.find(i=>i.model===model)!.id);
const base=(changes:Partial<ManualQuoteOptionInput>={})=>input({equipmentItems:guardianIds,...changes});
test('manual options are independent: exact equipment, warranty flags, labor, materials and price',()=>{
 const configs=[base(),base({tier:'Good',label:'Champion labor covered',equipmentItems:['chp-xc636','chp-z9t080','chp-ec36bn'],laborCost:900,materialsCost:200,laborWarranty:true})];
 const options=buildManualQuoteOptions(configs);
 assert.equal(options.length,2);assert.deepEqual(options[0].equipmentItems,guardianIds);
 assert.equal(options[0].customerPrice,6492.20);assert.equal(options[0].laborWarrantyCost,0);
 assert.equal(options[1].laborWarrantyCost,350);
 assert.equal(options[1].customerPrice,calculateQuotePricing(options[1].equipmentCost!,1250,200).customerPrice);
 assert.equal(options[0].rebateOffer,undefined);assert.equal(options[1].rebateOffer,undefined);
 for(const parts of [true,false])for(const labor of [true,false]) {
  const o=buildManualQuoteOption(base({partsWarranty:parts,laborWarranty:labor}));
  assert.equal(o.features.includes('10-year parts warranty'),parts);
  assert.equal(o.features.includes('10-year labor warranty'),labor);
  assert.equal(o.laborWarrantyCost,labor?350:0);
 }
 assert.deepEqual(buildManualQuoteOptions(configs)[0],options[0]);
});
test('rebate must be affirmatively confirmed, never reduces price, cannot be fabricated from unlisted models',()=>{
 const config=base({equipmentItems:['chp-xc636','chp-z9t080','chp-ec36bn'],laborWarranty:true});
 const no=buildManualQuoteOption(config,pricebook,'2026-10-27');
 const yes=buildManualQuoteOption({...config,rebateConfirmed:true},pricebook,'2026-10-27');
 assert.equal(yes.customerPrice,no.customerPrice);assert.equal(yes.totalCost,no.totalCost);
 assert.equal(yes.rebateOffer!.items.reduce((s,i)=>s+i.base,0),465);
 assert.equal(yes.rebateOffer!.items.reduce((s,i)=>s+i.bonusTotal,0),565);
 assert.throws(()=>buildManualQuoteOption(base({rebateConfirmed:true}),pricebook,'2026-10-27'),/No current suggested rebate/);
 assert.throws(()=>buildManualQuoteOption({...config,rebateConfirmed:true},pricebook,'2027-01-01'),/No current suggested rebate/);
});
test('saved JSON round trip preserves option-specific costs and selling override, public view does not leak cost',()=>{
 const configs=[base(),base({tier:'Good',label:'Second independent package',laborCost:600,materialsCost:100,laborWarranty:true,customerPriceOverride:9999.99})];
 const draft=buildQuoteDraft({customerId:'synthetic',customerName:'Test',title:'Choose a package',jobType:'Changeout',equipmentItems:[],equipmentCost:0,laborCost:0,materialsCost:0,manualOptions:configs},'TEST','2026-10-27');
 const saved=JSON.parse(JSON.stringify(draft));
 assert.equal(saved.options.length,2);assert.equal(saved.options[1].customerPrice,9999.99);
 assert.deepEqual(manualOptionInput(saved.options[1]),{...configs[1],manualEquipment:[]});
 assert.deepEqual(saved.equipmentItems,guardianIds);assert.equal(saved.laborCost,1200);
 const pub=publicFields('quote',saved);
 assert.equal(pub.options[1].manualConfiguration,true);assert.equal(pub.options[1].label,configs[1].label);
 for(const key of ['totalCost','equipmentCost','laborCost','materialsCost','laborWarrantyCost','manualEquipment','customerPriceOverride']) assert.equal(pub.options[1][key],undefined,key);
 assert.ok(quoteEfficiencyDeliveryBody('Scope',saved.options).includes(approximateEfficiencyDisclosure));
});
test('missing prices, invalid costs, duplicate identities, excluded furnace and known refrigerant conflict reject',()=>{
 for(const cost of [NaN,Infinity,-1,.001])assert.throws(()=>buildManualQuoteOption(base({laborCost:cost})),/Labor cost/);
 assert.throws(()=>buildManualQuoteOptions([]),/one to four/);
 assert.throws(()=>buildManualQuoteOptions([base(),base()]),/one to four/);
 assert.throws(()=>buildManualQuoteOption(base({equipmentItems:['missing']})),/missing or duplicated/);
 const zero=pricebook.map(i=>i.id===guardianIds[0]?{...i,cost:0}:i);
 assert.throws(()=>buildManualQuoteOption(base(),zero),/positive/);
 const bad=pricebook.map(i=>i.id===guardianIds[2]?{...i,description:'R410A coil'}:i);
 assert.throws(()=>buildManualQuoteOption(base(),bad),/refrigerant mismatch/);
 const excluded={...pricebook.find(i=>i.id===guardianIds[1])!,id:'forbidden',model:'RG19080C20MPS1'};
 assert.throws(()=>buildManualQuoteOption(base({equipmentItems:['forbidden']}),[...pricebook,excluded]),/unavailable/);
});
test('manual equipment has an explicit cost, stays private, does not manufacture rebate eligibility',()=>{
 const manual={...pricebook.find(i=>i.model==='XC636E2S11')!,id:'manual-example'};
 const o=buildManualQuoteOption(base({equipmentItems:[],manualEquipment:[manual],partsWarranty:false}));
 assert.equal(o.equipment,manual.model);assert.equal(o.equipmentCost,manual.cost);assert.deepEqual(o.equipmentItems,[]);
 assert.deepEqual(manualOptionInput(o).manualEquipment,[manual]);
 assert.throws(()=>buildManualQuoteOption(base({equipmentItems:[],manualEquipment:[manual],rebateConfirmed:true}),pricebook,'2026-10-27'),/No current suggested rebate/);
});
