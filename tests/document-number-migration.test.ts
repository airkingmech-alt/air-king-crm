import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { publicFields } from "../server/crm/core";

// Disposable in-memory PostgreSQL. Real permission, approval, balance, payment,
// and editing SQL runs here; no provider, production data, or live migration.
const pg = new PGlite();
const employee = "11111111-1111-4111-8111-111111111111";
type Data = Record<string, any>;
const tables = ["customers", "customer_notes", "customer_photos", "quotes", "quote_acceptances", "invoices", "invoice_line_items", "payments", "work_orders", "memberships", "price_book_items", "leads", "lead_sources", "crm_settings", "customer_communication_preferences", "message_templates", "automations", "automation_runs", "communications", "communication_events", "referrals", "coupons", "marketing_audiences", "marketing_campaigns", "marketing_campaign_steps", "marketing_campaign_runs", "marketing_campaign_recipients", "marketing_attributions", "communication_consent_events"];
const option = (changes: Data = {}): Data => ({ tier: "Better", label: "Selected system", equipment: "Heat pump", equipmentItems: ["sku-one"], equipmentSummary: "Selected heat pump", efficiency: "Match pending", features: ["Install as described"], equipmentCost: 100, purchaseTax: 9, totalCost: 109, customerPrice: 136.25, ...changes });
const quote = (changes: Data = {}): Data => ({ id: "q", customerId: "customer", customerName: "Synthetic Customer", status: "Draft", title: "Heat pump replacement", jobType: "Changeout", laborDescription: "Original labor", options: [option()], selectedOption: "Better", selectedAddOns: [], laborCost: 0, materialsCost: 0, taxRate: .09, equipmentCost: 100, purchaseTax: 9, equipmentItems: ["sku-one"], equipmentSelectionMode: "explicit", pricingVersion: "purchase-tax-v1", createdAt: "2026-10-01", sentAt: "2026-10-02", expiresAt: "2027-01-01", customMetadata: { preserve: true }, ...changes });
const invoice = (changes: Data = {}): Data => ({ id: "i", customerId: "customer", customerName: "Synthetic Customer", status: "Sent", amount: 125.35, paidAmount: 0, items: [{ description: "Original scope", amount: 125.35 }], dueDate: "2026-11-01", sentDate: "2026-10-01", cardFeePercent: 3, customMetadata: { preserve: true }, ...changes });
let migration: string;
let beforeUpgrade: any, afterUpgrade: any;
async function insert(table: string, data: Data, company = "airking") {
  return (await pg.query<Data>(`insert into ${table}(id,company_id,customer_id,data) values($1,$2,$3,$4) returning data`, [data.id, company, data.customerId ?? null, JSON.stringify(data)])).rows[0].data;
}
async function stored(kind: string, id: string) { return (await pg.query<Data>(`select data from ${kind}s where id=$1`, [id])).rows[0]?.data; }
async function asRole(role: string, sql: string, params: any[] = [], actor = employee) {
  return pg.transaction(async tx => {
    await tx.exec(`set local role ${role};set local request.jwt.claim.sub='${actor}';`);
    return (await tx.query<Data>(sql, params)).rows;
  });
}
async function edit(kind: string, previous: Data | null, changes: any, id = previous?.id ?? "i", role = "authenticated") {
  return (await asRole(role, "select crm_edit_document($1,$2,$3,$4) saved", [kind, id, JSON.stringify(previous), JSON.stringify(changes)]))[0].saved;
}
async function generic(kind: string, previous: Data, changes: Data) {
  return (await asRole("authenticated", "select crm_save_records($1) saved", [JSON.stringify([{ table: kind + "s", id: previous.id, previous, data: { ...previous, ...changes } }])]))[0].saved[0];
}
async function reserve(id = "i", amount = 12535, token = "ctoken_one") {
  return (await asRole("service_role", "select * from crm_reserve_direct_payment($1,'airking',$2,0,$3)", [id, amount, token]))[0];
}
async function recordPayment(id = "i", amount = 5000) {
  return asRole("service_role", "select * from crm_record_payment($1,'airking',$2,'Cash',$3)", [id, amount, "payment-" + id]);
}

