import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessoryAvailable, accessoryCatalog, accessoryTotals, snapshotAccessory, type AccessoryCatalogItem } from '../shared/quote-accessories';
import { buildManualQuoteOption, manualOptionInput, type ManualQuoteOptionInput } from '../client/src/lib/manual-quote-options';
import { buildQuoteDraft, calculateQuotePricing } from '../client/src/lib/quote-pricing';
import { quoteEditForm, quoteEditChanges } from '../client/src/lib/document-editing';
import { publicFields } from '../server/crm/core';
// Actual live catalog values read 2026-10-29; test fixtures only, never a runtime fallback.
const surge: AccessoryCatalogItem = {id:'5f004230-fb59-49f9-8590-e4911eef7a06',name:'HVAC Surge Protector',sku:'ADDON-surge-protector',category:'Add-ons',item_type:'service',unit:'each',cost_cents:0,price_cents:19900,active:true};
const humidifier: AccessoryCatalogItem = {id:'a6889504-dc06-438b-b184-5eb003ce5ace',name:'17 GPD Bypass Humidifier with Manual Humidistat',sku:'GNF5950',category:'Indoor Air Quality',item_type:'part',unit:'each',cost_cents:12428,price_cents:15535,active:true};
const base: ManualQuoteOptionInput = {tier:'Value',label:'Installation',equipmentItems:['chp-xc636'],laborCost:1200,materialsCost:450,partsWarranty:false,laborWarranty:false,rebateConfirmed:false,accessories:[]};
test('pricebook snapshots distinguish supplier cost and installed service price; quantities and alternatives remain independent',()=>{
 const accessories=[{...snapshotAccessory(surge),quantity:2},snapshotAccessory(humidifier)];
 const actual=buildManualQuoteOption({...base,accessories});
 const original=buildManualQuoteOption(base);
 const pricing=calculateQuotePricing(original.equipmentCost!,1200,450+124.28);
 assert.equal(actual.customerPrice,Math.round((pricing.customerPrice+398)*100)/100);
 assert.equal(actual.totalCost,pricing.totalCost);assert.equal(actual.purchaseTax,pricing.purchaseTax);
 assert.equal(actual.materialsCost,450,'base materials are retained separately, not compounded on edits');
 assert.equal(accessoryTotals(accessories).missingServiceCost,true);
 assert.equal(buildManualQuoteOption({...base,accessories,customerPriceOverride:8000}).customerPrice,8000);
 assert.deepEqual(buildManualQuoteOption(base),original);
 assert.match(actual.equipmentSummary!,/2 each × HVAC Surge Protector/);
 assert.equal(actual.homeownerEquipment!.filter(line=>line.includes('Humidifier')).length,1);
});
test('save/reload, unchanged edits, changed quantities and overrides preserve snapshots without catalog refresh',()=>{
 const accessories=[snapshotAccessory(surge)];
 const draft=buildQuoteDraft({customerId:'test',customerName:'Test',title:'Accessories',laborDescription:'Install selected equipment',jobType:'Changeout',equipmentItems:[],equipmentCost:0,laborCost:0,materialsCost:0,manualOptions:[{...base,accessories}, {...base,tier:'Good',label:'Other',accessories:[]}]},'test','2026-10-29');
 const saved=JSON.parse(JSON.stringify(draft));
 assert.deepEqual(manualOptionInput(saved.options[0]).accessories,accessories);
 assert.deepEqual(quoteEditChanges(saved,quoteEditForm(saved)),{});
 const form=quoteEditForm(saved);form.options[0].accessories![0].quantity=3;
 const changes=quoteEditChanges(saved,form) as any;
 assert.equal(changes.options[0].customerPrice,saved.options[0].customerPrice+398);
 assert.deepEqual(changes.options[1],saved.options[1]);
 const pub=publicFields('quote',{...saved,...changes});
 assert.equal(pub.options[0].accessories,undefined);assert.doesNotMatch(JSON.stringify(pub),/unitCostCents|sourceUpdatedAt|totalCost/);
 assert.match(pub.options[0].equipmentSummary,/3 each × HVAC Surge Protector/);
 assert.ok(!draft.addOnCatalog!.some(item=>item.id==='surge-protector'));
 const formOverride=quoteEditForm(saved);formOverride.options[0].customerPriceOverride=7777;
 formOverride.options[0].accessories![0].quantity=5;
 assert.equal((quoteEditChanges(saved,formOverride) as any).options[0].customerPrice,7777);
});
test('missing/unpriced/archived records and invalid quantities cannot silently become free accessories',()=>{
 for(const item of [{...surge,active:false},{...surge,price_cents:0},{...humidifier,cost_cents:0},{...surge,unit:''},{...surge,metadata:{price_status:'missing' as const}},{...surge,metadata:{unit_status:'missing' as const}}]) {
  assert.equal(accessoryAvailable(item),false);assert.throws(()=>snapshotAccessory(item),/confirmed price/);
 }
 for(const quantity of [0,-1,1.5,NaN,1001]) assert.throws(()=>accessoryTotals([{...snapshotAccessory(surge),quantity}]),/quantity/);
 assert.throws(()=>accessoryTotals([snapshotAccessory(surge),snapshotAccessory(surge)]),/Duplicate/);
 assert.deepEqual(accessoryCatalog([{...surge,active:false,metadata:{catalog_archived:true}},surge]),[surge]);
 assert.throws(()=>accessoryTotals([snapshotAccessory(humidifier),snapshotAccessory({...surge,id:'installed-humidifier',name:'Whole-Home Humidifier'})]),/double-counting/);
});
