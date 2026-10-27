import {test} from "node:test";
import assert from "node:assert/strict";
import {newHouseQuoteInput} from "../client/src/lib/new-house-quote";
import {buildQuoteDraft,calculateQuotePricing} from "../client/src/lib/quote-pricing";
import {pricebook} from "../client/src/data/pricebook";
import {publicFields} from "../server/crm/core";
const customer={id:"qa-customer",name:"Synthetic Customer"};
const project={customer:customer.name,address:"100 Synthetic Street",email:"",phone:"",projectName:"New House",squareFeet:"2000",floors:"1",foundation:"Slab",notes:"INTERNAL SUPPLIER NEGOTIATION"};
const equipment=pricebook.filter(x=>x.brand==="Guardian").slice(0,2);
const lines=[...equipment.map((item,id)=>({id,category:"Equipment",description:item.description,equipmentId:item.id,qty:1,unit:"EA",cost:item.cost})),{id:3,category:"Materials",description:"Duct",qty:3,unit:"EA",cost:10.25},{id:4,category:"Labor",description:"Crew",qty:2,unit:"DAY",cost:960},{id:5,category:"Other Costs",description:"Electrical subcontractor",qty:1,unit:"LS",cost:1200}];
test("original takeoff maps to CRM pricing, draft persistence and private snapshot",()=>{
 const state={project,crewDays:2,equipmentLines:lines.slice(0,2)};
 const input=newHouseQuoteInput(customer,"qa-property",project,lines,state);
 const quote=buildQuoteDraft(input,"Q-test","2026-10-23");
 assert.equal(quote.status,"Draft");assert.equal(quote.jobType,"New Construction");
 assert.equal(quote.materialsCost,30.75);assert.equal(quote.laborCost,3120);
 const pricing=calculateQuotePricing(equipment.reduce((sum,x)=>sum+x.cost,0),3120,30.75);
 assert.equal(quote.options[0].customerPrice,pricing.customerPrice);
 assert.deepEqual(JSON.parse(JSON.stringify(quote)).newHouseSnapshot?.state,state);
 state.crewDays=99;assert.equal(quote.newHouseSnapshot?.state.crewDays,2);
 const publicJson=JSON.stringify(publicFields("quote",quote));
 assert.ok(!publicJson.includes("newHouseSnapshot"));assert.ok(!publicJson.includes("INTERNAL SUPPLIER"));assert.ok(!publicJson.includes("unitCost"));assert.ok(!publicJson.includes("subcontractor"));assert.ok(!publicJson.includes("Crew"));assert.ok(!publicJson.includes("crewDays"));
});
test("invalid costs, quantities, equipment and unknown categories fail before persistence",()=>{
 for(const mutation of [{qty:-1},{cost:Infinity},{cost:-1},{qty:NaN},{category:"Unexpected"}])assert.throws(()=>newHouseQuoteInput(customer,"qa-property",project,[...lines,{...lines[2],...mutation}],{}));
 assert.throws(()=>newHouseQuoteInput(customer,"qa-property",project,[{...lines[0],equipmentId:"missing"},...lines.slice(1)],{}));
 assert.throws(()=>newHouseQuoteInput(customer,"qa-property",project,[{...lines[0],cost:1},...lines.slice(1)],{}));
 assert.throws(()=>newHouseQuoteInput(customer,"qa-property",project,lines,{manualJ:{wallR:Infinity}}));
 assert.throws(()=>newHouseQuoteInput(customer,"",project,lines,{}));
});
test("repeated equipment quantities use explicit catalog IDs and do not mutate source lines",()=>{
 const multiple=lines.map(x=>({...x}));multiple[0].qty=2;const before=structuredClone(multiple);
 const input=newHouseQuoteInput(customer,"qa-property",project,multiple,{});
 assert.equal(input.equipmentItems.filter(x=>x===equipment[0].id).length,2);
 assert.deepEqual(multiple,before);
});

test('new-house flow generates four approximate 80% options without certification and retains takeoff allowances',()=>{
 const selected=['chp-xc336','chp-z8e100c20','chp-ec36cs'].map(id=>pricebook.find(i=>i.id===id)!);
 const takeoff=[...selected.map((item,id)=>({id,category:'Equipment',description:item.description,equipmentId:item.id,qty:1,unit:'EA',cost:item.cost})),...lines.slice(2)];
 const input=newHouseQuoteInput(customer,'qa-property',project,takeoff,{});
 const quote=buildQuoteDraft(input,'Q-test','2026-10-27',pricebook,[]);
 assert.equal(quote.options.length,4);
 assert.equal(quote.materialsCost,30.75);assert.equal(quote.laborCost,3120);
 assert.ok(quote.options.every(o=>o.efficiency.startsWith('Approx.')&&o.features.some(f=>f.includes('An AHRI-certified rating is not represented'))));
 assert.equal(quote.options[3].equipmentItems?.[1],selected[1].id);
});
