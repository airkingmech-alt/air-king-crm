import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

test("direct checkout atomically reserves full principal, locks competing payments, and separates fee on settlement",async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role;
      create table invoices(id text primary key,company_id text,customer_id text,data jsonb,updated_at timestamptz);
      create table payments(id uuid primary key default gen_random_uuid(),company_id text,invoice_id text,customer_id text,amount_cents bigint,fee_cents bigint,method text,source text,external_id text unique,reference text,receipt_url text,paid_at timestamptz,actor_id uuid);
      create table checkout_attempts(id uuid primary key default gen_random_uuid(),company_id text,invoice_id text,amount_cents bigint,fee_cents bigint default 0,state text default 'reserved',session_id text unique,session_url text,expires_at timestamptz,created_at timestamptz default now());
      create table stripe_events(id text primary key,type text,payment_id uuid);
      create table communication_events(id uuid default gen_random_uuid(),company_id text,customer_id text,invoice_id text,event_type text,dedupe_key text unique,actor_id uuid,metadata jsonb);
      insert into invoices values('i','air-king','c','{"amount":1000,"status":"Sent"}',now()),('j','air-king','c','{"amount":1000,"status":"Sent"}',now());`);
    const original=await readFile("supabase/migrations/20260909230728_communications_payments.sql","utf8");
    await pg.exec(original.slice(original.indexOf("create function public.crm_record_payment("),original.indexOf("create function public.crm_decide_quote(")));
    for(const path of ["20260922225304_full_balance_checkout.sql","20260922233136_stripe_automatic_surcharge.sql","20260923004332_direct_card_checkout.sql"])
      await pg.exec(await readFile("supabase/migrations/"+path,"utf8"));
    const reserve="select * from crm_reserve_direct_payment('i','air-king',100000,3000,'ctoken_credit')";
    const a=(await pg.query<any>(reserve)).rows[0];
    assert.equal(a.amount_cents,100000);assert.equal(a.fee_cents,3000);assert.equal(a.checkout_kind,"direct");
    assert.equal((await pg.query<any>(reserve)).rows[0].id,a.id);
    await assert.rejects(pg.query("select * from crm_reserve_direct_payment('i','air-king',50000,1500,'ctoken_partial')"),/balance changed/);
    await assert.rejects(pg.query("select * from crm_reserve_direct_payment('i','air-king',100000,3000,'ctoken_second')"),/in progress/);
    await assert.rejects(pg.query("select * from crm_record_payment('i','air-king',100000,'Cash','cash-test')"),/in progress/);
    await assert.rejects(pg.query("select * from crm_reserve_direct_payment('j','air-king',100000,3000,'ctoken_credit')"),/reference conflict/);
    await assert.rejects(pg.query("select * from crm_reserve_direct_payment('j','air-king',100000,3500,'ctoken_excess')"),/Invalid payment review/);
    const settle=`select * from crm_record_surcharge_payment('i','air-king',100000,'visa','pi_test','${a.id}','evt_1','payment_intent.succeeded',3000,null)`;
    await pg.query(settle);await pg.query(settle);
    const pay=(await pg.query<any>("select * from payments where invoice_id='i'")).rows;
    assert.equal(pay.length,1);assert.equal(pay[0].amount_cents,100000);assert.equal(pay[0].fee_cents,3000);
    assert.deepEqual((await pg.query<any>("select data from invoices where id='i'")).rows[0].data,{amount:1000,status:"Paid",paidAmount:1000});
    const ev=(await pg.query<any>("select metadata from communication_events where invoice_id='i'")).rows[0].metadata;
    assert.equal(ev.fee_cents,3000);assert.equal(ev.total_cents,103000);
    // A cancelled attempt releases the invoice; cash pays only the principal.
    const b=(await pg.query<any>("select * from crm_reserve_direct_payment('j','air-king',100000,0,'ctoken_debit')")).rows[0];
    await pg.query("update checkout_attempts set state='cancelled' where id=$1",[b.id]);
    await pg.query("select * from crm_record_payment('j','air-king',100000,'Check','check-test')");
    assert.equal((await pg.query<any>("select fee_cents from payments where invoice_id='j'")).rows[0].fee_cents,0);
    for(const role of ["anon","authenticated"])
      assert.equal((await pg.query<any>(`select has_function_privilege('${role}','crm_reserve_direct_payment(text,text,bigint,bigint,text)','execute') allowed`)).rows[0].allowed,false);
  }finally{await pg.close();}
});
