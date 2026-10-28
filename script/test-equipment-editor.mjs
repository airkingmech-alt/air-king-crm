// Actual equipment components with synthetic persistence; never contacts production.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const css = readFileSync('dist/public/assets/' + (await import('node:fs')).readdirSync('dist/public/assets').find(name => name.endsWith('.css')), 'utf8');
const result = await build({
  stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { EquipmentEditor } from './client/src/components/equipment-editor';
    import { EquipmentScanner } from './client/src/components/equipment-scanner';
    const initial = { id: 'synthetic-customer', name: 'Synthetic customer', properties: [
      { id: 'a', address: 'Test A', city: 'Test city', systems: [] }, { id: 'b', address: 'Test B', systems: [] }
    ]};
    window.calls = []; window.mode = 'ok';
    function Harness() {
      const [customer, setCustomer] = useState(JSON.parse(localStorage.getItem('equipment')) || initial);
      window.refresh = () => setCustomer(JSON.parse(localStorage.getItem('equipment')) || initial);
      window.addEventListener('crm-refresh', window.refresh, { once: true });
      return <main><EquipmentEditor customer={customer}/><EquipmentScanner customer={customer}/>
        {customer.properties.map(p => <section key={p.id} aria-label={p.address}>{p.systems.map(s => <article key={s.id}>
          <p>{s.brand} {s.type} {s.model} {s.serial}</p><EquipmentEditor customer={customer} propertyId={p.id} system={s}/>
        </article>)}</section>)}
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic-api', setup(build) {
    build.onResolve({ filter: /lib\/crm-api$/ }, () => ({ path: 'fake-api', namespace: 'synthetic' }));
    build.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: `
      export async function crm(path, method, body) {
        window.calls.push({path,body}); await new Promise(r=>setTimeout(r,150));
        if(window.mode==='error') throw new Error('Synthetic storage failure');
        if(window.mode==='conflict') throw Object.assign(new Error('Equipment changed. Reopen to review.'), {status:409});
        if(path==='equipment/analyze') return {photoId:'synthetic-photo',analysis:{note:'Review synthetic reading',fields:Object.fromEntries(['manufacturer','model','serial','equipmentType','capacity','manufactureYear','efficiency','refrigerant'].map(k=>[k,{value:k==='equipmentType'?'AC':k==='manufacturer'?'Scan brand':null,confidence:'high',evidence:'Synthetic fixture'}]))}};
        const customer=JSON.parse(localStorage.getItem('equipment')) || {id:'synthetic-customer',name:'Synthetic customer',properties:[{id:'a',address:'Test A',city:'Test city',systems:[]},{id:'b',address:'Test B',systems:[]}]};
        if(body.customerId!==customer.id) throw new Error('Wrong customer');
        const p=customer.properties.find(p=>p.id===body.propertyId);
        const existing=p.systems.find(s=>s.id===body.systemId);
        const record={...existing,...body.equipment,id:existing?.id || crypto.randomUUID()};
        p.systems=existing?p.systems.map(s=>s.id===existing.id?record:s):[...p.systems,record];
        localStorage.setItem('equipment',JSON.stringify(customer)); return {equipment:record};
      }
    ` }));
  }}],
});
const server = createServer((request,response) => {
  response.setHeader('content-type',request.url==='/app.js'?'application/javascript':request.url==='/app.css'?'text/css':'text/html');
  response.end(request.url==='/app.js'?result.outputFiles[0].text:request.url==='/app.css'?css:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const add=page.getByRole('button',{name:'Add equipment manually',exact:true});
  const dialog=page.getByRole('dialog');
  const save=page.getByRole('button',{name:'Save equipment',exact:true});
  await add.click(); assert.equal(await save.isDisabled(),true);
  await page.getByRole('combobox',{name:/^Equipment type/}).selectOption('Furnace');
  await page.getByLabel('Brand / manufacturer',{exact:true}).fill('Synthetic brand');
  await page.getByLabel('Model',{exact:true}).fill('F-100');
  await page.getByLabel('Manufacture year',{exact:true}).fill('3000'); await save.click();
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByLabel('Manufacture year',{exact:true}).fill('2020');
  await page.evaluate(()=>window.mode='error'); await save.click(); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Model',{exact:true}).inputValue(),'F-100');
  await page.evaluate(()=>window.mode='ok'); await save.click(); await dialog.waitFor({state:'hidden'});
  await add.click(); await page.getByRole('combobox',{name:/^Property/}).selectOption('b');
  await page.getByRole('combobox',{name:/^Equipment type/}).selectOption('AC');
  await page.getByLabel('Model',{exact:true}).fill('AC-200'); await save.click(); await dialog.waitFor({state:'hidden'});
  await page.reload(); await page.getByRole('region',{name:'Test A'}).getByText('Synthetic brand Furnace F-100').waitFor();
  await page.getByRole('region',{name:'Test B'}).getByText('AC AC-200').waitFor();
  console.log('PASS manual entry, validation, error/retry, multiple properties and reload');

  await page.getByRole('region',{name:'Test A'}).getByRole('button').click();
  assert.equal(await page.getByRole('combobox',{name:/^Property/}).isDisabled(),true);
  assert.equal(await page.getByLabel('Model',{exact:true}).inputValue(),'F-100');
  await page.getByLabel('Model',{exact:true}).fill('F-101');
  const before=await page.evaluate(()=>window.calls.length);
  await page.getByLabel('Model',{exact:true}).evaluate(el=>{el.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));el.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(),true);
  await dialog.waitFor({state:'hidden'}); assert.equal(await page.evaluate(()=>window.calls.length),before+1);
  await page.reload(); await page.getByRole('region',{name:'Test A'}).getByText('Synthetic brand Furnace F-101').waitFor();
  await page.getByRole('region',{name:'Test A'}).getByRole('button').click();
  await page.getByLabel('Model',{exact:true}).fill('Discard'); await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('region',{name:'Test A'}).getByRole('button').click();
  assert.equal(await page.getByLabel('Model',{exact:true}).inputValue(),'F-101');
  await page.evaluate(()=>window.mode='conflict'); await save.click(); await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(),/changed/);
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); await page.evaluate(()=>window.mode='ok');
  console.log('PASS edit, duplicate-submit guard, pending dismissal, cancel and conflict');

  await page.setViewportSize({width:375,height:812}); await add.click();
  const bounds=await dialog.boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=376);
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:'/tmp/equipment-mobile.png'});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Scan Equipment Nameplate',exact:true}).click();
  await page.getByLabel('Upload a photo',{exact:true}).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=','base64')});
  await page.getByText('Review synthetic reading',{exact:true}).count();
  const confirm=page.getByRole('button',{name:'Confirm & Save Equipment',exact:true}); await confirm.waitFor(); assert.equal(await confirm.isDisabled(),true);
  await page.getByRole('checkbox').check(); await confirm.click();
  await page.getByText('Equipment saved to the customer profile.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('equipment')).properties[0].systems.length),2);
  assert.deepEqual(errors,[]);
  console.log('PASS 375px mobile layout and scanner analyze/review/confirm regression');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