before(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema crm_private;revoke all on schema crm_private from public,anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
    create table profiles(id uuid primary key,company_id text,role text,permissions jsonb);
    grant select on profiles to authenticated,service_role;alter table profiles enable row level security;
    create policy self on profiles for select to authenticated using(id=auth.uid());
    create function public.get_my_company_id() returns text language sql stable security invoker set search_path=public as $$select company_id from profiles where id=auth.uid()$$;
    revoke all on function public.get_my_company_id() from public,anon;grant execute on function public.get_my_company_id() to authenticated;`);
  for (const table of tables) {
    if (table === "quote_acceptances") {
      await pg.exec(`create table quote_acceptances(id uuid primary key default gen_random_uuid(),company_id text,quote_id text unique,customer_name text,decision text,signature text,selected_option text,message text,snapshot jsonb,created_at timestamptz default now());`);
    } else if (table === "payments") {
      await pg.exec(`create table payments(id uuid primary key default gen_random_uuid(),company_id text,invoice_id text,customer_id text,amount_cents bigint,fee_cents bigint default 0,method text,source text,external_id text unique,reference text,receipt_url text,paid_at timestamptz,actor_id uuid);`);
    } else if (table === "communication_events") {
      await pg.exec(`create table communication_events(id uuid primary key default gen_random_uuid(),company_id text,customer_id text,invoice_id text,event_type text,dedupe_key text unique,actor_id uuid,metadata jsonb);`);
    } else {
      await pg.exec(`create table ${table}(id text primary key,company_id text,customer_id text,data jsonb,created_at timestamptz default now(),updated_at timestamptz default now());`);
    }
    await pg.exec(`alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated,service_role;
      create policy company on ${table} for all to authenticated using(company_id=public.get_my_company_id()) with check(company_id=public.get_my_company_id());`);
  }
  await pg.exec(`revoke insert,update,delete on payments,quote_acceptances from authenticated;
    alter table leads alter column id type uuid using id::uuid;alter table leads add column status text;alter table leads add column converted_at timestamptz;
    create table checkout_attempts(id uuid primary key default gen_random_uuid(),company_id text,invoice_id text,amount_cents bigint,fee_cents bigint default 0,state text default 'reserved',session_id text unique,session_url text,expires_at timestamptz default now()+interval '35 minutes',created_at timestamptz default now());
    alter table checkout_attempts enable row level security;grant all on checkout_attempts to service_role;
    create table stripe_events(id text primary key,type text,payment_id uuid);grant all on stripe_events to service_role;`);
  for (const file of ["20260910222500_save_quote_addons.sql", "20260914010724_quote_job_invoice_flow.sql", "20260917225457_launch_permissions_and_confirmed_saves.sql", "20261005234844_accepted_quote_invoice_integrity.sql", "20260922225304_full_balance_checkout.sql", "20260922233136_stripe_automatic_surcharge.sql", "20260923004332_direct_card_checkout.sql"]) await pg.exec(await readFile("supabase/migrations/" + file, "utf8"));
  const original = await readFile("supabase/migrations/20260909230728_communications_payments.sql", "utf8");
  await pg.exec(original.slice(original.indexOf("create function public.crm_record_payment("), original.indexOf("create function public.crm_decide_quote(")));
  await pg.exec(original.slice(original.indexOf("create function crm_private.protect_balance()"), original.indexOf("revoke all on function public.crm_document_lifecycle", original.indexOf("create function crm_private.protect_balance()"))));
  await pg.exec(original.slice(original.indexOf("create function public.crm_void_invoice("), original.indexOf("commit;", original.indexOf("create function public.crm_void_invoice("))));
  await insert("quotes", quote({ id: "legacy", title: "Historical untouched" }));
  await insert("invoices", invoice({ id: "legacy-invoice" }));
  beforeUpgrade = (await pg.query("select 'quote' kind,to_jsonb(q) row from quotes q union all select 'invoice',to_jsonb(i) from invoices i")).rows;
  migration = (await readdir("supabase/migrations")).find(name => name.endsWith("_document_edit_guards.sql"))!;
  assert.ok(migration, "editing migration exists");
  await pg.exec(await readFile("supabase/migrations/" + migration, "utf8"));
  beforeUpgrade = (await pg.query("select 'quote' kind,to_jsonb(q) row from quotes q union all select 'invoice',to_jsonb(i) from invoices i")).rows;
  const numbering = (await readdir("supabase/migrations")).find(name => name.endsWith("_document_numbers.sql"))!;
  await pg.exec(await readFile("supabase/migrations/" + numbering, "utf8"));
  afterUpgrade = (await pg.query("select 'quote' kind,to_jsonb(q) row from quotes q union all select 'invoice',to_jsonb(i) from invoices i")).rows;
});
after(() => pg.close());

async function save(kind: string, data: Data, previous?: Data) {
 return (await asRole("authenticated", "select crm_save_records($1) saved", [JSON.stringify([{table:kind+"s",id:data.id,data,previous}])]))[0].saved[0];
}
beforeEach(async () => {
 await pg.exec(`truncate customers,quotes,invoices,work_orders,quote_acceptances,payments,checkout_attempts,stripe_events,communication_events,profiles,crm_private.document_number_counters;
 insert into profiles values('${employee}','airking','owner','{}');`);
 await insert("customers",{id:"customer",name:"Synthetic Customer"});
});
test("cutover leaves every existing row unchanged", () => assert.deepEqual(afterUpgrade,beforeUpgrade));
test("separate counters, six-digit padding and unchanged internal IDs", async () => {
 const i=await save("invoice",invoice()); const q=await save("quote",quote());
 assert.equal(i.documentNumber,"000001");assert.equal(q.documentNumber,"000001");
 assert.equal(i.id,"i");assert.equal(q.id,"q");
 assert.equal((await save("invoice",invoice({id:"i2"}))).documentNumber,"000002");
});
test("identical create retries return same number; changed retry fails",async()=>{
 const data=invoice();const first=await save("invoice",data);
 assert.deepEqual(await save("invoice",data),first);
 await assert.rejects(save("invoice",{...data,customerName:"Different"}),/changed/);
 assert.equal((await save("invoice",invoice({id:"i2"}))).documentNumber,"000002");
});
test("rollback does not consume number, deletion never reuses it",async()=>{
 await assert.rejects(pg.transaction(async tx=>{
  await tx.query("insert into invoices values('rollback','airking','customer',$1)",[JSON.stringify(invoice({id:"rollback"}))]);
  throw new Error("rollback");
 }),/rollback/);
 const first=await save("invoice",invoice());assert.equal(first.documentNumber,"000001");
 await pg.exec("delete from invoices where id='i'");
 assert.equal((await save("invoice",invoice({id:"i2"}))).documentNumber,"000002");
});
test("untrusted supplied numbers are replaced and saved numbers cannot change",async()=>{
 const first=await save("invoice",invoice({documentNumber:"999999"}));
 assert.equal(first.documentNumber,"000001");
 await assert.rejects(generic("invoice",first,{documentNumber:"000003"}),/number cannot be changed/);
 const {documentNumber,...oldClient}=first;
 assert.equal((await save("invoice",oldClient,first)).documentNumber,"000001");
});
test("upserts preserve number and independent tenants have separate counters",async()=>{
 const first=await insert("invoices",invoice());
 const retry=(await pg.query<Data>("insert into invoices(id,company_id,customer_id,data) values('i','airking','customer',$1) on conflict(id) do update set data=excluded.data returning data",[JSON.stringify(invoice())])).rows[0].data;
 assert.deepEqual(retry,first);
 assert.equal((await insert("invoices",invoice({id:"other"}),"other-company")).documentNumber,"000001");
 assert.equal((await insert("invoices",invoice({id:"i2"}))).documentNumber,"000002");
});
test("counter exceeds six digits without truncation; private allocator cannot be called",async()=>{
 await pg.exec("insert into crm_private.document_number_counters values('airking','invoices',999999)");
 assert.equal((await save("invoice",invoice())).documentNumber,"1000000");
 await assert.rejects(asRole("authenticated","select * from crm_private.document_number_counters"),/permission denied/);
 await assert.rejects(asRole("anon","select crm_private.assign_document_number()"),/permission denied/);
});
test("accepted quote revision and conversion receive fresh numbers, retries preserve them",async()=>{
 const q=await insert("quotes",quote({status:"Won"}));
 const args=["airking",employee,q.id,"22222222-2222-4222-8222-222222222222"];
 const revision=(await asRole("service_role","select crm_revise_accepted_quote($1,$2,$3,$4) saved",args))[0].saved;
 assert.equal(revision.documentNumber,"000002");assert.equal(revision.revisionOf,q.id);
 assert.deepEqual((await asRole("service_role","select crm_revise_accepted_quote($1,$2,$3,$4) saved",args))[0].saved,revision);
 const inv=(await asRole("service_role","select crm_invoice_accepted_quote($1,$2,$3) saved",args.slice(0,3)))[0].saved;
 assert.equal(inv.documentNumber,"000001");assert.equal(inv.quoteId,q.id);
 assert.deepEqual((await asRole("service_role","select crm_invoice_accepted_quote($1,$2,$3) saved",args.slice(0,3)))[0].saved,inv);
});
