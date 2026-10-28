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
  await writeFile(path.join(fixture,'mock-data.ts'),`
    import {buildQuoteDraft} from '@/lib/quote-pricing';
    export function useData(){return {customers:[{id:'test-customer',name:'Test Customer'}],createQuote:async(input)=>{window.__input=JSON.parse(JSON.stringify(input));const q=buildQuoteDraft(input,'Q-MANUAL','2026-10-27');localStorage.setItem('manual-saved',JSON.stringify(q));window.__saved=JSON.parse(JSON.stringify(q));return q;}}}
  `);
  await writeFile(path.join(fixture,'main.tsx'),`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Router,Route}from'wouter';import CustomerDocument from '@/pages/customer-document';import {ManualQuoteBuilder} from '@/components/manual-quote-builder';import '@/index.css';
    const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,gcTime:Infinity}}});
    function App(){const [saved,setSaved]=useState(JSON.parse(localStorage.getItem('manual-saved')||'null'));window.__saved=saved;
      if(saved){client.setQueryData(['public-document','synthetic'],{kind:'quote',document:{...saved,number:'TEST',scope:saved.laborDescription}});return <QueryClientProvider client={client}><Router hook={()=>['/synthetic',()=>{}]}><Route path='/:token'><CustomerDocument/></Route></Router></QueryClientProvider>}
      return <div className='p-4 max-w-5xl mx-auto'><ManualQuoteBuilder customerId='test-customer' onCancel={()=>{}} onSaved={setSaved}/></div>
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `);
  vite=await createServer({configFile:false,optimizeDeps:{entries:[path.join(fixture,'main.tsx')]},root:path.join(root,'client'),plugins:[react()],resolve:{alias:[{find:'@shared',replacement:path.join(root,'shared')},{find:'@/context/data-context',replacement:path.join(fixture,'mock-data.ts')},{find:'@/lib/crm-api',replacement:path.join(fixture,'api.ts')},{find:'@',replacement:path.join(root,'client/src')}]},server:{host:'127.0.0.1',port:5194,strictPort:true}});
  await vite.listen();
  chrome=spawn(process.env.CHROMIUM_PATH||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--remote-debugging-port=9344',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<80;i++){try{tabs=await(await fetch('http://127.0.0.1:9344/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}assert.ok(tabs,'Chromium unavailable');
  ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.on('open',r));let id=0;const pending=new Map();ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value};
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:5194/${path.basename(fixture)}/index.html`});
  const settle=()=>new Promise(r=>setTimeout(r,100));
  const select=async(label,value)=>{await evaluate(`(()=>{const el=document.querySelector('select[aria-label="${label}"]');el.value='${value}';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);await settle()};
  const change=async(label,value)=>{await evaluate(`(()=>{const el=document.querySelector('input[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'${value}');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await settle()};
  const clickText=async(text,index=0)=>{await evaluate(`Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.includes(${JSON.stringify(text)}))[${index}].click()`);await settle()};
  const checkbox=async(index,text)=>{await evaluate(`Array.from(document.querySelectorAll('[data-testid="manual-option"]')[${index}].querySelectorAll('label')).find(l=>l.textContent.includes(${JSON.stringify(text)})).querySelector('input[type=checkbox]').click()`);await settle()};
  for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('[data-testid=add-quote-option]')"))break;await settle()}
  assert.equal(await evaluate("document.querySelectorAll('[data-testid=manual-option]').length"),0);
  await clickText('Add option');
  await select('Option 1 add Condenser','chp-xc336');await select('Option 1 add Furnace','chp-z9e080b');await select('Option 1 add Evaporator Coil','chp-ec36bn');
  await change('Option 1 name','Standard choice');await checkbox(0,'10-year parts warranty');
  const original=await evaluate(`document.querySelector('[aria-label="Option 1 pricing"]').innerText`);
  assert.ok(original.includes('$8,060.44'));
  await clickText('Duplicate option');
  await change('Option 2 name','Premium choice');
  await evaluate(`document.querySelectorAll('[data-testid=manual-option]')[1].querySelector('button[aria-label="Remove XC336E2S11"]').click()`);await settle();
  await select('Option 2 add Condenser','chp-xc636');
  await evaluate(`document.querySelectorAll('[data-testid=manual-option]')[1].querySelector('button[aria-label="Remove Z9ES080B12SMPS1"]').click()`);await settle();
  await select('Option 2 add Furnace','chp-z9t080');await checkbox(1,'10-year labor warranty');await checkbox(1,'Include the suggested potential rebate');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Option 1 pricing"]').innerText`),original);
  await checkbox(1,'Override selling price');await change('Option 2 selling price','9999');
  await clickText('Add option');assert.equal(await evaluate("document.querySelectorAll('[data-testid=manual-option]').length"),3);
  await evaluate(`document.querySelector('button[aria-label="Remove option 3"]').click()`);await settle();
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=391'));
  await writeFile('/tmp/manual-options-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await clickText('Save Draft Quote');
  for(let i=0;i<50;i++){if(await evaluate("document.querySelectorAll('.quote-option').length===2"))break;await settle()}
  const saved=await evaluate('window.__saved');
  assert.equal(saved.options.length,2);assert.equal(saved.options[0].customerPrice,8060.44);assert.equal(saved.options[1].customerPrice,9999);
  assert.equal(saved.options[0].laborWarrantyCost,0);assert.equal(saved.options[1].laborWarrantyCost,350);
  assert.ok(!saved.options[0].rebateOffer);assert.equal(saved.options[1].rebateOffer.items.length,2);
  assert.ok(!saved.options[0].equipment.includes('XC636'));
  await send('Page.reload');await settle();for(let i=0;i<100;i++){if(await evaluate("!!window.__saved && document.querySelectorAll('.quote-option').length===2"))break;await settle()}
  assert.equal(await evaluate('window.__saved.options[1].customerPrice'),9999);
  assert.ok(await evaluate("document.body.innerText.includes('Standard choice') && document.body.innerText.includes('Premium choice') && document.body.innerText.includes('$465 base total or $565 bonus total')"));
  await send('Emulation.setEmulatedMedia',{media:'print'});const pdf=await send('Page.printToPDF',{printBackground:true});await writeFile('/tmp/manual-options.pdf',Buffer.from(pdf.data,'base64'));
  console.log('PASS: empty start, add/duplicate/remove, independent equipment and prices, separate warranty selections, $350 labor allowance, confirmed rebate, price override, saved reload, mobile layout and PDF. Synthetic only.');

} finally {ws?.close();chrome?.kill();await vite?.close();await rm(fixture,{recursive:true,force:true});await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
