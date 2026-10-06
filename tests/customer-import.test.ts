import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { importedCustomer, prepareCustomerImport, type MarkateCustomer } from "../shared/customer-import";

const pg = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const batch = "22222222-2222-4222-8222-222222222222";
const sha = "a".repeat(64);
function source(id="101", changes: Partial<MarkateCustomer> = {}): MarkateCustomer {
  return { source: { system:"markate", customerId:id, status:"Pending", addedOn:"2024-01-02", exportedAt:"2026-10-01T00:00:00Z", exportSha256:sha, csvRow:2 },
    displayName:`Customer ${id}`, firstName:"Customer", lastName:id, companyName:"Example LLC", type:"Commercial",
    email:`contact${id}@example.test`, mobile:`202555${id.padStart(4,"0")}`, phone:"",
    billingAddress:{street:"10 Billing St",unit:"Suite 2",city:"Example",state:"MO",postalCode:"00123"},
    serviceAddresses:[{sourceSlot:1,street:"20 Service St",unit:"A",city:"Other",state:"MO",postalCode:"00124"}],
    additionalContacts:[], ...changes };
}
function existing() { return { id:"existing", name:"Existing Person", type:"Residential", contacts:[{name:"Existing Person",email:"existing@example.test",phone:"2025550123"}], properties:[{id:"old-property",address:"Unchanged",systems:[{id:"old-system"}]}],activity:[{id:"old-history",text:"keep"}],leadStatus:"Won" }; }
function linkSource() { return source("900",{displayName:"Existing Person",firstName:"Existing",lastName:"Person",email:"existing@example.test",mobile:"2025550123"}); }
async function roleQuery(role:string,query:string,params:any[] = []) {
 return pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);return (await tx.query<any>(query,params)).rows;});
}
async function state() { return (await roleQuery("service_role","select crm_customer_import_state('test-company',$1) value",[owner]))[0].value; }
async function request(records:any[]=[{mode:"create",source:source()}]) {
 return prepareCustomerImport({batchId:batch,expectedSnapshot:(await state()).snapshot,expectedNew:records.filter(x=>x.mode==='create').length,expectedLinks:records.filter(x=>x.mode==='link').length,records});
}
async function run(r:any,actor=owner,company="test-company",role="service_role") {
 return (await roleQuery(role,"select crm_import_markate_customers($1,$2,$3,$4,$5,$6,$7) value",[company,actor,r.batchId,r.expectedSnapshot,r.expectedNew,r.expectedLinks,JSON.stringify(r.records)]))[0].value;
}
async function count(table:string) { return Number((await pg.query<any>(`select count(*) n from ${table}`)).rows[0].n); }

