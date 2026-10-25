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
const fixture=await mkdtemp(path.join(root,"client/.text-messages-qa-"));
const profile=await mkdtemp(path.join(tmpdir(),"text-messages-chrome-"));
let vite,chrome,ws;
try {
  await writeFile(path.join(fixture,"index.html"),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script>');
  await writeFile(path.join(fixture,"mock-auth.ts"),'export function AuthProvider({children}){return children;} export function useAuth(){return {profile:{id:"synthetic-staff",company_id:"synthetic-company",role:"owner",permissions:{}},signOut:async()=>{}};}');
  await writeFile(path.join(fixture,"mock-data.ts"),"export function useData(){return {customers:[]};}");

  await writeFile(path.join(fixture,"mock-api.ts"),`
    const phone='+18165550101';
    const customer={id:'synthetic-customer',name:'Jordan Sample',is_primary:true,total_count:1};
    const msg=(key,direction,status,body,time)=>({key,id:key,direction,status,body,created_at:time,customer_id:direction==='outbound'?'original-customer':null,provider_status:status,read_at:null});
    const recent=[msg('in:reply','inbound','received','Synthetic reply <img src=x onerror=window.injected=true>','2026-10-24T12:03:00Z'),msg('out:sent','outbound','sent','On our way','2026-10-24T12:02:00Z'),msg('out:delivered','outbound','delivered','Your appointment is confirmed','2026-10-24T12:01:00Z')];
    const older=[msg('out:failed','outbound','failed','Earlier failed text','2026-10-24T11:00:00Z')];
    const conversations=[{phone,last_at:recent[0].created_at,preview:'Appointment reply',unread_count:1,customers:[customer]},
      {phone:'+18165550102',last_at:'2026-10-24T12:00:00Z',preview:'Shared phone reply',unread_count:1,customers:[{...customer,id:'shared-one',total_count:2},{...customer,id:'shared-two',total_count:2}]},
      {phone:'+18165550103',last_at:'2026-10-24T11:00:00Z',preview:'Unmatched reply',unread_count:0,customers:[]}];
    window.__qa={calls:[],failRead:false,failSend:false,failHistory:false,failList:false,validationFail:false,changedPhone:false,submissions:{},conversations,recent};
    export async function crm(route,method='GET',body,key){
      window.__qa.calls.push({route,method,body,key});const url=new URL(route,'http://synthetic/');
      if(url.pathname==='/crm/text-messages') {if(window.__qa.failList)throw Error('Synthetic list failure');return {items:structuredClone(url.searchParams.has('before')?[{phone:'+18165550104',last_at:'2026-10-23T12:00:00Z',preview:'Older conversation',unread_count:0,customers:[]}]:conversations),next:url.searchParams.has('before')?null:{at:'2026-10-24T11:00:00Z',key:'+18165550103'}};}
      if(url.pathname==='/crm/text-messages/history') {
        if(window.__qa.failHistory)throw Error('Synthetic history failure');
        const p=url.searchParams.get('phone');const customers=conversations.find(c=>c.phone===p)?.customers||[];
        return {customers,items:structuredClone(p===phone?(url.searchParams.has('before')?older:recent):[msg('in:shared','inbound','received','Other conversation reply','2026-10-24T12:00:00Z')]),next:p===phone&&!url.searchParams.has('before')?{at:'2026-10-24T12:01:00Z',key:'out:delivered'}:null};
      }
      if(route==='crm/customers/synthetic-customer/sms')return {ready:true,recipient:window.__qa.changedPhone?'+18165550999':phone,issues:[],sending_enabled:true,timezone:'America/Chicago',sms_start:8,sms_end:19,mode:'approved_template'};
      if(route==='crm/text-messages/send'){
        if(window.__qa.validationFail)throw Object.assign(Error('Synthetic consent missing'),{status:400});
        window.__qa.submissions[key] ||= {id:key,status:'pending'};
        await new Promise(r=>setTimeout(r,150));if(window.__qa.failSend)throw Error('Synthetic response lost');return {message:window.__qa.submissions[key]};
      }
      if(method==='POST'&&route.endsWith('/read')) {if(window.__qa.failRead)throw Error('Synthetic read failure');recent[0].read_at='2026-10-24T13:00:00Z';conversations[0].unread_count=0;return {updated:1};}
      if(route==='crm/replies')return recent.filter(r=>r.direction==='inbound'&&!r.read_at);
      throw Error('Unexpected synthetic API: '+route);
    }
  `);
  await writeFile(path.join(fixture,"main.tsx"),`
    import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Router}from'wouter';
    import TextMessages from '@/pages/text-messages';import '@/index.css';
    window.__cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={window.__cache}><Router><main className="p-4"><TextMessages/></main></Router></QueryClientProvider>);
  `);
  vite=await createServer({configFile:false,root:path.join(root,"client"),plugins:[react()],optimizeDeps:{entries:[path.join(fixture,"index.html")]},resolve:{alias:[
    {find:"@/context/data-context",replacement:path.join(fixture,"mock-data.ts")},
    {find:"@/context/auth-context",replacement:path.join(fixture,"mock-auth.ts")},
    {find:"@/lib/crm-api",replacement:path.join(fixture,"mock-api.ts")},
    {find:"@",replacement:path.join(root,"client/src")},
  ]},server:{host:"127.0.0.1",port:5191,strictPort:true}});
  await vite.listen();
  chrome=spawn(process.env.CHROMIUM_PATH||"chromium",["--headless","--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--remote-debugging-port=9341",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","ignore"]});
  let tabs;
  for(let n=0;n<60;n++){
    try {tabs=await(await fetch("http://127.0.0.1:9341/json")).json();break;}
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

  await send("Page.navigate",{url:`http://127.0.0.1:5191/${path.basename(fixture)}/index.html`});
  await wait("document.body.innerText.includes('Jordan Sample')");
  const selectPhone=p=>evaluate(`Array.from(document.querySelectorAll('section[aria-label="Conversations"] button')).find(b=>b.textContent.includes(${JSON.stringify(p)})).click()`);
  await selectPhone('+18165550101');
  await wait("document.body.innerText.includes('Your appointment is confirmed')&&!!document.querySelector('textarea')");
  assert.equal(await evaluate("window.injected||false"),false);
  assert.ok(await evaluate("document.body.innerText.includes('Sent · delivery unconfirmed')&&document.body.innerText.includes('Delivered')"));
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('ol article p:first-child')).map(e=>e.textContent.split(' ·')[0])"),['Office → customer','Office → customer','Customer → office']);
  assert.ok(await evaluate("!!document.querySelector('a[href=\"/customers/original-customer\"]')"));
  assert.equal(await evaluate("window.__qa.calls.filter(c=>c.method==='POST').length"),0,'Opening must not mark read or send');
  await clickText('Load older messages');await wait("document.body.innerText.includes('Earlier failed text')");
  assert.ok(await evaluate("document.querySelector('ol').textContent.startsWith('Office → customerEarlier failed text')"));
  await evaluate("window.__qa.failRead=true");await clickText('Mark displayed replies read (1)');await wait("document.body.innerText.includes('Synthetic read failure')");
  assert.equal(await evaluate("window.__qa.recent[0].read_at"),null);
  await evaluate("window.__qa.failRead=false");await clickText('Mark displayed replies read (1)');await wait("!document.body.innerText.includes('Mark displayed replies read')");
  const fill=text=>evaluate(`(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await fill('Synthetic service reply');await evaluate('window.__qa.failSend=true');
  await evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Queue SMS');b.click();b.click();})()");
  await wait("document.body.innerText.includes('Synthetic response lost')");
  assert.equal(await evaluate("window.__qa.calls.filter(c=>c.route==='crm/text-messages/send').length"),1);
  await selectPhone('+18165550102');await wait("document.body.innerText.includes('Multiple customers share this phone.')");
  assert.equal(await evaluate("document.querySelectorAll('textarea').length"),0);
  await selectPhone('+18165550101');await wait("document.body.innerText.includes('prior request needs confirmation')");
  await evaluate('window.__qa.failSend=false');await clickText('Retry confirmation');await wait("document.body.innerText.includes('Text queued, not delivered.')");
  assert.equal(await evaluate("new Set(window.__qa.calls.filter(c=>c.route==='crm/text-messages/send').map(c=>c.key)).size"),1);
  assert.equal(await evaluate("Object.keys(window.__qa.submissions).length"),1);
  await fill('Retain this failed draft');await evaluate('window.__qa.validationFail=true');await clickText('Queue SMS');await wait("document.body.innerText.includes('Synthetic consent missing')");
  assert.equal(await evaluate("document.querySelector('textarea').value"),'Retain this failed draft');
  await evaluate("window.__qa.changedPhone=true;window.__cache.invalidateQueries({queryKey:['customer-sms']})");await wait("document.body.innerText.includes('current primary phone does not match')");
  assert.ok(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Queue SMS').disabled"));
  await selectPhone('+18165550103');await wait("document.body.innerText.includes('No current customer matches')");assert.equal(await evaluate("document.querySelectorAll('textarea').length"),0);
  await clickText('Load more conversations');await wait("document.body.innerText.includes('Older conversation')");
  await evaluate("window.__qa.failHistory=true;window.__cache.invalidateQueries({queryKey:['text-history']})");await wait("document.body.innerText.includes('Synthetic history failure')");
  await evaluate('window.__qa.failHistory=false');await clickText('Retry messages');await wait("!document.body.innerText.includes('Synthetic history failure')");
  await selectPhone('+18165550101');await wait("document.body.innerText.includes('Your appointment is confirmed')");
  await evaluate("window.__qa.changedPhone=false;window.__qa.recent[0].body='Thanks, that time works for me.';window.__cache.invalidateQueries()");
  await wait("document.body.innerText.includes('Thanks, that time works for me.')&&!document.body.innerText.includes('current primary phone does not match')");
  await writeFile('/tmp/text-messages-desktop.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate("document.documentElement.scrollWidth<=390"),'Mobile thread must not overflow');
  assert.ok(await evaluate("document.querySelector('section[aria-label=\"Conversations\"]').getBoundingClientRect().width===0"));
  await writeFile('/tmp/text-messages-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await clickText('All conversations');await wait("document.querySelector('section[aria-label=\"Conversations\"]').getBoundingClientRect().width>0");
  await selectPhone('+18165550102');await wait("document.body.innerText.includes('Multiple customers share this phone.')");
  assert.ok(await evaluate("document.documentElement.scrollWidth<=390"));
  await clickText('All conversations');await evaluate("window.__qa.failList=true;window.__cache.invalidateQueries({queryKey:['text-conversations']})");await wait("document.body.innerText.includes('Synthetic list failure')");
  await evaluate('window.__qa.failList=false');await clickText('Retry conversations');await wait("!document.body.innerText.includes('Synthetic list failure')");
  console.log('PASS desktop/mobile conversations, chronological history/pagination, delivery labels, original links, unmatched/ambiguous guards, explicit unread/error handling, repeated-click/navigation idempotency, validation failure, changed recipient and list/history errors. Mocks only. Screenshots /tmp/text-messages-{desktop,mobile}.png');
} finally {
  ws?.close();chrome?.kill();await vite?.close();
  await rm(fixture,{recursive:true,force:true});
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
