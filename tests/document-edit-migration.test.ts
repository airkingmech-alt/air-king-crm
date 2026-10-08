import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { publicFields } from "../server/crm/core";

// Disposable in-memory PostgreSQL. Real permission, approval, balance, payment,
// and editing SQL runs here; no provider, production data, or live migration.
const pg = new PGlite();
const employee = "11111111-1111-4111-8111-111111111111";
type Data = Record<string, any>;
const tables = ["customers", "customer_notes", "customer_photos", "quotes", "quote_acceptances", "invoices", "invoice_line_items", "payments", "work_orders", "memberships", "price_book_items", "leads", "lead_sources", "crm_settings", "customer_communication_preferences", "message_templates", "automations", "automation_runs", "communications", "communication_events", "referrals", "coupons", "marketing_audiences", "marketing_campaigns", "marketing_campaign_steps", "marketing_campaign_runs", "marketing_campaign_recipients", "marketing_attributions", "communication_consent_events"];
const option = (changes: Data = {}): Data => ({ tier: "Better", label: "Selected system", equipment: "Heat pump", equipmentItems: ["sku-one"], equipmentSummary: "Selected heat pump", efficiency: "Match pending", features: ["Install as described"], equipmentCost: 100, purchaseTax: 9, totalCost: 109, customerPrice: 136.25, ...changes });
const quote = (changes: Data = {}): Data => ({ id: "q", customerId: "customer", customerName: "Synthetic Customer", status: "Draft", title: "Heat pump replacement", jobType: "Changeout", laborDescription: "Original labor", options: [option()], selectedOption: "Better", selectedAddOns: [], laborCost: 0, materialsCost: 0, taxRate: .09, equipmentCost: 100, purchaseTax: 9, equipmentItems: ["sku-one"], equipmentSelectionMode: "explicit", pricingVersion: "purchase-tax-v1", createdAt: "2026-10-01", sentAt: "2026-10-02", expiresAt: "2027-01-01", customMetadata: { preserve: true }, ...changes });
const invoice = (changes: Data = {}): Data => ({ id: "i", customerId: "customer", customerName: "Synthetic Customer", status: "Sent", amount: 125.35, paidAmount: 0, items: [{ description: "Original scope", amount: 125.35 }], dueDate: "2026-11-01", sentDate: "2026-10-01", cardFeePercent: 3, customMetadata: { preserve: true }, ...changes });
let migration: string;
let beforeUpgrade: any, afterUpgrade: any;
async function insert(table: string, data: Data, company = "airking") {
  return (await pg.query<Data>(`insert into ${table}(id,company_id,customer_id,data) values($1,$2,$3,$4) returning data`, [data.id, company, data.customerId ?? null, JSON.stringify(data)])).rows[0].data;
}
async function stored(kind: string, id: string) { return (await pg.query<Data>(`select data from ${kind}s where id=$1`, [id])).rows[0]?.data; }
async function asRole(role: string, sql: string, params: any[] = [], actor = employee) {
  return pg.transaction(async tx => {
    await tx.exec(`set local role ${role};set local request.jwt.claim.sub='${actor}';`);
    return (await tx.query<Data>(sql, params)).rows;
  });
}
async function edit(kind: string, previous: Data | null, changes: any, id = previous?.id ?? "i", role = "authenticated") {
  return (await asRole(role, "select crm_edit_document($1,$2,$3,$4) saved", [kind, id, JSON.stringify(previous), JSON.stringify(changes)]))[0].saved;
}
async function generic(kind: string, previous: Data, changes: Data) {
  return (await asRole("authenticated", "select crm_save_records($1) saved", [JSON.stringify([{ table: kind + "s", id: previous.id, previous, data: { ...previous, ...changes } }])]))[0].saved[0];
}
async function reserve(id = "i", amount = 12535, token = "ctoken_one") {
  return (await asRole("service_role", "select * from crm_reserve_direct_payment($1,'airking',$2,0,$3)", [id, amount, token]))[0];
}
async function recordPayment(id = "i", amount = 5000) {
  return asRole("service_role", "select * from crm_record_payment($1,'airking',$2,'Cash',$3)", [id, amount, "payment-" + id]);
}

