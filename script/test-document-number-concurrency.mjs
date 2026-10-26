// Opt-in integration test against disposable PostgreSQL 17, never production.
// Usage: node script/test-document-number-concurrency.mjs (requires Docker).
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const container = `airking-numbers-${process.pid}`;
async function sql(query) {
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At']);
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.on('error',reject);child.on('exit',code=>code===0?resolve(out.trim()):reject(new Error(err)));
  child.stdin.end(query);
 });
}
try {
 await exec('docker',['run','--detach','--rm','--name',container,'-e','POSTGRES_PASSWORD=disposable-only','postgres:17-alpine']);
 for(let attempt=0;;attempt++){
  try{await sql('select 1');break;}catch(error){if(attempt>=30)throw error;await new Promise(r=>setTimeout(r,500));}
 }
 await sql(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema crm_private;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create table profiles(id uuid,company_id text,role text);
 insert into profiles values(auth.uid(),'test','owner');
 create table customers(id text primary key,company_id text,data jsonb);
 insert into customers values('customer','test','{}');
 create table invoices(id text primary key,company_id text,customer_id text,data jsonb);
 create table quotes(like invoices including all);
 insert into invoices values('004425','test','customer','{"id":"004425","status":"Sent"}');`);
 const source=await readFile('supabase/migrations/20260917225457_launch_permissions_and_confirmed_saves.sql','utf8');
 await sql(source.slice(source.indexOf('create function public.crm_save_records('),source.indexOf('--',source.indexOf('grant execute on function public.crm_save_records'))));
 const migration=(await readdir('supabase/migrations')).find(x=>x.endsWith('_document_numbers.sql'));
 await sql(await readFile(`supabase/migrations/${migration}`,'utf8'));
 const create=(id,table='invoices')=>sql(`select crm_save_records('[{"table":"${table}","id":"${id}","data":{"id":"${id}","customerId":"customer","status":"Draft"}}]'::jsonb)->0->>'documentNumber';`);
 const numbers=await Promise.all(Array.from({length:24},(_,i)=>create(`invoice-${i}`)));
 assert.equal(new Set(numbers).size,24);
 assert.deepEqual([...numbers].sort(),Array.from({length:24},(_,i)=>String(4426+i).padStart(6,'0')));
 const retries=await Promise.all(Array.from({length:24},()=>create('same-request','quotes')));
 assert.deepEqual(new Set(retries),new Set(['000001']));
 assert.equal(await sql("select count(*) from quotes"),'1');
 assert.equal(await create('next-quote','quotes'),'000002');
 assert.equal(await sql("select data::text from invoices where id='004425'"),'{"id": "004425", "status": "Sent"}');
 console.log('PASS: 24 simultaneous independent creates, 24 identical retries, separate sequences, numeric legacy reservation, unchanged historical document.');
} finally {
 await exec('docker',['rm','-f',container]).catch(()=>{});
}
