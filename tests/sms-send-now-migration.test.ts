import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',recipient='+18165550101';
before(async()=>{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table profiles(id uuid,company_id text,role text);
 create table communications(id uuid primary key,company_id text,customer_id text,quote_id text,invoice_id text,channel text,category text,campaign_id uuid,recipient text,body text,status text,attempts int,provider_id text,scheduled_at timestamptz,updated_at timestamptz,claim_token uuid,claimed_at timestamptz);
 create table communication_events(company_id text,customer_id text,quote_id text,invoice_id text,channel text,status text,event_type text,actor_id uuid,dedupe_key text unique,metadata jsonb);
 create table marketing_campaigns(id uuid,company_id text,enabled bool,status text);
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;
 alter table communications enable row level security;alter table communication_events enable row level security;`);
 await pg.exec(await readFile('supabase/migrations/20261025004206_sms_send_now.sql','utf8'));
 const claim=(await readFile('supabase/migrations/20260912031344_marketing_center_foundation.sql','utf8')).match(/create or replace function public.crm_claim_message[\s\S]*?end \$\$;/)![0];await pg.exec(claim);
});
after(()=>pg.close());beforeEach(async()=>{
 await pg.exec('reset role;truncate profiles,communications,communication_events;');
 await pg.query('insert into profiles values($1,\'co\',\'owner\')',[owner]);
 await pg.query("insert into communications(id,company_id,customer_id,quote_id,channel,category,recipient,body,status,attempts,scheduled_at) values($1,'co','customer','quote','sms','transactional',$2,'Original','pending',0,now()+interval '12 hours')",[id,recipient]);
});
const request=(company='co',actor=owner,phone=recipient)=>pg.query<any>('select crm_request_sms_send_now($1,$2,$3,$4) r',[company,id,actor,phone]);
test('one grant audits original identity and schedule without copying; repeats preserve original expiry',async()=>{
 const first=(await request()).rows[0].r;assert.equal(first.already_requested,false);assert.equal(first.message.body,'Original');
 const second=(await request()).rows[0].r;assert.equal(second.already_requested,true);assert.equal(second.message.send_now_expires_at,first.message.send_now_expires_at);
 assert.equal((await pg.query('select * from communications')).rows.length,1);
 const audit=(await pg.query<any>('select * from communication_events')).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,owner);assert.equal(audit[0].metadata.recipient,recipient);
 assert.equal(new Date(first.message.send_now_expires_at).getTime()-new Date(first.message.send_now_requested_at).getTime(),300000);
});
test('foreign tenant, changed recipient, non-admin, marketing and attempted/terminal outcomes cannot receive a grant',async()=>{
 await assert.rejects(request('other'));await assert.rejects(request('co',owner,'+18165550999'));
 await pg.exec("update profiles set role='dispatcher'");await assert.rejects(request());await pg.exec("update profiles set role='admin'");
 for(const status of ['sent','delivered','unknown','failed','sending','cancelled']){await pg.query('update communications set status=$1',[status]);await assert.rejects(request());}
 await pg.exec("update communications set status='pending',attempts=1");await assert.rejects(request());
 await pg.exec("update communications set attempts=0,category='marketing'");await assert.rejects(request());
 assert.equal((await pg.query('select * from communication_events')).rows.length,0);
});
test('scheduled claim and repeated requests converge on exactly one claim and audit',async()=>{
 await Promise.all([request(),request()]);
 const claims=await Promise.all([pg.query('select * from crm_claim_message($1)',[id]),pg.query('select * from crm_claim_message($1)',[id])]);
 assert.equal(claims.reduce((n,r)=>n+r.rows.length,0),1);assert.equal((await request()).rows[0].r.already_requested,true);
 assert.equal((await pg.query<any>('select attempts from communications')).rows[0].attempts,1);
});
test('a worker that already claimed wins; audit failure rolls back the request',async()=>{
 await pg.exec("update communications set scheduled_at=now()");await pg.query('select * from crm_claim_message($1)',[id]);await assert.rejects(request());
 await pg.exec("update communications set status='pending',attempts=0");
 await pg.query("insert into communication_events(dedupe_key) values($1)",['sms-send-now:'+id]);await assert.rejects(request());
 assert.equal((await pg.query<any>('select send_now_requested_at from communications')).rows[0].send_now_requested_at,null);
});
test('least privilege: internal invoker function only; no browser-role access or table/RLS changes',async()=>{
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(request(),/permission denied/);await pg.exec('reset role');}
 const fn=(await pg.query<any>("select prosecdef,proconfig from pg_proc where proname='crm_request_sms_send_now'")).rows[0];assert.equal(fn.prosecdef,false);assert.deepEqual(fn.proconfig,['search_path=""']);
 await pg.exec('set role service_role');assert.equal((await request()).rows[0].r.already_requested,false);
});
