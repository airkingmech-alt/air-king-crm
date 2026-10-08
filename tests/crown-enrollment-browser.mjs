// Synthetic, local-only browser smoke test. No production data or provider calls.
// Prerequisites: npm ci, Node 20+, and a working local Chromium (or CHROMIUM_PATH).
// Run: node tests/crown-enrollment-browser.mjs. Ports 5187 and 9337 must be free.
// Optional: --serve-only opens the same synthetic fixture for manual browser QA.
// Uses existing vite, @vitejs/plugin-react, and ws dev/runtime dependencies.
// This opt-in .mjs test is not part of npm test. It must run where browser and
// Vite share a network namespace; restricted Chromium/sockets are unsupported.
// Synthetic fixtures are temporary client/.crown-qa-* directories, removed on exit.
// Full browser verification was blocked in the implementation sandbox; helper
// and rendered-component checks live in crown-enrollment-ui.test.ts.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import WebSocket from "ws";
import { tmpdir } from "node:os";
const root=process.cwd(),fixture=await mkdtemp(path.join(root,"client/.crown-qa-")),profile=await mkdtemp(path.join(tmpdir(),"crown-chrome-"));
let vite,chrome,ws;
try {
 await writeFile(path.join(fixture,"index.html"),'<div id="root"></div><script type="module" src="./main.tsx"></script>');
 await writeFile(path.join(fixture,"main.tsx"),`import React from "react";import{createRoot}from"react-dom/client";import{QueryClient,QueryClientProvider}from"@tanstack/react-query";import CrownCare from "@/pages/crown-care";import{Toaster}from"@/components/ui/toaster";import "@/index.css";import "./mock-api";const q=new QueryClient({defaultOptions:{queries:{retry:false}}});window.__qa.refresh=()=>q.invalidateQueries({queryKey:["crown-care-catalog"]});createRoot(document.getElementById("root")!).render(<QueryClientProvider client={q}><CrownCare/><Toaster/></QueryClientProvider>);`);
 await writeFile(path.join(fixture,"mock-auth.ts"),'export function useAuth(){return {profile:{id:"test-owner",company_id:"test-company",role:new URLSearchParams(location.search).get("role")||"owner",permissions:{}}};}');
 await writeFile(path.join(fixture,"mock-data.ts"),`import{useEffect,useState}from"react";import "./mock-api";export function useData(){const[,redraw]=useState(0);useEffect(()=>{const fn=()=>redraw(n=>n+1);window.addEventListener("crm-refresh",fn);return()=>window.removeEventListener("crm-refresh",fn);},[]);return {customers:window.__qa.customers,memberships:window.__qa.memberships,addCustomer:async()=>{throw Error("Not used");},createWorkOrder:async()=>{throw Error("Not used");}};}`);
 await writeFile(path.join(fixture,"mock-api.ts"),`import {defaultCrownCatalog,crownEnrollmentSnapshot} from "../../shared/crown-tiers";
 const customer={id:"qa-customer",name:"Synthetic Crown Customer",type:"Residential",contacts:[{phone:"555-0100",email:"test@example.invalid"}],properties:[{id:"qa-property",address:"100 Test Street",city:"Test City",state:"MO",zip:"00000",systems:[]}]};
 const legacy={id:"CC-legacy",customerId:customer.id,customerName:"Synthetic Legacy Customer",propertyAddress:"100 Test Street",systemId:"",systemDescription:"Existing equipment",startDate:"2026-01-01",renewalDate:"2027-01-01",billingFrequency:"Annual",paymentStatus:"Paid",autoRenew:false,visitsIncluded:2,visitsUsed:0,springVisit:{status:"Unscheduled"},fallVisit:{status:"Unscheduled"},status:"Active"};
 window.__qa={catalog:structuredClone(defaultCrownCatalog),customers:[customer],memberships:[legacy],posts:[],patches:[]};
 export async function crm(path,method="GET",body,key){const state=window.__qa;if(path==="scheduling")return{people:[]};if(path==="crm/crown-care/catalog"){if(method==="PATCH"){state.patches.push(body);if(body.version!==state.catalog.version)throw Error("Catalog changed");state.catalog={...state.catalog,version:"qa-price-"+state.patches.length,tiers:Object.fromEntries(Object.entries(state.catalog.tiers).map(([id,p])=>[id,{...p,annualPerSystemCents:body.prices[id]}]))};}return{catalog:structuredClone(state.catalog),version:state.catalog.version};}
 if(path==="crm/memberships"&&method==="POST"){state.posts.push(body);await new Promise(r=>setTimeout(r,180));const plan=body.configuration.enrollmentTier?crownEnrollmentSnapshot(body.configuration.enrollmentTier,state.catalog):undefined;const membership={...legacy,...body.configuration,id:"CC-"+key,customerName:customer.name,pricing:{...body.configuration.pricing,totalAmountCents:body.configuration.pricing.baseAmountCents+body.configuration.pricing.adjustmentCents},tierPlan:plan,agreement:body.agreement};state.memberships.push(membership);return{membership};}
 if(path.startsWith("crm/memberships/")){const membership=state.memberships.find(m=>m.id===path.split("/").pop());if(method==="PATCH")Object.assign(membership,body.configuration);return{membership:structuredClone(membership),version:"qa-member-version"};}throw Error("Unexpected mocked API request "+path);}`);
 vite=await createServer({configFile:false,root:path.join(root,"client"),optimizeDeps:{entries:[path.join(fixture,"index.html")]},plugins:[react()],resolve:{alias:[{find:"@/context/auth-context",replacement:path.join(fixture,"mock-auth.ts")},{find:"@/context/data-context",replacement:path.join(fixture,"mock-data.ts")},{find:"@/lib/crm-api",replacement:path.join(fixture,"mock-api.ts")},{find:"@",replacement:path.join(root,"client/src")}]},server:{host:"127.0.0.1",port:5187,strictPort:true}});await vite.listen();
 if(process.argv.includes("--serve-only")){console.log(`Synthetic Crown Care fixture: http://127.0.0.1:5187/${path.basename(fixture)}/index.html`);await new Promise(resolve=>process.on("SIGINT",resolve));process.exitCode=0;}else{
 chrome=spawn(process.env.CHROMIUM_PATH||"chromium",["--headless","--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--remote-debugging-port=9337",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
 chrome.stderr.on("data",data=>process.stderr.write(data));
 let tabs;for(let i=0;i<60;i++){try{tabs=await(await fetch("http://127.0.0.1:9337/json")).json();break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(tabs,"Chromium debugger started");
 ws=new WebSocket(tabs.find(t=>t.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.on("open",r));let id=0;const pending=new Map();ws.on("message",data=>{const m=JSON.parse(data.toString());if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text+": "+result.exceptionDetails.exception?.description);return result.result?.value;};
 const wait=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,75));}throw Error("Timed out: "+expression+"\n"+await evaluate("document.body.innerText"));};
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
 const textClick=async text=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);};
 const set=async(selector,value)=>{await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);};
 const url=`http://127.0.0.1:5187/${path.basename(fixture)}/index.html`;
 await send("Page.enable");await send("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});await send("Page.navigate",{url});
 await wait(`document.body.innerText.includes('$279.00')`);
 const start=async()=>{await click('[data-testid="button-enroll-customer"]');await click('[data-testid="select-enroll-customer"]');await click('[data-testid="option-customer-qa-customer"]');};
 await start();await set('[data-testid="select-enrollment-tier"]','silver');await set('[data-testid="input-enrollment-system-count"]','2');await textClick('Add Equipment / Other Item');
 assert.equal(await evaluate(`document.querySelector('[data-testid="button-submit-enroll"]').disabled`),true);
 await click('[data-testid="checkbox-enrollment-accepted"]');assert.equal(await evaluate(`document.querySelector('[data-testid="button-submit-enroll"]').disabled`),false);
 assert.ok((await evaluate("document.body.innerText")).includes('$558.00'));
 const before=await send("Page.captureScreenshot",{format:"png"});await writeFile('/tmp/crown-enrollment-ui.png',Buffer.from(before.data,'base64'));
 await evaluate(`document.querySelector('[data-testid="button-submit-enroll"]').click();document.querySelector('[data-testid="button-submit-enroll"]').click();`);
 await wait(`!!document.querySelector('[data-testid="button-skip-visit"]')`);assert.equal(await evaluate('window.__qa.posts.length'),1);assert.equal(await evaluate('window.__qa.posts[0].autoRenew'),false);assert.equal(await evaluate('window.__qa.posts[0].configuration.enrollmentTier.systemCount'),2);assert.equal(await evaluate('window.__qa.posts[0].agreement.reference===undefined'),true);
 await click('[data-testid="button-skip-visit"]');await textClick('Edit Coverage & Notes');await wait(`document.body.innerText.includes('Saved membership terms')`);assert.equal(await evaluate(`!!document.querySelector('[data-testid="select-enrollment-tier"]')`),false);await textClick('Cancel');
 // Cancellation clears the tier choice, acceptance and price state.
 await start();await set('[data-testid="select-enrollment-tier"]','gold');await textClick('Cancel');await start();assert.equal(await evaluate(`document.querySelector('[data-testid="select-enrollment-tier"]').value`),'');assert.equal(await evaluate(`document.querySelector('[data-testid="checkbox-enrollment-accepted"]').checked`),false);await set('[data-testid="select-enrollment-tier"]','silver');await textClick('Add Equipment / Other Item');await click('[data-testid="checkbox-enrollment-accepted"]');
 // A refreshed catalog never silently changes the selected agreed offer.
 await evaluate(`window.__qa.catalog={...window.__qa.catalog,version:'qa-stale',tiers:{...window.__qa.catalog.tiers,silver:{...window.__qa.catalog.tiers.silver,annualPerSystemCents:29900}}};window.__qa.refresh()`);await wait(`document.body.innerText.includes('Use latest prices')`);assert.equal(await evaluate(`document.querySelector('[data-testid="button-submit-enroll"]').disabled`),true);await textClick('Use latest prices');assert.equal(await evaluate(`document.querySelector('[data-testid="checkbox-enrollment-accepted"]').checked`),false);await textClick('Cancel');
 // Owner edits preserve saved memberships and update new enrollment prices.
 await click('[data-testid="button-edit-tier-prices"]');await set('[data-testid="input-tier-price-bronze"]','219');await set('[data-testid="input-tier-price-silver"]','299');await set('[data-testid="input-tier-price-gold"]','369');await click('[data-testid="button-save-tier-prices"]');await wait(`!document.querySelector('[data-testid="button-save-tier-prices"]')`);assert.equal(await evaluate('window.__qa.patches.length'),1);assert.equal(await evaluate('window.__qa.memberships[1].pricing.totalAmountCents'),55800);assert.equal(await evaluate('window.__qa.catalog.tiers.bronze.annualPerSystemCents'),21900);
 // Explicit manual enrollment remains available; dismissing it resets the mode.
 await start();await set('[data-testid="select-enrollment-mode"]','manual');assert.ok((await evaluate('document.body.innerText')).includes('Base price ($ per year)'));assert.equal(await evaluate(`!!document.querySelector('[data-testid="checkbox-enrollment-accepted"]')`),false);await textClick('Cancel');
 await send("Page.navigate",{url:url+"?role=technician"});await wait(`document.body.innerText.includes('Crown Care annual tiers')`);assert.equal(await evaluate(`!!document.querySelector('[data-testid="button-edit-tier-prices"]')`),false);
 console.log('PASS: browser enrollment totals, acceptance gate, repeated submit, cancel/reopen, saved tier lock, stale prices, owner price update, grandfathering, manual mode, and non-owner control visibility. Screenshot: /tmp/crown-enrollment-ui.png');
 }
} finally {ws?.close();chrome?.kill();await vite?.close();await rm(fixture,{recursive:true,force:true});await rm(profile,{recursive:true,force:true}).catch(()=>{});}
