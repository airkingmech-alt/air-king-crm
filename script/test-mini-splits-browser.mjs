// Actual Price Book page, synthetic Supabase storage; all external requests blocked.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const mockDatabase = `
  const base={company_id:'synthetic-company',category:'Mini Splits',description:'Synthetic description',brand:'Test brand',unit:'each',cost_cents:8004,price_cents:10005,taxable:true,active:true,updated_at:'v1'};
  const initial=[{...base,id:'indoor',name:'Synthetic indoor',sku:'INDOOR',model:'INDOOR',item_type:'equipment',metadata:{subcategory:'Indoor units'}},
    {...base,id:'control',name:'Synthetic controller',sku:'CONTROL',model:'CONTROL',item_type:'part',metadata:{subcategory:'Controls'}},
    {...base,id:'archived',name:'Archived synthetic motor',sku:'MOTOR',model:'MOTOR',item_type:'part',active:false},
    {...base,id:'unrelated',name:'Unrelated furnace',sku:'FURNACE',model:'FURNACE',item_type:'equipment',category:'Furnace'}];
  let rows=JSON.parse(localStorage.getItem('synthetic-catalog')||'null')||initial;
  window.catalogRows=()=>rows; window.writes=0;
  export const supabase={from(table){if(table!=='price_book_items')throw Error('Unexpected table');
    let filters=[],changes=null,inserted=null;
    const execute=()=>{ let data=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
      if(changes){window.writes++;data=data.map(r=>Object.assign(r,changes,{updated_at:r.updated_at+'x'}));}
      if(inserted){window.writes++; data=[{...inserted,id:'new-'+window.writes,updated_at:'v1'}];rows.push(...data);}
      localStorage.setItem('synthetic-catalog',JSON.stringify(rows));return {data:structuredClone(data),error:null};};
    const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},update(v){changes=v;return q},insert(v){inserted=v;return q},
      maybeSingle(){const r=execute();return Promise.resolve({...r,data:r.data[0]||null})},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject)}};
    return q;}};
