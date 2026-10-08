import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { defaultCrownCatalog } from "../shared/crown-tiers";

const pg = new PGlite();
const company = "airking";
const actor = "11111111-1111-4111-8111-111111111111";
const initial = { ...structuredClone(defaultCrownCatalog), version: "catalog-v2" };
const next = { ...structuredClone(defaultCrownCatalog), version: "catalog-v3" };
next.tiers.gold.annualPerSystemCents = 39900;
const firstEdit = { actorId: actor, requestKey: "first", requestHash: "first-hash", before: defaultCrownCatalog, after: initial };
const nextEdit = { actorId: actor, requestKey: "second", requestHash: "second-hash", before: initial, after: next };
let legacyBefore: any;

before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to service_role;
    create table memberships(id text primary key,company_id text default 'airking',customer_id text default 'customer',data jsonb);
    create table crm_settings(company_id text primary key,data jsonb);
    insert into memberships(id,data) values('legacy','{"pricing":{"totalAmountCents":18900},"paymentStatus":"Paid","visitsUsed":1,"draftTier":{"catalogVersion":"2026-10-draft-1"}}');
    insert into crm_settings values('airking','{"company_name":"Untouched company","sending_enabled":false}');`);
  legacyBefore = await pg.query("select data from memberships union all select data from crm_settings");
  await pg.exec(await readFile("supabase/migrations/20261008031154_crown_care_versioned_catalog.sql", "utf8"));
  await pg.exec(`grant select,insert,update,delete on memberships to authenticated;
    alter table memberships enable row level security;
    create policy company_access on memberships for all to authenticated
      using(company_id='airking') with check(company_id='airking');
    create function public.crm_save_records(changes jsonb) returns jsonb
      language plpgsql security invoker set search_path=public as $$
      declare item jsonb; begin
        for item in select * from jsonb_array_elements(changes) loop
          insert into memberships(id,company_id,customer_id,data)
            values(item->>'id','airking','customer',item->'data')
            on conflict(id) do update set data=excluded.data;
        end loop;
        return changes;
      end $$;
    grant execute on function public.crm_save_records(jsonb) to authenticated;`);
});
after(() => pg.close());
beforeEach(async () => { await pg.exec("truncate crown_care_catalogs; alter table memberships disable trigger crown_membership_terms; delete from memberships where id <> 'legacy'; alter table memberships enable trigger crown_membership_terms");
  await pg.query("update memberships set data=$1 where id='legacy'", [JSON.stringify(legacyBefore.rows[0].data)]);
});
async function asRole(role: "service_role" | "authenticated" | "anon", sql: string, parameters: any[] = []) {
  return pg.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(sql, parameters); });
}
async function publish() {
  return asRole("service_role", "insert into crown_care_catalogs(company_id,version,catalog,history) values($1,$2,$3,$4) returning catalog",
    [company, initial.version, JSON.stringify(initial), JSON.stringify([firstEdit])]);
}
async function revise(history: any[] = [firstEdit, nextEdit], version = next.version, catalog = next) {
  return asRole("service_role", "update crown_care_catalogs set version=$1,catalog=$2,history=$3 where company_id=$4 and version=$5 returning catalog",
    [version, JSON.stringify(catalog), JSON.stringify(history), company, initial.version]);
}

test("catalog migration creates no catalog rows and leaves every legacy membership/settings field untouched", async () => {
  assert.deepEqual(await pg.query("select data from memberships union all select data from crm_settings"), legacyBefore);
  assert.equal((await pg.query("select * from crown_care_catalogs")).rows.length, 0);
});

test("catalog table has RLS, no client grants or policies, and invoker audit protection", async () => {
  const table = (await pg.query<any>("select relrowsecurity from pg_class where oid='public.crown_care_catalogs'::regclass")).rows[0];
  assert.equal(table.relrowsecurity, true);
  assert.equal((await pg.query("select * from pg_policy where polrelid='public.crown_care_catalogs'::regclass")).rows.length, 0);
  const fn = (await pg.query<any>("select prosecdef from pg_proc where oid='crm_private.guard_crown_catalog_history()'::regprocedure")).rows[0];
  assert.equal(fn.prosecdef, false);
  for (const role of ["anon", "authenticated"] as const) {
    for (const permission of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.equal((await pg.query<any>("select has_table_privilege($1,'public.crown_care_catalogs',$2) allowed", [role, permission])).rows[0].allowed, false);
    }
    await assert.rejects(asRole(role, "select * from crown_care_catalogs"), /permission denied/);
  }
  assert.equal((await pg.query<any>("select has_table_privilege('service_role','public.crown_care_catalogs','DELETE') allowed")).rows[0].allowed, false);
  assert.equal((await pg.query<any>("select has_table_privilege('service_role','public.crown_care_catalogs','TRUNCATE') allowed")).rows[0].allowed, false);
});

test("service catalog writes append exact snapshots while all existing agreements stay unchanged", async () => {
  await publish(); await revise();
  const saved = (await pg.query<any>("select * from crown_care_catalogs")).rows[0];
  assert.equal(saved.version, next.version); assert.deepEqual(saved.catalog, next); assert.deepEqual(saved.history, [firstEdit, nextEdit]);
  assert.deepEqual(await pg.query("select data from memberships union all select data from crm_settings"), legacyBefore);
  assert.equal((await revise()).rows.length, 0, "Optimistic old version cannot overwrite a newer publication");
});

test("audit snapshots cannot be removed, rewritten, or detached from the resulting catalog", async () => {
  await publish();
  for (const history of [[], [nextEdit], [{ ...firstEdit, actorId: "rewritten" }, nextEdit], [firstEdit, { ...nextEdit, before: {} }], [firstEdit, { ...nextEdit, after: initial }], [firstEdit, { ...nextEdit, requestKey: firstEdit.requestKey }]]) {
    await assert.rejects(revise(history), /catalog|Catalog|history/i);
  }
  await assert.rejects(revise([firstEdit, nextEdit], initial.version), /append a new version/);
  await assert.rejects(asRole("service_role", "update crown_care_catalogs set company_id='other' where company_id=$1", [company]), /ownership/);
  assert.deepEqual((await pg.query<any>("select catalog from crown_care_catalogs")).rows[0].catalog, initial);
});

const tierData = {
  id: "tier-member", customerId: "customer", tierPlan: { catalogVersion: initial.version, tier: "silver", systemCount: 1, annualTotalCents: 27900 },
  enrollmentTier: { tier: "silver", catalogVersion: initial.version, systemCount: 1 },
  agreement: { accepted: true, date: "2026-10-08", recordedBy: actor },
  pricing: { baseAmountCents: 27900, totalAmountCents: 27900, adjustmentCents: 0 },
  billingFrequency: "Annual", visitsIncluded: 2, startDate: "2026-10-08", renewalDate: "2027-10-08", autoRenew: false,
  notes: "Existing notes", coveredEquipment: [{ type: "AC", quantity: 1 }, { type: "Furnace", quantity: 1 }],
};
async function seedTier() {
  await asRole("service_role", "insert into memberships(id,company_id,customer_id,data) values($1,'airking','customer',$2)", [tierData.id, JSON.stringify(tierData)]);
}

test("authenticated direct inserts and invoker save RPC cannot bypass staff tier enrollment", async () => {
  for (const field of ["tierPlan", "enrollmentTier", "agreement"]) {
    const data = { id: "bypass", [field]: { accepted: true } };
    await assert.rejects(asRole("authenticated", "insert into memberships(id,data) values('bypass',$1)", [JSON.stringify(data)]), /enrollment workflow/);
    await assert.rejects(asRole("authenticated", "select crm_save_records($1)", [JSON.stringify([{ id: "bypass", data }])]), /enrollment workflow/);
    await assert.rejects(asRole("authenticated", "update memberships set data=data || $1::jsonb where id='legacy'", [JSON.stringify({ [field]: data[field as keyof typeof data] })]), /enrollment workflow/);
  }
  assert.equal((await pg.query("select * from memberships where id='bypass'")).rows.length, 0);
  await seedTier(); assert.equal((await pg.query("select * from memberships where id='tier-member'")).rows.length, 1);
});

test("saved tier price, customer, count, acceptance and renewal terms are immutable through every write role", async () => {
  await seedTier();
  const changes = {
    tierPlan: { ...tierData.tierPlan, systemCount: 2 }, enrollmentTier: null, agreement: null,
    pricing: { totalAmountCents: 1 }, billingFrequency: "Monthly", visitsIncluded: 20,
    startDate: "2020-01-01", renewalDate: "2030-01-01", autoRenew: true,
  };
  for (const role of ["authenticated", "service_role"] as const) {
    for (const [field, value] of Object.entries(changes)) {
      await assert.rejects(asRole(role, "update memberships set data=data || $1::jsonb where id='tier-member'", [JSON.stringify({ [field]: value })]), /terms are locked/);
    }
    for (const column of ["id", "company_id", "customer_id"]) {
      await assert.rejects(asRole(role, `update memberships set ${column}='different' where id='tier-member'`), /ownership/);
    }
    await assert.rejects(asRole(role, "update memberships set data=data || '{\"customerId\":\"different\"}' where id='tier-member'"), /ownership/);
  }
  await assert.rejects(asRole("authenticated", "select crm_save_records($1)", [JSON.stringify([{ id: tierData.id, data: { ...tierData, pricing: { totalAmountCents: 1 } } }])]), /enrollment workflow|terms are locked/);
  assert.deepEqual((await pg.query<any>("select data from memberships where id='tier-member'")).rows[0].data, tierData);
});

test("ordinary tier notes, component coverage, scheduling, and checklists stay editable; legacy pricing remains unchanged by guards", async () => {
  await seedTier();
  // Components are not complete systems: one AC plus its furnace may cover one system.
  const allowed = { notes: "Updated", coveredEquipment: [{ type: "AC", quantity: 1 }, { type: "Furnace", quantity: 1 }], springVisit: { status: "Scheduled" }, checklists: [{ status: "draft" }] };
  await asRole("authenticated", "update memberships set data=data || $1::jsonb where id='tier-member'", [JSON.stringify(allowed)]);
  const data = (await pg.query<any>("select data from memberships where id='tier-member'")).rows[0].data;
  await asRole("authenticated", "select crm_save_records($1)", [JSON.stringify([{ id: tierData.id, data: { ...data, notes: "Harmless RPC update" } }])]);
  assert.equal((await pg.query<any>("select data from memberships where id='tier-member'")).rows[0].data.notes, "Harmless RPC update");
  assert.equal(data.notes, "Updated"); assert.deepEqual(data.tierPlan, tierData.tierPlan); assert.deepEqual(data.pricing, tierData.pricing);
  await asRole("authenticated", "update memberships set data=data || '{\"pricing\":{\"totalAmountCents\":25000}}' where id='legacy'");
  assert.equal((await pg.query<any>("select data from memberships where id='legacy'")).rows[0].data.pricing.totalAmountCents, 25000);
});

test("accepted tier memberships cannot be hard-deleted by staff or service role; legacy deletion stays unchanged", async () => {
  await seedTier();
  for (const role of ["authenticated", "service_role"] as const) {
    await assert.rejects(asRole(role, "delete from memberships where id='tier-member'"), /cannot be permanently deleted/);
  }
  assert.deepEqual((await pg.query<any>("select data from memberships where id='tier-member'")).rows[0].data, tierData);
  await asRole("authenticated", "insert into memberships(id,data) values('legacy-delete','{\"pricing\":{\"totalAmountCents\":18900}}')");
  await asRole("authenticated", "delete from memberships where id='legacy-delete'");
  assert.equal((await pg.query("select * from memberships where id='legacy-delete'")).rows.length, 0);
  await asRole("service_role", "insert into memberships(id,data) values('legacy-delete-service','{\"notes\":\"legacy\"}')");
  await asRole("service_role", "delete from memberships where id='legacy-delete-service'");
  assert.equal((await pg.query("select * from memberships where id='legacy-delete-service'")).rows.length, 0);
});
