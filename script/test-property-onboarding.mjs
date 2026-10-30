// Real editors against synthetic local persistence; all remote requests blocked.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
const css = readFileSync('dist/public/assets/' + readdirSync('dist/public/assets').find(name => name.endsWith('.css')), 'utf8');
const result = await build({
  stdin: { contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {CustomerEditor} from './client/src/components/customer-editor';
    import {EquipmentEditor} from './client/src/components/equipment-editor';
    import {CrownConfigurationFields} from './client/src/components/crown-configuration';
    import {configurationFor} from './shared/crown-care';
    const initial={id:'synthetic',name:'Synthetic owner',type:'Residential',contacts:[{name:'Synthetic owner',role:'Primary',phone:'2025550100',email:''}],properties:[],activity:[],tags:[]};
    window.fixture=initial; window.calls=[]; window.mode='ok';
    function App(){const [customer,setCustomer]=useState(JSON.parse(localStorage.getItem('customer')) || initial);
      window.accept=setCustomer;
      window.addEventListener('crm-refresh',()=>setCustomer(JSON.parse(localStorage.getItem('customer')) || initial),{once:true});
      const [coverage,setCoverage]=useState({...configurationFor({}),coveredEquipment:[]});
      return <main><CustomerEditor customer={customer}/><EquipmentEditor customer={customer}/>
        <p data-testid="count">{customer.properties.length} properties</p>
        <CrownConfigurationFields customer={customer} value={coverage} onChange={setCoverage}/>
        <pre hidden data-testid="coverage">{JSON.stringify(coverage.coveredEquipment)}</pre>
      </main>;
    } createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},
  bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'synthetic',setup(build){
    const stubs={
      'lib/supabase':`export const supabase={auth:{getSession:async()=>({data:{session:null}})}};`,
      'context/auth-context':`export const useAuth=()=>({profile:{id:'test',company_id:'test',role:'owner',full_name:'Test'}});`,
      'context/data-context':`export const useData=()=>({acceptSavedRecord:(_,saved)=>window.accept(saved)});`,
      'lib/confirmed-save':`export async function saveRecords(records){window.calls.push(records);await new Promise(r=>setTimeout(r,200));if(window.mode==='error')throw new Error('Synthetic storage failure');const saved=records[0].data;localStorage.setItem('customer',JSON.stringify(saved));if(window.mode==='lost'){window.mode='ok';throw new Error('Synthetic lost response');}return [saved];}`,
      'lib/crm-api':`export async function crm(path,method,body){window.calls.push(body);const customer=JSON.parse(localStorage.getItem('customer'));const p=customer.properties.find(p=>p.id===body.propertyId);p.systems.push({...body.equipment,id:crypto.randomUUID(),status:'Active'});localStorage.setItem('customer',JSON.stringify(customer));return {equipment:p.systems.at(-1)};}`,
    };
    for(const [suffix,contents] of Object.entries(stubs)){build.onResolve({filter:new RegExp(suffix+'$')},()=>({path:suffix,namespace:'stub'}));build.onLoad({filter:new RegExp(suffix+'$'),namespace:'stub'},()=>({contents}));}
  }}]
});
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:req.url==='/app.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const edit=()=>page.getByRole('button',{name:'Edit customer',exact:true});
 await edit().click(); await page.getByLabel('Customer name *',{exact:true}).fill('Discard me'); await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await edit().click(); assert.equal(await page.getByLabel('Customer name *',{exact:true}).inputValue(),'Synthetic owner');
 for(let i=0;i<9;i++){
  await page.getByRole('button',{name:'Add service address',exact:true}).click();
  await page.locator('#service-'+i+'-street').fill((i+1)+' Synthetic Street');
  if(i===0){await page.locator('#service-0-city').fill('Lathrop');await page.locator('#service-0-state').fill('CA');}
  assert.equal(await page.locator('#service-'+i+'-city').inputValue(),'Lathrop');
 }
 await page.getByRole('button',{name:'Add property contact',exact:true}).nth(3).click();
 await page.getByRole('group',{name:'Service address 4',exact:true}).getByLabel('Contact name',{exact:true}).fill('Synthetic tenant');await page.getByLabel('Contact phone',{exact:true}).fill('2025550199');
 await page.getByLabel('Access instructions',{exact:true}).nth(3).fill('Call tenant');
 await page.evaluate(()=>window.mode='error');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic storage failure'}).waitFor();
 assert.equal(await page.locator('#service-8-street').inputValue(),'9 Synthetic Street');
 await page.evaluate(()=>window.mode='lost');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic lost response'}).waitFor();
 await page.getByRole('button',{name:'Save changes',exact:true}).dblclick();await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.customer).properties.length),9);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.customer).contacts[0].name),'Synthetic owner');
 await page.reload();assert.equal(await page.getByTestId('count').textContent(),'9 properties');
 await page.getByRole('button',{name:'Add equipment manually',exact:true}).click();
 const propertyId=await page.evaluate(()=>JSON.parse(localStorage.customer).properties[3].id);
 await page.getByRole('dialog').locator('select').nth(0).selectOption(propertyId);await page.getByRole('dialog').locator('select').nth(1).selectOption('Furnace');
 await page.getByLabel('Filter size (with units)',{exact:true}).fill('20x25x4');await page.getByLabel('Filter quantity (blank if unknown)',{exact:true}).fill('2');await page.getByLabel('Equipment / filter location',{exact:true}).fill('Hall closet');
 await page.getByRole('button',{name:'Save equipment',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByLabel(/^Property to prepare/).selectOption(propertyId);
 await page.getByRole('button',{name:"Add this property's saved equipment",exact:true}).click();assert.equal(await page.getByRole('button',{name:"Add this property's saved equipment",exact:true}).isDisabled(),true);
 const coverage=JSON.parse(await page.getByTestId('coverage').textContent());assert.equal(coverage.length,1);assert.equal(coverage[0].propertyId,propertyId);assert.equal(coverage[0].filterQuantity,2);assert.match(coverage[0].description,/Hall closet/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'Mobile content must fit viewport');
 await page.setViewportSize({width:1280,height:900});await edit().click();assert.equal(await page.getByLabel('Contact phone',{exact:true}).inputValue(),'2025550199');await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PASS: nine-property mobile entry, contact roles, cancel, failed/lost-response retry, repeated submit, reload persistence, property-specific filters, deduplicated Crown Care coverage and desktop reopen.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