before(async()=>{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema crm_private;
 create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create table profiles(id uuid primary key,company_id text,role text,permissions jsonb);
 create table customers(id text primary key,company_id text not null,data jsonb not null,created_at timestamptz default now(),updated_at timestamptz default now());
 create table communication_events(id uuid primary key default gen_random_uuid(),company_id text,customer_id text,quote_id text,invoice_id text,job_id text,event_type text,actor_id uuid,created_at timestamptz default now());
 create table automations(id uuid primary key default gen_random_uuid(),company_id text,enabled boolean,trigger text,steps jsonb);
 create table automation_runs(id uuid primary key default gen_random_uuid(),company_id text,automation_id uuid,event_id uuid,next_at timestamptz);
 grant select on profiles to service_role;
 grant select,insert,update on customers,communication_events,automations,automation_runs to service_role;
 grant select,insert,update on customers to authenticated;
 alter table customers enable row level security;
 create policy test_company on customers to authenticated using(company_id='test-company') with check(company_id='test-company');
 grant usage on schema auth to authenticated,service_role;
 grant execute on function auth.uid() to authenticated,service_role;`);
 const original=await readFile("supabase/migrations/20260909230728_communications_payments.sql","utf8");
 const capture=original.slice(original.indexOf("create function crm_private.capture_entity()"),original.indexOf("create trigger crm_capture_quotes"));
 const enqueue=original.slice(original.indexOf("create function crm_private.enqueue_event()"),original.indexOf("-- Restrict existing helper"));
 await pg.exec(capture);await pg.exec(enqueue);
 await pg.exec(await readFile("supabase/migrations/20261006001150_markate_customer_only_import.sql","utf8"));
 await pg.exec(await readFile("supabase/migrations/20261006012920_reviewed_customer_import_approval.sql","utf8"));
});
after(()=>pg.close());
beforeEach(async()=>{
 await pg.exec(`truncate crm_import.customer_import_approvals,crm_import.customer_import_rows,crm_import.customer_import_batches,customers,communication_events,automation_runs,automations,profiles;
 insert into profiles values('${owner}','test-company','owner','{}');
 insert into automations(company_id,enabled,trigger,steps) values('test-company',true,'customer.created','[{"send_email":true}]'),('test-company',true,'lead.created','[{"send_email":true}]');`);
 await pg.query("insert into customers(id,company_id,data) values('existing','test-company',$1)",[JSON.stringify(existing())]);
 await pg.exec("truncate communication_events,automation_runs");
});

test("mapping preserves source channels, billing/service distinction, pending status, and original values",()=>{
 const s=source("101",{mobile:"(202) 555-0101",phone:"(202) 555-9999",additionalContacts:[{name:"Other Person",emails:["Other@Example.test"],phones:["(202) 555-0202"],raw:"Other Person, Other@Example.test, (202) 555-0202, -",unparsed:[]}]});
 const c=importedCustomer(s,batch);
 assert.equal(c.contacts.length,2);assert.equal(c.contacts[0].phoneNumbers.length,2);assert.equal(c.contacts[1].email,"Other@Example.test");
 assert.equal(c.billingAddress.street,"10 Billing St");assert.equal(c.properties[0].street,"20 Service St");assert.equal(c.properties[0].unit,"A");
 assert.equal(c.billingAddress.postalCode,"00123");assert.equal(c.sourceStatus,"Pending");assert.ok(!("leadStatus" in c));assert.deepEqual(c.activity,[]);
 assert.deepEqual(importedCustomer({...s,serviceAddresses:[]},batch).properties,[]);
});
test("strict source parsing rejects unapproved notes, wrong counts, duplicate IDs, and questionable email without fixing it",async()=>{
 const input={batchId:batch,expectedSnapshot:(await state()).snapshot,expectedNew:1,expectedLinks:0,records:[{mode:"create",source:source()}]};
 assert.throws(()=>prepareCustomerImport({...input,expectedNew:2}));
 assert.throws(()=>prepareCustomerImport({...input,records:[{...input.records[0],source:{...source(),notes:"out of scope"}}]}));
 assert.throws(()=>prepareCustomerImport({...input,records:[{mode:"create",source:source("101",{email:"bad@example.con"})}]}));
 assert.throws(()=>prepareCustomerImport({...input,expectedNew:2,records:[...input.records,...input.records]}));
});
test("atomic import creates contacts and provenance-only link, full snapshot, and zero events/runs despite enabled sends",async()=>{
 const before=(await pg.query<any>("select to_jsonb(c) value from customers c order by id")).rows.map(x=>x.value);
 const r=await request([{mode:"create",source:source()},{mode:"link",customerId:"existing",source:linkSource()}]);
 const result=await run(r);assert.equal(result.inserted,1);assert.equal(result.linked,1);
 const created=(await pg.query<any>("select data from customers where id='cust-markate-101'")).rows[0].data;
 assert.deepEqual(created,r.records[0].customer);
 const linked=(await pg.query<any>("select data from customers where id='existing'")).rows[0].data;
 const {sourceReferences,...unchanged}=linked;assert.deepEqual(unchanged,existing());assert.equal(sourceReferences.markate.customerId,"900");
 const audit=(await pg.query<any>("select before_snapshot,status from crm_import.customer_import_batches")).rows[0];
 assert.deepEqual(audit.before_snapshot,before);assert.equal(audit.status,"completed");
 assert.equal(await count("communication_events"),0);assert.equal(await count("automation_runs"),0);
 assert.equal((await run(r)).replayed,true);assert.equal(await count("customers"),2);
 const changed=structuredClone(r);changed.records[0].customer.name="Different";
 await assert.rejects(run(changed),/different data/);
});
test("fresh snapshot and full rollback prevent stale imports and partial batches",async()=>{
 const stale=await request();await pg.query("update customers set data=data||'{\"name\":\"Changed\"}'::jsonb where id='existing'");
 await assert.rejects(run(stale),/Customers changed/);assert.equal(await count("crm_import.customer_import_batches"),0);
 const bad=await request([{mode:"create",source:source("101")},{mode:"create",source:source("102")}]);
 bad.records[1].customer.activity=[{type:"payment"}];await assert.rejects(run(bad),/customer-only/);
 assert.equal(await count("customers"),1);assert.equal(await count("crm_import.customer_import_batches"),0);
});
test("source-only payload, counts, unique IDs, and exact linkage are enforced in database",async()=>{
 const base=await request();
 for(const modify of [(r:any)=>r.expectedNew=2,(r:any)=>r.records[0].customer.leadStatus='New',(r:any)=>r.records[0].customer.properties[0].systems=[{serial:'bad'}],(r:any)=>r.records[0].customer.contacts[0].email='bad@example.con',(r:any)=>r.records[0].customer.type=null,(r:any)=>r.records[0].customer.contacts[0].name=42,(r:any)=>delete r.records[0].customer.sourceReferences.markate.sourceRow]){
  const r=structuredClone(base);modify(r);await assert.rejects(run(r));assert.equal(await count("customers"),1);
 }
 const link=await request([{mode:"link",customerId:"existing",source:source()}]);await assert.rejects(run(link),/exact name, email, and phone/);
});
test("duplicate checks use exact contact identities, not name-only merging, and reject intra-batch collisions",async()=>{
 const duplicate=await request([{mode:"create",source:source("101",{email:'existing@example.test'})}]);await assert.rejects(run(duplicate),/Possible duplicate/);
 const same=await request([{mode:"create",source:source("101")},{mode:"create",source:source("102",{mobile:source().mobile})}]);await assert.rejects(run(same),/Possible duplicate/);
 assert.equal(await count("customers"),1);
});
test("service-only RPCs require same-company admin and audit tables are private",async()=>{
 const r=await request();for(const role of ['anon','authenticated'])await assert.rejects(run(r,owner,'test-company',role),/permission denied/);
 await assert.rejects(run(r,owner,'other-company'),/authorized owner/);
 await pg.exec("update profiles set role='technician'");await assert.rejects(run(r),/authorized owner/);
 await assert.rejects(roleQuery('authenticated','select * from crm_import.customer_import_batches'),/permission denied/);
 await assert.rejects(roleQuery('service_role','delete from crm_import.customer_import_rows'),/permission denied/);
 await assert.rejects(roleQuery('service_role',"update crm_import.customer_import_rows set source_id='999'"),/permission denied/);
});
test("ordinary creation still triggers automation even if source metadata or session flags are forged",async()=>{
 const c={...importedCustomer(source(),batch),leadStatus:'New'};
 await pg.transaction(async tx=>{await tx.exec("set local role authenticated;set local app.customer_import='true'");await tx.query("insert into customers(id,company_id,data) values($1,'test-company',$2)",[c.id,JSON.stringify(c)]);});
 assert.equal(await count('communication_events'),2);assert.equal(await count('automation_runs'),2);
});

async function approve(r:any, raw:any[] = r.records, corrections:any[] = []) {
 await pg.query(`insert into crm_import.customer_import_approvals
  (company_id,batch_id,actor_id,expected_snapshot,records,raw_source_records,email_corrections,approval_note)
  values('test-company',$1,$2,$3,$4,$5,$6,'Explicitly approved separate source records')`,
  [r.batchId,owner,r.expectedSnapshot,JSON.stringify(r.records),JSON.stringify(raw),JSON.stringify(corrections)]);
}
test("reviewed exact batch permits separate collisions with audit and no sends",async()=>{
 const records=[{mode:'create',source:source('101',{email:'existing@example.test'})},
  {mode:'create',source:source('102',{email:'existing@example.test'})}];
 const r=await request(records);const before=(await pg.query<any>("select to_jsonb(c) value from customers c")).rows[0].value;
 await approve(r);const result=await run(r);assert.equal(result.inserted,2);assert.equal(result.linked,0);
 assert.equal(await count('customers'),3);assert.equal(await count('communication_events'),0);assert.equal(await count('automation_runs'),0);
 assert.deepEqual((await pg.query<any>("select to_jsonb(c) value from customers c where id='existing'")).rows[0].value,before);
 assert.deepEqual((await pg.query<any>("select before_snapshot from crm_import.customer_import_batches")).rows[0].before_snapshot,[before]);
 assert.equal((await run(r)).replayed,true);assert.equal(await count('customers'),3);
 const other=await request([{mode:'create',source:source('103',{email:'existing@example.test'})}]);
 other.batchId='33333333-3333-4333-8333-333333333333';other.records[0].customer.sourceReferences.markate.batchId=other.batchId;
 await assert.rejects(run(other),/Possible duplicate/);
});
test("reviewed approval rejects changed source IDs, fields, snapshots, actors and destination links",async()=>{
 const r=await request([{mode:'create',source:source('101',{email:'existing@example.test'})}]);await approve(r);
 for(const modify of [(x:any)=>x.records[0].customer.name='Changed',
  (x:any)=>{x.records[0].sourceId='999';x.records[0].customer.id='cust-markate-999';x.records[0].customer.sourceReferences.markate.customerId='999';},
  (x:any)=>x.expectedSnapshot='b'.repeat(32),
  (x:any)=>{x.records[0].mode='link';x.records[0].customerId='existing';x.expectedNew=0;x.expectedLinks=1;}]){
  const changed=structuredClone(r);modify(changed);await assert.rejects(run(changed),/Reviewed approval does not match/);
 }
 const admin='44444444-4444-4444-8444-444444444444';await pg.query("insert into profiles values($1,'test-company','admin','{}')",[admin]);
 await assert.rejects(run(r,admin),/Reviewed approval does not match/);assert.equal(await count('customers'),1);
 const changedCount=structuredClone(r);changedCount.expectedNew=2;await assert.rejects(run(changedCount),/Reviewed counts changed/);
});
test("approved collisions still enforce validation, source uniqueness and rollback",async()=>{
 const invalid=await request([{mode:'create',source:source('101',{email:'existing@example.test'})}]);
 invalid.records[0].customer.contacts[0].email='bad@example.con';await approve(invalid);
 await assert.rejects(run(invalid),/validation/);assert.equal(await count('customers'),1);assert.equal(await count('crm_import.customer_import_batches'),0);
 await pg.exec('truncate crm_import.customer_import_approvals');
 const r=await request([{mode:'create',source:source('101',{email:'existing@example.test'})}]);await approve(r);await run(r);
 const again=structuredClone(r);again.batchId='33333333-3333-4333-8333-333333333333';again.expectedSnapshot=(await state()).snapshot;
 again.records[0].customer.sourceReferences.markate.batchId=again.batchId;await approve(again);
 await assert.rejects(run(again),/already linked/);assert.equal(await count('customers'),2);
});
test("email corrections retain exact raw source and correction audit without changing existing rows",async()=>{
 const raw=source('101',{email:'contact@example.con'});const corrected={...raw,email:'contact@example.com'};
 const r=await request([{mode:'create',source:corrected}]);const corrections=[{sourceId:'101',field:'email',before:raw.email,after:corrected.email}];
 await approve(r,[raw],corrections);await run(r);
 const audit=(await pg.query<any>('select raw_source_records,email_corrections from crm_import.customer_import_approvals')).rows[0];
 assert.deepEqual(audit.raw_source_records,[raw]);assert.deepEqual(audit.email_corrections,corrections);
 assert.equal((await pg.query<any>("select data#>>'{contacts,0,email}' email from customers where id='cust-markate-101'")).rows[0].email,corrected.email);
});
test("no client or service role can manufacture or mutate a reviewed approval",async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await assert.rejects(roleQuery(role,"insert into crm_import.customer_import_approvals(company_id,batch_id,actor_id,expected_snapshot,records,raw_source_records,email_corrections,approval_note) values('test-company',$1,$2,$3,'[]','[]','[]','forged')",[batch,owner,'a'.repeat(32)]),/permission denied/);
  await assert.rejects(roleQuery(role,'delete from crm_import.customer_import_approvals'),/permission denied/);
  await assert.rejects(roleQuery(role,"update crm_import.customer_import_approvals set approval_note='changed'"),/permission denied/);
 }
});
