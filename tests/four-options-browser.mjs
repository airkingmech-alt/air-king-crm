// Synthetic public-document browser/print QA. No customer or provider requests.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import WebSocket from 'ws';
const root=process.cwd(),fixture=await mkdtemp(path.join(root,'client/.four-options-qa-')),profile=await mkdtemp(path.join(tmpdir(),'four-options-chrome-'));
let vite,chrome,ws;
try {
  await writeFile(path.join(fixture,'index.html'),'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script>');
  await writeFile(path.join(fixture,'api.ts'),'export async function crm(){throw Error("Network forbidden in synthetic QA")}');
  await writeFile(path.join(fixture,'main.tsx'),`
    import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Router,Route}from'wouter';import CustomerDocument from '@/pages/customer-document';import {potentialChampionRebates} from '@shared/champion-rebates';import {approximateEfficiencyDisclosure} from '@shared/quote-efficiency';import {buildQuoteDraft} from '@/lib/quote-pricing';import '@/index.css';
    const halfDraft=buildQuoteDraft({customerId:'synthetic',customerName:'Test',jobType:'Changeout',title:'Half-size bid',equipmentItems:['chp-xc342','chp-z8e100c16','chp-ec42'],equipmentCost:0,laborCost:960,materialsCost:200},'TEST','2026-10-27');
    const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,gcTime:Infinity}}});
    client.setQueryData(['public-document','synthetic'],{kind:'quote',document:{number:'Q-SYNTHETIC',title:'Synthetic four-option layout',customerName:'Test Customer',status:'Quote Sent',scope:'Same installation location and scope',selectedAddOns:[],addOnCatalog:[],options:['Value','Good','Better','Best'].map((tier,i)=>({tier,label:['Guardian · parts only','Champion 13.4 SEER2','Champion 14.3 SEER2','Champion 16+ SEER2 · two-stage furnace'][i],customerPrice:5000+i*500,rebateOffer:potentialChampionRebates(i===3?[{brand:'Champion',category:'Condenser',model:'XC636E2S11'},{brand:'Champion',category:'Furnace',model:'Z9ET080C16SMPS1'}]:i===2?[{brand:'Champion',category:'Furnace',model:'Z9ET080C16SMPS1'}]:[]),equipmentSummary:'Synthetic model combination for layout testing only',efficiency:'Synthetic test rating · 13.4 SEER2',features:[i===0?'10-year parts-only warranty; labor coverage not included':'10-year parts and labor warranty','Warranty registration and proposal terms apply',approximateEfficiencyDisclosure],...(i===3?halfDraft.options[3]:{})}))}});
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Router hook={()=>["/synthetic",()=>{}]}><Route path='/:token'><CustomerDocument/></Route></Router></QueryClientProvider>);
  `);
  vite=await createServer({configFile:false,optimizeDeps:{entries:[path.join(fixture,'main.tsx')]},root:path.join(root,'client'),plugins:[react()],resolve:{alias:[{find:'@shared',replacement:path.join(root,'shared')},{find:'@/lib/crm-api',replacement:path.join(fixture,'api.ts')},{find:'@',replacement:path.join(root,'client/src')}]},server:{host:'127.0.0.1',port:5193,strictPort:true}});
  await vite.listen();
  chrome=spawn(process.env.CHROMIUM_PATH||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--remote-debugging-port=9343',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<80;i++){try{tabs=await(await fetch('http://127.0.0.1:9343/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}assert.ok(tabs,'Chromium unavailable');
  ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.on('open',r));let id=0;const pending=new Map();ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value};
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:5193/${path.basename(fixture)}/index.html`});
  for(let i=0;i<150;i++){if(await evaluate("document.querySelectorAll('.quote-option').length===4"))break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(await evaluate("document.querySelectorAll('.quote-option').length"),4,await evaluate('document.body.innerText'));
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.quote-options')).gridTemplateColumns.split(' ').length"),4);
  for(let i=0;i<4;i++){await evaluate(`document.querySelectorAll('.quote-option')[${i}].click()`);assert.ok(await evaluate(`document.querySelectorAll('.quote-option')[${i}].className.includes('ring-2')`));}
  assert.ok(await evaluate("document.body.innerText.includes('An AHRI-certified rating is not represented unless specifically provided')"));
  assert.ok(await evaluate("document.body.innerText.includes('$300 base rebate or $365 total bonus rebate') && document.body.innerText.includes('60 calendar days')"));
  assert.ok(await evaluate("document.body.innerText.includes('4-ton AC (upsized from 3.5 ton)') && document.body.innerText.includes('CTM48C5CFS1') && document.body.innerText.includes('Coil changes from CTM42C5CES1')"));
  await writeFile('/tmp/four-options-desktop.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.quote-options')).gridTemplateColumns.split(' ').length"),1);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=391'));
  await writeFile('/tmp/four-options-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await send('Emulation.setEmulatedMedia',{media:'print'});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.quote-options')).gridTemplateColumns.split(' ').length"),2);
  const pdf=await send('Page.printToPDF',{printBackground:true});await writeFile('/tmp/four-options.pdf',Buffer.from(pdf.data,'base64'));
  console.log('PASS: four selectable public cards, desktop four columns, mobile one column without overflow, print two columns/PDF. Potential rebate alternatives and requirements shown without price deductions. Synthetic only.');
} finally {ws?.close();chrome?.kill();await vite?.close();await rm(fixture,{recursive:true,force:true});await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
