import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Disposable in-memory PostgreSQL only. The original production approval RPCs,
// production permission/save RPCs, and the new integrity migration run unchanged.
const pg = new PGlite();
const employee = "11111111-1111-4111-8111-111111111111";
const request = "22222222-2222-4222-8222-222222222222";
type Data = Record<string, any>;
const tables = [
  "customers", "customer_notes", "customer_photos", "quotes", "quote_acceptances",
  "invoices", "invoice_line_items", "payments", "work_orders", "memberships",
  "price_book_items", "leads", "lead_sources", "crm_settings",
  "customer_communication_preferences", "message_templates", "automations",
  "automation_runs", "communications", "communication_events", "referrals",
  "coupons", "marketing_audiences", "marketing_campaigns", "marketing_campaign_steps",
  "marketing_campaign_runs", "marketing_campaign_recipients", "marketing_attributions",
  "communication_consent_events",
];
const equipment = [{ id: "equipment-at-approval", name: "Approved air handler", quantity: 1 }];
function quote(changes: Data = {}): Data {
  return {
    id: "quote-one", customerId: "customer-one", customerName: "Example Customer",
    title: "Replace heat pump", laborDescription: "Remove old system; install approved equipment",
    status: "Sent", createdAt: "2026-10-01", jobType: "Installation", selectedOption: "good",
    selectedAddOns: [], equipmentSelectionMode: "explicit", equipmentItems: [{ id: "wrong-tier" }],
    options: [
      { tier: "good", label: "Essential", customerPrice: 8000, equipmentItems: [{ id: "basic" }] },
      { tier: "better", label: "Comfort", customerPrice: 10500.25, equipmentItems: equipment,
        totalCost: 4000, equipmentCost: 3000, purchaseTax: 100, equipment: "Approved system" },
    ],
    addOnCatalog: [
      { id: "custom-filter", name: "Approved filter", price: 175.5, description: "Quoted price" },
      { id: "custom-stat", name: "Approved thermostat", price: 299.25 },
    ], ...changes,
  };
}
const legacyQuote = quote({ id: "legacy-quote", status: "Won", selectedOption: "better", selectedAddOns: ["custom-filter"] });
const legacyInvoice = {
  id: "legacy-invoice", customerId: "customer-one", customerName: "Historical spelling",
  quoteId: "legacy-quote", amount: 4321.99, items: [{ description: "Original invoiced scope", amount: 4321.99 }],
  paidAmount: 2000, status: "Partial", sentDate: "2026-08-01", paymentHistory: [{ reference: "retain-me" }],
};
let beforeUpgrade: any[], afterUpgrade: any[];

async function insert(table: string, data: Data, company = "airking") {
  await pg.query(`insert into ${table}(id,company_id,customer_id,data) values($1,$2,$3,$4)`,
    [data.id, company, data.customerId ?? null, JSON.stringify(data)]);
}
async function historicalFixtures() {
  await insert("quotes", legacyQuote);
  await insert("invoices", legacyInvoice);
  await pg.query(`insert into quote_acceptances(company_id,quote_id,customer_name,decision,signature,selected_option,snapshot)
    values('airking','legacy-quote','Historical signer','accepted','Original signature','better',$1)`, [JSON.stringify(legacyQuote)]);
  await insert("quotes", quote({ ...legacyQuote, id: "legacy-unbilled" }));
  await insert("quotes", quote({ ...legacyQuote, id: "legacy-job-quote" }));
  await insert("work_orders", { id: "legacy-job", customerId: "customer-one", quoteId: "legacy-job-quote", status: "Completed" });
  const { quoteId: _quoteId, ...jobInvoice } = legacyInvoice;
  await insert("invoices", { ...jobInvoice, id: "legacy-job-invoice", workOrderId: "legacy-job" });
}
async function historicalRows() {
  return Promise.all(["quotes", "invoices", "work_orders", "quote_acceptances"].map(async table =>
    (await pg.query(`select to_jsonb(t) row from ${table} t order by id`)).rows));
}

