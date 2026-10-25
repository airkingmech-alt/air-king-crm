// Synthetic UI QA only. All app APIs/auth are local module stubs.
// Run: node tests/text-messages-browser.mjs (requires local Chromium).
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
  await writeFile(path.join(fixture,"mock-storage.ts"),"export const supabase={auth:{getSession:async()=>({data:{session:null}})}};");
  await writeFile(path.join(fixture,"mock-save.ts"),"export const guardSave=(_key,fn)=>fn; export const saveRecords=()=>{throw Error('Customer writes prohibited in SMS QA');};");
  await writeFile(path.join(fixture,"mock-data.ts"),`const customer=(id,name,phone)=>({id,name,type:'Residential',tags:[],contacts:[{role:'Primary',phone,email:''}],properties:[]});
    const customers=[...Array.from({length:35},(_,n)=>customer('other-'+n,'Other Person '+n,'+12025550'+String(n).padStart(3,'0'))),customer('new-customer','New Customer','(816) 555-0105')];
    window.__created=[];
    export function useData(){return {customers,loading:false,addCustomer:async(data)=>{window.__created.push(data);return {id:'created',...data};}};}`);

  await writeFile(path.join(fixture,"mock-api.ts"),`
    const phone='+18165550101';
    const customer={id:'synthetic-customer',name:'Jordan Sample',is_primary:true,total_count:1};
    const msg=(key,direction,status,body,time)=>({key,id:key,direction,status,body,created_at:time,customer_id:direction==='outbound'?'original-customer':null,provider_status:status,read_at:null});
    const recent=[msg('in:reply','inbound','received','Synthetic reply <img src=x onerror=window.injected=true>','2026-10-24T12:03:00Z'),msg('out:sent','outbound','sent','On our way','2026-10-24T12:02:00Z'),msg('out:delivered','outbound','delivered','Your appointment is confirmed','2026-10-24T12:01:00Z')];
    const older=[msg('out:failed','outbound','failed','Earlier failed text','2026-10-24T11:00:00Z')];
    const conversations=[{phone,last_at:recent[0].created_at,preview:'Appointment reply',unread_count:1,customers:[customer]},
      {phone:'+18165550102',last_at:'2026-10-24T12:00:00Z',preview:'Shared phone reply',unread_count:1,customers:[{...customer,id:'shared-one',name:'Alex Sample',total_count:3},{...customer,id:'shared-two',name:'Morgan Sample',total_count:3},{...customer,id:'additional',name:'Additional contact',is_primary:false,total_count:3}]},
      {phone:'+18165550103',last_at:'2026-10-24T11:00:00Z',preview:'Unmatched reply',unread_count:0,customers:[]}];
    window.__qa={calls:[],failRead:false,failSend:false,failHistory:false,failList:false,validationFail:false,changedPhone:false,submissions:{},conversations,recent};
    export async function crm(route,method='GET',body,key){
      window.__qa.calls.push({route,method,body,key});const url=new URL(route,'http://synthetic/');
      if(url.pathname.endsWith('/send-now')) {
        const message={id:'pending-one',customer_id:'original-customer',quote_id:'Q-SYNTHETIC',recipient:phone,body:'Synthetic existing queued quote',status:'pending'};
        if(method==='GET')return {message,already_requested:!!window.__qa.nowRequested};
        if(body.confirmed!==true)throw Error('Confirmation required');
        window.__qa.nowRequested=true;await new Promise(r=>setTimeout(r,150));if(window.__qa.nowFail)throw Error('Synthetic response lost');return {message:{...message,status:'sent'}};
      }
      if(url.pathname==='/crm/text-messages') {if(window.__qa.failList)throw Error('Synthetic list failure');return {items:structuredClone(url.searchParams.has('before')?[{phone:'+18165550104',last_at:'2026-10-23T12:00:00Z',preview:'Older conversation',unread_count:0,customers:[]}]:conversations),next:url.searchParams.has('before')?null:{at:'2026-10-24T11:00:00Z',key:'+18165550103'}};}
      if(url.pathname==='/crm/text-messages/history') {
        if(window.__qa.failHistory)throw Error('Synthetic history failure');
        const p=url.searchParams.get('phone');const customers=conversations.find(c=>c.phone===p)?.customers||[];
        return {customers:structuredClone(customers),items:structuredClone(p===phone?(url.searchParams.has('before')?older:recent):[msg('in:shared','inbound','received','Other conversation reply','2026-10-24T12:00:00Z')]),next:p===phone&&!url.searchParams.has('before')?{at:'2026-10-24T12:01:00Z',key:'out:delivered'}:null};
      }
      if(route==='crm/customers/new-customer/history')return {events:[],messages:[],preferences:window.__qa.newPrefs||null};
      if(route==='crm/customers/new-customer/preferences'&&method==='PUT'){
        if(!body.consent_source||body.consent_source.length<3)throw Object.assign(Error('Record how permission was obtained'),{status:400});
        window.__qa.newPrefs=body;return {message:'Preferences saved'};
      }
      if(route==='crm/customers/new-customer/sms'){
        const ready=!!window.__qa.newPrefs?.sms_transactional;
        if(method==='POST'){
          if(!ready)throw Object.assign(Error('Consent required'),{status:400});
          return {message:{id:'new-message',status:'pending'}};
        }
        return {ready,consent_required:!ready,recipient:'+18165550105',issues:ready?[]:['SMS consent is missing or the customer has opted out. Review communication preferences.'],sending_enabled:true,timezone:'America/Chicago',sms_start:8,sms_end:19};
      }
      if(route==='crm/customers/shared-one/sms'||route==='crm/customers/shared-two/sms')return {ready:!(route.includes('shared-two')&&window.__qa.blockShared),recipient:'+18165550102',issues:route.includes('shared-two')&&window.__qa.blockShared?['Synthetic shared consent missing']:[],sending_enabled:true,timezone:'America/Chicago',sms_start:8,sms_end:19,mode:'approved_template'};
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
    import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Router}from'wouter';import{useHashLocation}from'wouter/use-hash-location';
    import TextMessages from '@/pages/text-messages';import Customers from '@/pages/customers';import '@/index.css';
    function Screen(){const[mode,setMode]=React.useState('customers');window.__showMessages=()=>setMode('texts');return mode==='customers'?<Customers/>:<TextMessages/>;}
    window.__cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={window.__cache}><Router hook={useHashLocation}><main className="p-4"><Screen/></main></Router></QueryClientProvider>);
  `);
  vite=await createServer({configFile:false,root:path.join(root,"client"),plugins:[react()],optimizeDeps:{entries:[path.join(fixture,"index.html")]},resolve:{alias:[
    {find:"@/context/data-context",replacement:path.join(fixture,"mock-data.ts")},
    {find:"@/lib/supabase",replacement:path.join(fixture,"mock-storage.ts")},
    {find:"@/lib/confirmed-save",replacement:path.join(fixture,"mock-save.ts")},
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
  await wait("document.body.innerText.includes('Add Customer')");
  await clickText('Add Customer');
  await wait("!!document.querySelector('#cust-name')");
  const consentBox="document.querySelector('[role=checkbox][aria-label=\"Customer agreed to service texts\"]')";
  assert.equal(await evaluate(consentBox+".getAttribute('data-state')"),'unchecked');
  await evaluate(`(()=>{for(const [id,value] of [['cust-name','Synthetic New Contact'],['cust-phone','8165550105']]){const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await evaluate(consentBox+'.click()');
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().height<=844"));
  await evaluate("document.querySelector('[data-testid=button-submit-customer]').click()");
  await wait("window.__created.length===1");assert.equal(await evaluate('window.__created[0].serviceTextConsent'),true);
  await clickText('Add Customer');await wait("!!document.querySelector('#cust-name')");
  assert.equal(await evaluate(consentBox+".getAttribute('data-state')"),'unchecked','New-customer permission resets for each customer');
  await clickText('Cancel');
  await send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate('window.__showMessages()');
  console.log('PASS real Add Customer form: permission starts unchecked, explicit selection is passed to creation, resets on next customer, and mobile form scrolls.');
  await wait("document.body.innerText.includes('Jordan Sample')");
  await clickText('Start a text');
  await evaluate("document.querySelector('[data-testid=text-new-customer]').click()");
  assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"Customer search results\"] button').length"),20);
  await evaluate(`(()=>{const e=document.querySelector('[data-testid=text-new-customer]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'8165550105');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);

  await wait("!!document.querySelector('[data-testid=option-customer-new-customer]')");
  await evaluate("document.querySelector('[data-testid=option-customer-new-customer]').click()");
  await wait("document.body.innerText.includes('Before the first text')");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Queue SMS').disabled"),true);
  assert.equal(await evaluate("window.__qa.calls.filter(c=>c.method!=='GET').length"),0,'Choosing a new customer must not change consent or send');
  await clickText('Review communication preferences');
  await wait("document.body.innerText.includes('Consent source / note')");
  await evaluate("Array.from(document.querySelectorAll('[role=switch]'))[1].click()");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save Preferences').disabled"),true,'Consent source is required before saving');
  await evaluate(`(()=>{const e=document.querySelector('input[placeholder="How and when did the customer give permission?"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Synthetic explicit permission');e.dispatchEvent(new Event('input',{bubbles:true}));const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Synthetic first service text');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const savedAt=Date.now();
  await clickText('Save Preferences');
  await wait("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Queue SMS').disabled");
  assert.ok(Date.now()-savedAt<5000,'Readiness updates immediately, without waiting for the 15-second poll');
  assert.equal(await evaluate("window.__qa.newPrefs.sms_marketing"),false);
  await clickText('Queue SMS');
  await wait("document.body.innerText.includes('Text queued, not delivered.')");
  const first=await evaluate("window.__qa.calls.filter(c=>c.method==='POST'&&c.route==='crm/customers/new-customer/sms')");
  assert.equal(first.length,1);assert.equal(first[0].body.recipient,'+18165550105');assert.ok(first[0].key);
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate("document.documentElement.scrollWidth<=390"),'New-text controls fit a mobile screen');
  await writeFile('/tmp/new-customer-text-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  console.log('PASS first text without prior history, no writes on selection, consent/source required, immediate readiness refresh, service-only consent, original recipient and mobile layout.');
  await evaluate(`(()=>{const e=document.querySelector('[data-testid=text-new-customer]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'no such customer');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait("document.body.innerText.includes('No matching customers')");
  assert.equal(await evaluate("document.querySelectorAll('textarea').length"),0,'Changing customer search clears the prior recipient composer');
  await clickText('Close');
  await evaluate("window.__qa.calls=[]");
  const selectPhone=p=>evaluate(`Array.from(document.querySelectorAll('section[aria-label="Conversations"] button')).find(b=>b.textContent.includes(${JSON.stringify(p)})).click()`);
  await selectPhone('+18165550101');
  await wait("document.body.innerText.includes('Your appointment is confirmed')&&!!document.querySelector('textarea')");
  assert.equal(await evaluate("window.injected||false"),false);
  assert.ok(await evaluate("document.body.innerText.includes('Sent · delivery unconfirmed')&&document.body.innerText.includes('Delivered')"));
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('ol article p:first-child')).map(e=>e.textContent.split(' ·')[0])"),['Office → customer','Office → customer','Customer → office']);
  assert.ok(await evaluate("!!document.querySelector('a[href=\"#/customers/original-customer\"]')"));
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
  // A shared phone requires an explicit choice; every mounted composer belongs
  // to that customer, with no implicit read acknowledgement or historical edits.
  await evaluate('window.__qa.validationFail=false;window.__qa.changedPhone=false');
  await selectPhone('+18165550102');await wait("!!document.querySelector('#reply-customer')");
  const chooseCustomer=id=>evaluate(`(()=>{const s=document.querySelector('#reply-customer');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate("document.querySelector('#reply-customer').value"),'');
  assert.equal(await evaluate("Array.from(document.querySelector('#reply-customer').options).some(o=>o.value==='additional')"),false);
  const postsBefore=await evaluate("window.__qa.calls.filter(c=>c.method==='POST').length");
  await chooseCustomer('shared-one');await wait("!!document.querySelector('textarea')&&document.body.innerText.includes('Reply for Alex Sample')");
  await fill('Unsent Alex draft');await chooseCustomer('shared-two');await wait("document.body.innerText.includes('Reply for Morgan Sample')");
  assert.equal(await evaluate("document.querySelector('textarea').value"),'');
  await evaluate("window.__qa.blockShared=true;window.__cache.invalidateQueries({queryKey:['customer-sms']})");
  await wait("document.body.innerText.includes('Synthetic shared consent missing')");
  await fill('Blocked draft');assert.ok(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Queue SMS').disabled"));
  assert.equal(await evaluate("window.__qa.calls.filter(c=>c.method==='POST').length"),postsBefore,'Selection and drafts never mark read or send');
  await chooseCustomer('shared-one');await wait("document.body.innerText.includes('Reply for Alex Sample')");
  assert.equal(await evaluate("document.querySelector('textarea').value"),'');
  await fill('Synthetic selected customer reply');await evaluate('window.__qa.failSend=true');
  await evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Queue SMS');b.click();b.click();})()");
  await wait("document.body.innerText.includes('Synthetic response lost')");
  await chooseCustomer('shared-two');await wait("document.body.innerText.includes('Reply for Morgan Sample')");
  assert.equal(await evaluate("document.querySelector('textarea').value"),'');
  await chooseCustomer('shared-one');await wait("document.body.innerText.includes('prior request needs confirmation')");
  assert.equal(await evaluate("document.querySelector('textarea').value"),'Synthetic selected customer reply');
  await selectPhone('+18165550103');await wait("document.body.innerText.includes('No current customer matches')");
  await selectPhone('+18165550102');await wait("!!document.querySelector('#reply-customer')");
  assert.equal(await evaluate("document.querySelector('#reply-customer').value"),'','Returning to a conversation requires a fresh choice');
  assert.equal(await evaluate("document.querySelectorAll('textarea').length"),0);
  await chooseCustomer('shared-one');await wait("document.body.innerText.includes('prior request needs confirmation')");
  await evaluate('window.__qa.failSend=false');await clickText('Retry confirmation');await wait("document.body.innerText.includes('Text queued, not delivered.')");
  assert.equal(await evaluate("new Set(window.__qa.calls.filter(c=>c.route==='crm/text-messages/send'&&c.body.customer_id==='shared-one').map(c=>c.key)).size"),1);
  assert.equal(await evaluate("window.__qa.calls.filter(c=>c.route==='crm/text-messages/send'&&c.body.customer_id==='shared-one').length"),2,'One submission and one confirmation only');
  assert.equal(await evaluate("window.__qa.calls.filter(c=>c.route==='crm/text-messages/send'&&c.body.customer_id==='shared-two').length"),0);
  await evaluate("window.__qa.conversations[1].customers[0].is_primary=false;window.__cache.invalidateQueries({queryKey:['text-history']})");
  await wait("!document.querySelector('textarea')");
  assert.equal(await evaluate("document.querySelector('#reply-customer').value"),'');
  await evaluate("window.__qa.conversations[1].customers[0].is_primary=true;window.__qa.blockShared=false;window.__cache.invalidateQueries({queryKey:['text-history']})");
  await selectPhone('+18165550103');await wait("document.body.innerText.includes('No current customer matches')");
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
  assert.equal(await evaluate("document.querySelector('#reply-customer').value"),'');
  await chooseCustomer('shared-two');await wait("document.body.innerText.includes('Reply for Morgan Sample')&&!!document.querySelector('textarea')");
  await fill('Synthetic service reply preview');
  assert.ok(await evaluate("document.documentElement.scrollWidth<=390&&document.querySelector('#reply-customer').getBoundingClientRect().right<=390"));
  await writeFile('/tmp/shared-phone-replies-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await writeFile('/tmp/shared-phone-replies-desktop.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await clickText('All conversations');await evaluate("window.__qa.failList=true;window.__cache.invalidateQueries({queryKey:['text-conversations']})");await wait("document.body.innerText.includes('Synthetic list failure')");
  await evaluate('window.__qa.failList=false');await clickText('Retry conversations');await wait("!document.body.innerText.includes('Synthetic list failure')");
  await selectPhone('+18165550101');await wait("document.body.innerText.includes('Your appointment is confirmed')");
  await evaluate("window.__qa.recent.push({key:'out:pending-one',id:'pending-one',direction:'outbound',status:'pending',body:'Synthetic existing queued quote',created_at:'2026-10-24T12:04:00Z',customer_id:'original-customer'});window.__cache.invalidateQueries({queryKey:['text-history']})");
  await wait("document.body.innerText.includes('Send now…')");await clickText('Send now…');await wait("!!document.querySelector('[data-testid=confirm-sms-send-now]')");
  assert.ok(await evaluate("document.querySelector('[role=dialog]').innerText.includes('Q-SYNTHETIC')"));await clickText('Cancel');
  assert.equal(await evaluate("window.__qa.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/send-now')).length"),0);
  await clickText('Send now…');await wait("!!document.querySelector('[data-testid=confirm-sms-send-now]')");await new Promise(r=>setTimeout(r,250));
  assert.ok(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().right<=390"));
  await writeFile('/tmp/sms-send-now-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("window.__qa.nowFail=true;const b=document.querySelector('[data-testid=confirm-sms-send-now]');b.click();b.click()");
  await wait("document.body.innerText.includes('Confirmation unavailable')");assert.equal(await evaluate("window.__qa.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/send-now')).length"),1);
  await clickText('Send now…');await wait("document.body.innerText.includes('already has a Send now request')");assert.equal(await evaluate("document.querySelector('[data-testid=confirm-sms-send-now]')"),null);await clickText('Cancel');
  console.log('PASS Send now explicit confirmation, original recipient/quote, cancel, duplicate clicks, lost response/retry protection and mobile dialog.');
  console.log('PASS desktop/mobile conversations, chronological history/pagination, delivery labels, original links, unmatched/ambiguous guards, explicit unread/error handling, repeated-click/navigation idempotency, validation failure, changed recipient and list/history errors. Mocks only. Screenshots /tmp/text-messages-{desktop,mobile}.png');
} finally {
  ws?.close();chrome?.kill();await vite?.close();
  await rm(fixture,{recursive:true,force:true});
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
