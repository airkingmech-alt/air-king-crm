import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();
before(async()=>{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table customers(id text primary key,company_id text,data jsonb);
 create table communications(id uuid primary key default gen_random_uuid(),company_id text,channel text,customer_id text,recipient text,body text,status text,provider_status text,error text,created_at timestamptz default now(),scheduled_at timestamptz);
 create table communication_events(id uuid primary key default gen_random_uuid(),company_id text,channel text,customer_id text,metadata jsonb,event_type text,created_at timestamptz default now(),read_at timestamptz);
 grant usage on schema public to service_role;grant select on all tables in schema public to service_role;`);
 await pg.exec(await readFile('supabase/migrations/20261024231359_text_conversations.sql','utf8'));
});
after(()=>pg.close());beforeEach(()=>pg.exec('reset role;truncate customers,communications,communication_events;'));
const phone='+18165550101';
async function customer(id='c',company='co',number=phone,role='Primary',deleted=false){await pg.query('insert into customers values($1,$2,$3)',[id,company,JSON.stringify({name:'Customer '+id,contacts:[{phone:number,role}],...(deleted?{deletedAt:'today'}:{})})]);}
async function outbound(company='co',body='Outbound',time='2026-10-24T12:00:00Z',recipient=phone){await pg.query("insert into communications(company_id,channel,customer_id,recipient,body,status,provider_status,created_at) values($1,'sms','original',$2,$3,'sent','queued',$4)",[company,recipient,body,time]);}
async function inbound(company='co',number=phone,read=false){await pg.query("insert into communication_events(company_id,channel,customer_id,metadata,event_type,created_at,read_at) values($1,'sms',null,$2,'sms.received','2026-10-24T12:01:00Z',$3)",[company,JSON.stringify({from:number,body:'Reply',ambiguous:true}),read?'2026-10-24T13:00:00Z':null]);}
async function list(company='co',at:string|null=null,key=''){return (await pg.query<any>('select * from crm_text_conversations($1,$2,$3)',[company,at,key])).rows;}
async function history(company='co',number=phone,at:string|null=null,key=''){return (await pg.query<any>('select * from crm_text_history($1,$2,$3,$4)',[company,number,at,key])).rows;}
test('groups canonical phone across directions, preserves links and accurate statuses without duplicating delivery events',async()=>{
 await customer();await outbound();await inbound('co','(816) 555-0101');
 await pg.exec("insert into communication_events(company_id,channel,event_type,metadata) values('co','sms','message.delivered','{}')");
 const rows=await list();assert.equal(rows.length,1);assert.equal(rows[0].unread_count,1);assert.equal(rows[0].customers[0].id,'c');
 const h=await history();assert.equal(h.length,2);assert.equal(h[0].direction,'inbound');assert.equal(h[0].customer_id,null);assert.equal(h[0].ambiguous,true);assert.equal(h[1].customer_id,'original');assert.equal(h[1].provider_status,'queued');
});
test('foreign company messages and customers never contribute to thread, unread counts or matches',async()=>{
 await customer('other','foreign');await outbound('foreign','Private');await inbound('foreign');await outbound();
 const rows=await list();assert.equal(rows.length,1);assert.equal(rows[0].unread_count,0);assert.deepEqual(rows[0].customers,[]);assert.equal((await history()).length,1);
 assert.equal((await list('empty')).length,0);
});
test('ambiguous, additional, deleted and unmatched contacts are distinguished without reassignment',async()=>{
 await customer('one');await customer('two','co','8165550101');await customer('deleted','co',phone,'Primary',true);await inbound();
 let rows=await list();assert.equal(rows[0].customers.length,2);assert.equal(rows[0].customers[0].total_count,2);assert.equal((await history())[0].customer_id,null);
 await pg.exec('truncate customers');await customer('additional','co','+18165550202');
 await pg.query("update customers set data=jsonb_set(data,'{contacts}',data->'contacts'||$1::jsonb)",[JSON.stringify([{phone,role:'Additional'}])]);
 rows=await list();assert.equal(rows[0].customers[0].is_primary,false);
});
test('history uses deterministic keyset pages with more than 1000 messages and tied timestamps',async()=>{
 await pg.query("insert into communications(company_id,channel,recipient,body,status,created_at) select 'co','sms',$1,n::text,'pending','2026-10-24T12:00:00Z' from generate_series(1,1105)n",[phone]);
 const seen=new Set();let at=null,key='';
 for(let page=0;page<30;page++){const rows=await history('co',phone,at,key);assert.ok(rows.length<=51);const shown=rows.slice(0,50);for(const r of shown){assert.ok(!seen.has(r.key));seen.add(r.key);}if(rows.length<=50)break;const last=shown.at(-1);at=last.created_at;key=last.key;}
 assert.equal(seen.size,1105);
});
test('conversation pages are bounded and preserve equal-time phone ordering',async()=>{
 for(let n=0;n<65;n++)await outbound('co','hello','2026-10-24T12:00:00Z','+1816555'+String(n).padStart(4,'0'));
 let rows=await list();assert.equal(rows.length,31);const first=rows.slice(0,30);rows=await list('co',first[29].last_at,first[29].phone);assert.equal(rows.length,31);assert.ok(!first.some(a=>rows.some(b=>a.phone===b.phone)));
});
test('read-only projections do not auto-mark replies; marked history remains accessible',async()=>{
 await inbound();await list();await history();assert.equal((await list())[0].unread_count,1);
 await pg.exec('update communication_events set read_at=now()');assert.equal((await list())[0].unread_count,0);assert.equal((await history()).length,1);
});
test('anonymous and authenticated database roles cannot call internal projections; service role can',async()=>{
 await outbound();
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(list(),/permission denied/);await assert.rejects(history(),/permission denied/);await assert.rejects(pg.query('select * from crm_text_matches($1,$2)',['co',phone]),/permission denied/);await pg.exec('reset role');}
 await pg.exec('set role service_role');assert.equal((await list()).length,1);
});
