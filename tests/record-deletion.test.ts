import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const pg=new PGlite();
const actor='11111111-1111-4111-8111-111111111111';
before(async()=>{
 await pg.exec(`create role anon; create role authenticated; create schema auth; create schema crm_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,company_id text,role text,permissions jsonb);
 insert into profiles values('${actor}','airking','owner','{}'); grant select on profiles to authenticated;
 create function crm_can(feature text) returns boolean language sql stable as $$select exists(select 1 from profiles where id=auth.uid() and (role='owner' or coalesce(permissions->feature,'true')<>'false'))$$;
 `);
 for (const t of ['customers','quotes','invoices','work_orders','memberships']) {
  await pg.exec(`create table ${t}(id text primary key,company_id text,${t==='customers'?'':'customer_id text,'}data jsonb);grant select,insert,update on ${t} to authenticated;
  alter table ${t} enable row level security;create policy own on ${t} for all to authenticated using(company_id=(select company_id from profiles where id=auth.uid())) with check(company_id=(select company_id from profiles where id=auth.uid()));`);
 }
 await pg.exec(`
 create table payments(id text,invoice_id text,customer_id text);
 create table checkout_attempts(id text,invoice_id text);
 create table quote_acceptances(id text,quote_id text);
 create table coupons(customer_id text);
 create table referrals(referring_customer_id text,referred_customer_id text);
 create table communications(id text,company_id text,customer_id text,quote_id text,invoice_id text,status text,error text,updated_at timestamptz);
 create table communication_events(id uuid default gen_random_uuid(),company_id text,customer_id text,quote_id text,invoice_id text,event_type text,actor_id uuid,metadata jsonb);
 create table automation_runs(id text,event_id uuid,status text,error text,lease_until timestamptz,claim_token uuid,updated_at timestamptz);
 create table document_links(id text,company_id text,quote_id text,invoice_id text,revoked_at timestamptz);
 `);
 await pg.exec(await readFile('supabase/migrations/20260919180425_safe_record_deletion.sql','utf8'));
});
after(()=>pg.close());
async function asActor(sql:string,params:any[]=[]){
 await pg.exec('begin'); try {
  await pg.exec(`set local role authenticated; set local request.jwt.claim.sub='${actor}';`);
  const r=await pg.query(sql,params);await pg.exec('commit');return r;
 }catch(e){await pg.exec('rollback');throw e;}
}
async function add(table:string,id:string,extra:any={}){
 const data={id,...extra}; if(table==='customers') await pg.query(`insert into customers(id,company_id,data) values($1,'airking',$2)`,[id,JSON.stringify(data)]); else await pg.query(`insert into ${table}(id,company_id,customer_id,data) values($1,'airking',$2,$3)`,[id,extra.customerId||null,JSON.stringify(data)]);return data;
}
const remove=(table:string,data:any)=>asActor('select crm_delete_record($1,$2,$3)',[table,data.id,JSON.stringify(data)]);
const read=async(table:string,id:string)=>(await pg.query<any>(`select data from ${table} where id=$1`,[id])).rows[0].data;
test('delete removes no stored data, records actor, and retries safely',async()=>{
 const data=await add('customers','simple',{name:'Example'});
 await remove('customers',data); await remove('customers',data);
 const row=await read('customers','simple');assert.equal(row.name,'Example');assert.ok(row.deletedAt);assert.equal(row.deletedBy,actor);
 assert.equal((await pg.query("select * from communication_events where event_type='customer.deleted'")).rows.length,1);
 await assert.rejects(asActor("update customers set data='{}' where id='simple'"),/deleted/);
});
test('deletion requires admin, company access, permission and current version',async()=>{
 const data=await add('customers','access');
 await pg.exec("update profiles set role='technician'");await assert.rejects(remove('customers',data),/owners/);
 await assert.rejects(asActor("update customers set data=data||'{\"deletedAt\":\"now\"}' where id='access'"),/administrator/);
 await pg.exec("update profiles set role='admin',permissions='{\"customers\":false}'");await assert.rejects(remove('customers',data),/permitted/);
 await pg.exec("update profiles set role='owner',permissions='{}'");
 await assert.rejects(remove('customers',{...data,name:'stale'}),/changed/);
 await pg.exec("update customers set company_id='other' where id='access'");await assert.rejects(remove('customers',data),/unavailable/);
});
test('quote deletion revokes links and stops queued messages and runs, preserving history',async()=>{
 const q=await add('quotes','draft',{status:'Sent'});
 await pg.exec(`insert into communications values('m','airking',null,'draft',null,'pending',null,null);
 insert into document_links values('l','airking','draft',null,null);
 insert into communication_events(id,company_id,quote_id,event_type) values('22222222-2222-4222-8222-222222222222','airking','draft','quote.sent');
 insert into automation_runs(id,event_id,status) values('r','22222222-2222-4222-8222-222222222222','waiting');`);
 await remove('quotes',q);
 assert.equal((await read('quotes','draft')).status,'Cancelled');
 assert.equal((await pg.query<any>('select status from communications')).rows[0].status,'cancelled');
 assert.equal((await pg.query<any>('select status from automation_runs')).rows[0].status,'stopped');
 assert.ok((await pg.query<any>('select revoked_at from document_links')).rows[0].revoked_at);
 await assert.rejects(pg.exec("insert into communications(quote_id) values('draft')"),/deleted/);
 await assert.rejects(add('work_orders','after-delete',{quoteId:'draft'}),/deleted/);
});
test('linked customers and accepted quotes remain protected',async()=>{
 const c=await add('customers','linked');await add('work_orders','job',{customerId:'linked'});
 await assert.rejects(remove('customers',c),/linked/);
 const q=await add('quotes','won',{status:'Won'});await assert.rejects(remove('quotes',q),/Accepted/);
 const q2=await add('quotes','jobquote');await add('work_orders','qjob',{quoteId:'jobquote'});await assert.rejects(remove('quotes',q2),/linked/);
});
test('paid, checkout and linked invoices protected; standalone unpaid invoice can be deleted',async()=>{
 const paid=await add('invoices','paid',{paidAmount:25});await assert.rejects(remove('invoices',paid),/payments/);
 const ledger=await add('invoices','ledger');await pg.exec("insert into payments(invoice_id) values('ledger')");await assert.rejects(remove('invoices',ledger),/payments/);
 const checkout=await add('invoices','checkout');await pg.exec("insert into checkout_attempts(invoice_id) values('checkout')");await assert.rejects(remove('invoices',checkout),/payment attempts/);
 const linked=await add('invoices','linkedinv',{quoteId:'won'});await assert.rejects(remove('invoices',linked),/linked/);
 const draft=await add('invoices','unpaid',{amount:25});await remove('invoices',draft);assert.equal((await read('invoices','unpaid')).status,'Void');
 await assert.rejects(pg.exec("insert into payments(invoice_id) values('unpaid')"),/deleted/);
});
test('in-flight send blocks deletion without cancelling or hiding anything',async()=>{
 const q=await add('quotes','sending');await pg.exec("insert into communications(id,company_id,quote_id,status) values('sending','airking','sending','sending')");
 await assert.rejects(remove('quotes',q),/being sent/);assert.equal((await read('quotes','sending')).deletedAt,undefined);
});

