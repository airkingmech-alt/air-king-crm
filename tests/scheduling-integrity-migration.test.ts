import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Fully isolated PostgreSQL engine. No real customers/appointments or integrations.
const pg = new PGlite();
const employee = "11111111-1111-4111-8111-111111111111";
const teammate = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const tables = ["customers", "customer_notes", "customer_photos", "quotes", "quote_acceptances", "invoices", "invoice_line_items", "payments", "work_orders", "memberships", "price_book_items", "leads", "lead_sources", "crm_settings", "customer_communication_preferences", "message_templates", "automations", "automation_runs", "communications", "communication_events", "referrals", "coupons", "marketing_audiences", "marketing_campaigns", "marketing_campaign_steps", "marketing_campaign_runs", "marketing_campaign_recipients", "marketing_attributions", "communication_consent_events"];
const migration = "supabase/migrations/20261005235014_scheduling_write_integrity.sql";
const legacy = { id: "legacy", customerId: "customer", status: "Scheduled", scheduledDate: "2020-02-30", technician: "Former staff", description: "Leave intact" };
let legacyAfterMigration: any;
before(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema crm_private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create table profiles(id uuid primary key,company_id text,role text,permissions jsonb,full_name text);
    grant select on profiles to authenticated,service_role;alter table profiles enable row level security;
    create policy self on profiles for select to authenticated using(id=auth.uid());
    create function public.get_my_company_id() returns text language sql stable security invoker set search_path=public as $$select company_id from profiles where id=auth.uid()$$;
    revoke all on function public.get_my_company_id() from public,anon;grant execute on function public.get_my_company_id() to authenticated;`);
  for (const table of tables) {
    await pg.exec(`create table ${table}(id text primary key,company_id text,customer_id text,data jsonb,updated_at timestamptz default now());
      alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated,service_role;
      create policy company on ${table} for all to authenticated using(company_id=public.get_my_company_id()) with check(company_id=public.get_my_company_id());`);
  }
  await pg.exec(`alter table leads alter column id type uuid using id::uuid;alter table leads add column status text;alter table leads add column converted_at timestamptz;
    create function crm_touch_updated_at() returns trigger language plpgsql set search_path=public as $$begin new.updated_at=clock_timestamp();return new;end$$;
    create trigger schedule_work_orders_touch before update on work_orders for each row execute function crm_touch_updated_at();`);
  for (const name of ["20260917225457_launch_permissions_and_confirmed_saves.sql", "20260930212925_crown_care_visit_linkage.sql"]) {
    await pg.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  }
  await pg.query("insert into work_orders(id,company_id,customer_id,data,updated_at) values('legacy','airking','customer',$1,'2020-01-01T00:00:00Z')", [JSON.stringify(legacy)]);
  await pg.exec(await readFile(migration, "utf8"));
  legacyAfterMigration = (await pg.query<any>("select data,updated_at from work_orders where id='legacy'")).rows[0];
});
after(() => pg.close());
beforeEach(async () => {
  await pg.exec(`truncate work_orders,memberships,customers,profiles,crm_private.schedule_write_locks;
    insert into profiles values('${employee}','airking','technician','{}','Alex Technician'),('${teammate}','airking','technician','{}','Morgan Technician'),('${outsider}','other','technician','{}','Foreign Technician');
    insert into customers(id,company_id,data) values('customer','airking','{"id":"customer"}'),('foreign','other','{"id":"foreign"}');
    insert into memberships(id,company_id,customer_id,data) values('member','airking','customer','{"id":"member","customerId":"customer","status":"Active","springVisit":{"status":"Unscheduled"},"visitsUsed":0}');`);
});
const job = (changes: Record<string, any> = {}) => ({ id: "job-one", customerId: "customer", customerName: "Synthetic Customer", property: "Synthetic address", type: "Service Call", description: "Keep scope", status: "Scheduled", scheduledDate: "2026-10-12", scheduledTime: "09:00", durationMinutes: 60, technicianId: employee, technician: "Alex Technician", priority: "Normal", ...changes });
async function asRole(role: string, sql: string, params: any[] = [], setup = "") {
  return pg.transaction(async tx => {
    await tx.exec(`set local role ${role};set local request.jwt.claim.sub='${employee}';${setup}`);
    return tx.query<any>(sql, params);
  });
}
const save = async (data: any, previous?: any) => (await asRole("authenticated", "select crm_save_records($1) saved", [JSON.stringify([{ table: "work_orders", id: data.id, data, previous }])])).rows[0].saved[0];
const direct = (data: any, company = "airking") => asRole("authenticated", "insert into work_orders(id,company_id,customer_id,data) values($1,$2,$3,$4) returning data", [data.id, company, data.customerId, JSON.stringify(data)]);
const stored = async (id = "job-one") => (await pg.query<any>("select * from work_orders where id=$1", [id])).rows[0];
async function serverWrite(data: any, create = true, expected: string | null = null, override = false, actor = employee, company = "airking") {
  return (await asRole("service_role", "select crm_write_scheduled_work_order($1,$2,$3,$4,$5,$6) saved", [actor, company, JSON.stringify(data), create, expected, override])).rows[0].saved;
}

test("migration does not infer, backfill, or rewrite legacy appointments", () => {
  assert.deepEqual(legacyAfterMigration.data, legacy);
  assert.equal(legacyAfterMigration.updated_at.toISOString(), "2020-01-01T00:00:00.000Z");
});

test("generic RPC, direct INSERT and UPDATE cannot bypass overlapping bookings", async () => {
  await save(job());
  const conflicting = job({ id: "overlap", scheduledTime: "09:30" });
  await assert.rejects(save(conflicting), /overlapping job/);
  await assert.rejects(direct(conflicting), /overlapping job/);
  const adjacent = job({ id: "adjacent", scheduledTime: "10:00" });
  await direct(adjacent);
  await assert.rejects(asRole("authenticated", "update work_orders set data=$1 where id='adjacent'", [JSON.stringify({ ...adjacent, scheduledTime: "09:45" })]), /overlapping job/);
  assert.equal((await stored("adjacent")).data.scheduledTime, "10:00");
});

test("multi-row INSERT and confirmed-save batches atomically reject the second overlap", async () => {
  const first = job(), second = job({ id: "job-two" });
  await assert.rejects(asRole("authenticated", "insert into work_orders(id,company_id,customer_id,data) values($1,'airking','customer',$2),($3,'airking','customer',$4)", [first.id, JSON.stringify(first), second.id, JSON.stringify(second)]), /overlapping job/);
  await assert.rejects(asRole("authenticated", "select crm_save_records($1)", [JSON.stringify([first, second].map(data => ({ table: "work_orders", id: data.id, data })))]), /overlapping job/);
  assert.equal((await pg.query("select * from work_orders")).rows.length, 0);
});

test("the server RPC fails closed for overlap with no prior override setting", async () => {
  await serverWrite(job());
  await assert.rejects(serverWrite(job({ id: "server-overlap" })), /overlapping job/);
});

test("adjacent bookings, another technician/company, and overnight boundaries", async () => {
  await save(job({ scheduledTime: "23:30", durationMinutes: 120 }));
  await assert.rejects(save(job({ id: "overlap", scheduledDate: "2026-10-13", scheduledTime: "00:15" })), /overlapping job/);
  await save(job({ id: "adjacent", scheduledDate: "2026-10-13", scheduledTime: "01:30" }));
  await save(job({ id: "other-tech", technicianId: teammate, technician: "Morgan Technician", scheduledTime: "23:30" }));
  await asRole("service_role", "insert into work_orders(id,company_id,customer_id,data) values('foreign','other','foreign',$1)", [JSON.stringify(job({ id: "foreign", customerId: "foreign", technicianId: outsider, technician: "Foreign Technician", scheduledTime: "23:30" }))]);
});

test("current team identity is validated under self-only profile RLS and mismatched names are rejected", async () => {
  await assert.rejects(save(job({ technicianId: teammate, technician: "Spoofed" })), /current team member name/);
  const saved = await save(job({ technicianId: teammate, technician: "Morgan Technician" }));
  assert.equal(saved.technician, "Morgan Technician");
  for (const change of [{ technicianId: outsider }, { technicianId: "invalid" }, { technicianId: null, technician: "Former staff" }]) {
    await assert.rejects(save(job({ id: "invalid", ...change })), /Choose an active|Choose a current/);
  }
  await pg.exec(`update profiles set role='customer' where id='${teammate}'`);
  await assert.rejects(save(job({ id: "inactive", technicianId: teammate })), /Choose an active/);
});

test("unique legacy names validate without rewriting their snapshot; ambiguous names require IDs", async () => {
  const saved = await save(job({ technicianId: undefined, technician: " alex technician " }));
  assert.equal(saved.technicianId, undefined);
  assert.deepEqual(await save(saved), saved);
  await pg.exec(`update profiles set full_name='Alex Technician' where id='${teammate}'`);
  await assert.rejects(save(job({ id: "ambiguous", technicianId: undefined, scheduledTime: "12:00" })), /duplicate names require/);
  await save(job({ id: "distinct-id", technicianId: teammate, scheduledTime: "12:00" }));
});

test("old name-only appointments still block a new ID-based overlapping booking without rewriting them", async () => {
  // Seed only this historical fixture without triggers, before exercising new writes.
  await pg.exec("alter table work_orders disable trigger a_work_order_schedule_guard");
  const original = job({ id: "legacy", technicianId: undefined });
  await pg.query("insert into work_orders(id,company_id,customer_id,data) values('legacy','airking','customer',$1)", [JSON.stringify(original)]);
  await pg.exec("alter table work_orders enable trigger a_work_order_schedule_guard");
  await assert.rejects(save(job()), /overlapping job/);
  assert.deepEqual((await stored("legacy")).data, JSON.parse(JSON.stringify(original)));
});

test("unassigned and undated drafts do not reserve a technician or fabricate dates", async () => {
  const draft = { id: "draft", customerId: "customer", status: "Unscheduled", description: "Accepted quote scope" };
  assert.deepEqual(await save(draft), draft);
  assert.equal((await serverWrite({ ...draft, id: "server-draft" })).data.scheduledDate, undefined);
  await save(job({ id: "unassigned", technicianId: null, technician: "" }));
  await save(job());
  assert.equal((await stored("draft")).data.scheduledDate, undefined);
});

for (const patch of [{ scheduledDate: "2026-02-30" }, { scheduledDate: undefined }, { scheduledTime: undefined }, { scheduledTime: "24:00" }, { scheduledTime: "9:00" }, { durationMinutes: 0 }, { durationMinutes: 1441 }, { durationMinutes: 15.5 }, { durationMinutes: "60" }, { status: "Fake" }]) {
  test(`all write paths reject invalid schedule fields: ${JSON.stringify(patch)}`, async () => {
    await assert.rejects(save(job(patch)), /valid appointment|duration|valid job status/);
    await assert.rejects(serverWrite(job(patch)), /valid appointment|duration|valid job status/);
    assert.equal(await stored(), undefined);
  });
}

test("unrelated legacy edits and closing malformed historical jobs remain possible without inventing times", async () => {
  await pg.exec("alter table work_orders disable trigger a_work_order_schedule_guard");
  await pg.query("insert into work_orders(id,company_id,customer_id,data) values('legacy','airking','customer',$1)", [JSON.stringify(legacy)]);
  await pg.exec("alter table work_orders enable trigger a_work_order_schedule_guard");
  const edited = { ...legacy, description: "New scope" };
  assert.deepEqual(await save(edited, legacy), edited);
  const closed = { ...edited, status: "Completed" };
  assert.deepEqual(await save(closed, edited), closed);
  await assert.rejects(save({ ...closed, status: "Scheduled" }, closed), /valid appointment/);
  assert.deepEqual((await stored("legacy")).data, closed);
});

for (const status of ["Cancelled", "Completed", "Unscheduled", "Needs Follow-up"]) {
  test(`${status} frees the booking; reopening checks for a conflicting new appointment`, async () => {
    const original = await save(job());
    const closed = await save({ ...original, status }, original);
    await save(job({ id: "replacement" }));
    await assert.rejects(save({ ...closed, status: "Scheduled" }, closed), /overlapping job/);
  });
}

test("Crown Care sync commits selected identity and rolls back both records on overlap", async () => {
  await save(job());
  const crown = job({ id: "crown", membershipId: "member", membershipSeason: "spring" });
  await assert.rejects(asRole("authenticated", "select crm_schedule_crown_visit($1)", [JSON.stringify(crown)]), /overlapping job/);
  assert.equal(await stored("crown"), undefined);
  assert.equal((await pg.query<any>("select data from memberships where id='member'")).rows[0].data.springVisit.status, "Unscheduled");
  crown.scheduledTime = "11:00"; crown.technicianId = teammate; crown.technician = "Morgan Technician";
  const result = (await asRole("authenticated", "select crm_schedule_crown_visit($1) saved", [JSON.stringify(crown)])).rows[0].saved;
  assert.equal(result.membership.springVisit.technician, "Morgan Technician");
  const updated = await serverWrite({ ...result.workOrder, scheduledTime: "12:00" }, false, (await stored("crown")).updated_at.toISOString());
  assert.equal(updated.data.membershipId, "member");
  assert.equal((await pg.query<any>("select data from memberships where id='member'")).rows[0].data.springVisit.scheduledTime, "12:00");
});

test("ordinary JSON flags, history and spoofed session settings never authorize an override", async () => {
  await save(job());
  const conflict = job({ id: "override", allowConflict: true, scheduleHistory: [{ conflictOverride: true }] });
  await assert.rejects(save(conflict), /overlapping job/);
  await assert.rejects(asRole("authenticated", "insert into work_orders(id,company_id,customer_id,data) values('override','airking','customer',$1)", [JSON.stringify(conflict)], "set local crm.schedule_conflict_override='override';"), /overlapping job/);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(asRole(role, "select crm_write_scheduled_work_order($1,'airking',$2,true,null,true)", [employee, JSON.stringify(conflict)]), /permission denied/);
  }
  await assert.rejects(serverWrite(conflict, true, null, true), /New jobs cannot override/);
});

test("guarded rescheduling allows an explicit override, restores it, and rejects stale versions", async () => {
  const first = await serverWrite(job());
  const second = await serverWrite(job({ id: "second", scheduledTime: "12:00" }));
  const moved = { ...second.data, scheduledTime: "09:30" };
  await assert.rejects(serverWrite(moved, false, second.updated_at), /overlapping job/);
  const saved = await serverWrite(moved, false, second.updated_at, true);
  assert.equal(saved.data.scheduledTime, "09:30");
  await assert.rejects(serverWrite({ ...saved.data, scheduledTime: "14:00" }, false, second.updated_at, true), /job changed/);
  await assert.rejects(serverWrite(job({ id: "third" })), /overlapping job/);
  assert.equal(first.data.description, "Keep scope");
});

test("server RPC honors actor company, feature access, Crown Care access and customer ownership", async () => {
  await assert.rejects(serverWrite(job(), true, null, false, outsider), /Schedule access/);
  await assert.rejects(serverWrite(job({ customerId: "foreign" })), /Customer unavailable/);
  await pg.exec(`update profiles set permissions='{"schedule":false}' where id='${employee}'`);
  await assert.rejects(serverWrite(job()), /Schedule access/);
  await pg.exec(`update profiles set permissions='{"customers":false}' where id='${employee}'`);
  await assert.rejects(serverWrite(job()), /Customer access/);
  await pg.exec(`update profiles set permissions='{}' where id='${employee}'`);
  const crown = await save(job({ membershipId: "member", membershipSeason: "spring" }));
  await pg.exec(`update profiles set permissions='{"memberships":false}' where id='${employee}'`);
  await assert.rejects(serverWrite({ ...crown, scheduledTime: "12:00" }, false, (await stored()).updated_at.toISOString()), /Crown Care access/);
});

test("stable IDs retry safely and changed create payloads cannot silently overwrite", async () => {
  const original = await serverWrite(job());
  assert.deepEqual(await serverWrite(job()), original);
  await assert.rejects(serverWrite(job({ description: "Different" })), /job changed/);
  assert.equal((await pg.query("select * from work_orders")).rows.length, 1);
});

test("queued competing writers yield exactly one appointment (PGlite serializes connections)", async () => {
  const results = await Promise.allSettled([serverWrite(job()), serverWrite(job({ id: "second" }))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await pg.query("select * from work_orders")).rows.length, 1);
});

test("private serialization is mandatory, VOLATILE and updates a persistent mutex row", async () => {
  const metadata = (await pg.query<any>("select provolatile,prosecdef from pg_proc where oid='crm_private.guard_work_order_schedule()'::regprocedure")).rows[0];
  assert.deepEqual(metadata, { provolatile: "v", prosecdef: true });
  await serverWrite(job());
  const prior = (await pg.query<any>("select revision from crm_private.schedule_write_locks where company_id='airking'")).rows[0].revision;
  await serverWrite(job({ id: "adjacent", scheduledTime: "10:00" }));
  assert.ok((await pg.query<any>("select revision from crm_private.schedule_write_locks where company_id='airking'")).rows[0].revision > prior);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(asRole(role, "select crm_private.lock_company_schedule('airking')"), /permission denied/);
    await assert.rejects(asRole(role, "delete from crm_private.schedule_write_locks"), /permission denied/);
  }
  const source = await readFile(migration, "utf8");
  assert.ok(source.indexOf("perform crm_private.lock_company_schedule(new.company_id)") < source.indexOf("select exists(select 1 from public.work_orders other"));
  assert.match(source, /on conflict\(company_id\) do update set revision=/);
});

test("name-only Crown Care retries remain idempotent and retain the structured link", async () => {
 const crown=job({id:"crown",membershipId:"member",membershipSeason:"spring",technicianId:undefined});
 const book=()=>asRole("authenticated","select crm_schedule_crown_visit($1) saved",[JSON.stringify(crown)]);
 const first=(await book()).rows[0].saved;
 assert.deepEqual((await book()).rows[0].saved,first);
 assert.equal(first.membership.springVisit.workOrderId,"crown");
});

test("manual new-job creation cannot claim a quote link",async()=>{
 await assert.rejects(serverWrite(job({quoteId:"quote"})),/Use quote conversion/);
 assert.equal(await stored(),undefined);
});

for(const deletedAt of ["",false,0,{},[],"not-a-date"]){
 test(`falsey or malformed deletion markers cannot bypass scheduling: ${JSON.stringify(deletedAt)}`,async()=>{
  await save(job());
  const conflict=job({id:"conflict",deletedAt});
  await assert.rejects(save(conflict),/Invalid appointment deletion marker/);
  await assert.rejects(direct(conflict),/Invalid appointment deletion marker/);
  const crown={...conflict,membershipId:"member",membershipSeason:"spring"};
  await assert.rejects(asRole("authenticated","select crm_schedule_crown_visit($1)",[JSON.stringify(crown)]),/Invalid appointment deletion marker/);
 });
}
test("old falsey tombstones still reserve the appointment without being rewritten",async()=>{
 await pg.exec("alter table work_orders disable trigger a_work_order_schedule_guard");
 const old=job({id:"legacy",deletedAt:false});
 await pg.query("insert into work_orders(id,company_id,customer_id,data) values('legacy','airking','customer',$1)",[JSON.stringify(old)]);
 await pg.exec("alter table work_orders enable trigger a_work_order_schedule_guard");
 await assert.rejects(save(job()),/overlapping job/);
 assert.deepEqual((await stored("legacy")).data,old);
});
test("closing a job cannot smuggle invalid changed appointment fields",async()=>{
 const original=await save(job());
 for(const patch of [{scheduledDate:"bad"},{scheduledTime:"25:00"},{durationMinutes:-4},{technicianId:undefined,technician:"Fake"}]){
  await assert.rejects(save({...original,status:"Completed",...patch},original),/valid appointment|duration|current team member/);
 }
 assert.deepEqual((await stored()).data,original);
});

for(const deletedAt of [false,0,""]){
 test(`historical falsey tombstones can still be rescheduled through the guarded RPC: ${JSON.stringify(deletedAt)}`,async()=>{
  await pg.exec("alter table work_orders disable trigger a_work_order_schedule_guard");
  const old=job({deletedAt});
  await pg.query("insert into work_orders(id,company_id,customer_id,data) values('job-one','airking','customer',$1)",[JSON.stringify(old)]);
  await pg.exec("alter table work_orders enable trigger a_work_order_schedule_guard");
  const updated=await serverWrite({...old,scheduledTime:"12:00"},false,(await stored()).updated_at.toISOString());
  assert.equal(updated.data.scheduledTime,"12:00");assert.equal(updated.data.deletedAt,deletedAt);
 });
}

for(const scheduledTime of [undefined,"","25:00"]){
 test(`historical incomplete times require review instead of an inferred 09:00 booking: ${JSON.stringify(scheduledTime)}`,async()=>{
  await pg.exec("alter table work_orders disable trigger a_work_order_schedule_guard");
  const old=job({id:"legacy",scheduledTime});
  await pg.query("insert into work_orders(id,company_id,customer_id,data) values('legacy','airking','customer',$1)",[JSON.stringify(old)]);
  await pg.exec("alter table work_orders enable trigger a_work_order_schedule_guard");
  await assert.rejects(save(job()),/incomplete appointment details/);
  await assert.rejects(serverWrite(job({scheduledTime:"18:00"})),/incomplete appointment details/);
  await assert.rejects(save(job({scheduledDate:"2026-10-11",scheduledTime:"23:30",durationMinutes:60})),/incomplete appointment details/);
  await save(job({id:"before",scheduledDate:"2026-10-11",scheduledTime:"23:00",durationMinutes:60}));
  await save(job({id:"after",scheduledDate:"2026-10-13"}));
  await save(job({id:"other-tech",technicianId:teammate,technician:"Morgan Technician"}));
  const movable=await serverWrite(job({id:"movable",scheduledDate:"2026-10-13",scheduledTime:"12:00"}));
  await assert.rejects(serverWrite({...movable.data,scheduledDate:"2026-10-12"},false,movable.updated_at,true),/incomplete appointment details/);
  assert.deepEqual((await stored("legacy")).data,JSON.parse(JSON.stringify(old)));
  // Explicitly giving the old appointment a real time releases the uncertainty.
  await serverWrite({...old,scheduledTime:"15:00"},false,(await stored("legacy")).updated_at.toISOString());
  await save(job());
 });
}
test("incomplete legacy appointments stay visible for review without a fabricated edit time",async()=>{
 const calendar=await readFile("client/src/components/dispatch-calendar.tsx","utf8");
 assert.match(calendar,/Review appointment details/);
 assert.match(calendar,/!Number.isFinite\(jobStart\(j\)\)/);
 assert.match(calendar,/scheduledTime: job.scheduledTime \|\| \(draft \? "09:00" : ""\)/);
});
