import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// This is a disposable, in-memory database. No Supabase connection or live data
// is used. Keep the production RLS policies and RPCs in the execution path.
const pg = new PGlite();
const employee = "11111111-1111-4111-8111-111111111111";
type RecordData = Record<string, any>;
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

before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create schema auth; create schema crm_private;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table profiles(id uuid primary key,company_id text,role text,permissions jsonb);
    insert into profiles values('${employee}','airking','technician','{}');
    grant select on profiles to authenticated; alter table profiles enable row level security;
    create policy self on profiles for select to authenticated using(id=auth.uid());
    create function public.get_my_company_id() returns text language sql stable
      security definer set search_path=public as
      $$select company_id from profiles where id=auth.uid()$$;
    revoke all on function public.get_my_company_id() from public,anon;
    grant execute on function public.get_my_company_id() to authenticated;
  `);
  for (const table of tables) {
    await pg.exec(`
      create table ${table}(id text primary key,company_id text,customer_id text,data jsonb);
      alter table ${table} enable row level security;
      grant select,insert,update,delete on ${table} to authenticated;
      create policy company on ${table} for all to authenticated
        using(company_id=(select company_id from profiles where id=auth.uid()))
        with check(company_id=(select company_id from profiles where id=auth.uid()));
    `);
  }
  await pg.exec(`
    alter table leads alter column id type uuid using id::uuid;
    alter table leads add column status text;
    alter table leads add column converted_at timestamptz;
  `);
  for (const migration of [
    "20260917225457_launch_permissions_and_confirmed_saves.sql",
    "20260917231306_company_lookup_invoker.sql",
    "20260930212925_crown_care_visit_linkage.sql",
  ]) {
    await pg.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  }
});

after(() => pg.close());

beforeEach(async () => {
  await pg.exec(`
    truncate work_orders, memberships, customers;
    update profiles set role='technician',permissions='{}';
    insert into customers values
      ('customer-one','airking',null,'{"id":"customer-one","name":"First customer"}'),
      ('customer-two','airking',null,'{"id":"customer-two","name":"Second customer"}'),
      ('foreign-customer','other',null,'{"id":"foreign-customer"}');
  `);
  await seedMembership();
});

function membership(changes: RecordData = {}): RecordData {
  return {
    id: "member-one", customerId: "customer-one", status: "Active",
    visitsUsed: 0, visitsIncluded: 2, billingFrequency: "Annual",
    pricing: { totalAmountCents: 19900 }, notes: "Keep the existing agreement",
    springVisit: { status: "Unscheduled", notes: "Keep spring instructions" },
    fallVisit: { status: "Unscheduled", notes: "Keep fall instructions" },
    ...changes,
  };
}

async function seedMembership(changes: RecordData = {}, company = "airking") {
  const data = membership(changes);
  await pg.query(`insert into memberships(id,company_id,customer_id,data) values($1,$2,$3,$4)
    on conflict(id) do update set company_id=excluded.company_id,
      customer_id=excluded.customer_id,data=excluded.data`,
  [data.id, company, data.customerId, JSON.stringify(data)]);
  return data;
}

function job(changes: RecordData = {}): RecordData {
  return {
    id: "job-one", customerId: "customer-one", customerName: "First customer",
    membershipId: "member-one", membershipSeason: "spring", status: "Scheduled",
    scheduledDate: "2026-10-08", scheduledTime: "09:30", durationMinutes: 60,
    description: "Crown Care seasonal visit", notes: "Keep job notes",
    selectedAddOns: ["filter"], ...changes,
  };
}

async function employeeQuery(query: string, params: any[] = []) {
  // PGlite queues these complete transactions. Unlike independent PostgreSQL
  // sessions, Promise.all callers here do not exercise simultaneous row locks.
  return pg.transaction(async (tx) => {
    await tx.exec(`set local role authenticated; set local request.jwt.claim.sub='${employee}';`);
    return (await tx.query<RecordData>(query, params)).rows;
  });
}

async function schedule(data = job()) {
  return (await employeeQuery("select crm_schedule_crown_visit($1) result", [JSON.stringify(data)]))[0].result;
}

async function save(data: RecordData, previous?: RecordData) {
  return (await employeeQuery("select crm_save_records($1) result", [JSON.stringify([
    { table: "work_orders", id: data.id, data, ...(previous ? { previous } : {}) },
  ])]))[0].result[0];
}

async function stored(table: "memberships" | "work_orders", id: string) {
  return (await pg.query<{ data: RecordData }>(`select data from ${table} where id=$1`, [id])).rows[0]?.data;
}

async function assertNothingBooked(original = membership()) {
  assert.equal((await pg.query("select * from work_orders")).rows.length, 0);
  assert.deepEqual(await stored("memberships", original.id), original);
}

for (const season of ["spring", "fall"]) {
  for (const technician of [undefined, "Alex Technician"]) {
    test(`${season} booking ${technician ? "with" : "without"} a technician returns both confirmed records`, async () => {
      const data = job({ membershipSeason: season, ...(technician ? { technician } : {}) });
      const original = membership();
      const result = await schedule(data);
      const expected = {
        ...original,
        [`${season}Visit`]: {
          ...original[`${season}Visit`], status: "Scheduled", workOrderId: data.id,
          scheduledDate: data.scheduledDate, scheduledTime: data.scheduledTime,
          ...(technician ? { technician } : {}),
        },
      };
      assert.deepEqual(result, { workOrder: data, membership: expected });
      assert.deepEqual(await stored("work_orders", data.id), result.workOrder);
      assert.deepEqual(await stored("memberships", original.id), result.membership);
      assert.equal(result.membership.visitsUsed, 0, "booking does not consume a completed visit");
    });
  }
}

test("an unchanged create retry is idempotent; a changed retry or duplicate seasonal job is rejected", async () => {
  const data = job();
  const first = await schedule(data);
  assert.deepEqual(await schedule(data), first);
  await assert.rejects(schedule({ ...data, notes: "Different request" }), /record changed/i);
  await assert.rejects(schedule({ ...data, id: "duplicate-job" }), /already scheduled or completed/);
  assert.equal((await pg.query("select * from work_orders")).rows.length, 1);
  assert.deepEqual(await stored("memberships", "member-one"), first.membership);
  assert.deepEqual(await stored("work_orders", data.id), data);
});

test("spring and fall are independent and each keeps its own job and appointment", async () => {
  const spring = job({ technician: "Alex Technician" });
  const fall = job({ id: "job-fall", membershipSeason: "fall", scheduledDate: "2026-11-09", scheduledTime: "14:00" });
  const springResult = await schedule(spring);
  const fallResult = await schedule(fall);
  assert.deepEqual(fallResult.membership.springVisit, springResult.membership.springVisit);
  assert.equal(fallResult.membership.fallVisit.workOrderId, fall.id);
  assert.equal(fallResult.membership.fallVisit.scheduledDate, fall.scheduledDate);
  assert.equal((await pg.query("select * from work_orders")).rows.length, 2);
});

test("denied membership writes roll back booking and leave no orphan work order", async () => {
  await pg.exec(`create policy deny_crown_write on memberships as restrictive for update
    to authenticated using(true) with check(false)`);
  try {
    await assert.rejects(schedule(), /row-level security|not permitted/);
    await assertNothingBooked();
  } finally {
    await pg.exec("drop policy deny_crown_write on memberships");
  }
});

test("a work-order write rejected after its trigger also rolls back the membership slot", async () => {
  await pg.exec(`create policy deny_job_write on work_orders as restrictive for insert
    to authenticated with check(false)`);
  try {
    await assert.rejects(schedule(), /row-level security/);
    await assertNothingBooked();
  } finally {
    await pg.exec("drop policy deny_job_write on work_orders");
  }
});

test("a denied membership completion update rolls back both status and usage", async () => {
  const data = job();
  const booked = await schedule(data);
  await pg.exec(`create policy deny_crown_write on memberships as restrictive for update
    to authenticated using(true) with check(false)`);
  try {
    await assert.rejects(save({ ...data, status: "Completed" }, data), /row-level security|not permitted/);
    assert.deepEqual(await stored("work_orders", data.id), data);
    assert.deepEqual(await stored("memberships", "member-one"), booked.membership);
  } finally {
    await pg.exec("drop policy deny_crown_write on memberships");
  }
});

test("a cross-company membership is inaccessible and unchanged", async () => {
  const foreign = await seedMembership({ id: "foreign-member", customerId: "foreign-customer" }, "other");
  await assert.rejects(schedule(job({ membershipId: foreign.id })), /Membership unavailable/);
  await assertNothingBooked();
  assert.deepEqual(await stored("memberships", foreign.id), foreign);
});

test("a same-company membership cannot be booked for a different customer", async () => {
  await assert.rejects(schedule(job({ customerId: "customer-two" })), /different customer/);
  await assertNothingBooked();
});

test("a foreign customer cannot be used to create a linked work order", async () => {
  await assert.rejects(schedule(job({ customerId: "foreign-customer" })), /Customer unavailable/);
  await assertNothingBooked();
});

test("a membership with inconsistent stored customer identity fails closed", async () => {
  await pg.query("update memberships set customer_id=$1 where id='member-one'", ["customer-two"]);
  await assert.rejects(schedule(), /different customer/);
  await assertNothingBooked();
});

for (const permission of ["memberships", "schedule"]) {
  test(`the booking RPC rejects missing ${permission} permission without partial writes`, async () => {
    await pg.query("update profiles set permissions=$1", [JSON.stringify({ [permission]: false })]);
    await assert.rejects(schedule(), /Schedule and Crown Care access are required/);
    await assertNothingBooked();
  });

  test(`generic saves cannot bypass ${permission} permission for a linked visit`, async () => {
    await pg.query("update profiles set permissions=$1", [JSON.stringify({ [permission]: false })]);
    await assert.rejects(save(job()), /row-level security|Membership unavailable/);
    await assertNothingBooked();
  });

  test(`a linked job status change fails atomically after ${permission} permission is revoked`, async () => {
    const data = job();
    const booked = await schedule(data);
    await pg.query("update profiles set permissions=$1", [JSON.stringify({ [permission]: false })]);
    await assert.rejects(save({ ...data, status: "Completed" }, data), /Record unavailable|Membership unavailable|row-level security/);
    assert.deepEqual(await stored("work_orders", data.id), data);
    assert.deepEqual(await stored("memberships", "member-one"), booked.membership);
  });
}

test("the established owner permission override still allows a paired booking", async () => {
  await pg.exec(`update profiles set role='owner', permissions='{"schedule":false,"memberships":false}'`);
  assert.equal((await schedule()).membership.springVisit.workOrderId, "job-one");
});

for (const status of ["Cancelled", "Expired", "Paused"]) {
  test(`a ${status.toLowerCase()} membership cannot book a new visit`, async () => {
    const original = await seedMembership({ status });
    await assert.rejects(schedule(), /Only active Crown Care memberships/);
    await assertNothingBooked(original);
  });
}

for (const status of ["Cancelled", "Expired"]) {
  test(`a cancelled job cannot reclaim a slot after its membership becomes ${status.toLowerCase()}`, async () => {
    const original = job();
    await schedule(original);
    const cancelled = { ...original, status: "Cancelled" };
    await save(cancelled, original);
    const inactive = await seedMembership({ ...(await stored("memberships", "member-one")), status });
    await assert.rejects(save(original, cancelled), /Only active Crown Care memberships/);
    assert.deepEqual(await stored("work_orders", original.id), cancelled);
    assert.deepEqual(await stored("memberships", "member-one"), inactive);
  });

  test(`an existing scheduled job can finish its lifecycle after its membership becomes ${status.toLowerCase()}`, async () => {
    const original = job();
    await schedule(original);
    await seedMembership({ ...(await stored("memberships", "member-one")), status });
    const rescheduled = { ...original, scheduledDate: "2026-10-19", scheduledTime: "11:15" };
    await save(rescheduled, original);
    await save({ ...rescheduled, status: "Completed" }, rescheduled);
    const member = (await stored("memberships", "member-one"))!;
    assert.equal(member.status, status);
    assert.equal(member.springVisit.status, "Completed");
    assert.equal(member.springVisit.scheduledDate, rescheduled.scheduledDate);
    assert.equal(member.visitsUsed, 1);
    await assert.rejects(schedule(job({ id: "fall-job", membershipSeason: "fall" })), /Only active Crown Care memberships/);
    assert.deepEqual(await stored("memberships", "member-one"), member);
  });
}

test("deleted and missing memberships cannot be booked", async () => {
  const original = await seedMembership({ deletedAt: "2026-09-01T00:00:00Z" });
  await assert.rejects(schedule(), /Membership unavailable/);
  await assert.rejects(schedule(job({ membershipId: "missing-member" })), /Membership unavailable/);
  await assertNothingBooked(original);
});

for (const status of ["Scheduled", "Completed", "In Progress"]) {
  test(`legacy ${status.toLowerCase()} seasonal history without a job link cannot be overwritten`, async () => {
    const original = await seedMembership({
      visitsUsed: status === "Completed" ? 1 : 0,
      springVisit: { status, scheduledDate: "2026-03-01", completedAt: "2026-03-01T12:00:00Z", notes: "Legacy history" },
    });
    await assert.rejects(schedule(), /already scheduled or completed/);
    await assertNothingBooked(original);
  });
}

test("an existing seasonal job link blocks replacement even if its display status is Unscheduled", async () => {
  const original = await seedMembership({ springVisit: { status: "Unscheduled", workOrderId: "existing-job" } });
  await assert.rejects(schedule(), /already scheduled or completed/);
  await assertNothingBooked(original);
});

for (const springVisit of [undefined, null, { status: "Not Scheduled" }]) {
  test(`an empty or legacy unbooked seasonal slot is bookable: ${JSON.stringify(springVisit)}`, async () => {
    await seedMembership({ springVisit });
    assert.equal((await schedule()).membership.springVisit.workOrderId, "job-one");
  });
}

test("rescheduling synchronizes date, time and technician while preserving scope and membership metadata", async () => {
  const original = job({ technician: "Alex Technician" });
  const booked = await schedule(original);
  const revised = { ...original, scheduledDate: "2026-10-12", scheduledTime: "13:45", technician: "Morgan Technician", durationMinutes: 90 };
  assert.deepEqual(await save(revised, original), revised);
  const member = (await stored("memberships", "member-one"))!;
  assert.deepEqual(member.springVisit, {
    ...booked.membership.springVisit, scheduledDate: revised.scheduledDate,
    scheduledTime: revised.scheduledTime, technician: revised.technician,
  });
  assert.deepEqual(member.fallVisit, booked.membership.fallVisit);
  assert.deepEqual(member.pricing, booked.membership.pricing);
  assert.equal(member.notes, booked.membership.notes);
  assert.equal(member.visitsUsed, 0);
  assert.deepEqual((await stored("work_orders", original.id))?.selectedAddOns, ["filter"]);
  await assert.rejects(save({ ...original, notes: "Stale edit" }, original), /record changed/i);
  assert.deepEqual(await stored("memberships", "member-one"), member);
});

test("removing an assigned technician also clears the seasonal assignment", async () => {
  const original = job({ technician: "Alex Technician" });
  await schedule(original);
  const revised = { ...original };
  delete revised.technician;
  await save(revised, original);
  assert.equal(Object.hasOwn((await stored("memberships", "member-one"))!.springVisit, "technician"), false);
});

test("completion is counted once; reopening and recompleting adjust only the linked visit", async () => {
  await seedMembership({ visitsUsed: 4 });
  const original = job();
  await schedule(original);
  const completed = { ...original, status: "Completed", completedAt: "2026-10-08T15:30:00Z" };
  await save(completed, original);
  await save(completed, original); // Network retry has the old previous snapshot.
  let member = (await stored("memberships", "member-one"))!;
  assert.equal(member.visitsUsed, 5);
  assert.equal(member.springVisit.status, "Completed");
  assert.equal(member.springVisit.completedAt, completed.completedAt);
  const editedCompletion = { ...completed, notes: "Completion notes amended" };
  await save(editedCompletion, completed);
  assert.equal((await stored("memberships", "member-one"))?.visitsUsed, 5);
  assert.equal((await stored("memberships", "member-one"))?.springVisit.completedAt, completed.completedAt);
  const reopened = { ...editedCompletion, status: "In Progress" };
  await save(reopened, editedCompletion);
  member = (await stored("memberships", "member-one"))!;
  assert.equal(member.visitsUsed, 4);
  assert.equal(member.springVisit.status, "Scheduled");
  assert.equal(Object.hasOwn(member.springVisit, "completedAt"), false);
  await save({ ...reopened, status: "Completed" }, reopened);
  assert.equal((await stored("memberships", "member-one"))?.visitsUsed, 5);
});

test("completing both seasons counts two visits and reopening one leaves the other complete", async () => {
  const spring = job();
  const fall = job({ id: "fall-job", membershipSeason: "fall" });
  await schedule(spring);
  await schedule(fall);
  const springCompleted = { ...spring, status: "Completed" };
  await save(springCompleted, spring);
  await save({ ...fall, status: "Completed" }, fall);
  const complete = (await stored("memberships", "member-one"))!;
  assert.equal(complete.visitsUsed, 2);
  assert.ok(complete.springVisit.completedAt);
  assert.ok(complete.fallVisit.completedAt);
  await save(spring, springCompleted);
  const reopened = (await stored("memberships", "member-one"))!;
  assert.equal(reopened.visitsUsed, 1);
  assert.deepEqual(reopened.fallVisit, complete.fallVisit);
});

test("reopening a completed visit cannot drive an inconsistent legacy usage count below zero", async () => {
  const original = job();
  await schedule(original);
  const completed = { ...original, status: "Completed" };
  await save(completed, original);
  await seedMembership({ ...(await stored("memberships", "member-one")), visitsUsed: 0 });
  await save(original, completed);
  assert.equal((await stored("memberships", "member-one"))?.visitsUsed, 0);
});

test("cancel and rebook releases the slot; later edits to the old cancelled job cannot reclaim it", async () => {
  const original = job({ technician: "Alex Technician" });
  await schedule(original);
  const cancelled = { ...original, status: "Cancelled" };
  await save(cancelled, original);
  assert.deepEqual((await stored("memberships", "member-one"))?.springVisit, membership().springVisit);
  await save(cancelled, original);
  const replacement = job({ id: "replacement-job", scheduledDate: "2026-10-15" });
  const rebooked = await schedule(replacement);
  const amended = { ...cancelled, notes: "Customer requested the cancellation" };
  await save(amended, cancelled);
  assert.deepEqual(await stored("memberships", "member-one"), rebooked.membership);
  assert.deepEqual(await stored("work_orders", original.id), amended);
  await assert.rejects(save({ ...amended, status: "Scheduled" }, amended), /already scheduled or completed/);
  assert.deepEqual(await stored("memberships", "member-one"), rebooked.membership);
  assert.deepEqual(await stored("work_orders", replacement.id), replacement);
});

test("cancelling a completed visit reverses its usage exactly once", async () => {
  const original = job();
  await schedule(original);
  const completed = { ...original, status: "Completed" };
  await save(completed, original);
  const cancelled = { ...completed, status: "Cancelled" };
  await save(cancelled, completed);
  await save({ ...cancelled, notes: "Keep cancellation history" }, cancelled);
  assert.equal((await stored("memberships", "member-one"))?.visitsUsed, 0);
  assert.deepEqual((await stored("memberships", "member-one"))?.springVisit, membership().springVisit);
});

for (const status of ["Unscheduled", "Needs Follow-up"]) {
  test(`${status} preserves the job link but clears the appointment and prevents duplicate booking`, async () => {
    const original = job({ technician: "Alex Technician" });
    await schedule(original);
    await save({ ...original, status }, original);
    assert.deepEqual((await stored("memberships", "member-one"))?.springVisit,
      { ...membership().springVisit, workOrderId: original.id });
    await assert.rejects(schedule(job({ id: "duplicate-job" })), /already scheduled or completed/);
  });
}

for (const change of [
  { membershipId: "another-member" }, { membershipSeason: "fall" },
  { membershipId: null }, { membershipSeason: null }, { customerId: "customer-two" },
]) {
  test(`saved Crown Care linkage cannot be changed: ${JSON.stringify(change)}`, async () => {
    const original = job();
    const booked = await schedule(original);
    await assert.rejects(save({ ...original, ...change }, original), /cannot change|cannot be reassigned/);
    assert.deepEqual(await stored("work_orders", original.id), original);
    assert.deepEqual(await stored("memberships", "member-one"), booked.membership);
  });
}

for (const field of ["id", "company_id", "customer_id"]) {
  test(`direct database updates cannot change linked job ${field}`, async () => {
    const original = job();
    const booked = await schedule(original);
    await assert.rejects(employeeQuery(`update work_orders set ${field}=$1 where id=$2`, ["changed", original.id]), /cannot change/);
    assert.deepEqual(await stored("work_orders", original.id), original);
    assert.deepEqual(await stored("memberships", "member-one"), booked.membership);
  });
}

test("linked work orders cannot be deleted, including after cancellation", async () => {
  const original = job();
  await schedule(original);
  await assert.rejects(employeeQuery("delete from work_orders where id=$1", [original.id]), /Cancel linked Crown Care jobs/);
  const cancelled = { ...original, status: "Cancelled" };
  await save(cancelled, original);
  await assert.rejects(employeeQuery("delete from work_orders where id=$1", [original.id]), /Cancel linked Crown Care jobs/);
  assert.deepEqual(await stored("work_orders", original.id), cancelled);
});

for (const change of [
  { scheduledDate: undefined }, { scheduledDate: null }, { scheduledDate: "" },
  { scheduledDate: "2026-2-03" }, { scheduledDate: "2026-02-30" },
  { scheduledDate: "2026-13-01" }, { scheduledDate: "2026-10-08T09:30:00Z" },
  { scheduledTime: undefined }, { scheduledTime: null }, { scheduledTime: "" },
  { scheduledTime: "9:30" }, { scheduledTime: "24:00" }, { scheduledTime: "12:60" },
  { scheduledTime: "09:30:00" },
]) {
  test(`invalid or missing appointment data cannot book either record: ${JSON.stringify(change)}`, async () => {
    await assert.rejects(schedule(job(change)), /valid appointment date and time|date\/time field value out of range/);
    await assertNothingBooked();
  });
}

for (const change of [
  { membershipId: undefined }, { membershipId: null }, { membershipId: "" }, { membershipId: "  " },
  { membershipSeason: undefined }, { membershipSeason: null }, { membershipSeason: "winter" },
  { membershipSeason: "Spring" },
]) {
  test(`invalid or incomplete structured linkage fails in both entry points: ${JSON.stringify(change)}`, async () => {
    await assert.rejects(schedule(job(change)), /Choose a membership, seasonal visit, and appointment/);
    await assert.rejects(save(job(change)), /Choose a Crown Care membership and spring or fall visit/);
    await assertNothingBooked();
  });
}

test("the booking entry point requires Scheduled status, while generic linked saves reject unknown statuses", async () => {
  await assert.rejects(schedule(job({ status: "Completed" })), /Choose a membership, seasonal visit, and appointment/);
  await assert.rejects(save(job({ status: "Unknown" })), /Invalid Crown Care job status/);
  await assertNothingBooked();
});

test("direct linked inserts validate JSON identity against the row identity", async () => {
  for (const data of [job({ id: "mismatched-id" }), job({ customerId: "customer-two" })]) {
    await assert.rejects(employeeQuery(`insert into work_orders(id,company_id,customer_id,data)
      values('job-one','airking','customer-one',$1)`, [JSON.stringify(data)]), /Invalid Crown Care job identity/);
  }
  await assertNothingBooked();
});

test("generic unlinked jobs and legacy description-only Crown Care jobs preserve their normal lifecycle", async () => {
  const original = job({ description: "Crown Care spring visit, member-one (legacy free text)" });
  delete original.membershipId;
  delete original.membershipSeason;
  delete original.scheduledTime;
  await save(original);
  const completed = { ...original, status: "Completed" };
  await save(completed, original);
  assert.deepEqual(await stored("work_orders", original.id), completed);
  assert.deepEqual(await stored("memberships", "member-one"), membership());
  await employeeQuery("delete from work_orders where id=$1", [original.id]);
  await assertNothingBooked();
});

test("a generic confirmed save of a structured visit synchronizes the paired membership", async () => {
  const data = job({ membershipSeason: "fall" });
  assert.deepEqual(await save(data), data);
  assert.equal((await stored("memberships", "member-one"))?.fallVisit.workOrderId, data.id);
  assert.equal((await stored("memberships", "member-one"))?.fallVisit.status, "Scheduled");
});

test("a conflicting second booking in one confirmed batch rolls back the first booking as well", async () => {
  const jobs = [job({ id: "first-job" }), job({ id: "conflicting-job" })];
  await assert.rejects(employeeQuery("select crm_save_records($1)", [JSON.stringify(jobs.map((data) => ({
    table: "work_orders", id: data.id, data,
  })))]), /already scheduled or completed/);
  await assertNothingBooked();
});

test("queued competing booking calls produce one seasonal job (PGlite serializes sessions)", async () => {
  const results = await Promise.allSettled([
    schedule(job({ id: "first-job" })), schedule(job({ id: "second-job" })),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.match(String(failed.reason), /already scheduled or completed/);
  const rows = (await pg.query<{ id: string }>("select id from work_orders")).rows;
  assert.equal(rows.length, 1);
  assert.equal((await stored("memberships", "member-one"))?.springVisit.workOrderId, rows[0].id);
});

test("queued retries with the same job ID return the same confirmed pair (serialized PGlite)", async () => {
  const [first, second] = await Promise.all([schedule(), schedule()]);
  assert.deepEqual(first, second);
  assert.equal((await pg.query("select * from work_orders")).rows.length, 1);
});

test("both new functions execute as invoker and anonymous users cannot call the booking RPC", async () => {
  const functions = await pg.query<{ prosecdef: boolean }>(`select prosecdef from pg_proc
    where oid in ('crm_private.sync_crown_visit()'::regprocedure,
      'public.crm_schedule_crown_visit(jsonb)'::regprocedure)`);
  assert.deepEqual(functions.rows.map((row) => row.prosecdef), [false, false]);
  await assert.rejects(pg.transaction(async (tx) => {
    await tx.exec("set local role anon");
    await tx.query("select crm_schedule_crown_visit($1)", [JSON.stringify(job())]);
  }), /permission denied/);
  await assertNothingBooked();
});