before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema crm_private;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    create table profiles(id uuid primary key,company_id text,role text,permissions jsonb);
    insert into profiles values('${employee}','airking','technician','{}');
    grant select on profiles to authenticated,service_role;
    alter table profiles enable row level security;
    create policy self on profiles for select to authenticated using(id=auth.uid());
    create function public.get_my_company_id() returns text language sql stable
      security definer set search_path=public as $$select company_id from profiles where id=auth.uid()$$;
    revoke all on function public.get_my_company_id() from public,anon;
    grant execute on function public.get_my_company_id() to authenticated;
  `);
  for (const table of tables) {
    if (table === "quote_acceptances") {
      await pg.exec(`create table quote_acceptances(
        id uuid primary key default gen_random_uuid(), company_id text not null,
        quote_id text not null unique references quotes(id),customer_name text not null,
        decision text not null check(decision in ('accepted','declined')),signature text,
        selected_option text,message text,snapshot jsonb not null,created_at timestamptz not null default now())`);
    } else {
      await pg.exec(`create table ${table}(id text primary key,company_id text,customer_id text,data jsonb,
        created_at timestamptz not null default now(),updated_at timestamptz not null default now())`);
    }
    await pg.exec(`alter table ${table} enable row level security;
      grant select,insert,update,delete on ${table} to authenticated,service_role;
      create policy company on ${table} for all to authenticated
      using(company_id=(select company_id from profiles where id=auth.uid()))
      with check(company_id=(select company_id from profiles where id=auth.uid()));`);
  }
  await pg.exec(`revoke insert,update,delete on quote_acceptances from authenticated;
    alter table leads alter column id type uuid using id::uuid;
    alter table leads add column status text; alter table leads add column converted_at timestamptz;`);
  for (const migration of [
    "20260910222500_save_quote_addons.sql", "20260914010724_quote_job_invoice_flow.sql",
    "20260917225457_launch_permissions_and_confirmed_saves.sql", "20260917231306_company_lookup_invoker.sql",
  ]) await pg.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  await historicalFixtures();
  beforeUpgrade = await historicalRows();
  await pg.exec(await readFile("supabase/migrations/20261005234844_accepted_quote_invoice_integrity.sql", "utf8"));
  afterUpgrade = await historicalRows();
});
after(() => pg.close());
beforeEach(async () => {
  await pg.exec(`truncate quote_acceptances,quotes,invoices,work_orders,customers;
    update profiles set company_id='airking',role='technician',permissions='{}';
    alter table quotes disable trigger crm_20_accepted_quote;
    alter table invoices disable trigger crm_20_quote_invoice;
    alter table quote_acceptances disable trigger crm_20_quote_acceptance;`);
  // Re-create pre-migration records, without fabricating acceptance snapshots.
  try { await historicalFixtures(); }
  finally {
    await pg.exec(`alter table quotes enable trigger crm_20_accepted_quote;
      alter table invoices enable trigger crm_20_quote_invoice;
      alter table quote_acceptances enable trigger crm_20_quote_acceptance;`);
  }
  await insert("customers", { id: "customer-one", name: "Example Customer", properties: [{ address: "100 Example Street" }] });
  await insert("customers", { id: "customer-two", name: "Other Customer" });
  await insert("quotes", quote());
  await insert("quotes", quote({ id: "foreign-quote" }), "other");
});
async function asRole(role: "authenticated" | "service_role" | "anon", sql: string, params: any[] = []) {
  return pg.transaction(async tx => {
    await tx.exec(`set local role ${role}; set local request.jwt.claim.sub='${employee}';`);
    return (await tx.query<Data>(sql, params)).rows;
  });
}
async function service(sql: string, params: any[] = []) { return asRole("service_role", sql, params); }
async function stored(table: "quotes" | "invoices" | "work_orders", id: string) {
  return (await pg.query<{ data: Data }>(`select data from ${table} where id=$1`, [id])).rows[0]?.data;
}
async function convert(id = "quote-one", option = "better", addons = ["custom-filter", "custom-stat"]) {
  return (await service("select crm_staff_convert_quote($1,$2,$3,$4,$5) result",
    ["airking", employee, id, option, JSON.stringify(addons)]))[0].result;
}
async function decide(decision = "accepted", addons = ["custom-filter", "custom-stat"]) {
  return (await service("select crm_decide_quote($1,$2,$3,$4,$5,$6,$7,$8) result",
    ["quote-one", "airking", "Example Customer", decision, "Example Customer", "better", "Approved as quoted", JSON.stringify(addons)]))[0].result;
}
async function invoice(id = "quote-one", actor = employee, company = "airking") {
  return (await service("select crm_invoice_accepted_quote($1,$2,$3) result", [company, actor, id]))[0].result;
}
async function revise(id = "quote-one", actor = employee, company = "airking", requestId = request) {
  return (await service("select crm_revise_accepted_quote($1,$2,$3,$4) result", [company, actor, id, requestId]))[0].result;
}
async function save(table: string, data: Data, previous?: Data) {
  return (await asRole("authenticated", "select crm_save_records($1) result", [JSON.stringify([
    { table, id: data.id, data, ...(previous ? { previous } : {}) },
  ])]))[0].result[0];
}
function expectedScope(): Data {
  const q = quote(), { totalCost, equipmentCost, purchaseTax, ...option } = q.options[1];
  return {
    version: 1, quoteId: q.id, customerId: q.customerId, customerName: q.customerName,
    title: q.title, laborDescription: q.laborDescription, selectedOption: "better",
    selectedAddOns: ["custom-filter", "custom-stat"], option, addOns: q.addOnCatalog,
    items: [
      { description: "Comfort package — Replace heat pump\nEquipment: Approved system\nRemove old system; install approved equipment", amount: 10500.25 },
      { description: "Add-on — Approved filter", amount: 175.5 },
      { description: "Add-on — Approved thermostat", amount: 299.25 },
    ], equipmentItems: equipment, amount: 10975,
  };
}

test("applying the migration leaves every historical row, acceptance and financial value byte-equivalent", () => {
  assert.deepEqual(afterUpgrade, beforeUpgrade);
});

test("the real staff conversion freezes the approved tier, exact add-on prices, equipment and itemized total", async () => {
  const converted = await convert();
  const accepted = (await stored("quotes", "quote-one"))!;
  assert.equal(converted.status, "Won");
  assert.deepEqual(accepted.acceptedScope, expectedScope());
  const billed = await invoice();
  assert.equal(billed.workOrderId, converted.job_id);
  assert.deepEqual(billed.quoteAcceptance, expectedScope());
  assert.deepEqual(billed.items, expectedScope().items);
  assert.deepEqual(billed.equipmentItems, equipment);
  assert.equal(billed.amount, 10975);
  assert.equal(billed.paidAmount, 0);
  assert.deepEqual(await stored("invoices", billed.id), billed);
  assert.deepEqual(await invoice(), billed, "retry returns the same confirmed invoice");
  assert.deepEqual(await convert(), converted, "unchanged staff approval retry returns the same job");
});

test("public acceptance stores an exact immutable priced snapshot and replay cannot change a signature or selection", async () => {
  const acceptance = await decide();
  assert.deepEqual(acceptance.snapshot.acceptedScope, expectedScope());
  assert.deepEqual((await stored("quotes", "quote-one"))!.acceptedScope, expectedScope());
  assert.equal(acceptance.signature, "Example Customer");
  assert.equal(acceptance.decision, "accepted");
  assert.deepEqual(await decide("declined", []), acceptance);
  const billed = await invoice();
  assert.deepEqual(billed.quoteAcceptance, acceptance.snapshot.acceptedScope);
  await assert.rejects(service("update quote_acceptances set signature='Altered' where quote_id='quote-one'"), /immutable/i);
  await assert.rejects(service("update quote_acceptances set snapshot=snapshot || '{\"amount\":1}'::jsonb where quote_id='quote-one'"), /immutable/i);
  assert.equal((await pg.query<Data>("select signature from quote_acceptances where quote_id='quote-one'")).rows[0].signature, "Example Customer");
});

test("a declined public quote neither receives a snapshot nor becomes invoiceable", async () => {
  const result = await decide("declined", []);
  assert.equal(result.snapshot.acceptedScope, undefined);
  assert.equal((await stored("quotes", "quote-one"))!.status, "Lost");
  await assert.rejects(invoice(), /active accepted quote/i);
  assert.equal((await pg.query("select id from work_orders where data->>'quoteId'='quote-one'")).rows.length, 0);
});

for (const change of [
  { selectedOption: "good" }, { selectedAddOns: [] }, { addOnCatalog: [{ id: "custom-filter", name: "Changed", price: 1 }] },
  { options: quote().options.map((o: Data) => ({ ...o, customerPrice: 1 })) },
  { laborDescription: "Additional unapproved work" }, { acceptedScope: { version: 1, amount: 1 } }, { status: "Draft" },
]) {
  test(`accepted quote rejects generic edits to ${Object.keys(change)[0]} and its invoice stays unchanged`, async () => {
    await convert();
    const original = (await stored("quotes", "quote-one"))!;
    const billed = await invoice();
    await assert.rejects(save("quotes", { ...original, ...change }, original), /locked|approval/i);
    assert.deepEqual(await stored("quotes", original.id), original);
    assert.deepEqual(await invoice(), billed);
  });
}

test("a changed old conversion RPC cannot silently replace an accepted option or add-ons", async () => {
  await convert();
  const original = await stored("quotes", "quote-one");
  await assert.rejects(convert("quote-one", "good", []), /locked|approval/i);
  assert.deepEqual(await stored("quotes", "quote-one"), original);
});

test("a draft revision is explicit and idempotent; editing it leaves the accepted quote and invoice intact", async () => {
  await convert();
  const original = (await stored("quotes", "quote-one"))!;
  const billed = await invoice();
  const draft = await revise();
  assert.equal(draft.id, "Q-R-" + request);
  assert.equal(draft.status, "Draft");
  assert.equal(draft.revisionOf, original.id);
  for (const field of ["acceptedScope", "acceptedAt", "staffAcceptedAt", "convertedWorkOrderId", "sentAt", "firstViewedAt"]) assert.equal(draft[field], undefined);
  assert.deepEqual(await revise(), draft);
  const edited = { ...draft, selectedOption: "good", selectedAddOns: [], options: draft.options.map((o: Data) => ({ ...o, customerPrice: 999 })) };
  assert.deepEqual(await save("quotes", edited, draft), edited);
  assert.deepEqual(await revise(), edited, "retry cannot overwrite edits to the new draft");
  await assert.rejects(invoice(draft.id), /active accepted quote/i);
  await convert(draft.id, "good", []);
  const revisedInvoice = await invoice(draft.id);
  assert.equal(revisedInvoice.amount, 999);
  assert.notEqual(revisedInvoice.id, billed.id);
  assert.deepEqual(await stored("quotes", original.id), original);
  assert.deepEqual(await stored("invoices", billed.id), billed);
});

test("a reused revision request cannot point to a different accepted quote", async () => {
  await convert(); await revise();
  await assert.rejects(revise("legacy-unbilled"), /Revision request conflict/i);
});

test("legacy Won quotes have no fabricated snapshot and new billing is blocked until fresh approval", async () => {
  await assert.rejects(invoice("legacy-unbilled"), /legacy acceptance.*snapshot/i);
  const original = await stored("quotes", "legacy-unbilled");
  assert.equal(original!.acceptedScope, undefined);
  const draft = await revise("legacy-unbilled");
  assert.equal(draft.status, "Draft");
  assert.equal(draft.acceptedScope, undefined);
  assert.deepEqual(await stored("quotes", "legacy-unbilled"), original);
});

test("an existing historical quote-linked invoice is returned with its amount, payments and history unchanged", async () => {
  assert.deepEqual(await invoice("legacy-quote"), legacyInvoice);
  assert.deepEqual(await stored("invoices", "legacy-invoice"), legacyInvoice);
});

test("an existing historical job-linked invoice is returned before requiring a legacy quote snapshot", async () => {
  const original = await stored("invoices", "legacy-job-invoice");
  assert.deepEqual(await invoice("legacy-job-quote"), original);
  assert.deepEqual(await stored("invoices", "legacy-job-invoice"), original);
});

for (const change of [
  { amount: 1 }, { items: [{ description: "Changed", amount: 1 }] }, { equipmentItems: [] },
  { quoteAcceptance: {} }, { quoteId: "legacy-quote" }, { customerId: "customer-two" },
  { customerName: "Different recipient" }, { workOrderId: "different-job" },
]) {
  test(`quote invoice generic save cannot change ${Object.keys(change)[0]}`, async () => {
    await convert();
    const billed = await invoice();
    await assert.rejects(save("invoices", { ...billed, ...change }, billed), /locked|reassigned/i);
    assert.deepEqual(await stored("invoices", billed.id), billed);
  });
}

test("direct invoice insertion and generic invoice creation cannot supply a client-selected amount or items", async () => {
  await convert();
  const scope = expectedScope();
  const forged = { id: "forged-invoice", customerId: "customer-one", quoteId: "quote-one", amount: 1, items: scope.items };
  await assert.rejects(save("invoices", forged), /approved scope and price/i);
  await assert.rejects(service("insert into invoices(id,company_id,customer_id,data) values($1,'airking','customer-one',$2)",
    [forged.id, JSON.stringify({ ...forged, amount: scope.amount, items: [{ description: "Forged", amount: scope.amount }] })]), /approved scope and price/i);
  assert.equal(await stored("invoices", forged.id), undefined);
});

test("a job-linked generic invoice cannot omit quoteId to escape approved-price checks", async () => {
  const converted = await convert();
  await assert.rejects(save("invoices", { id: "job-forgery", customerId: "customer-one", workOrderId: converted.job_id,
    amount: 1, items: [{ description: "Forged", amount: 1 }] }), /approved scope and price/i);
});

test("invoice status, delivery, payment ledger projection and soft-deletion updates remain allowed", async () => {
  await convert();
  const billed = await invoice();
  const operational = { ...billed, status: "Partial", paidAmount: 500, sentDate: "2026-10-05", paymentHistory: [{ amount: 500, reference: "check-one" }] };
  assert.deepEqual(await save("invoices", operational, billed), operational);
  assert.deepEqual(await invoice(), operational);
  const voided = { ...operational, status: "Void", deletedAt: "2026-10-06T00:00:00Z", deletedBy: employee };
  assert.deepEqual(await save("invoices", voided, operational), voided);
  assert.deepEqual(voided.quoteAcceptance, expectedScope());
});

test("historical quote-linked invoices also reject scope changes while accepting payment/status updates", async () => {
  await assert.rejects(save("invoices", { ...legacyInvoice, amount: 9999 }, legacyInvoice), /locked/i);
  const paid = { ...legacyInvoice, status: "Paid", paidAmount: legacyInvoice.amount };
  assert.deepEqual(await save("invoices", paid, legacyInvoice), paid);
});

test("both the invoice guard and independent unique index reject a second active quote invoice", async () => {
  await convert(); const billed = await invoice();
  const duplicate = () => service("insert into invoices(id,company_id,customer_id,data) values($1,'airking','customer-one',$2)",
    ["second-invoice", JSON.stringify({ ...billed, id: "second-invoice" })]);
  await assert.rejects(duplicate(), /already exists|crm_active_invoice_quote|unique/i);
  // A single PGlite connection cannot model concurrent PostgreSQL sessions.
  // Independently prove the DB unique index is effective without its pre-check.
  await pg.exec("alter table invoices disable trigger crm_20_quote_invoice");
  try { await assert.rejects(duplicate(), /crm_active_invoice_quote|unique/i); }
  finally { await pg.exec("alter table invoices enable trigger crm_20_quote_invoice"); }
  assert.equal((await pg.query("select id from invoices where data->>'quoteId'='quote-one'")).rows.length, 1);
});

for (const addons of [["custom-filter", "custom-filter"], ["not-in-quote-catalog"]]) {
  for (const method of ["staff", "public"]) {
    test(`${method} acceptance rejects ${addons.length === 2 ? "duplicate" : "unknown"} add-ons atomically`, async () => {
      const original = await stored("quotes", "quote-one");
      await assert.rejects(method === "staff" ? convert("quote-one", "better", addons) : decide("accepted", addons), /Duplicate add-on|add-on price is missing/i);
      assert.deepEqual(await stored("quotes", "quote-one"), original);
      assert.equal((await pg.query("select id from work_orders where data->>'quoteId'='quote-one'")).rows.length, 0);
      assert.equal((await pg.query("select id from quote_acceptances where quote_id='quote-one'")).rows.length, 0);
    });
  }
}

for (const [field, value] of [["customerPrice", -1], ["customerPrice", 1.001], ["customerPrice", "100"]] as const) {
  test(`acceptance rejects an invalid option price ${JSON.stringify(value)}`, async () => {
    const current = quote(); current.options[1][field] = value;
    await pg.query("update quotes set data=$1 where id='quote-one'", [JSON.stringify(current)]);
    await assert.rejects(convert(), /price/i);
    assert.equal((await stored("quotes", "quote-one"))!.status, "Sent");
  });
}

test("legacy drafts freeze the displayed default add-on catalog when first accepted", async () => {
  const { addOnCatalog: _catalog, ...oldDraft } = quote();
  await pg.query("update quotes set data=$1 where id='quote-one'", [JSON.stringify(oldDraft)]);
  await convert("quote-one", "good", ["duct-clean", "crown-care"]);
  const scope = (await stored("quotes", "quote-one"))!.acceptedScope;
  assert.equal(scope.amount, 8638);
  assert.deepEqual(scope.addOns.map((a: Data) => a.price), [449, 189]);
  assert.equal((await invoice()).amount, 8638);
});

for (const permission of ["quotes", "invoices"]) {
  test(`the billing RPC rejects disabled ${permission} access even when called by service_role`, async () => {
    await convert();
    await pg.query("update profiles set permissions=$1", [JSON.stringify({ [permission]: false })]);
    await assert.rejects(invoice(), /access required/i);
    assert.equal((await pg.query("select id from invoices where data->>'quoteId'='quote-one'")).rows.length, 0);
    if (permission === "quotes") await assert.rejects(revise(), /access required/i);
    else assert.equal((await revise()).status, "Draft", "revision requires quote access but not invoice access");
  });
}

test("missing, wrong-company and nonstaff actors cannot create invoices or revisions", async () => {
  await convert();
  await assert.rejects(invoice("quote-one", request), /access required/i);
  await assert.rejects(revise("quote-one", request), /access required/i);
  await assert.rejects(invoice("quote-one", employee, "other"), /access required/i);
  await assert.rejects(revise("quote-one", employee, "other"), /access required/i);
  await assert.rejects(invoice("foreign-quote"), /no rows|unavailable/i);
  await pg.exec("update profiles set role='customer'");
  await assert.rejects(invoice(), /access required/i);
  await assert.rejects(revise(), /access required/i);
});

test("owners retain invoice/revision access despite feature flags", async () => {
  await convert();
  await pg.exec(`update profiles set role='owner',permissions='{"quotes":false,"invoices":false}'`);
  assert.equal((await invoice()).amount, 10975);
  assert.equal((await revise()).status, "Draft");
});

test("authenticated and anonymous users cannot invoke service-only billing/revision RPCs or forge approval through generic saves", async () => {
  for (const role of ["authenticated", "anon"] as const) {
    await assert.rejects(asRole(role, "select crm_invoice_accepted_quote('airking',$1,'quote-one')", [employee]), /permission denied/i);
    await assert.rejects(asRole(role, "select crm_revise_accepted_quote('airking',$1,'quote-one',$2)", [employee, request]), /permission denied/i);
  }
  const original = quote();
  await assert.rejects(save("quotes", { ...original, status: "Won" }, original), /approval action/i);
  await assert.rejects(save("quotes", { ...original, acceptedScope: expectedScope() }, original), /only be created by quote approval/i);
  assert.deepEqual(await stored("quotes", original.id), original);
});

test("historical job-only invoices preserve financial scope while permitting later payments and delivery", async () => {
  const historical = (await stored("invoices", "legacy-job-invoice"))!;
  await assert.rejects(save("invoices", { ...historical, amount: 1 }, historical), /locked/i);
  const updated = { ...historical, paidAmount: 3000, status: "Partial", sentDate: "2026-10-05" };
  assert.deepEqual(await save("invoices", updated, historical), updated);
  assert.deepEqual(await invoice("legacy-job-quote"), updated);
});

for (const mismatch of [{ id: "different-json-id" }, { customerId: "customer-two" }]) {
  for (const method of ["staff", "public"]) {
    test(`${method} acceptance rejects JSON/row ${Object.keys(mismatch)[0]} mismatches atomically`, async () => {
      const bad = quote(mismatch);
      await pg.query("update quotes set data=$1 where id='quote-one'", [JSON.stringify(bad)]);
      await assert.rejects(method === "staff" ? convert() : decide(), /identity does not match/i);
      assert.deepEqual(await stored("quotes", "quote-one"), bad);
      assert.equal((await pg.query("select id from quote_acceptances where quote_id='quote-one'")).rows.length, 0);
      assert.equal((await pg.query("select id from work_orders where data->>'quoteId'='quote-one'")).rows.length, 0);
    });
  }
}

test("direct acceptance cannot silently choose a missing or ambiguous tier", async () => {
  for (const selectedOption of [undefined, "unknown-option"]) {
    const data = quote({ id: "direct-invalid", status: "Won", selectedOption });
    await assert.rejects(insert("quotes", data), /explicit approved option/i);
  }
  const duplicate = quote({ id: "direct-duplicate", status: "Won", selectedOption: "better" });
  duplicate.options.push({ ...duplicate.options[1], customerPrice: 1 });
  await assert.rejects(insert("quotes", duplicate), /explicit approved option/i);
  assert.equal(await stored("quotes", "direct-invalid"), undefined);
  assert.equal(await stored("quotes", "direct-duplicate"), undefined);
});

test("a valid priced invoice cannot reference a cross-company or different-customer job", async () => {
  await convert();
  const scope = expectedScope();
  await insert("work_orders", { id: "foreign-job", customerId: "customer-one", quoteId: "quote-one" }, "other");
  await insert("work_orders", { id: "other-customer-job", customerId: "customer-two", quoteId: "quote-one" });
  for (const workOrderId of ["foreign-job", "other-customer-job", "missing-job"]) {
    await assert.rejects(save("invoices", { id: "invalid-job-invoice", customerId: "customer-one", quoteId: "quote-one",
      workOrderId, amount: scope.amount, items: scope.items }), /job unavailable|another customer/i);
  }
  assert.equal(await stored("invoices", "invalid-job-invoice"), undefined);
});

test("invoice customer row and JSON identity must both agree with the accepted quote", async () => {
  await convert(); const scope = expectedScope();
  const data = { id: "identity-invoice", quoteId: "quote-one", amount: scope.amount, items: scope.items, customerId: "customer-one" };
  await assert.rejects(service("insert into invoices(id,company_id,customer_id,data) values($1,'airking','customer-two',$2)",
    [data.id, JSON.stringify(data)]), /approved scope and price/i);
  await assert.rejects(service("insert into invoices(id,company_id,customer_id,data) values($1,'airking','customer-one',$2)",
    [data.id, JSON.stringify({ ...data, customerId: "customer-two" })]), /approved scope and price/i);
});

test("accepted quote operational timestamps can change while its snapshot remains frozen", async () => {
  await decide(); const original = (await stored("quotes", "quote-one"))!;
  const viewed = { ...original, firstViewedAt: "2026-10-05T12:00:00Z", sentAt: "2026-10-05T11:00:00Z" };
  assert.deepEqual(await save("quotes", viewed, original), viewed);
  assert.deepEqual((await invoice()).quoteAcceptance, expectedScope());
});

test("legacy billing finds the existing job-only invoice even when it belongs to a second later job", async () => {
  await insert("work_orders", { id: "earlier-unbilled-job", customerId: "customer-one", quoteId: "legacy-job-quote", status: "Completed" });
  await pg.exec("update work_orders set created_at='2020-01-01T00:00:00Z' where id='earlier-unbilled-job'");
  const orderedJobs = (await pg.query<{ id: string }>(
    "select id from work_orders where data->>'quoteId'='legacy-job-quote' order by created_at")).rows;
  assert.deepEqual(orderedJobs.map(job => job.id), ["earlier-unbilled-job", "legacy-job"]);
  const historical = await stored("invoices", "legacy-job-invoice");
  assert.equal((await stored("quotes", "legacy-job-quote"))!.acceptedScope, undefined);
  assert.deepEqual(await invoice("legacy-job-quote"), historical);
  assert.deepEqual(await invoice("legacy-job-quote"), historical, "retry still returns the same historical invoice");
  assert.deepEqual(await stored("invoices", "legacy-job-invoice"), historical);
  assert.equal((await pg.query("select id from invoices where data->>'quoteId'='legacy-job-quote'")).rows.length, 0);
});

test("an accepted snapshot with an existing historical job-only invoice cannot be billed again by direct insertion", async () => {
  const converted = await convert();
  const scope = (await stored("quotes", "quote-one"))!.acceptedScope;
  const historical = {
    id: "historical-active-job-invoice", customerId: "customer-one", customerName: "Historical customer",
    workOrderId: converted.job_id, amount: 9500,
    items: [{ description: "Preserve the previously invoiced scope", amount: 9500 }],
    paidAmount: 500, status: "Partial", paymentHistory: [{ reference: "prior-check", amount: 500 }],
  };
  // Represent an already-existing pre-migration invoice that never had quoteId.
  // Re-enable the real integrity trigger before every action under test.
  await pg.exec("alter table invoices disable trigger crm_20_quote_invoice");
  try { await insert("invoices", historical); }
  finally { await pg.exec("alter table invoices enable trigger crm_20_quote_invoice"); }
  const duplicate = {
    id: "direct-duplicate", customerId: "customer-one", quoteId: "quote-one", workOrderId: converted.job_id,
    amount: scope.amount, items: scope.items,
  };
  await assert.rejects(service("insert into invoices(id,company_id,customer_id,data) values($1,'airking','customer-one',$2)",
    [duplicate.id, JSON.stringify(duplicate)]), /invoice already exists/i);
  assert.equal(await stored("invoices", duplicate.id), undefined);
  assert.deepEqual(await invoice(), historical);
  assert.deepEqual(await stored("invoices", historical.id), historical);
  assert.deepEqual((await stored("quotes", "quote-one"))!.acceptedScope, scope);
});

test("changing the live default catalog after approval cannot change a frozen legacy-draft invoice", async () => {
  const { addOnCatalog: _catalog, ...oldDraft } = quote();
  await pg.query("update quotes set data=$1 where id='quote-one'", [JSON.stringify(oldDraft)]);
  await convert("quote-one", "good", ["duct-clean"]);
  const accepted = (await stored("quotes", "quote-one"))!.acceptedScope;
  const originalDefinition = (await pg.query<{ definition: string }>(
    "select pg_get_functiondef('public.crm_quote_addon_catalog()'::regprocedure) definition")).rows[0].definition;
  try {
    await pg.exec(`create or replace function public.crm_quote_addon_catalog() returns jsonb
      language sql immutable security invoker set search_path=public,pg_temp as
      $$select '[{"id":"duct-clean","name":"Renamed after approval","price":999999}]'::jsonb$$;`);
    const billed = await invoice();
    assert.equal(billed.amount, 8449);
    assert.deepEqual(billed.quoteAcceptance, accepted);
    assert.equal(billed.quoteAcceptance.addOns[0].name, "Whole-Home Duct Cleaning");
    assert.equal(billed.quoteAcceptance.addOns[0].price, 449);
  } finally { await pg.exec(originalDefinition); }
});

test("real payment RPC and legacy balance/acceptance triggers can update the ledger without changing accepted scope", async () => {
  // Add only the payment subsystem columns used by the actual historical RPC.
  // This test deliberately runs its original function and both original guards.
  await pg.exec(`
    alter table payments alter column id set default gen_random_uuid()::text;
    alter table payments add column invoice_id text, add column amount_cents bigint, add column fee_cents bigint,
      add column method text, add column source text, add column external_id text unique, add column reference text,
      add column receipt_url text, add column paid_at timestamptz, add column actor_id uuid;
    alter table communication_events alter column id set default gen_random_uuid()::text;
    alter table communication_events add column invoice_id text,add column event_type text,add column dedupe_key text,
      add column actor_id uuid,add column metadata jsonb;
    create table checkout_attempts(id uuid primary key default gen_random_uuid(),invoice_id text,amount_cents bigint,
      fee_cents bigint,state text,expires_at timestamptz);
    create table stripe_events(id text primary key,type text,payment_id text);
    grant select,insert,update,delete on checkout_attempts,stripe_events to service_role;
  `);
  const migration = await readFile("supabase/migrations/20260909230728_communications_payments.sql", "utf8");
  const paymentFunction = migration.match(/create function public\.crm_record_payment\([\s\S]*?end \$\$;/)?.[0];
  const balanceFunction = migration.match(/create function crm_private\.protect_balance\(\)[\s\S]*?end \$\$;/)?.[0];
  assert.ok(paymentFunction); assert.ok(balanceFunction);
  await pg.exec(paymentFunction + "\n" + balanceFunction);
  await pg.exec(`create trigger crm_protect_balance before insert or update on invoices for each row execute function crm_private.protect_balance();
    create trigger crm_protect_acceptance before update on quotes for each row execute function crm_private.protect_balance();`);
  try {
    await decide();
    const originalQuote = (await stored("quotes", "quote-one"))!;
    const billed = await invoice();
    const payment = async (amount: number, reference: string) => (await service(
      "select to_jsonb(crm_record_payment($1,'airking',$2,'Check',$3,$4)) result", [billed.id, amount, reference, employee]))[0].result;
    const first = await payment(50000, "first-check");
    assert.equal(first.amount_cents, 50000);
    const partial = (await stored("invoices", billed.id))!;
    assert.equal(partial.paidAmount, 500); assert.equal(partial.status, "Partial");
    assert.deepEqual(partial.quoteAcceptance, expectedScope());
    assert.deepEqual(partial.items, billed.items); assert.equal(partial.amount, billed.amount);
    assert.deepEqual(await payment(50000, "first-check"), first, "payment retry is idempotent");
    await payment((billed.amount - 500) * 100, "final-check");
    const paid = (await stored("invoices", billed.id))!;
    assert.equal(paid.status, "Paid"); assert.equal(paid.paidAmount, 10975);
    assert.deepEqual(paid.quoteAcceptance, expectedScope());
    assert.deepEqual(await stored("quotes", "quote-one"), originalQuote);
    assert.equal((await pg.query("select id from payments where invoice_id=$1", [billed.id])).rows.length, 2);
    await assert.rejects(service("update invoices set data=jsonb_set(data,'{amount}','1') where id=$1", [billed.id]), /locked|cannot change/i);
  } finally {
    await pg.exec("drop trigger crm_protect_balance on invoices; drop trigger crm_protect_acceptance on quotes;");
  }
});

test("historical job-only invoice protection cannot be removed by unlinking or deleting its job", async () => {
  const job = (await stored("work_orders", "legacy-job"))!;
  const historical = (await stored("invoices", "legacy-job-invoice"))!;
  const { quoteId: _quoteId, ...unlinked } = job;
  await assert.rejects(save("work_orders", unlinked, job), /quote link.*cannot|linked.*locked/i);
  await assert.rejects(asRole("authenticated", "delete from work_orders where id='legacy-job'"), /billing history|retained/i);
  await assert.rejects(save("invoices", { ...historical, amount: 1, items: [{ description: "Repriced", amount: 1 }] }, historical), /scope is locked/i);
  assert.deepEqual(await stored("work_orders", job.id), job);
  assert.deepEqual(await invoice("legacy-job-quote"), historical);
});

test("an arbitrary standalone job invoice cannot be rebound to an accepted quote", async () => {
  await convert();
  const job = { id: "unlinked-job", customerId: "customer-one", status: "Unscheduled" };
  await save("work_orders", job);
  const bill = { id: "unpriced-bill", customerId: "customer-one", workOrderId: job.id,
    amount: 1, items: [{ description: "Standalone service", amount: 1 }] };
  await save("invoices", bill);
  await assert.rejects(save("work_orders", { ...job, quoteId: "quote-one" }, job), /quote link.*cannot/i);
  await assert.rejects(save("work_orders", { ...job, id: "forged-linked-job", quoteId: "quote-one" }), /quote approval/i);
  assert.deepEqual(await stored("work_orders", job.id), job);
  assert.deepEqual(await stored("invoices", bill.id), bill);
  assert.equal((await invoice()).amount, expectedScope().amount);
});

test("invoice-only staff cannot strip a hidden historical job link to change financial scope", async () => {
  await pg.exec(`update profiles set permissions='{"schedule":false,"quotes":false}'`);
  const historical = (await stored("invoices", "legacy-job-invoice"))!;
  assert.equal((await asRole("authenticated", "select id from work_orders where id='legacy-job'")).length, 0);
  const { workOrderId: _job, ...unlinked } = historical;
  await assert.rejects(save("invoices", { ...unlinked, amount: 1, items: [{ description: "Repriced", amount: 1 }] }, historical), /scope is locked/i);
  assert.deepEqual(await stored("invoices", historical.id), historical);
});

test("invoice-only staff retain operational updates to historical job-only invoices", async () => {
  await pg.exec(`update profiles set permissions='{"schedule":false,"quotes":false}'`);
  const historical = (await stored("invoices", "legacy-job-invoice"))!;
  const delivered = { ...historical, sentDate: "2026-10-06", status: "Partial", paidAmount: 3000 };
  assert.deepEqual(await save("invoices", delivered, historical), delivered);
  assert.deepEqual((await stored("invoices", historical.id))!.items, historical.items);
  assert.equal((await stored("invoices", historical.id))!.amount, historical.amount);
});

test("the private invoice guard does not expose a hidden accepted quote through a new invoice", async () => {
  await convert();
  const scope = expectedScope();
  await pg.exec(`update profiles set permissions='{"quotes":false}'`);
  assert.equal((await asRole("authenticated", "select id from quotes where id='quote-one'")).length, 0);
  await assert.rejects(save("invoices", { id: "hidden-quote-copy", customerId: "customer-one", quoteId: "quote-one",
    amount: scope.amount, items: scope.items }), /access|permission|accepted quote/i);
  assert.equal(await stored("invoices", "hidden-quote-copy"), undefined);
});
