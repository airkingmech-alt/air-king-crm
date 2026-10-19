// Synthetic UI QA only. All app APIs/auth are local module stubs.
// Run: node tests/sentdm-replies-browser.mjs (requires local Chromium).
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {spawn} from "node:child_process";
import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import WebSocket from "ws";
const root=process.cwd();
const fixture=await mkdtemp(path.join(root,"client/.sent-replies-qa-"));
const profile=await mkdtemp(path.join(tmpdir(),"sent-replies-chrome-"));
let vite,chrome,ws;
try {
  await writeFile(path.join(fixture,"index.html"),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script>');
  await writeFile(path.join(fixture,"mock-auth.ts"),'export function AuthProvider({children}){return children;} export function useAuth(){return {profile:{id:"synthetic-staff",company_id:"synthetic-company",role:"owner",permissions:{}},signOut:async()=>{}};}');
  await writeFile(path.join(fixture,"mock-data.ts"),"export function useData(){return {customers:[]};}");
  await writeFile(path.join(fixture,"mock-api.ts"),`
    const replies=[
      {id:"one",customer_id:"synthetic-customer",created_at:"2026-10-15T12:00:00Z",event_type:"sms.received",metadata:{from:"+18165550101",body:"Synthetic reply <img src=x onerror=window.injected=true>"}},
      {id:"two",created_at:"2026-10-15T11:00:00Z",event_type:"customer.opted_out",metadata:{from:"+18165550102",body:"STOP",ambiguous:true}},
      {id:"three",created_at:"2026-10-15T10:00:00Z",event_type:"sms.received",metadata:{from:"+18165550103",body:"Synthetic unmatched reply",unmatched:true}},
    ];
    window.__qa={replies,failRead:false,calls:[]};
    export async function crm(route,method="GET"){
      window.__qa.calls.push({route,method});
      if(route==="crm/replies")return structuredClone(replies.filter(r=>!r.read_at));
      if(route.startsWith("crm/replies?history="))return structuredClone(replies);
      if(method==="POST"&&route.endsWith("/read")){
        if(window.__qa.failRead)throw Error("Synthetic read failure");
        replies.find(r=>r.id===route.split("/")[2]).read_at=new Date().toISOString();return {updated:1};
      }
      if(route==="crm/customers/synthetic-customer/history")return {events:[replies[0]],messages:[],preferences:{}};
      throw Error("Unexpected synthetic API: "+route);
    }
  `);
  await writeFile(path.join(fixture,"main.tsx"),`
    import React from "react";import{createRoot}from"react-dom/client";import{QueryClient,QueryClientProvider}from"@tanstack/react-query";import{Router,Route,Switch}from"wouter";import{useHashLocation}from"wouter/use-hash-location";
    import{AppShell}from"@/components/layout/app-shell";import{Replies,CustomerCommunications}from"@/pages/communications";import"@/index.css";
    createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Router hook={useHashLocation}><AppShell><Switch><Route path="/customers/:id"><CustomerCommunications customerId="synthetic-customer"/></Route><Route><Replies/></Route></Switch></AppShell></Router></QueryClientProvider>);
  `);
  vite=await createServer({configFile:false,root:path.join(root,"client"),plugins:[react()],optimizeDeps:{entries:[path.join(fixture,"index.html")]},resolve:{alias:[
    {find:"@/context/data-context",replacement:path.join(fixture,"mock-data.ts")},
    {find:"@/context/auth-context",replacement:path.join(fixture,"mock-auth.ts")},
    {find:"@/lib/crm-api",replacement:path.join(fixture,"mock-api.ts")},
    {find:"@",replacement:path.join(root,"client/src")},
  ]},server:{host:"127.0.0.1",port:5190,strictPort:true}});
  await vite.listen();
  chrome=spawn(process.env.CHROMIUM_PATH||"chromium",["--headless","--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--remote-debugging-port=9340",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","ignore"]});
  let tabs;
  for(let n=0;n<60;n++){
    try {tabs=await(await fetch("http://127.0.0.1:9340/json")).json();break;}
    catch {await new Promise(resolve=>setTimeout(resolve,100));}
  }
  assert.ok(tabs,"Local Chromium prerequisite unavailable");
  ws=new WebSocket(tabs.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(resolve=>ws.on("open",resolve));
  ws.on("message",data=>{const m=JSON.parse(data);if(["Runtime.exceptionThrown","Network.loadingFailed"].includes(m.method))console.error(m.method,JSON.stringify(m.params));});
  let id=0;const pending=new Map();
  ws.on("message",data=>{const msg=JSON.parse(data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,75));}throw Error("Timed out: "+expression+"\n"+await evaluate("document.body.innerText"));};
  const clickText=text=>evaluate(`Array.from(document.querySelectorAll('button,a')).find(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()===${JSON.stringify(text)}).click()`);
  await send("Page.enable");await send("Runtime.enable");
  // Reject any attempt to load an external API/image/resource during UI checks.
  await send("Network.enable");
  await send("Network.setBlockedURLs",{urls:["*supabase*","*api.sent.dm*","*api.resend.com*"]});
  await send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:`http://127.0.0.1:5190/${path.basename(fixture)}/index.html#/replies`});
  await wait("document.body.innerText.includes('Synthetic unmatched reply')");
  assert.ok(await evaluate("!!document.querySelector('[aria-label=\"3 unread text replies\"]')"));
  assert.ok(await evaluate("document.body.innerText.includes('Multiple customers share this phone')"));
  assert.ok(await evaluate("document.body.innerText.includes('No matching customer')"));
  assert.equal(await evaluate("document.querySelectorAll('a[href*=synthetic-customer]').length"),1);
  assert.equal(await evaluate("window.injected||false"),false);
  await clickText("View customer reply history");
  await wait("document.body.innerText.includes('Synthetic reply <img')");
  assert.ok(await evaluate("document.body.innerText.includes('Communications')"));
  await evaluate("location.hash='/replies'");await wait("document.body.innerText.includes('Unread text replies')");
  await evaluate("window.__qa.failRead=true");await clickText("Mark as read");
  await wait("document.body.innerText.includes('Synthetic read failure')");
  assert.equal(await evaluate("window.__qa.replies.filter(r=>!r.read_at).length"),3);
  await evaluate("window.__qa.failRead=false");await clickText("Mark as read");
  await wait("!!document.querySelector('[aria-label=\"2 unread text replies\"]')");
  await clickText("View all reply history");
  await wait("document.body.innerText.includes('Text reply history')&&document.body.innerText.includes('Synthetic reply <img')");
  assert.ok(await evaluate("Array.from(document.querySelectorAll('span')).some(e=>e.textContent==='Read')"));
  assert.ok(await evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Previous page').disabled"));
  await clickText("Show unread replies");await wait("document.body.innerText.includes('Unread text replies')");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate("document.documentElement.scrollWidth<=390"),"Mobile inbox must not overflow the viewport");
  await evaluate("document.querySelector('[aria-label=\"Open menu\"]').click()");
  await wait("!!document.querySelector('[aria-label=\"Close menu\"]')");
  assert.ok(await evaluate("Array.from(document.querySelectorAll('[aria-label=\"2 unread text replies\"]')).some(e=>e.getBoundingClientRect().width>0)"));
  await clickText("Text replies2");
  await wait("Array.from(document.querySelectorAll('[aria-label=\"Close menu\"]')).every(e=>e.getBoundingClientRect().width===0)");
  console.log("PASS: desktop/mobile unread navigation, body escaping, history link, duplicate/unmatched warnings, failed/successful shared read state and reviewed history. Synthetic local fixtures only.");
} finally {
  ws?.close();chrome?.kill();await vite?.close();
  await rm(fixture,{recursive:true,force:true});
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
