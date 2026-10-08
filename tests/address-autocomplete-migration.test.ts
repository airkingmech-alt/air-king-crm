import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const migration = "supabase/migrations/20261008221059_address_autocomplete_quota.sql";
before(async () => {
  await pg.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await pg.exec(await readFile(migration, "utf8"));
});
after(() => pg.close());
beforeEach(() => pg.exec("truncate crm_private.address_provider_requests;"));
async function reserve(role = "service_role") {
  await pg.exec(`begin; set local role ${role};`);
  try { const { rows } = await pg.query<{ value: any }>("select public.crm_reserve_address_request() value"); await pg.exec("commit"); return rows[0].value; }
  catch (error) { await pg.exec("rollback"); throw error; }
}
const count = async () => (await pg.query<{ count: number }>("select count(*)::integer count from crm_private.address_provider_requests")).rows[0].count;

test("only server role can reserve quota; ledger is RLS enabled and inaccessible to browser roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(reserve(role), /permission denied/);
    const { rows } = await pg.query<{ allowed: boolean }>("select has_table_privilege($1, 'crm_private.address_provider_requests', 'SELECT') allowed", [role]);
    assert.equal(rows[0].allowed, false);
  }
  const result = await reserve(); assert.equal(result.allowed, true); assert.equal(await count(), 1);
  const { rows } = await pg.query<{ rls: boolean; definer: boolean }>("select c.relrowsecurity rls, p.prosecdef definer from pg_class c, pg_proc p where c.oid='crm_private.address_provider_requests'::regclass and p.oid='public.crm_reserve_address_request()'::regprocedure");
  assert.equal(rows[0].rls, true); assert.equal(rows[0].definer, false);
});
test("four-per-rolling-second guard is global and denied requests do not reserve", async () => {
  for (let i = 0; i < 4; i++) assert.equal((await reserve()).allowed, true);
  const denied = await reserve(); assert.equal(denied.allowed, false); assert.equal(denied.reason, "rate_limit"); assert.equal(await count(), 4);
  await pg.exec("update crm_private.address_provider_requests set requested_at=clock_timestamp()-interval '2 seconds';");
  assert.equal((await reserve()).allowed, true); assert.equal(await count(), 5);
});
test("2,500 rolling-24-hour budget includes failed requests and only expires genuinely old attempts", async () => {
  await pg.exec("insert into crm_private.address_provider_requests(requested_at) select clock_timestamp()-interval '2 seconds' from generate_series(1,2500);");
  const denied = await reserve(); assert.equal(denied.allowed, false); assert.equal(denied.reason, "daily_limit"); assert.ok(denied.retry_after_seconds > 86000); assert.equal(await count(), 2500);
  await pg.exec("update crm_private.address_provider_requests set requested_at=clock_timestamp()-interval '25 hours' where id=(select id from crm_private.address_provider_requests limit 1);");
  assert.equal((await reserve()).allowed, true); assert.equal(await count(), 2500);
  assert.equal((await reserve()).reason, "daily_limit");
});
test("reservation uses shared transaction lock before wall time and stores timestamps only", async () => {
  const sql = await readFile(migration, "utf8");
  assert.ok(sql.indexOf("pg_advisory_xact_lock") < sql.indexOf("reserved_at := pg_catalog.clock_timestamp"));
  const { rows } = await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='crm_private' and table_name='address_provider_requests' order by ordinal_position");
  assert.deepEqual(rows.map(row => row.column_name), ["id", "requested_at"]);
});
