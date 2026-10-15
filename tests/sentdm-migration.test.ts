import {test, before, after, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

// Real SQL in disposable PostgreSQL. No Supabase/provider connections.
const pg = new PGlite();
const migration = "supabase/migrations/20261015034423_sentdm_launch_safety.sql";
before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table customers(id text primary key,company_id text);
    create table communications(id uuid primary key default gen_random_uuid(),company_id text,customer_id text,
      quote_id text,invoice_id text,job_id text,channel text,status text,provider_id text,
      provider_status text,provider_status_at timestamptz,error text,updated_at timestamptz);
    create table communication_events(id uuid primary key default gen_random_uuid(),company_id text,customer_id text,
      quote_id text,invoice_id text,job_id text,channel text,status text,event_type text,metadata jsonb,dedupe_key text unique,
      created_at timestamptz default now());
    create table provider_webhook_events(id text primary key,provider text,provider_id text,payload jsonb,processed_at timestamptz,
      created_at timestamptz default now());
    grant usage on schema public to anon,authenticated,service_role;
    grant all on communications,communication_events,provider_webhook_events to service_role;
  `);
  await pg.exec(await readFile(migration, "utf8"));
});
after(() => pg.close());
beforeEach(async () => {
  await pg.exec("reset role; truncate communications,communication_events,provider_webhook_events,sms_phone_suppressions;");
});
async function message(company="co") {
  await pg.query(`insert into communications(company_id,customer_id,channel,status,provider_id,provider_status)
    values($1,'customer','sms','sent','sentdm:message','accepted')`, [company]);
}
async function callback(id: string,status: string,time="2026-10-15T12:00:00Z",company="co") {
  await pg.query(`insert into provider_webhook_events values($1,'sms','sentdm:message',$2,null,now(),now())`,
    [id,JSON.stringify({status,created_at:time,company_id:company,failure_reason:"BUSINESS_004: Recipient is opted out or suppressed."})]);
}
async function apply(id: string) {await pg.query("select crm_apply_sent_status($1)",[id]);}
async function current(): Promise<any> {return (await pg.query("select * from communications")).rows[0];}

test("callback before acceptance stays durable and becomes applicable after provider ID is saved", async () => {
  await callback("early","delivered"); await apply("early");
  const pending: any = (await pg.query("select * from provider_webhook_events")).rows[0];
  assert.equal(pending.processed_at,null);
  assert.ok(Date.parse(pending.next_attempt_at)>Date.parse(pending.created_at));
  await message(); await apply("early");
  assert.equal((await current()).status,"delivered");
  assert.ok((await pg.query<any>("select * from provider_webhook_events")).rows[0].processed_at);
});
test("duplicate callback application is atomic and creates one history event", async () => {
  await message(); await callback("duplicate","delivered");
  await Promise.all([apply("duplicate"),apply("duplicate"),apply("duplicate")]);
  assert.equal((await pg.query("select * from communication_events")).rows.length,1);
  assert.equal((await current()).status,"delivered");
});
test("late queued/sent callbacks never regress delivery, even with a later timestamp", async () => {
  await message(); await callback("delivered","delivered"); await apply("delivered");
  for (const [id,status,time] of [["old","queued","2026-10-15T11:00:00Z"],["late","sent","2026-10-15T13:00:00Z"]]) {
    await callback(id,status,time); await apply(id);
  }
  assert.equal((await current()).provider_status,"delivered");
  assert.equal((await pg.query("select * from communication_events")).rows.length,3);
});
test("equal-time terminal result wins over nonterminal; delivered can advance to read", async () => {
  await message(); await callback("sent","sent"); await apply("sent");
  await callback("delivered","delivered"); await apply("delivered");
  await callback("read","read"); await apply("read");
  assert.equal((await current()).provider_status,"read");
});
test("cancelled is terminal and failure stores only the sanitized local explanation", async () => {
  await message(); await callback("cancel","cancelled"); await apply("cancel");
  await callback("late","queued","2026-10-15T13:00:00Z"); await apply("late");
  assert.equal((await current()).status,"cancelled");
  assert.equal((await current()).provider_status,"cancelled");
  await pg.exec("truncate communications"); await message();
  await callback("filtered","filtered"); await apply("filtered");
  assert.equal((await current()).status,"failed");
  assert.match((await current()).error,/BUSINESS_004/);
});
test("foreign-company callback never projects into a message belonging to another company", async () => {
  await message("other"); await callback("foreign","failed"); await apply("foreign");
  assert.equal((await current()).status,"sent");
  assert.equal((await pg.query("select * from communication_events")).rows.length,0);
});
test("history insertion failure rolls status and callback completion back together", async () => {
  await message(); await callback("rollback","delivered");
  await pg.exec("alter table communication_events add constraint synthetic_failure check (false) not valid");
  try {await assert.rejects(apply("rollback"));}
  finally {await pg.exec("alter table communication_events drop constraint synthetic_failure");}
  assert.equal((await current()).status,"sent");
  assert.equal((await pg.query<any>("select processed_at from provider_webhook_events")).rows[0].processed_at,null);
  await apply("rollback"); assert.equal((await current()).status,"delivered");
});
test("suppression is unique, company scoped, RLS protected; callback RPC is service-only", async () => {
  await pg.exec(`insert into sms_phone_suppressions(company_id,phone) values('co','+18165551234'),('other','+18165551234');`);
  assert.equal((await pg.query("select * from sms_phone_suppressions")).rows.length,2);
  await assert.rejects(pg.exec("insert into sms_phone_suppressions(company_id,phone) values('co','+18165551234')"));
  for (const role of ["anon","authenticated"]) {
    await pg.exec(`set role ${role}`);
    await assert.rejects(pg.exec("select * from sms_phone_suppressions"),/permission denied/);
    await assert.rejects(apply("anything"),/permission denied/);
    await pg.exec("reset role");
  }
  await pg.exec("set role service_role");
  assert.equal((await pg.query("select * from sms_phone_suppressions")).rows.length,2);
  await apply("nonexistent"); await pg.exec("reset role");
});

test("durable intake deduplicates and immediately suppresses without running a worker",async()=>{
  const payload=JSON.stringify({company_id:"co",from:"+18165551234",opt_out:true,message_id:null});
  for(let i=0;i<2;i++)await pg.query("select crm_store_sent_callback($1,'sentdm-inbound','sentdm:none',$2)",["intake",payload]);
  assert.equal((await pg.query("select * from provider_webhook_events")).rows.length,1);
  assert.equal((await pg.query("select * from sms_phone_suppressions")).rows.length,1);
  await pg.query("select crm_store_sent_callback('start','sentdm-inbound','sentdm:start',$1)",
    [JSON.stringify({company_id:"co",from:"+18165551234",opt_out:false,text:"START"})]);
  assert.equal((await pg.query("select * from sms_phone_suppressions")).rows.length,1);
  for(const role of ["anon","authenticated"]){
    await pg.exec(`set role ${role}`);
    await assert.rejects(pg.query("select crm_store_sent_callback('forged','sms','forged',$1)",[payload]),/permission denied/);
    await pg.exec("reset role");
  }
});
test("intake failure cannot acknowledge a callback without its required suppression",async()=>{
  await assert.rejects(pg.query("select crm_store_sent_callback('rollback','sentdm-inbound','sentdm:none',$1)",
    [JSON.stringify({company_id:"co",from:"invalid-phone",opt_out:true})]));
  assert.equal((await pg.query("select * from provider_webhook_events")).rows.length,0);
});
