import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {canAccess,requestFeatures} from '../shared/access';
import {receiptsThisMonth,membershipSummary} from '../shared/dashboard';
const pg=new PGlite();
const employee='11111111-1111-4111-8111-111111111111';
const tables=['customers','customer_notes','customer_photos','quotes','quote_acceptances','invoices','invoice_line_items','payments','work_orders','memberships','price_book_items','leads','lead_sources','crm_settings','customer_communication_preferences','message_templates','automations','automation_runs','communications','communication_events','referrals','coupons','marketing_audiences','marketing_campaigns','marketing_campaign_steps','marketing_campaign_runs','marketing_campaign_recipients','marketing_attributions','communication_consent_events'];
before(async()=>{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create schema crm_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,company_id text,role text,permissions jsonb);
 insert into profiles values('${employee}','airking','technician','{}');
 grant select on profiles to authenticated;alter table profiles enable row level security;
 create policy self on profiles for select to authenticated using(id=auth.uid());
 create function public.get_my_company_id() returns text language sql stable security definer set search_path=public as $$select company_id from profiles where id=auth.uid()$$;
 revoke all on function public.get_my_company_id() from public,anon;grant execute on function public.get_my_company_id() to authenticated;`);
 for(const t of tables)await pg.exec(`create table ${t}(id text primary key,company_id text,customer_id text,data jsonb);alter table ${t} enable row level security;grant select,insert,update,delete on ${t} to authenticated;create policy company on ${t} for all to authenticated using(company_id=(select company_id from profiles where id=auth.uid())) with check(company_id=(select company_id from profiles where id=auth.uid()));`);
 await pg.exec('alter table leads alter column id type uuid using id::uuid;alter table leads add column status text;alter table leads add column converted_at timestamptz;');
 await pg.exec(await readFile('supabase/migrations/20260917225457_launch_permissions_and_confirmed_saves.sql','utf8'));
 await pg.exec(await readFile('supabase/migrations/20260917231306_company_lookup_invoker.sql','utf8'));
 await pg.exec('drop policy company on customers;create policy company on customers for all to authenticated using(company_id=public.get_my_company_id()) with check(company_id=public.get_my_company_id());');
 await pg.exec(`insert into customers values('existing','airking',null,'{"id":"existing","name":"Original"}'),('foreign','other',null,'{"id":"foreign"}');`);
});
after(()=>pg.close());
async function employeeQuery(query:string,params:any[]=[]){
 await pg.exec('begin');try{await pg.exec(`set local role authenticated;set local request.jwt.claim.sub='${employee}';`);const r=await pg.query(query,params);await pg.exec('commit');return r.rows as any[];}catch(e){await pg.exec('rollback');throw e;}
}
const save=(records:any[])=>employeeQuery('select crm_save_records($1) result',[JSON.stringify(records)]);
test('database feature restrictions stop same-company reads and writes, with owner override',async()=>{
 await pg.exec(`update profiles set permissions='{"customers":false}'`);
 assert.equal((await employeeQuery('select * from customers')).length,0);
 await assert.rejects(save([{table:'customers',id:'blocked',data:{id:'blocked'}}]),/row-level security/);
 await pg.exec(`update profiles set role='owner'`);
 assert.equal((await employeeQuery('select * from customers')).length,1);
 await pg.exec(`update profiles set role='technician',permissions='{}'`);
});
test('confirmed saves reject stale edits and preserve the newer value',async()=>{
 const original={id:'existing',name:'Original'},updated={id:'existing',name:'Updated'};
 await save([{table:'customers',id:'existing',data:updated,previous:original}]);
 await assert.rejects(save([{table:'customers',id:'existing',data:{...original,name:'Stale'},previous:original}]),/changed/);
 assert.equal((await employeeQuery("select data from customers where id='existing'"))[0].data.name,'Updated');
});
test('company lookup obeys caller profile policy without elevated privileges',async()=>{
 assert.equal((await employeeQuery('select get_my_company_id() company'))[0].company,'airking');
 assert.equal((await pg.query("select prosecdef from pg_proc where oid='public.get_my_company_id()'::regprocedure")).rows[0].prosecdef,false);
 assert.equal((await employeeQuery("select * from customers where company_id='other'")).length,0);
});
test('a failed invoice/equipment transaction leaves neither half saved',async()=>{
 await pg.exec(`update profiles set permissions='{"invoices":false}'`);
 await assert.rejects(save([{table:'customers',id:'new-customer',data:{id:'new-customer'}},{table:'invoices',id:'new-invoice',data:{id:'new-invoice',customerId:'new-customer',amount:100}}]),/row-level security/);
 assert.equal((await pg.query("select * from customers where id='new-customer'")).rows.length,0);
 await pg.exec(`update profiles set permissions='{}'`);
});
test('retrying the same create is idempotent and linked invoices cannot be duplicated',async()=>{
 const write={table:'invoices',id:'invoice-one',data:{id:'invoice-one',customerId:'existing',quoteId:'quote-one',amount:100}};
 await save([write]);await save([write]);
 assert.equal((await employeeQuery('select * from invoices')).length,1);
 await assert.rejects(save([{...write,id:'invoice-two',data:{...write.data,id:'invoice-two'}}]),/already exists/);
 await assert.rejects(save([{table:'customers',id:'foreign',data:{id:'foreign',name:'Changed'}}]));
});
test('server permissions cover document sends, conversion and compound history',()=>{
 assert.deepEqual(requestFeatures('/api/crm/invoice/a/send','POST'),['invoices','communications']);
 assert.deepEqual(requestFeatures('/api/crm/quotes/q/convert','POST'),['quotes','schedule']);
 assert.ok(requestFeatures('/api/crm/customers/c/history').includes('invoices'));
 assert.equal(canAccess({role:'technician',permissions:{invoices:false}},'invoices'),false);
 assert.equal(canAccess({role:'owner',permissions:{invoices:false}},'invoices'),true);
 assert.equal(canAccess(null,'invoices'),false);
});
test('lead conversion links once, retries safely, and rolls back a denied link',async()=>{
 const id='22222222-2222-4222-8222-222222222222';
 await pg.exec(`insert into leads(id,company_id) values('${id}','airking');create policy no_link on leads as restrictive for update to authenticated using(true) with check(false);`);
 const convert=()=>employeeQuery('select crm_convert_lead($1,$2) result',[id,JSON.stringify({id:'lead-customer',name:'Lead customer'})]);
 await assert.rejects(convert(),/row-level security/);
 assert.equal((await pg.query("select * from customers where id='lead-customer'")).rows.length,0);
 await pg.exec('drop policy no_link on leads');
 await convert();await convert();
 assert.equal((await employeeQuery("select * from customers where id='lead-customer'")).length,1);
 assert.equal((await employeeQuery('select customer_id from leads where id=$1',[id]))[0].customer_id,'lead-customer');
});
test('month receipts use Central time and exclude historical imports and future receipts',()=>{
 const now=new Date('2026-09-17T12:00:00Z');
 assert.equal(receiptsThisMonth([{amount_cents:100,paid_at:'2026-09-01T04:30:00Z',method:'Cash'},{amount_cents:200,paid_at:'2026-09-01T05:30:00Z',method:'Cash'},{amount_cents:300,paid_at:'2026-09-02T00:00:00Z',method:'Historical'},{amount_cents:400,paid_at:'2026-10-01T12:00:00Z',method:'Cash'}],now),200);
 assert.deepEqual(membershipSummary([{status:'Active',billingFrequency:'Monthly',pricing:{totalAmountCents:2000},springVisit:{status:'Unscheduled'},fallVisit:{status:'Completed'}},{status:'Cancelled',billingFrequency:'Annual'}]),{annualCents:24000,unbooked:1});
});
