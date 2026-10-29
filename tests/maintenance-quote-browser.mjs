// Local synthetic browser QA; never connects to Supabase or real customer records.
// Run after npm ci: node tests/maintenance-quote-browser.mjs
// Requires local Chromium (or CHROMIUM_PATH); ports 5189/9339 must be free.
// --serve-only exposes the same fixture for manual browser inspection.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import WebSocket from "ws";
const root=process.cwd(), fixture=await mkdtemp(path.join(root,"client/.maintenance-qa-")), profile=await mkdtemp(path.join(tmpdir(),"maintenance-chrome-"));
let vite, chrome, ws;
try {
  await writeFile(path.join(fixture,"index.html"),'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script>');
  await writeFile(path.join(fixture,"mock-auth.ts"),'export function useAuth(){return {profile:{id:"test-owner",company_id:"test-company",full_name:"QA Owner",role:"owner",permissions:{}}};}');
  await writeFile(path.join(fixture,"mock-api.ts"),'export async function crm(path){if(path==="crm/addresses/autocomplete")return {suggestions:[],available:false};throw Error("Unexpected synthetic API request: "+path)}');
  await writeFile(path.join(fixture,"mock-supabase.ts"),`
    const accessory={id:"catalog-surge",name:"HVAC Surge Protector",sku:"ADDON-surge-protector",category:"Add-ons",item_type:"service",unit:"each",cost_cents:0,price_cents:19900,active:true};
    const initial={price_book_items:[accessory],customers:[{id:"qa-customer",name:"Synthetic Customer",type:"Residential",contacts:[{name:"Synthetic Customer",phone:"5555550100",email:"test@example.invalid",role:"Primary"}],properties:[{id:"qa-property",address:"100 Test Street, Unit 2",street:"100 Test Street",unit:"Unit 2",city:"Test City",state:"MO",zip:"00000",systems:[{id:"qa-system",model:"KEEP-ME"}]}],billingAddress:{street:"200 Billing Street",unit:"",city:"Other City",state:"MO",postalCode:"00001"},leadSource:"Other",leadStatus:"New",activity:[],tags:[],createdAt:"2026-10-08"}],quotes:[],invoices:[],work_orders:[],memberships:[]};
    const stored=localStorage.getItem("maintenance-qa");window.__qa={records:stored?JSON.parse(stored):initial,saves:0,fail:false,delay:0};
    const persist=()=>localStorage.setItem("maintenance-qa",JSON.stringify(window.__qa.records));
    export function extractEntities(rows){return rows.map(row=>row.data)}
    export const supabase={from(table){return {select(){return this},eq(){return this},order(){return this},async range(){return {data:(window.__qa.records[table]||[]).map(data=>table==="price_book_items"?structuredClone(data):({data:structuredClone(data)})),error:null}}}},async rpc(name,p){
      const q=window.__qa;q.saves++;await new Promise(resolve=>setTimeout(resolve,q.delay));if(q.fail)return {data:null,error:{message:"Synthetic offline failure"}};
      if(name==="crm_save_records"){const saved=[];for(const rec of p.p_records){const rows=q.records[rec.table],old=rows.find(row=>row.id===rec.id);if(old&&JSON.stringify(old)!==JSON.stringify(rec.previous))return {data:null,error:{message:"This record changed. Refresh and review before saving again."}};const data=structuredClone(rec.data);q.records[rec.table]=[...rows.filter(row=>row.id!==rec.id),data];saved.push(data)}persist();return {data:saved,error:null}}
      if(name==="crm_edit_document"){const rows=q.records[p.p_kind+"s"],old=rows.find(row=>row.id===p.p_id);if(JSON.stringify(old)!==JSON.stringify(p.p_previous))return {data:null,error:{message:"This record changed. Refresh and review before saving again."}};const data={...old,...p.p_changes,editHistory:[...(old.editHistory||[]),{at:new Date().toISOString(),actorId:"test-owner",before:old.title||old.amount,changes:p.p_changes}]};q.records[p.p_kind+"s"]=rows.map(row=>row.id===old.id?data:row);persist();return {data:structuredClone(data),error:null}}
      throw Error("Unexpected synthetic RPC: "+name)
    }};
  `);
  await writeFile(path.join(fixture,"main.tsx"),`
    import React from "react";import{createRoot}from"react-dom/client";import{QueryClient,QueryClientProvider}from"@tanstack/react-query";import{DataProvider,useData}from"@/context/data-context";import Proposal from "@/pages/proposal";import Quotes from "@/pages/quote-builder";import CustomerDetail from "@/pages/customer-detail";import{Toaster}from"@/components/ui/toaster";import{Router,Route,Switch}from"wouter";import{useHashLocation}from"wouter/use-hash-location";import "@/index.css";
    function Fixture(){const d=useData();window.__qa.context=d;return <Switch><Route path="/customers/:id"><CustomerDetail/></Route><Route path="/proposals/:id"><Proposal/></Route><Route><Quotes/></Route></Switch>}
    createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><Router hook={useHashLocation}><DataProvider><Fixture/><Toaster/></DataProvider></Router></QueryClientProvider>);
  `);
  vite=await createServer({configFile:false,optimizeDeps:{entries:[path.join(fixture,"main.tsx")]},root:path.join(root,"client"),plugins:[react()],resolve:{alias:[{find:"@shared",replacement:path.join(root,"shared")},{find:"@/context/auth-context",replacement:path.join(fixture,"mock-auth.ts")},{find:"@/lib/supabase",replacement:path.join(fixture,"mock-supabase.ts")},{find:"./supabase",replacement:path.join(fixture,"mock-supabase.ts")},{find:"@/lib/crm-api",replacement:path.join(fixture,"mock-api.ts")},{find:"@",replacement:path.join(root,"client/src")}]},server:{host:"127.0.0.1",port:5189,strictPort:true}});await vite.listen();
  const url=`http://127.0.0.1:5189/${path.basename(fixture)}/index.html`;
  if(process.argv.includes("--serve-only")){console.log(url);await new Promise(resolve=>process.on("SIGINT",resolve));}else{
    chrome=spawn(process.env.CHROMIUM_PATH||"chromium",["--headless","--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--remote-debugging-port=9339",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});chrome.stderr.on("data",data=>process.stderr.write(data));
    let tabs;for(let n=0;n<60;n++){try{tabs=await(await fetch("http://127.0.0.1:9339/json")).json();break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}assert.ok(tabs,"Chromium debugger must be available; this is an environment prerequisite, not a passing UI check.");
    ws=new WebSocket(tabs.find(tab=>tab.type==="page").webSocketDebuggerUrl);await new Promise(resolve=>ws.on("open",resolve));let id=0;const pending=new Map();ws.on("message",data=>{const msg=JSON.parse(data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result)}});
    const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
    const evaluate=async expression=>{const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value};
    const wait=async expression=>{for(let n=0;n<150;n++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,75))}throw Error("Timed out: "+expression+"\n"+await evaluate("document.body.innerText"))};
    const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)};
    const set=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    const labeled=label=>`label:has(> span:first-child):nth-child(n)`; // Label search uses visible text, keeping tests tied to accessible controls.
    const setLabel=async(label,value)=>{await evaluate(`document.querySelectorAll('[data-qa-field]').forEach(e=>e.removeAttribute('data-qa-field'));Array.from(document.querySelectorAll('label')).find(e=>e.firstElementChild?.textContent===${JSON.stringify(label)}).querySelector('input,textarea,select').setAttribute('data-qa-field','current')`);await set('[data-qa-field="current"]',value)};
    const cancel=()=>evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.trim()==='Cancel').click()`);
    await send("Page.enable");await send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});await send("Page.navigate",{url});await wait("document.body.innerText.includes('New Quote')");
    const button=async text=>{await wait(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===${JSON.stringify(text)})`);await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`)};
    const fill=async()=>{await set('[data-testid="service-description"]','Furnace tune-up — heating only, one system');await set('[data-testid="service-price"]','99');};
    await button('New Quote');await click('[data-testid="service-only-toggle"]');
    assert.equal(await evaluate("document.querySelector('[data-testid=save-maintenance]').disabled"),true);
    await click('[data-testid="select-quote-customer"]');await wait("!!document.querySelector('[cmdk-item]')");await click('[cmdk-item]');
    await fill();await wait("!document.querySelector('[data-testid=save-maintenance]').disabled");
    await evaluate("window.__qa.delay=250;window.__qa.before=window.__qa.saves");
    await evaluate("document.querySelector('[data-testid=save-maintenance]').click();document.querySelector('[data-testid=save-maintenance]').click()");
    await wait("document.body.innerText.includes('Maintenance service terms')");assert.equal(await evaluate("window.__qa.saves-window.__qa.before"),1);
    assert.equal(await evaluate("window.__qa.records.quotes[0].options[0].customerPrice"),99);
    assert.deepEqual(await evaluate("window.__qa.records.quotes[0].equipmentItems"),[]);
    assert.ok(await evaluate("document.body.innerText.includes('$99.00') && !document.body.innerText.includes('10-year')"));
    await evaluate("location.hash='/customers/qa-customer'");await wait("!!document.querySelector('[data-testid=button-customer-new-quote]')");
    const openMaintenance=async()=>{await click('[data-testid="button-customer-new-quote"]');await click('[data-testid="select-quote-job-type"]');await wait("Array.from(document.querySelectorAll('[role=option]')).some(e=>e.textContent==='Maintenance')");await evaluate("Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent==='Maintenance').click()");await wait("!!document.querySelector('[data-testid=maintenance-form]')")};
    await openMaintenance();await fill();await evaluate("window.__qa.fail=true");await click('[data-testid="save-maintenance"]');await wait("document.body.innerText.includes('Synthetic offline failure')");
    assert.equal(await evaluate("document.querySelector('[data-testid=service-price]').value"),'99');await button('Cancel');assert.equal(await evaluate("window.__qa.records.quotes.length"),1);
    await openMaintenance();assert.equal(await evaluate("document.querySelector('[data-testid=service-description]').value"),'');await fill();await evaluate("window.__qa.fail=false");
    await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await wait("document.querySelector('[role=dialog]').getBoundingClientRect().right<=391");
    await evaluate("document.querySelectorAll('[toast-close]').forEach(e=>e.click())");await new Promise(r=>setTimeout(r,350));
    const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/maintenance-mobile.png',Buffer.from(shot.data,'base64'));
    await click('[data-testid="save-maintenance"]');await wait("!document.querySelector('[data-testid=maintenance-form]')");assert.equal(await evaluate("window.__qa.records.quotes.length"),2);
    assert.equal(await evaluate("window.__qa.records.quotes[1].jobType"),'Maintenance');
    await openMaintenance();await fill();await evaluate("window.__qa.delay=700");await click('[data-testid="save-maintenance"]');await evaluate("location.hash='/quotes'");await wait("location.hash==='#/quotes' && window.__qa.records.quotes.length===3");
    await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate("location.hash"),'#/quotes');
    await evaluate("location.hash='/customers/qa-customer';window.__qa.delay=0");
    await click('[data-testid="button-customer-new-quote"]');await wait("!!document.querySelector('[data-testid=manual-quote-builder]')");
    assert.equal(await evaluate("document.querySelectorAll('[data-testid=manual-option]').length"),0);
    await button('Add option');await set('select[aria-label="Option 1 add Condenser"]','chp-xc336');
    await wait("document.querySelector('[aria-label=\"Option 1 pricing\"]').innerText.includes('$4,654.19')");
    await button('Duplicate option');await wait("document.querySelectorAll('[data-testid=manual-option]').length===2");
    await wait("!!document.querySelector('select[aria-label=\"Option 1 add Surge protection\"] option[value=\"catalog-surge\"]')");
    assert.equal(await evaluate("document.querySelector('select[aria-label=\"Option 1 add Electrical whip\"]').disabled"),true);
    await set('select[aria-label="Option 1 add Surge protection"]','catalog-surge');
    await set('input[aria-label="Option 1 HVAC Surge Protector quantity"]','2');
    await wait("document.querySelector('[aria-label=\"Option 1 pricing\"]').innerText.includes('$5,052.19')");
    await set('input[aria-label="Option 2 labor cost"]','1300');
    await evaluate("Array.from(document.querySelectorAll('[data-testid=manual-option]')[1].querySelectorAll('label')).find(e=>e.textContent.includes('10-year labor warranty')).querySelector('input').click()");
    await click('[data-testid="button-generate-quote"]');await wait("!document.querySelector('[data-testid=manual-quote-builder]')");
    const manual=await evaluate("window.__qa.records.quotes[3]");assert.equal(manual.options.length,2);
    assert.ok(manual.options.every(o=>o.manualConfiguration));assert.equal(manual.options[0].laborCost,1200);assert.equal(manual.options[1].laborCost,1300);assert.equal(manual.options[1].laborWarrantyCost,350);
    assert.equal(manual.options[1].customerPrice-manual.options[0].customerPrice,164.5);
    assert.equal(manual.options[0].accessories[0].quantity,2);assert.equal(manual.options[1].accessories.length,0);
    await evaluate("location.reload()");await wait("window.__qa?.records.quotes.length===4");
    assert.equal(await evaluate("window.__qa.records.quotes[3].options[0].accessories[0].quantity"),2);
    await evaluate("location.hash='/proposals/'+window.__qa.records.quotes[3].id");
    await click('[data-testid="button-edit-quote"]');
    await set('input[aria-label="Option 1 HVAC Surge Protector quantity"]','3');
    await click('[data-testid="button-save-quote"]');
    await wait("!document.querySelector('[data-testid=form-edit-quote]')");
    assert.equal(await evaluate("window.__qa.records.quotes[3].options[0].accessories[0].quantity"),3);
    assert.equal(await evaluate("window.__qa.records.quotes[3].options[0].customerPrice"),5251.19);
    assert.ok(await evaluate("document.body.innerText.includes('3 each × HVAC Surge Protector')"));
    console.log('PASS: both maintenance routes plus customer-detail manual quote builder; empty validation, exact $99, no equipment, duplicate clicks, failure retention, cancel/reopen, mobile, pending-save navigation, independent manual options, live-pricebook accessory selection, missing whip, quantities, reload, editing, proposal text and $350 warranty. Synthetic records only.');

  }
} finally {ws?.close();chrome?.kill();await vite?.close();await rm(fixture,{recursive:true,force:true});await rm(profile,{recursive:true,force:true}).catch(()=>{});}
