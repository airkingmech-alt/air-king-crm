import {test} from 'node:test';
import assert from 'node:assert/strict';
import {potentialChampionRebates,championRebateSummary,publicChampionRebateOffer} from '../shared/champion-rebates';
import {buildQuoteDraft,buildQuoteOptions,calculateQuotePricing} from '../client/src/lib/quote-pricing';
import {publicFields} from '../server/crm/core';
const equipment=(model:string,category='Furnace',brand='Champion')=>({model,category,brand});
test('2026 flyer model families, type and brand determine potential rebates, never efficiency',()=>{
  const offer=potentialChampionRebates([equipment('XC636E2S11','Condenser'),equipment('Z9ET080C16SMPS1')])!;
  assert.deepEqual(offer.items.map(i=>[i.base,i.bonusTotal]),[[300,365],[165,200]]);
  assert.deepEqual(championRebateSummary(offer,'2026-10-27').combined,{base:465,bonusTotal:565});
  assert.equal(offer.items.reduce((s,i)=>s+i.bonusTotal,0),565,'bonus is total, not 1030 added to base');
  for(const model of ['TM8V080B12MP12C','TM8Y080B12MP12C','TM9V080B12MP12C','TM9Y080B12MP12C','Z8ET080B12SMPS1','Z8VT080B12SMPS1','Z9VT080B12SMPS1','Z9ET080C16SMPS1']) assert.equal(potentialChampionRebates([equipment(model)])?.items[0].base,165);
  for(const model of ['TP9C080B12MP12C','TPLC080B12MP12C','Z9VV080B12SMPS1']) assert.equal(potentialChampionRebates([equipment(model)])?.items[0].base,220);
  for(const item of [equipment('XC636E2S11','Condenser','Guardian'),equipment('XC636E2S11','Accessory'),equipment('PREFIX-XC636E2S11','Condenser'),equipment('XC6FAKE','Condenser'),equipment('XC336E2S11','Condenser'),equipment('XC436E2S11','Condenser'),equipment('CTM36C5ADS1','Evaporator Coil'),equipment('Z9ES080C16SMPS1'),equipment('XH936E2S11','Condenser')]) assert.equal(potentialChampionRebates([item]),undefined,JSON.stringify(item));
  const furnaceOnly=potentialChampionRebates([equipment('XC436E2S11','Condenser'),equipment('Z9ET080C16SMPS1')])!;
  assert.equal(furnaceOnly.items.length,1);assert.equal(furnaceOnly.items[0].base,165);
});
test('eligible selected heat pumps and air handlers list amounts without inventing combination totals',()=>{
  for(const [model,base,bonus] of [['XH936E2S11',360,430],['XH636E2S11',300,365],['HH836E2S11',300,365],['XH536E2S11',250,300]] as const) {
    const offer=potentialChampionRebates([equipment(model,'Heat Pump'),equipment('JHE36C5ADS1','Air Handler')])!;
    assert.deepEqual(offer.items.map(i=>[i.base,i.bonusTotal]),[[base,bonus],[75,90]]);
    assert.equal(championRebateSummary(offer).combined,undefined);
  }
});
test('fixed 2026 window warns before/after dates; no next-year rollover or duplicate-model multiplication',()=>{
  const item=equipment('XC636E2S11','Condenser');const offer=potentialChampionRebates([item,item])!;
  assert.equal(offer.items.length,1);
  assert.equal(championRebateSummary(offer,'2025-12-31').beforeWindow,true);
  for(const date of ['2026-01-01','2026-12-31']) assert.equal(championRebateSummary(offer,date).expired,false);
  assert.equal(championRebateSummary(offer,'2027-01-01').expired,true);
  assert.equal(offer.installationEnd,'2026-12-31');
});
test('rebates persist per selected option and public snapshot without changing quote cost, price, or private data',()=>{
  const input={customerId:'synthetic',customerName:'Test',jobType:'Changeout',title:'Rebate test',equipmentCost:0,laborCost:960,materialsCost:200,equipmentItems:['chp-xc636']};
  const q=buildQuoteDraft(input,'TEST','2026-10-27');const option=q.options[0];
  assert.equal(option.rebateOffer?.items[0].base,300);
  assert.equal(option.customerPrice,calculateQuotePricing(option.equipmentCost!,960,200).customerPrice);
  assert.deepEqual(publicFields('quote',q).options[0].rebateOffer,option.rebateOffer);
  const privateOffer={...option.rebateOffer,secret:'private',items:option.rebateOffer!.items.map(i=>({...i,cost:999}))};
  assert.doesNotMatch(JSON.stringify(publicChampionRebateOffer(privateOffer)),/private|secret|cost/);
  const accepted={...q,status:'Won',acceptedScope:{selectedOption:'Better',option:{...option,rebateOffer:option.rebateOffer}}};
  assert.deepEqual(publicFields('quote',accepted).options[0].rebateOffer,option.rebateOffer);
  const none=buildQuoteOptions({...input,equipmentItems:['chp-xc336']});
  assert.equal(none.options[0].rebateOffer,undefined);
});

test('equipment recalculation refreshes rebate eligibility and manual descriptions clear stale offers',async()=>{
  const {quoteEditForm,recalculateQuoteOption}=await import('../client/src/lib/document-editing');
  const q=buildQuoteDraft({customerId:'test',customerName:'Test',jobType:'Changeout',title:'Test',equipmentCost:0,laborCost:960,materialsCost:200,equipmentItems:['chp-xc636']},'TEST','2026-10-27');
  const option=quoteEditForm(q).options[0];
  assert.equal(recalculateQuoteOption(option,['chp-xc336'],'960','200').rebateOffer,undefined);
  assert.equal(recalculateQuoteOption(option,['chp-z9t080c16'],'960','200').rebateOffer?.items[0].base,165);
  const {readFileSync}=await import('node:fs');
  assert.match(readFileSync('client/src/components/document-editors.tsx','utf8'),/equipmentItems: \[\], rebateOffer: undefined/);
});