`;
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import Pricebook from './client/src/pages/pricebook';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Pricebook/></QueryClientProvider>);`,
    resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{name:'synthetic-only', setup(b){
    b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'synthetic'}));
    b.onResolve({filter:/^@\/context\/auth-context$/},()=>({path:'auth',namespace:'synthetic'}));
    b.onResolve({filter:/^@\/hooks\/use-toast$/},()=>({path:'toast',namespace:'synthetic'}));
    b.onLoad({filter:/.*/,namespace:'synthetic'},({path})=>({contents:path==='db'?mockDatabase:path==='auth'?`export const useAuth=()=>({profile:{id:'synthetic-owner',company_id:'synthetic-company',role:'owner'}})`:`export const useToast=()=>({toast:()=>{}});`,loader:'js'}));
  }}],
});
// Exercise the unchanged invoice selector callback verbatim in an isolated
// harness, without opening/saving a customer invoice.
const invoices = await readFile('client/src/pages/invoices.tsx','utf8');
const callback = invoices.slice(invoices.indexOf('  const addCatalogItem = '), invoices.indexOf('  const handleSubmit ='));
assert.match(callback,/setLineItems/);
const invoiceBundle=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  type CatalogItem=any;
  const unit={id:'unit',item_type:'equipment',description:'Synthetic indoor component',name:'Indoor',price_cents:10005,cost_cents:8004};
  const part={id:'part',item_type:'part',description:'Synthetic controller',name:'Control',price_cents:1505,cost_cents:1204};
  function Harness(){const [lineItems,setLineItems]=useState([{description:'',quantity:'1',unitPrice:''}]);const [catalogEquipment,setCatalogEquipment]=useState<any[]>([]);
    window.invoiceLines=()=>lineItems;window.invoiceEquipment=()=>catalogEquipment;window.changeCatalog=()=>{unit.price_cents=20000;part.price_cents=30000;};
    ${callback}
    return <main><button onClick={()=>addCatalogItem(unit)}>Select indoor</button><button onClick={()=>addCatalogItem(part)}>Select control</button></main>;}
  createRoot(document.getElementById('root')).render(<Harness/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic'});
const server = createServer((req,res)=>{const js=req.url?.endsWith('.js');res.setHeader('content-type',js?'application/javascript':'text/html');res.end(js?(req.url==='/invoice.js'?invoiceBundle:result).outputFiles[0].text:`<!doctype html><html><body><div id="root"></div><script src="${req.url==='/invoice'?'/invoice.js':'/app.js'}"></script></body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox'] });
try {
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Mini Splits (2)',exact:true}).click();
  await page.getByRole('heading',{name:'Synthetic indoor',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Synthetic controller',exact:true}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'Unrelated furnace',exact:true}).count(),0);
  const search=page.getByPlaceholder('Search name, SKU, brand, model, or category');
  await search.fill('controls');
  assert.equal(await page.getByRole('heading',{name:'Synthetic controller',exact:true}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'Synthetic indoor',exact:true}).count(),0);
  await search.fill('CONTROL');assert.equal(await page.getByRole('heading',{name:'Synthetic controller',exact:true}).count(),1);
  await search.fill('');
  console.log('PASS equipment/accessory tab counts, category exclusion, SKU and subtype search');
  await page.getByRole('button',{name:'Add item',exact:true}).click();
  let dialog=page.getByRole('dialog'); const fields=dialog.locator('input');
  assert.equal(await fields.nth(1).inputValue(),'Mini Splits');
  assert.match(await dialog.getByRole('combobox').textContent(),/Equipment/);
  await fields.nth(0).fill('Discarded');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.writes),0);
  await page.getByRole('button',{name:'Add item',exact:true}).click();
  assert.equal(await fields.nth(0).inputValue(),'');assert.equal(await fields.nth(1).inputValue(),'Mini Splits');
  await dialog.getByRole('combobox').click();await page.getByRole('option',{name:'Parts',exact:true}).click();
  assert.equal(await fields.nth(1).inputValue(),'Mini Splits');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  console.log('PASS add/cancel/reopen defaults and category retained for parts');
  await search.fill('CONTROL');await page.getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await fields.nth(1).inputValue(),'Mini Splits');
  await fields.nth(7).fill('123.45');await page.getByRole('button',{name:'Save item',exact:true}).click();
  await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.catalogRows().find(r=>r.id==='control').price_cents),12345);
  await page.getByRole('button',{name:'Archive',exact:true}).click();
  await page.getByRole('heading',{name:'Synthetic controller',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Show archived',exact:true}).click();
  await page.getByRole('button',{name:'Restore',exact:true}).click();
  await page.waitForFunction(()=>window.catalogRows().find(r=>r.id==='control').active);
  await page.reload();await page.getByRole('button',{name:'Mini Splits (2)',exact:true}).click();
  await page.getByRole('heading',{name:'Synthetic controller',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.catalogRows().find(r=>r.id==='control').price_cents),12345);
  assert.equal(await page.evaluate(()=>window.catalogRows().find(r=>r.id==='control').metadata.subcategory),'Controls');
  console.log('PASS versioned edits, exact cents, archive/restore, metadata and reload');
  await page.goto(`http://127.0.0.1:${server.address().port}/invoice`);
  await page.getByRole('button',{name:'Select indoor',exact:true}).click();
  await page.getByRole('button',{name:'Select control',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.invoiceLines()),[
    {description:'Synthetic indoor component',quantity:'1',unitPrice:'100.05'},
    {description:'Synthetic controller',quantity:'1',unitPrice:'15.05'},
  ]);
  assert.equal(await page.evaluate(()=>window.invoiceEquipment().length),1);
  await page.evaluate(()=>window.changeCatalog());
  assert.equal(await page.evaluate(()=>window.invoiceLines()[0].unitPrice),'100.05');
  console.log('PASS actual invoice selection callback uses sale prices for components/accessories and keeps line snapshots');
  assert.deepEqual(errors,[]);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