before(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema crm_private;revoke all on schema crm_private from public,anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
    create table profiles(id uuid primary key,company_id text,role text,permissions jsonb);
    grant select on profiles to authenticated,service_role;alter table profiles enable row level security;
    create policy self on profiles for select to authenticated using(id=auth.uid());
    create function public.get_my_company_id() returns text language sql stable security invoker set search_path=public as $$select company_id from profiles where id=auth.uid()$$;
    revoke all on function public.get_my_company_id() from public,anon;grant execute on function public.get_my_company_id() to authenticated;`);
  for (const table of tables) {
    if (table === "quote_acceptances") {
      await pg.exec(`create table quote_acceptances(id uuid primary key default gen_random_uuid(),company_id text,quote_id text unique,customer_name text,decision text,signature text,selected_option text,message text,snapshot jsonb,created_at timestamptz default now());`);
    } else if (table === "payments") {
      await pg.exec(`create table payments(id uuid primary key default gen_random_uuid(),company_id text,invoice_id text,customer_id text,amount_cents bigint,fee_cents bigint default 0,method text,source text,external_id text unique,reference text,receipt_url text,paid_at timestamptz,actor_id uuid);`);
    } else if (table === "communication_events") {
      await pg.exec(`create table communication_events(id uuid primary key default gen_random_uuid(),company_id text,customer_id text,invoice_id text,event_type text,dedupe_key text unique,actor_id uuid,metadata jsonb);`);
    } else {
      await pg.exec(`create table ${table}(id text primary key,company_id text,customer_id text,data jsonb,created_at timestamptz default now(),updated_at timestamptz default now());`);
    }
    await pg.exec(`alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated,service_role;
      create policy company on ${table} for all to authenticated using(company_id=public.get_my_company_id()) with check(company_id=public.get_my_company_id());`);
  }
  await pg.exec(`revoke insert,update,delete on payments,quote_acceptances from authenticated;
    alter table leads alter column id type uuid using id::uuid;alter table leads add column status text;alter table leads add column converted_at timestamptz;
    create table checkout_attempts(id uuid primary key default gen_random_uuid(),company_id text,invoice_id text,amount_cents bigint,fee_cents bigint default 0,state text default 'reserved',session_id text unique,session_url text,expires_at timestamptz default now()+interval '35 minutes',created_at timestamptz default now());
    alter table checkout_attempts enable row level security;grant all on checkout_attempts to service_role;
    create table stripe_events(id text primary key,type text,payment_id uuid);grant all on stripe_events to service_role;`);
  for (const file of ["20260910222500_save_quote_addons.sql", "20260914010724_quote_job_invoice_flow.sql", "20260917225457_launch_permissions_and_confirmed_saves.sql", "20261005234844_accepted_quote_invoice_integrity.sql", "20260922225304_full_balance_checkout.sql", "20260922233136_stripe_automatic_surcharge.sql", "20260923004332_direct_card_checkout.sql"]) await pg.exec(await readFile("supabase/migrations/" + file, "utf8"));
  const original = await readFile("supabase/migrations/20260909230728_communications_payments.sql", "utf8");
  await pg.exec(original.slice(original.indexOf("create function public.crm_record_payment("), original.indexOf("create function public.crm_decide_quote(")));
  await pg.exec(original.slice(original.indexOf("create function crm_private.protect_balance()"), original.indexOf("revoke all on function public.crm_document_lifecycle", original.indexOf("create function crm_private.protect_balance()"))));
  await pg.exec(original.slice(original.indexOf("create function public.crm_void_invoice("), original.indexOf("commit;", original.indexOf("create function public.crm_void_invoice("))));
  await insert("quotes", quote({ id: "legacy", title: "Historical untouched" }));
  await insert("invoices", invoice({ id: "legacy-invoice" }));
  beforeUpgrade = (await pg.query("select 'quote' kind,to_jsonb(q) row from quotes q union all select 'invoice',to_jsonb(i) from invoices i")).rows;
  migration = (await readdir("supabase/migrations")).find(name => name.endsWith("_document_edit_guards.sql"))!;
  assert.ok(migration, "editing migration exists");
  await pg.exec(await readFile("supabase/migrations/" + migration, "utf8"));
  afterUpgrade = (await pg.query("select 'quote' kind,to_jsonb(q) row from quotes q union all select 'invoice',to_jsonb(i) from invoices i")).rows;
});
after(() => pg.close());
beforeEach(async () => {
  await pg.exec(`truncate customers,quotes,invoices,work_orders,quote_acceptances,payments,checkout_attempts,stripe_events,communication_events,profiles;
    insert into profiles values('${employee}','airking','technician','{}');`);
  await insert("customers", { id: "customer", name: "Synthetic Customer" });
  await insert("quotes", quote()); await insert("invoices", invoice());
});

test("migration leaves existing rows and financial values untouched", () => assert.deepEqual(afterUpgrade, beforeUpgrade));

test("quote edit merges permitted fields, retains metadata/status/linkage, and appends server snapshots", async () => {
  const old = await stored("quote", "q");
  const saved = await edit("quote", old, { customerName: "Corrected name", title: "New title", laborDescription: "Corrected scope" });
  assert.deepEqual({ ...saved, customerName: old.customerName, title: old.title, laborDescription: old.laborDescription, editHistory: undefined }, { ...old, editHistory: undefined });
  const entry = saved.editHistory[0];
  assert.equal(entry.editedBy, employee); assert.equal(entry.actorRole, "authenticated"); assert.ok(Number.isFinite(Date.parse(entry.editedAt)));
  assert.deepEqual(entry.changedFields, ["customerName", "title", "laborDescription"]);
  assert.deepEqual(entry.before, old);
  assert.deepEqual(entry.after, Object.fromEntries(Object.entries(saved).filter(([k]) => k !== "editHistory")));
  assert.deepEqual(await stored("quote", "q"), saved);
  const next = await edit("quote", saved, { title: "Second title" });
  assert.deepEqual(next.editHistory[0], entry); assert.equal(next.editHistory.length, 2);
  assert.equal(next.editHistory[1].before.editHistory, undefined, "snapshots do not recursively duplicate history");
});

test("quote options and exact cents can be edited, and removed selection is cleared server-side", async () => {
  const old = await stored("quote", "q");
  const saved = await edit("quote", old, { laborCost: 25.15, materialsCost: 3.25, options: [option({ tier: "Good", customerPrice: 189.13 })] });
  assert.equal(saved.selectedOption, undefined); assert.equal(saved.options[0].customerPrice, 189.13);
  assert.equal(saved.status, old.status); assert.deepEqual(saved.equipmentItems, old.equipmentItems);
  assert.ok(saved.editHistory[0].changedFields.includes("selectedOption"));
});

test("ordinary invoice edits require an exact item sum and preserve payment and delivery metadata", async () => {
  const old = await stored("invoice", "i");
  const saved = await edit("invoice", old, { customerName: "Corrected Customer", projectName: "Lot 4", constructionStage: "Rough-in", dueDate: "2026-12-31", items: [{ description: "Labor", amount: 10.1 }, { description: "Materials", amount: .2 }], amount: 10.3 });
  assert.equal(saved.amount, 10.3); assert.equal(saved.paidAmount, 0); assert.equal(saved.status, "Sent");
  assert.equal(saved.cardFeePercent, 3); assert.equal(saved.sentDate, old.sentDate); assert.deepEqual(saved.customMetadata, old.customMetadata);
  const cleared = await edit("invoice", saved, { projectName: "", constructionStage: null });
  assert.equal(cleared.projectName, ""); assert.equal(cleared.constructionStage, null);
});

for (const status of ["Draft", "Sent", "Overdue"]) test(`unpaid ${status} invoices support corrections`, async () => {
  const old = await insert("invoices", invoice({ id: "status", status }));
  const saved = await edit("invoice", old, { customerName: "Corrected" });
  assert.equal(saved.status, status);
});

test("unchanged saves do not append history; stale saves and retries cannot overwrite newer edits", async () => {
  const old = await stored("invoice", "i");
  assert.deepEqual(await edit("invoice", old, {}), old);
  assert.deepEqual(await edit("invoice", old, { amount: old.amount }), old);
  const saved = await edit("invoice", old, { customerName: "First change" });
  await assert.rejects(edit("invoice", old, { customerName: "First change" }), /record changed/i);
  await assert.rejects(edit("invoice", old, { dueDate: "2027-01-01" }), /record changed/i);
  assert.deepEqual(await stored("invoice", "i"), saved);
});

test("two queued edits of the same snapshot have one winner and one conflict", async () => {
  const old = await stored("quote", "q");
  const results = await Promise.allSettled([edit("quote", old, { title: "First" }), edit("quote", old, { title: "Second" })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal((await stored("quote", "q")).editHistory.length, 1);
});

for (const key of ["id", "customerId", "status", "paidAmount", "workOrderId", "quoteId", "sentDate", "cardFeePercent", "editHistory", "deletedAt", "customMetadata", "selectedOption", "acceptedScope"]) test(`RPC rejects editing protected field ${key}`, async () => {
  const old = await stored("invoice", "i");
  await assert.rejects(edit("invoice", old, { [key]: "forged" }), /field cannot be changed/i);
  assert.deepEqual(await stored("invoice", "i"), old);
});

test("direct and old generic saves cannot erase or fabricate audit history", async () => {
  const saved = await edit("invoice", await stored("invoice", "i"), { customerName: "Corrected" });
  for (const history of [[], [...saved.editHistory, { editedBy: "forged" }], [{ ...saved.editHistory[0], before: {} }]]) {
    await assert.rejects(generic("invoice", saved, { editHistory: history }), /history is immutable/i);
    await assert.rejects(asRole("authenticated", "update invoices set data=jsonb_set(data,'{editHistory}',$1) where id='i'", [JSON.stringify(history)]), /history is immutable/i);
  }
  const genericSaved = await generic("invoice", saved, { dueDate: "2027-02-01" });
  assert.equal(genericSaved.editHistory.length, 2); assert.deepEqual(genericSaved.editHistory[0], saved.editHistory[0]);
});

test("row ownership, feature flags, valid staff role, and function grants are enforced", async () => {
  const foreign = await insert("invoices", invoice({ id: "foreign" }), "other");
  await assert.rejects(edit("invoice", foreign, { customerName: "Stolen" }), /unavailable|restricted/i);
  for (const feature of ["quotes", "invoices"]) {
    await pg.query("update profiles set permissions=$1", [JSON.stringify({ [feature]: false })]);
    const kind = feature.slice(0, -1), id = kind === "quote" ? "q" : "i";
    await assert.rejects(edit(kind, await stored(kind, id), { customerName: "Hidden" }), /access.*restricted/i);
  }
  await pg.exec("update profiles set permissions='{}',role='customer'");
  await assert.rejects(edit("quote", await stored("quote", "q"), { title: "No" }), /Staff access required/i);
  await pg.exec("update profiles set role='owner',permissions='{\"quotes\":false}'");
  assert.equal((await edit("quote", await stored("quote", "q"), { title: "Owner change" })).title, "Owner change");
  for (const role of ["anon", "service_role"]) await assert.rejects(edit("invoice", await stored("invoice", "i"), {}, "i", role), /permission denied/i);
  await assert.rejects(asRole("authenticated", "select * from checkout_attempts"), /permission denied/i);
  const privileges = (await pg.query<Data>("select prosecdef from pg_proc where oid='public.crm_edit_document(text,text,jsonb,jsonb)'::regprocedure")).rows[0];
  assert.equal(privileges.prosecdef, false);
});

test("missing, deleted, invalid-kind, null, and malformed edit requests cannot mutate records", async () => {
  await assert.rejects(edit("invoice", invoice({ id: "missing" }), {}), /unavailable/i);
  const deleted = await insert("invoices", invoice({ id: "deleted", deletedAt: "2026-10-01" }));
  await assert.rejects(edit("invoice", deleted, { customerName: "No" }), /unavailable/i);
  for (const [kind, previous, changes] of [["invoices", invoice(), {}], [null, invoice(), {}], ["invoice", null, {}], ["invoice", invoice(), null], ["invoice", invoice(), []]] as any[]) {
    await assert.rejects(edit(kind, previous, changes), /Invalid document edit/i);
  }
});

for (const changes of [
  { customerName: " " }, { customerName: "x".repeat(301) }, { customerName: 7 },
  { amount: -1 }, { amount: 1.001 }, { amount: "125.35" }, { amount: 100000001 },
  { amount: 100 }, { items: [] }, { items: [{ description: "", amount: 125.35 }] },
  { items: [{ description: "Work", amount: 125.351 }] }, { items: [{ description: "Work", amount: "125.35" }] },
  { dueDate: "2026-02-30" }, { dueDate: "tomorrow" }, { dueDate: "1800-01-01" }, { dueDate: null },
  { constructionStage: "Other" }, { constructionStage: "Finish", projectName: " " },
]) test(`invalid invoice edit is atomic: ${JSON.stringify(changes).slice(0, 80)}`, async () => {
  const old = await stored("invoice", "i"); await assert.rejects(edit("invoice", old, changes)); assert.deepEqual(await stored("invoice", "i"), old);
});

for (const changes of [
  { jobType: "Unrecognized" }, { laborCost: -1 }, { taxRate: 9 }, { pricingVersion: "other" },
  { equipmentSelectionMode: "auto" }, { equipmentItems: [7] }, { selectedAddOns: ["not-in-catalog"] },
  { selectedAddOns: ["crown-care", "crown-care"] }, { options: [] },
  { options: [option({ customerPrice: 1.001 })] }, { options: [option({ tier: "Other" })] },
  { options: [option(), option({ tier: "better" })] }, { options: [option({ features: [5] })] },
]) test(`invalid quote edit is atomic: ${JSON.stringify(changes).slice(0, 80)}`, async () => {
  const old = await stored("quote", "q"); await assert.rejects(edit("quote", old, changes)); assert.deepEqual(await stored("quote", "q"), old);
});

test("accepted quotes are immutable and invoice scope locks survive feature-restricted edits", async () => {
  const accepted = await insert("quotes", quote({ id: "accepted", status: "Won" }));
  await assert.rejects(edit("quote", accepted, { title: "Changed" }), /Accepted scope.*locked/i);
  const billed = (await asRole("service_role", "select crm_invoice_accepted_quote('airking',$1,'accepted') saved", [employee]))[0].saved;
  await pg.exec("update profiles set permissions='{\"quotes\":false,\"schedule\":false}'");
  for (const changes of [{ customerName: "Changed" }, { items: [{ description: "Changed", amount: billed.amount }] }, { amount: 1 }]) {
    await assert.rejects(edit("invoice", billed, changes), /Quote invoice scope is locked/i);
  }
  const saved = await edit("invoice", billed, { projectName: "Lot 7", constructionStage: "Finish", dueDate: "2026-12-01" });
  assert.deepEqual(saved.quoteAcceptance, billed.quoteAcceptance); assert.deepEqual(saved.items, billed.items); assert.equal(saved.amount, billed.amount);
  assert.deepEqual(await stored("quote", "accepted"), accepted);
});

test("payment recorded after opening an editor wins; partial/paid/void invoices reject all content edits", async () => {
  const previous = await stored("invoice", "i"); await recordPayment();
  await assert.rejects(edit("invoice", previous, { customerName: "Stale" }), /record changed/i);
  for (const [id, amount] of [["partial", 5000], ["paid", 12535]] as const) {
    await insert("invoices", invoice({ id })); await recordPayment(id, amount);
    const paid = await stored("invoice", id);
    for (const changes of [{ customerName: "Changed" }, { dueDate: "2027-01-01" }, { projectName: "New" }, { items: [{ description: "Changed", amount: paid.amount }] }]) {
      await assert.rejects(edit("invoice", paid, changes), /content is locked/i);
      await assert.rejects(generic("invoice", paid, changes), /content is locked/i);
    }
  }
  const voided = await insert("invoices", invoice({ id: "void", status: "Void" }));
  await assert.rejects(edit("invoice", voided, { dueDate: "2027-01-01" }), /content is locked/i);
});

test("active checkout blocks equal-total scope swaps and allows only due-date corrections", async () => {
  const old = await stored("invoice", "i"); const attempt = await reserve();
  for (const changes of [{ customerName: "Changed" }, { projectName: "Another location" }, { constructionStage: "Finish", projectName: "Lot" }, { items: [{ description: "Different work", amount: old.amount }] }, { items: [{ description: "Higher", amount: 130 }], amount: 130 }]) {
    await assert.rejects(edit("invoice", old, changes), /payment.*in progress|total cannot change/i);
    await assert.rejects(generic("invoice", old, changes), /payment.*in progress|total cannot change/i);
  }
  const saved = await edit("invoice", old, { dueDate: "2026-12-01" });
  assert.equal(saved.dueDate, "2026-12-01");
  await pg.query("update checkout_attempts set expires_at=now()-interval '1 day' where id=$1", [attempt.id]);
  await assert.rejects(edit("invoice", saved, { customerName: "Still locked" }), /payment.*in progress/i);
  await pg.query("update checkout_attempts set state='cancelled' where id=$1", [attempt.id]);
  assert.equal((await edit("invoice", saved, { customerName: "After cancellation" })).customerName, "After cancellation");
});

test("edited amount invalidates a stale payment review and successful payment still preserves audit", async () => {
  const old = await stored("invoice", "i");
  const saved = await edit("invoice", old, { amount: 150, items: [{ description: "Updated", amount: 150 }] });
  await assert.rejects(reserve("i", 12535), /balance changed/i);
  assert.equal((await reserve("i", 15000)).amount_cents, 15000);
  await pg.exec("update checkout_attempts set state='cancelled'"); await recordPayment("i", 15000);
  const paid = await stored("invoice", "i"); assert.equal(paid.status, "Paid"); assert.deepEqual(paid.editHistory, saved.editHistory);
});

test("legacy invalid unrelated fields are preserved and an expired hosted checkout releases scope edits", async () => {
  const legacy = await insert("invoices", invoice({ id: "legacy", dueDate: "2020-02-30" }));
  await pg.exec("insert into checkout_attempts(company_id,invoice_id,amount_cents,checkout_kind,state,expires_at) values('airking','legacy',12535,'hosted','open',now()-interval '1 day')");
  const saved = await edit("invoice", legacy, { customerName: "Corrected historical name" }); assert.equal(saved.dueDate, "2020-02-30");
});

test("new records cannot fabricate edit history, but audited revisions preserve original history", async () => {
  const forged = invoice({ id: "forged", editHistory: [{ editedBy: employee, before: {}, after: {} }] });
  await assert.rejects(asRole("authenticated", "select crm_save_records($1)", [JSON.stringify([{ table: "invoices", id: forged.id, data: forged }])]), /fabricated edit history/i);
  const edited = await edit("quote", await stored("quote", "q"), { title: "Scope confirmed", selectedAddOns: ["crown-care"] });
  await asRole("service_role", "select crm_staff_convert_quote('airking',$1,'q','Better','[\"crown-care\"]')", [employee]);
  const accepted = await stored("quote", "q");
  assert.equal(accepted.status, "Won"); assert.deepEqual(accepted.editHistory, edited.editHistory);
  const draft = (await asRole("service_role", "select crm_revise_accepted_quote('airking',$1,'q','22222222-2222-4222-8222-222222222222') saved", [employee]))[0].saved;
  assert.equal(draft.status, "Draft"); assert.deepEqual(draft.editHistory, accepted.editHistory);
  const revised = await edit("quote", draft, { title: "New revision scope" });
  assert.equal(revised.editHistory.length, 2); assert.deepEqual(await stored("quote", "q"), accepted);
});

test("acceptance after opening an editor wins, and a declined quote cannot retain a removed selection", async () => {
  const previous = await stored("quote", "q");
  await asRole("service_role", "select crm_staff_convert_quote('airking',$1,'q','Better','[]')", [employee]);
  await assert.rejects(edit("quote", previous, { title: "Stale scope" }), /record changed/i);
  const declined = await insert("quotes", quote({ id: "declined", status: "Lost" }));
  await pg.query("insert into quote_acceptances(company_id,quote_id,decision,selected_option,snapshot) values('airking','declined','declined','Better',$1)", [JSON.stringify(declined)]);
  const saved = await edit("quote", declined, { options: [option({ tier: "Good" })] });
  assert.equal(saved.status, "Lost"); assert.equal(saved.selectedOption, undefined);
  assert.equal((await pg.query<Data>("select selected_option from quote_acceptances where quote_id='declined'")).rows[0].selected_option, "Better");
});

test("historical job-only quote invoices remain price-locked with scheduling access disabled", async () => {
  const accepted = await insert("quotes", quote({ id: "job-quote", status: "Won" }));
  await insert("work_orders", { id: "legacy-job", customerId: "customer", quoteId: accepted.id });
  await pg.exec("alter table invoices disable trigger crm_20_quote_invoice");
  let legacy: Data;
  try { legacy = await insert("invoices", invoice({ id: "job-invoice", workOrderId: "legacy-job" })); }
  finally { await pg.exec("alter table invoices enable trigger crm_20_quote_invoice"); }
  await pg.exec("update profiles set permissions='{\"schedule\":false,\"quotes\":false}'");
  await assert.rejects(edit("invoice", legacy!, { customerName: "Changed" }), /Quote invoice scope is locked/i);
  const saved = await edit("invoice", legacy!, { projectName: "Corrected lot", dueDate: "2026-12-01" });
  assert.equal(saved.workOrderId, "legacy-job"); assert.equal(saved.quoteId, undefined); assert.equal(saved.amount, legacy!.amount);
});


test("customer-facing document projections never expose private audit snapshots or actor IDs", async () => {
  for (const [kind, id] of [["quote", "q"], ["invoice", "i"]]) {
    const saved = await edit(kind, await stored(kind, id), { customerName: "Corrected customer" });
    const projected = publicFields(kind, saved);
    assert.equal(projected.editHistory, undefined);
    assert.equal(JSON.stringify(projected).includes(employee), false);
    assert.equal(JSON.stringify(projected).includes("customMetadata"), false);
  }
});

test("Void cannot be reopened through generic or direct writes to bypass content locks", async () => {
  const voided = await insert("invoices", invoice({ id: "void-reset", status: "Void" }));
  for (const status of ["Draft", "Sent", "Overdue", "Partial", "Paid", null]) {
    await assert.rejects(generic("invoice", voided, { status }), /void invoice cannot be reopened/i);
    await assert.rejects(asRole("authenticated", "update invoices set data=data||jsonb_build_object('status',$1::text) where id=$2", [status, voided.id]), /void invoice cannot be reopened/i);
    assert.deepEqual(await stored("invoice", voided.id), voided);
  }
  await assert.rejects(generic("invoice", voided, { status: "Sent", amount: 777, items: [{ description: "Bypassed", amount: 777 }] }), /void invoice cannot be reopened/i);
  await assert.rejects(edit("invoice", await stored("invoice", voided.id), { amount: 777, items: [{ description: "Bypassed", amount: 777 }] }), /content is locked/i);
  const archived = await generic("invoice", voided, { deletedAt: "2026-10-08" });
  assert.equal(archived.status, "Void", "non-content lifecycle updates still work");
});

test("paid and partial ledger projections cannot be zeroed or reset to unlock later editing", async () => {
  for (const [id, amount] of [["paid-reset", 12535], ["partial-reset", 5000]] as const) {
    await insert("invoices", invoice({ id })); await recordPayment(id, amount);
    const original = await stored("invoice", id);
    const saved = await generic("invoice", original, { status: "Sent", paidAmount: 0 });
    assert.equal(saved.status, original.status); assert.equal(saved.paidAmount, original.paidAmount);
    const rows = await asRole("authenticated", "update invoices set data=data||'{\"status\":\"Draft\",\"paidAmount\":0}'::jsonb where id=$1 returning data", [id]);
    assert.equal(rows[0].data.status, original.status); assert.equal(rows[0].data.paidAmount, original.paidAmount);
    await assert.rejects(edit("invoice", rows[0].data, { amount: 777, items: [{ description: "Bypassed", amount: 777 }] }), /content is locked/i);
  }
  await asRole("service_role", "select * from crm_record_payment('partial-reset','airking',7535,'Cash','payment-partial-final')");
  assert.equal((await stored("invoice", "partial-reset")).status, "Paid", "legitimate Partial-to-Paid progression is retained");
});

test("legacy paid and partial records without a ledger cannot be reset into editable unpaid records", async () => {
  for (const status of ["Paid", "Partial"]) {
    const original = invoice({ id: "legacy-" + status, status, paidAmount: 50 });
    await pg.exec("alter table invoices disable trigger crm_protect_balance");
    try { await insert("invoices", original); }
    finally { await pg.exec("alter table invoices enable trigger crm_protect_balance"); }
    await assert.rejects(generic("invoice", original, { status: "Sent", paidAmount: 0 }), /cannot be reset to an unpaid status/i);
    await assert.rejects(asRole("authenticated", "update invoices set data=data||'{\"status\":\"Sent\",\"paidAmount\":0}'::jsonb where id=$1", [original.id]), /cannot be reset to an unpaid status/i);
    assert.deepEqual(await stored("invoice", original.id), original);
  }
});

test("a verified late online payment can still settle a voided invoice without discarding money", async () => {
  const original = await insert("invoices", invoice({ id: "late-settlement", status: "Void" }));
  const attempt = (await pg.query<Data>("insert into checkout_attempts(company_id,invoice_id,amount_cents,checkout_kind,state,expires_at) values('airking','late-settlement',12535,'hosted','open',now()-interval '1 day') returning id")).rows[0];
  await asRole("service_role", "select * from crm_record_payment($1,'airking',12535,'visa','late-charge',null,null,$2,'evt_late','checkout.session.completed')", [original.id, attempt.id]);
  const saved = await stored("invoice", original.id);
  assert.equal(saved.status, "Paid"); assert.equal(saved.paidAmount, 125.35); assert.deepEqual(saved.items, original.items);
  await assert.rejects(edit("invoice", saved, { customerName: "Bypassed" }), /content is locked/i);
});


test("the existing authorized void action still closes unpaid invoices and leaves their content unchanged", async () => {
  for (const status of ["Draft", "Sent", "Overdue"]) {
    const original = await insert("invoices", invoice({ id: "void-action-" + status, status }));
    await asRole("service_role", "select crm_void_invoice($1,'airking')", [original.id]);
    const saved = await stored("invoice", original.id);
    assert.equal(saved.status, "Void"); assert.deepEqual(saved.items, original.items); assert.equal(saved.amount, original.amount);
    assert.equal(saved.editHistory, undefined);
    await assert.rejects(edit("invoice", original, { customerName: "Stale" }), /record changed/i);
    await assert.rejects(edit("invoice", saved, { customerName: "Locked" }), /content is locked/i);
  }
});
