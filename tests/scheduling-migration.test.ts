import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("legacy writes advance versions without rewriting records during migration",async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(`create table customers(id text primary key,data jsonb,updated_at timestamptz);
      create table work_orders(id text primary key,data jsonb,updated_at timestamptz);
      create function crm_touch_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now();return new;end $$;
      insert into customers values('c','{"name":"Preserved"}','2020-01-01');
      insert into work_orders values('w','{"description":"Preserved"}','2020-01-01');`);
    await pg.exec(await readFile("supabase/migrations/20260917040657_schedule_equipment_concurrency.sql","utf8"));
    assert.equal((await pg.query<any>("select extract(year from updated_at)::int as y from customers")).rows[0].y,2020);
    await pg.exec("update customers set data=data where id='c'; update work_orders set data=data where id='w';");
    assert.equal((await pg.query<any>("select extract(year from updated_at)::int as y from customers")).rows[0].y,new Date().getUTCFullYear());
    assert.equal((await pg.query<any>("select data->>'description' description from work_orders")).rows[0].description,"Preserved");
    assert.equal((await pg.query("update work_orders set data='{}' where id='w' and updated_at='2020-01-01' returning id")).rows.length,0);
  }finally{await pg.close();}
});
