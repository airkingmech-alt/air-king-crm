// Local synthetic browser QA; never connects to Supabase or real customer records.
// Run after npm ci: node tests/new-house-preview.mjs
// Open the printed URL; port 5189 must be free. Ctrl+C cleans up.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const root=process.cwd(), fixture=await mkdtemp(path.join(root,"client/.new-house-qa-"));
let vite;
try {
  await writeFile(path.join(fixture,"index.html"),'<div id="root"></div><script type="module" src="./main.tsx"></script>');
  await writeFile(path.join(fixture,"mock-auth.ts"),'export function useAuth(){return {profile:{id:"test-owner",company_id:"test-company",full_name:"QA Owner",role:"owner",permissions:{}}};}');
  await writeFile(path.join(fixture,"mock-api.ts"),'export async function crm(path){if(path==="crm/addresses/autocomplete")return {suggestions:[],available:false};throw Error("Unexpected synthetic API request: "+path)}');
  await writeFile(path.join(fixture,"mock-supabase.ts"),`
    const initial={customers:[{id:"qa-customer",name:"Synthetic Customer",type:"Residential",contacts:[{name:"Synthetic Customer",phone:"5555550100",email:"test@example.invalid",role:"Primary"}],properties:[{id:"qa-property",address:"100 Test Street, Unit 2",street:"100 Test Street",unit:"Unit 2",city:"Test City",state:"MO",zip:"00000",systems:[{id:"qa-system",model:"KEEP-ME"}]}],billingAddress:{street:"200 Billing Street",unit:"",city:"Other City",state:"MO",postalCode:"00001"},leadSource:"Other",leadStatus:"New",activity:[],tags:[],createdAt:"2026-10-08"}],quotes:[],invoices:[],work_orders:[],memberships:[]};
    const stored=localStorage.getItem("new-house-qa");window.__qa={records:stored?JSON.parse(stored):initial,saves:0,fail:false,delay:0};
    const persist=()=>localStorage.setItem("new-house-qa",JSON.stringify(window.__qa.records));
    export function extractEntities(rows){return rows.map(row=>row.data)}
    export const supabase={from(table){return {select(){return this},order(){return this},async range(){return {data:(window.__qa.records[table]||[]).map(data=>({data:structuredClone(data)})),error:null}}}},async rpc(name,p){
      const q=window.__qa;q.saves++;await new Promise(resolve=>setTimeout(resolve,q.delay));if(q.fail)return {data:null,error:{message:"Synthetic offline failure"}};
      if(name==="crm_save_records"){const saved=[];for(const rec of p.p_records){const rows=q.records[rec.table],old=rows.find(row=>row.id===rec.id);if(old&&JSON.stringify(old)!==JSON.stringify(rec.previous))return {data:null,error:{message:"This record changed. Refresh and review before saving again."}};const data=structuredClone(rec.data);q.records[rec.table]=[...rows.filter(row=>row.id!==rec.id),data];saved.push(data)}persist();return {data:saved,error:null}}
      if(name==="crm_edit_document"){const rows=q.records[p.p_kind+"s"],old=rows.find(row=>row.id===p.p_id);if(JSON.stringify(old)!==JSON.stringify(p.p_previous))return {data:null,error:{message:"This record changed. Refresh and review before saving again."}};const data={...old,...p.p_changes,editHistory:[...(old.editHistory||[]),{at:new Date().toISOString(),actorId:"test-owner",before:old.title||old.amount,changes:p.p_changes}]};q.records[p.p_kind+"s"]=rows.map(row=>row.id===old.id?data:row);persist();return {data:structuredClone(data),error:null}}
      throw Error("Unexpected synthetic RPC: "+name)
    }};
  `);
  await writeFile(path.join(fixture,"main.tsx"),`
import React from "react";import{createRoot}from"react-dom/client";import{QueryClient,QueryClientProvider}from"@tanstack/react-query";import{DataProvider,useData}from"@/context/data-context";import{Router,Switch,Route,Link}from"wouter";import{useHashLocation}from"wouter/use-hash-location";import NewHouseQuote from "@/pages/new-house-quote";import {QuoteEditor} from "@/components/document-editors";import "@/index.css";
function Fixture(){const d=useData();return <main><Link href="/quotes">QA Quotes navigation</Link><div className="p-4 border"><b>Local synthetic new-house QA — no production connections</b><label className="mx-4"><input type="checkbox" onChange={e=>{window.__qa.fail=e.target.checked}}/>Simulate save failure</label><label><input type="checkbox" onChange={e=>{window.__qa.delay=e.target.checked?1200:0}}/>Delay saves</label><p>Saved records: {d.quotes.length}</p></div><Switch><Route path="/quotes/new-house/:id"><NewHouseQuote/></Route><Route path="/quotes/new-house"><NewHouseQuote/></Route><Route><div className="p-6"><Link href="/quotes/new-house?customer=qa-customer">New synthetic house quote</Link>{d.quotes.map(q=><div key={q.id}><p>{q.title} · {q.status} · {q.options[0].customerPrice}</p><p>{q.laborDescription}</p><QuoteEditor quote={q}/><Link href={"/quotes/new-house/"+q.id}>Reopen saved takeoff</Link></div>)}</div></Route></Switch></main>}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><Router hook={useHashLocation}><DataProvider><Fixture/></DataProvider></Router></QueryClientProvider>);
`);
  vite=await createServer({configFile:false,optimizeDeps:{entries:[path.join(fixture,"index.html")]},root:path.join(root,"client"),plugins:[react()],resolve:{alias:[{find:"@/context/auth-context",replacement:path.join(fixture,"mock-auth.ts")},{find:"@/lib/supabase",replacement:path.join(fixture,"mock-supabase.ts")},{find:"./supabase",replacement:path.join(fixture,"mock-supabase.ts")},{find:"@/lib/crm-api",replacement:path.join(fixture,"mock-api.ts")},{find:"@",replacement:path.join(root,"client/src")}]},server:{host:"127.0.0.1",port:5189,strictPort:true}});await vite.listen();
  console.log("http://127.0.0.1:5189/"+path.basename(fixture)+"/index.html");
  await new Promise(resolve=>process.on("SIGINT",resolve));
} finally {await vite?.close();await rm(fixture,{recursive:true,force:true});}
