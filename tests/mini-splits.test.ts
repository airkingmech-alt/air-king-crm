import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { authorizeMiniSplitsImport, buildMiniSplitsRows, planMiniSplitsImport } from "../shared/mini-splits-import";
import { categoryAfterTypeChange, matchesPricebookTab, newItemDefaults } from "../shared/pricebook-sections";

// Synthetic records only: never put supplier account prices in this repository.
const source = {
  model: "000TEST", supplier_sku: "SUP-000TEST", label: "Test indoor unit", description: "Indoor unit",
  source_section: "Equipment", subcategory: "Indoor units", manufacturer: "Test brand",
  currency: "USD", unit: "each", supplier_unit_cost: "80.04", supplier_unit_cost_cents: 8004,
  supplier: "Test supplier", supplier_branch: "Test branch", pricing_date: "2026-10-10",
  source_filename: "synthetic.pdf", source_library_file_id: "synthetic-library-id", source_page: 1, source_notes: [],
  source_store_664_stock_quantity: 0,
};
test("Mini Splits includes equipment and accessories in their normal type views", () => {
  const equipment = { category: "Mini Splits", item_type: "equipment" as const };
  const part = { category: " mini splits ", item_type: "part" as const };
  assert.ok(matchesPricebookTab(equipment, "mini-splits"));
  assert.ok(matchesPricebookTab(part, "mini-splits"));
  assert.ok(matchesPricebookTab(part, "part"));
  assert.ok(matchesPricebookTab(equipment, "equipment"));
  assert.equal(matchesPricebookTab({ category: "Mini Splits", item_type: "service" }, "mini-splits"), false);
  assert.equal(matchesPricebookTab({ category: "Condenser", item_type: "equipment" }, "mini-splits"), false);
  assert.deepEqual(newItemDefaults("mini-splits"), { item_type: "equipment", category: "Mini Splits" });
  assert.equal(categoryAfterTypeChange("Mini Splits", "part"), "Mini Splits");
  assert.equal(categoryAfterTypeChange("Mini Splits", "labor"), "Labor");
});
test("supplier costs stay exact, models stay strings, stock is ignored, and sale prices retain margin", () => {
  const rows = buildMiniSplitsRows({ rows: [source, { ...source, model: "PART", supplier_sku: null, source_section: "Parts and accessories", subcategory: "Controls" }] }, "test-company");
  assert.equal(rows.length, 2); assert.equal(rows[0].cost_cents, 8004); assert.equal(rows[0].price_cents, 10005);
  assert.equal(rows[0].model, "000TEST"); assert.equal(rows[0].sku, "SUP-000TEST");
  assert.equal(rows[1].item_type, "part"); assert.equal(rows[1].unit, "each");
  assert.equal(rows[0].metadata.availability_ignored, true);
  assert.throws(() => buildMiniSplitsRows({ rows: [{ ...source, supplier_unit_cost: null }] }, "test-company"));
  assert.throws(() => buildMiniSplitsRows({ rows: [{ ...source, supplier_unit_cost_cents: 80 }] }, "test-company"), /match cents/);
  assert.throws(() => buildMiniSplitsRows({ rows: [source, { ...source, model: "000test" }] }, "test-company"), /Duplicate/);
});
test("imports skip existing SKU or same-brand model without updating its price or archive state", () => {
  const rows = buildMiniSplitsRows({ rows: [source] }, "test-company");
  const existing = [{ sku: " sup-000test ", model: null, brand: null, cost_cents: 123, active: false }];
  assert.deepEqual(planMiniSplitsImport(rows, existing), []);
  assert.deepEqual(planMiniSplitsImport(rows, [{ sku: "different", model: "000test", brand: "test BRAND" }]), []);
  assert.equal(existing[0].cost_cents, 123); assert.equal(existing[0].active, false);
  assert.equal(planMiniSplitsImport(rows, [{ sku: "different", model: "000test", brand: "other brand" }]).length, 1);
});
test("import authorization requires owner/admin, company and Price Book permission", () => {
  assert.equal(authorizeMiniSplitsImport({ company_id: "test-company", role: "owner", permissions: { pricebook: false } }), "test-company");
  assert.equal(authorizeMiniSplitsImport({ company_id: "test-company", role: "admin" }), "test-company");
  for (const profile of [null, { company_id: "", role: "owner" }, { company_id: "x", role: "technician" }, { company_id: "x", role: "admin", permissions: { pricebook: false } }]) {
    assert.throws(() => authorizeMiniSplitsImport(profile), /owner\/admin/);
  }
});
test("existing database policies enforce company/permission and atomic duplicate prevention", async () => {
  const pg = new PGlite();
  try {
    const schema = await readFile("supabase/migrations/20260914120000_pricebook_invoices_permissions_leads.sql", "utf8");
    const policies = await readFile("supabase/migrations/20260914131501_finish_crm_package.sql", "utf8");
    await pg.exec(`create role authenticated; create role anon;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
      create table profiles(id uuid primary key,company_id text,role text,permissions jsonb default '{}'::jsonb);
      grant select on profiles to authenticated;
      ${schema.match(/create table if not exists public.price_book_items \([\s\S]*?\);/)![0]}
      ${schema.match(/create unique index if not exists price_book_company_sku[\s\S]*?;/)![0]}
      alter table price_book_items enable row level security;
      grant select,insert,update on price_book_items to authenticated;
      ${policies.match(/create or replace function public.crm_can\([\s\S]*?\$\$;/)![0]}
      ${policies.match(/create policy price_book_staff[\s\S]*?;/)![0]}
      insert into profiles(id,company_id,role) values('00000000-0000-0000-0000-000000000001','test-company','owner');`);
    const rows = buildMiniSplitsRows({ rows: [source] }, "test-company");
    const insert = async (row: any) => pg.query("insert into price_book_items(company_id,item_type,category,name,sku,model,cost_cents,price_cents) values($1,$2,$3,$4,$5,$6,$7,$8)", [row.company_id,row.item_type,row.category,row.name,row.sku,row.model,row.cost_cents,row.price_cents]);
    await pg.exec("set role authenticated; select set_config('test.user','00000000-0000-0000-0000-000000000001',false);");
    await insert(rows[0]);
    await assert.rejects(insert({ ...rows[0], company_id: "other-company" }), /row-level security/);
    await assert.rejects(insert({ ...rows[0], sku: rows[0].sku.toLowerCase() }), /unique constraint/);
    const saved = (await pg.query<any>("select sku,model,brand from price_book_items")).rows;
    assert.deepEqual(planMiniSplitsImport(rows, saved), []);
    await pg.exec("reset role; update profiles set role='admin',permissions='{\"pricebook\":false}'; set role authenticated;");
    assert.equal((await pg.query("select * from price_book_items")).rows.length, 0);
    await assert.rejects(insert({ ...rows[0], sku: "NEW" }), /row-level security/);
    await pg.exec("reset role;");
    assert.equal((await pg.query("select * from price_book_items")).rows.length, 1);
  } finally { await pg.close(); }
});
