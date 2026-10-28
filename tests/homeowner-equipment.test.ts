import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricebook } from '../client/src/data/pricebook';
import { formatHomeownerEquipment, homeownerEquipmentLines, homeownerOption, homeownerText } from '../shared/homeowner-equipment';
import { buildManualQuoteOption } from '../client/src/lib/manual-quote-options';
import { publicFields } from '../server/crm/core';
const byModel=(model:string)=>pricebook.find(i=>i.model===model)!;
test('homeowner descriptions use actual selected capacities and accurate SEER/SEER2 and AFUE',()=>{
 assert.equal(formatHomeownerEquipment(byModel('XC336E2S11')),'3-ton, 13.4 SEER2 Champion AC');
 assert.equal(formatHomeownerEquipment(byModel('CTM36B5ADN1')),'3-ton Champion coil');
 assert.equal(formatHomeownerEquipment(byModel('Z9ET080B12SMPS1')),'97% efficient, 80,000 BTU Champion furnace');
 assert.equal(formatHomeownerEquipment(byModel('Z9ES080B12SMPS1')),'96% efficient, 80,000 BTU Champion furnace');
 assert.equal(formatHomeownerEquipment(byModel('Z9ET100C16SMPS1')),'96.8% efficient, 100,000 BTU Champion furnace');
 assert.equal(formatHomeownerEquipment(byModel('Z9ET100C20SMPS1')),'96.4% efficient, 100,000 BTU Champion furnace');
 assert.equal(formatHomeownerEquipment(byModel('XC648E2S11')),'4-ton, 16+ SEER2 Champion AC');
 assert.equal(formatHomeownerEquipment({...byModel('XC336E2S11'),model:'OTHER123',tier:'16 SEER'}),'3-ton, 16 SEER Champion AC');
});
test('unknown/manual equipment never acquires invented specifications',()=>{
 assert.equal(formatHomeownerEquipment({brand:'Champion',model:'CUSTOM123',category:'Condenser',description:'Special order AC'}),'Champion AC');
 assert.equal(formatHomeownerEquipment({brand:'Guardian',model:'CUSTOM456',category:'Furnace',description:'Special order furnace'}),'Guardian furnace');
 assert.deepEqual(homeownerEquipmentLines({equipment:'UNKNOWN123'}),[]);
 assert.equal(homeownerOption({equipment:'UNKNOWN123'}).equipment,'Equipment details available on request');
 assert.deepEqual(homeownerEquipmentLines({equipment:'UNKNOWN123',equipmentSummary:'Existing saved special order unit — UNKNOWN123'}),['Existing saved special order unit']);
});
test('snapshot labels survive public projection and repeated display without changing selected equipment or price',()=>{
 const input={tier:'Best' as const,label:'Premium choice',equipmentItems:['chp-xc336','chp-ec36bn','chp-z9t080'],laborCost:1200,materialsCost:450,partsWarranty:true,laborWarranty:true,rebateConfirmed:false};
 const option=buildManualQuoteOption(input), before=structuredClone(option);
 assert.match(option.equipment,/XC336E2S11.*Z9ET080B12SMPS1/);
 assert.doesNotMatch(option.equipmentSummary!,/XC336|CTM36|Z9ET080/);
 const projected=publicFields('quote',{options:[option],title:'Proposal',laborDescription:'Install XC336E2S11. Do not move gas service.'}).options[0];
 assert.deepEqual(homeownerOption(projected),homeownerOption(option));
 assert.equal(projected.customerPrice,option.customerPrice);
 assert.ok(projected.features.includes('10-year parts warranty'));assert.ok(projected.features.includes('10-year labor warranty'));
 assert.deepEqual(option,before);
 assert.equal(homeownerText('Do not move XC336E2S11 until approved.',[option]),'Do not move 3-ton, 13.4 SEER2 Champion AC until approved.');
 assert.equal(homeownerText('No electrical upgrade included.',[option]),'No electrical upgrade included.');
 assert.equal(homeownerText('Do not substitute XC336E2S110.',[option]),'Do not substitute XC336E2S110.');
});
test('legacy summary fallback does not use current catalog or rewrite saved snapshot',()=>{
 const option={equipment:'OLD123 + OTHER456',equipmentSummary:'Saved custom AC 15 SEER — OLD123\nSaved furnace 80% AFUE — OTHER456',efficiency:'OLD123: approx. 15 SEER series',features:['Manufacturer warranty']};
 const original=JSON.stringify(option);
 assert.deepEqual(homeownerEquipmentLines(option),['Saved custom AC 15 SEER','Saved furnace 80% AFUE']);
 assert.equal(homeownerOption(option).efficiency,'');
 assert.deepEqual(homeownerOption(homeownerOption(option)),homeownerOption(option));
 assert.equal(JSON.stringify(option),original);
 const legacyNoRating={equipment:'OLD123',equipmentSummary:'Saved 3-ton AC — OLD123',efficiency:'OLD123: approx. 13.4 SEER2 series'};
 assert.deepEqual(homeownerOption(homeownerOption(legacyNoRating)),homeownerOption(legacyNoRating));
});
