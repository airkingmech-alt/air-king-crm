// Actual document-send dialog components, synthetic API/auth only. No live writes.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import WebSocket from 'ws';
const root=process.cwd(),fixture=await mkdtemp(path.join(root,'client/.document-text-qa-'));
const profile=await mkdtemp(path.join(tmpdir(),'document-text-chrome-'));
let vite,chrome,ws;
try {
  await writeFile(path.join(fixture,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script>');
  await writeFile(path.join(fixture,'mock-auth.ts'),'export function useAuth(){return {profile:{id:"staff",company_id:"synthetic",role:"owner"}};}');
  await writeFile(path.join(fixture,'mock-api.ts'),`
    window.__qa={calls:[],prefs:null,suppressed:false,stopped:false,failRead:false};
    export async function crm(route,method='GET',body,key){
      const q=window.__qa;q.calls.push({route,method,body,key});
      if(route==='crm/config')return {connections:{sms:true},settings:{sending_enabled:true}};
      if(['crm/quote/document/sms-readiness','crm/invoice/document/sms-readiness'].includes(route)){
        if(q.failRead)throw Error('Readiness unavailable');
        const consent=!!q.prefs?.sms_transactional;
        return {customer_id:'new',ready:consent&&!q.suppressed&&!q.stopped,consent_required:!consent&&!q.stopped,recipient:'+18165550105',issues:q.suppressed?['This phone is suppressed after an opt-out.']:q.stopped?['Customer replied STOP. Text messages are blocked.']:consent?[]:['SMS consent is missing or the customer has opted out. Review communication preferences.']};
      }
      if(route==='crm/customers/new/history')return {events:[],messages:[],preferences:q.prefs};
      if(route==='crm/customers/new/preferences'&&method==='PUT'){
        if(!body.consent_source||body.consent_source.trim().length<3)throw Error('Consent source required');
        q.prefs=body;return {message:'Preferences saved'};
      }
      if(['crm/quote/document/send','crm/invoice/document/send'].includes(route)&&method==='POST'){
        if(body.channels.includes('sms')&&(!q.prefs?.sms_transactional||q.suppressed||q.stopped))throw Error('Must not attempt blocked SMS');
        return {message:'Delivery queued. Check the customer timeline for results.',messages:body.channels.map(channel=>({status:'pending',channel}))};
      }
      throw Error('Unexpected synthetic API: '+route);
    }
  `);
  await writeFile(path.join(fixture,'main.tsx'),`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{Router}from'wouter';import{useHashLocation}from'wouter/use-hash-location';
    import{DocumentActions}from'@/components/document-actions';import{Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription}from'@/components/ui/dialog';import '@/index.css';
    window.__cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
    function App(){const[kind,setKind]=useState('quote');return <><button onClick={()=>setKind('invoice')}>Switch to invoice</button><Dialog open><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Send {kind}</DialogTitle><DialogDescription>Send the selected document to its customer.</DialogDescription></DialogHeader><DocumentActions key={kind} kind={kind} id="document"/></DialogContent></Dialog></>;}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={window.__cache}><Router hook={useHashLocation}><App/></Router></QueryClientProvider>);
    window.__invoice=()=>document.querySelector('body > div button')?.click();
  `);
  vite=await createServer({configFile:false,root:path.join(root,'client'),plugins:[react()],optimizeDeps:{entries:[path.join(fixture,'index.html')]},resolve:{alias:[
    {find:'@/context/auth-context',replacement:path.join(fixture,'mock-auth.ts')},
    {find:'@/lib/crm-api',replacement:path.join(fixture,'mock-api.ts')},
    {find:'@',replacement:path.join(root,'client/src')},
  ]},server:{host:'127.0.0.1',port:5193,strictPort:true}});
  await vite.listen();
  chrome=spawn(process.env.CHROMIUM_PATH||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--remote-debugging-port=9343',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let tabs;for(let n=0;n<80;n++){try{tabs=await(await fetch('http://127.0.0.1:9343/json')).json();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(tabs,'Local Chromium unavailable');
  ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.on('open',r));
  let seq=0;const pending=new Map();ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,75));}throw Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));};
  const button=text=>`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click=text=>evaluate(button(text)+'.click()');
  await send('Page.enable');await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['*supabase*','*api.sent.dm*','*api.resend.com*']});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:5193/${path.basename(fixture)}/index.html`});
  await wait("document.body.innerText.includes('Before texting this quote')");
  assert.equal(await evaluate(button('Text')+'.disabled'),true);
  assert.equal(await evaluate(button('Email + Text')+'.disabled'),true);
  assert.equal(await evaluate(button('Email')+'.disabled'),false);
  assert.equal(await evaluate('window.__qa.calls.some(c=>c.method!=="GET")'),false);
  await click('Review communication preferences');
  await wait("!!document.querySelector('[role=switch][aria-label=\"Service and invoice texts\"]')");
  assert.equal(await evaluate("document.querySelectorAll('textarea').length"),0,'Document setup must not introduce a separate free-text composer');
  assert.equal(await evaluate(button('Save Preferences')+'.disabled'),true);
  await evaluate("document.querySelector('[role=switch][aria-label=\"Service and invoice texts\"]').click()");
  assert.equal(await evaluate(button('Save Preferences')+'.disabled'),true);
  await evaluate(`(()=>{const e=document.querySelector('input[placeholder="How and when did the customer give permission?"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Synthetic permission for service texts');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=390'));
  assert.ok(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().height<=844"),'Consent controls must fit or scroll within mobile dialog');
  await writeFile('/tmp/document-text-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('Save Preferences');
  await wait('!'+button('Text')+'.disabled');
  assert.equal(await evaluate('window.__qa.prefs.sms_marketing'),false);
  assert.equal(await evaluate('window.__qa.calls.filter(c=>c.route.endsWith("/send")).length'),0,'Saving preferences must not send');
  assert.equal(await evaluate("document.querySelectorAll('[role=switch]').length"),0,'Saved setup collapses back to document-send actions');
  await click('Text');await wait("document.body.innerText.includes('Delivery queued.')");
  const sent=await evaluate('window.__qa.calls.filter(c=>c.route.endsWith("/send"))');assert.equal(sent.length,1);assert.deepEqual(sent[0].body.channels,['sms']);assert.ok(sent[0].key);
  for(const blocker of ['suppressed','stopped','failRead']){
    await evaluate(`window.__qa.${blocker}=true;window.__cache.invalidateQueries({queryKey:['document-sms']})`);
    await wait(button('Text')+'.disabled');assert.equal(await evaluate(button('Email + Text')+'.disabled'),true);
    await evaluate(`window.__qa.${blocker}=false;window.__cache.invalidateQueries({queryKey:['document-sms']})`);await wait('!'+button('Text')+'.disabled');
  }
  await click('Switch to invoice');await wait("document.body.innerText.includes('Send invoice')");
  await click('Text');await wait("window.__qa.calls.some(c=>c.route==='crm/invoice/document/send')");
  console.log('PASS real quote/invoice send components: missing consent blocks Text and Email + Text; inline permission/source setup; no message on save; immediate readiness; original document endpoint; opt-out/suppression/read failures block; mobile dialog fits. All API calls synthetic.');
} finally {ws?.close();chrome?.kill();await vite?.close();await rm(fixture,{recursive:true,force:true});await rm(profile,{recursive:true,force:true}).catch(()=>{});}
