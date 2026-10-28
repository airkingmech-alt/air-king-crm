import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('homeowner proposal and rebate presentation show saved specifications without model numbers', async () => {
 const temp=await mkdtemp(path.join(process.cwd(),'.homeowner-view-test-'));
 try {
  await build({stdin:{contents:`
   import React from 'react';
   import {renderToStaticMarkup} from 'react-dom/server';
   import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
   import {Router,Route} from 'wouter';
   import CustomerDocument from './client/src/pages/customer-document';
   import Proposal from './client/src/pages/proposal';
   import {QuoteRebates} from './client/src/components/quote-rebates';
   import {potentialChampionRebates} from './shared/champion-rebates';
   const rebateOffer=potentialChampionRebates([{brand:'Champion',category:'Furnace',model:'Z9ET080B12SMPS1'}]);
   const option={tier:'Good',label:'Comfort choice',manualConfiguration:true,customerPrice:9454.76,equipmentItems:['chp-xc336','chp-ec36bn','chp-z9t080'],equipment:'XC336E2S11 + CTM36B5ADN1 + Z9ET080B12SMPS1',equipmentSummary:'3-ton Champion AC — XC336E2S11\\n3-ton Champion coil — CTM36B5ADN1\\n97% efficient, 80,000 BTU Champion furnace — Z9ET080B12SMPS1',homeownerEquipment:['13.4 SEER2, 3-ton Champion AC','3-ton Champion coil','97% efficient, 80,000 BTU Champion furnace'],efficiency:'XC336E2S11: approx. 13.4 SEER2 equipment series',features:['10-year parts warranty','10-year labor warranty'],rebateOffer};
   export function render(status){
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    const document={number:'TEST',title:'Install XC336E2S11 equipment',scope:'Install the selected XC336E2S11 equipment and complete startup.',customerName:'Test Customer',status,selectedOption:'Good',selectedAddOns:[],addOnCatalog:[],equipmentItems:option.equipmentItems,equipmentSelectionMode:'explicit',options:[option]};
    client.setQueryData(['public-document','test'],{kind:'quote',document});
    const html=renderToStaticMarkup(<QueryClientProvider client={client}><Router ssrPath='/customer/test'><Route path='/customer/:token'><CustomerDocument/></Route></Router></QueryClientProvider>);
    client.clear();return html;
   }
   export function renderStaff(){
    const quote={id:'staff-test',customerId:'test',customerName:'Test Customer',status:'Draft',title:'Install XC336E2S11 equipment',laborDescription:'Install XC336E2S11 and complete startup.',options:[option],equipmentItems:option.equipmentItems,equipmentSelectionMode:'explicit',selectedAddOns:[],laborCost:1200,materialsCost:450,createdAt:'2026-10-27',taxRate:.09};
    globalThis.__staffViewData={quotes:[quote],invoices:[],workOrders:[]};
    return renderToStaticMarkup(<Router ssrPath='/proposals/staff-test'><Route path='/proposals/:id'><Proposal/></Route></Router>);
   }
   export function internalRebate(){return renderToStaticMarkup(<QuoteRebates offer={rebateOffer} today='2026-10-27'/>)}
  `,resolveDir:process.cwd(),loader:'tsx'},outfile:path.join(temp,'render.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.jpg':'dataurl','.css':'empty'},plugins:[{name:'no-network',setup(b){b.onResolve({filter:/^@\/lib\/confirmed-save$/},()=>({path:'save',namespace:'view-save'}));b.onLoad({filter:/.*/,namespace:'view-save'},()=>({contents:'export const guardSave=(key,action)=>action;'}));b.onResolve({filter:/^@\/context\/data-context$/},()=>({path:'data',namespace:'view-data'}));b.onLoad({filter:/.*/,namespace:'view-data'},()=>({contents:'export function useData(){return globalThis.__staffViewData}'}));b.onResolve({filter:/^@\/components\/(document-actions|document-editors|delete-record)$/},()=>({path:'staff-controls',namespace:'view-controls'}));b.onLoad({filter:/.*/,namespace:'view-controls'},()=>({contents:'export const DocumentActions=()=>null;export const QuoteEditor=()=>null;export const DeleteRecord=()=>null;'}));b.onResolve({filter:/^@\/lib\/crm-api$/},()=>({path:'crm',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function crm(){throw Error("Network forbidden in presentation test")}' }));}}]});
  const {render,renderStaff,internalRebate}=await import(pathToFileURL(path.join(temp,'render.mjs')).href);
  for(const status of ['Draft','Won']) {
   const html=render(status);
   assert.doesNotMatch(html,/XC336E2S11|CTM36B5ADN1|Z9ET080B12SMPS1/);
   assert.match(html,/13\.4 SEER2/);assert.match(html,/3-ton Champion coil/);
   assert.match(html,/97% efficient, 80,000 BTU Champion furnace/);
   assert.match(html,/\$9,454\.76/);
   assert.match(html,/10-year parts warranty/);assert.match(html,/10-year labor warranty/);
   assert.match(html,/Champion furnace/);assert.match(html,/\$165 base rebate/);assert.match(html,/\$200 total bonus/);
  }
  const staff=renderStaff();
  const technical=staff.match(/<details class="no-print[^"]*"[\s\S]*?<\/details>/g) || [];
  assert.ok(technical.some((section:string)=>section.includes('XC336E2S11')&&section.includes('CTM36B5ADN1')&&section.includes('Z9ET080B12SMPS1')),'staff keeps exact models in print-hidden technical details');
  const printable=technical.reduce((html:string,section:string)=>html.replace(section,''),staff);
  assert.doesNotMatch(printable,/XC336E2S11|CTM36B5ADN1|Z9ET080B12SMPS1/);
  assert.match(printable,/97% efficient, 80,000 BTU Champion furnace/);
  assert.match(internalRebate(),/Z9ET080B12SMPS1/,'internal rebate review retains its exact model');
 } finally {await rm(temp,{recursive:true,force:true});}
});