test('expanded deletion preserves paid, accepted and linked records without cascading',async()=>{
 const saves=await readFile('supabase/migrations/20260917225457_launch_permissions_and_confirmed_saves.sql','utf8');
 await pg.exec(saves.slice(saves.indexOf('create function public.crm_save_records'),saves.indexOf('-- Customer creation')));
 await pg.exec(await readFile('supabase/migrations/20260919183211_flexible_record_deletion.sql','utf8'));
 const won=await read('quotes','won');await remove('quotes',won);assert.equal((await read('quotes','won')).status,'Won');
 const paid=await read('invoices','paid');await remove('invoices',paid);assert.equal((await read('invoices','paid')).paidAmount,25);
 const linkedInvoice=await read('invoices','linkedinv');await remove('invoices',linkedInvoice);assert.equal((await read('invoices','linkedinv')).quoteId,'won');
 const customer=await read('customers','linked');await remove('customers',customer);
 assert.equal((await read('work_orders','job')).customerId,'linked');
 await assert.rejects(asActor("update customers set data='{}' where id='linked'"),/deleted/);
 await asActor("update customers set data=data||'{\"lastServiceAt\":\"2026-09-19\"}' where id='linked'");
 assert.ok((await read('customers','linked')).deletedAt);
});
test('a replacement invoice is permitted after deletion, but still prevents active duplicates',async()=>{
 await add('customers','replacement-customer');
 const inv=await add('invoices','replacement-old',{customerId:'replacement-customer',quoteId:'replacement-quote',amount:10});
 await remove('invoices',inv);
 const save=(id:string)=>asActor('select crm_save_records($1)',[JSON.stringify([{table:'invoices',id,data:{id,customerId:'replacement-customer',quoteId:'replacement-quote',amount:10}}])]);
 await save('replacement-new');await assert.rejects(save('replacement-duplicate'),/already exists/);
});
test('late verified Stripe payment still settles once after invoice and customer deletion',async()=>{
 // Exercise the actual existing payment SQL, including webhook idempotency.
 await pg.exec(`alter table invoices add column updated_at timestamptz;
 alter table payments add column company_id text,add column amount_cents bigint,add column fee_cents bigint,add column method text,add column source text,add column external_id text unique,add column reference text,add column receipt_url text,add column paid_at timestamptz,add column actor_id uuid;
 alter table payments alter column id set default gen_random_uuid()::text;
 alter table checkout_attempts alter column id type uuid using id::uuid;
 alter table checkout_attempts add column amount_cents bigint,add column fee_cents bigint,add column state text,add column expires_at timestamptz;
 alter table communication_events add column dedupe_key text;
 create table stripe_events(id text primary key,type text,payment_id text);`);
 const sql=await readFile('supabase/migrations/20260909230728_communications_payments.sql','utf8');
 await pg.exec(sql.slice(sql.indexOf('create function public.crm_record_payment'),sql.indexOf('create function public.crm_decide_quote')));
 const c=await add('customers','late-customer'),inv=await add('invoices','late-invoice',{customerId:c.id,status:'Sent',amount:100,paidAmount:0});
 const attempt='33333333-3333-4333-8333-333333333333';
 await pg.query("insert into checkout_attempts(id,invoice_id,amount_cents,fee_cents,state) values($1,'late-invoice',10000,0,'open')",[attempt]);
 await remove('invoices',inv);await remove('customers',c);
 const settle=()=>pg.query("select crm_record_payment('late-invoice','airking',10000,'card','pi_test',null,null,$1,'evt_test','checkout.session.completed')",[attempt]);
 await settle();await settle();
 const row=await read('invoices','late-invoice');assert.equal(row.paidAmount,100);assert.equal(row.status,'Paid');assert.ok(row.deletedAt);
 assert.equal((await pg.query<any>("select count(*)::int n from payments where invoice_id='late-invoice'")).rows[0].n,1);
 await assert.rejects(pg.exec("insert into checkout_attempts(invoice_id) values('late-invoice')"),/deleted/);
});
