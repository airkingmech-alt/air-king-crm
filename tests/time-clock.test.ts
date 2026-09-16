import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { dateBoundary, duration, elapsedMs, localTime, shiftDay, timeCandidates, weekStart } from "../shared/time-clock";
const pg = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const tech = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const foreign = "44444444-4444-4444-8444-444444444444";
async function sql(q: string, p: any[] = []): Promise<any[]> { return (await pg.query(q, p)).rows; }
async function write(action: string, data: any = {}, actor = tech, key = randomUUID()) {
  return (await sql("select time_clock_write($1,$2,$3,$4) entry", [actor, action, key, data]))[0].entry;
}
const missed = (day: string, extra = {}) => ({ employee_id: tech, clock_in: `${day}T13:00:00Z`, clock_out: `${day}T21:00:00Z`, notes: "Service calls", reason: "Forgot to clock in", ...extra });
before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,company_id text,role text,permissions jsonb default '{}');
    insert into profiles(id,company_id,role) values('${owner}','airking','owner'),('${tech}','airking','technician'),('${other}','airking','dispatcher'),('${foreign}','foreign','owner');`);
  await pg.exec(await readFile("supabase/migrations/20260916215625_employee_time_clock.sql", "utf8"));
});
after(() => pg.close());

test("clock punches use server time; retries produce one entry and one audit per operation", async () => {
  const key = randomUUID();
  const entry = await write("clock_in", {}, tech, key);
  assert.ok(Math.abs(Date.now() - Date.parse(entry.clock_in)) < 5000);
  assert.equal(entry.clock_out, null);
  assert.deepEqual(await write("clock_in", {}, tech, key), entry);
  await assert.rejects(write("clock_in"), /already clocked in/);
  const outKey = randomUUID(), payload = { id: entry.id, version: entry.version };
  const closed = await write("clock_out", payload, tech, outKey);
  assert.ok(Date.parse(closed.clock_out) > Date.parse(entry.clock_in));
  assert.equal(closed.version, 2);
  assert.deepEqual(await write("clock_out", payload, tech, outKey), closed);
  assert.equal((await sql("select count(*)::int n from employee_time_events where entry_id=$1", [entry.id]))[0].n, 2);
  await assert.rejects(write("clock_out", payload), /changed/);
});

test("own correction records original times, name reference, reason, and optimistic version", async () => {
  const entry = await write("create", missed("2026-01-05"));
  const payload = { id: entry.id, version: entry.version, clock_in: "2026-01-05T14:00:00Z", clock_out: entry.clock_out, notes: "Corrected", reason: "Started one hour later" };
  const changed = await write("edit", payload);
  assert.equal(changed.version, 2);
  const audit = (await sql("select * from employee_time_events where entry_id=$1 and action='edit'", [entry.id]))[0];
  assert.equal(audit.actor_id, tech);
  assert.deepEqual(audit.before_data, entry);
  assert.deepEqual(audit.after_data, changed);
  assert.equal(audit.reason, payload.reason);
  await assert.rejects(write("edit", payload), /changed/);
  assert.equal((await sql("select count(*)::int n from employee_time_events where entry_id=$1", [entry.id]))[0].n, 2);
});

test("staff cannot edit coworkers or another company; owner can correct own company", async () => {
  const entry = await write("create", missed("2026-01-06"));
  const payload = { id: entry.id, version: 1, clock_in: entry.clock_in, clock_out: entry.clock_out, notes: "", reason: "Manager reviewed times" };
  await assert.rejects(write("edit", payload, other), /own time/);
  await assert.rejects(write("edit", payload, foreign), /not found/);
  assert.equal((await write("edit", payload, owner)).version, 2);
  await assert.rejects(write("create", missed("2026-01-07", { employee_id: foreign }), owner), /not found/);
});

test("invalid, future, overlapping, and incomplete shifts leave no audit or entry", async () => {
  const entry = await write("create", missed("2026-01-08"));
  await assert.rejects(write("create", missed("2026-01-08")), /overlap/);
  await assert.rejects(write("create", missed("2026-01-09", { clock_out: null })), /both times/);
  await assert.rejects(write("create", missed("2099-01-09")), /past times/);
  await assert.rejects(write("create", missed("2026-01-09", { clock_out: "2026-01-09T12:00:00Z" })), /after clock in/);
  await assert.rejects(write("create", missed("2026-01-09", { reason: "" })), /reason/);
  await assert.rejects(write("edit", { id: entry.id, version: 1, clock_in: entry.clock_in, clock_out: null, reason: "Reopen", notes: "" }), /must have a clock-out/);
  // Adjacent shifts are allowed (e.g. clocking out for an unpaid break).
  const adjacent = await write("create", missed("2026-01-08", { clock_in: "2026-01-08T21:00:00Z", clock_out: "2026-01-08T22:00:00Z" }));
  assert.ok(adjacent.id);
});

test("reused keys cannot create a different shift", async () => {
  const key = randomUUID();
  const data = missed("2026-01-12");
  const entry = await write("create", data, tech, key);
  assert.deepEqual(await write("create", data, tech, key), entry);
  await assert.rejects(write("create", missed("2026-01-13"), tech, key), /already used/);
});

test("employee can correct a forgotten clock-out without starting a new shift", async () => {
  const entry = await write("clock_in", {}, other);
  const corrected = await write("edit", { id: entry.id, version: 1, clock_in: "2026-01-14T13:00:00Z", clock_out: "2026-01-14T21:00:00Z", notes: "", reason: "Forgot to clock out yesterday" }, other);
  assert.equal(corrected.clock_out.slice(0,10), "2026-01-14");
  assert.equal((await sql("select count(*)::int n from employee_time_entries where employee_id=$1 and clock_out is null", [other]))[0].n, 0);
});

test("an old clock-out request cannot stop a newer running shift", async () => {
  const first = await write("clock_in", {}, other);
  await write("clock_out", { id: first.id, version: 1 }, other);
  const second = await write("clock_in", {}, other);
  await assert.rejects(write("clock_out", { id: first.id, version: 1 }, other), /changed/);
  assert.equal((await sql("select clock_out from employee_time_entries where id=$1", [second.id]))[0].clock_out, null);
  await write("clock_out", { id: second.id, version: 1 }, other);
});

test("permissions are enforced inside the transaction, with owner override", async () => {
  await sql("update profiles set permissions=$1 where id=$2", [{ time_clock_edit_own: false }, tech]);
  await assert.rejects(write("create", missed("2026-01-15")), /Ask an owner/);
  const running = await write("clock_in");
  await write("clock_out", { id: running.id, version: 1 });
  await write("create", missed("2026-01-15"), owner);
  await sql("update profiles set permissions=$1 where id=$2", [{ time_clock: false }, tech]);
  await assert.rejects(write("clock_in"), /access is disabled/);
  await sql("update profiles set permissions='{}' where id=$1", [tech]);
  await assert.rejects(write("clock_in", {}, randomUUID()), /Staff access/);
});

test("browser database roles cannot read time records, edit history, or call privileged RPC", async () => {
  for (const role of ["anon","authenticated"]) {
    await pg.exec(`set role ${role}`);
    try {
      await assert.rejects(sql("select * from employee_time_entries"), /permission denied/);
      await assert.rejects(sql("select * from employee_time_events"), /permission denied/);
      await assert.rejects(write("clock_in"), /permission denied/);
    } finally { await pg.exec("reset role"); }
  }
  assert.equal((await sql("select relrowsecurity from pg_class where oid='employee_time_entries'::regclass"))[0].relrowsecurity, true);
  assert.equal((await sql("select has_table_privilege('service_role','employee_time_events','UPDATE') allowed"))[0].allowed, false);
});

test("Central time handles overnight shifts, date boundaries, and daylight saving gaps/repeats", () => {
  assert.equal(localTime("2026-07-01T13:00:00Z"), "2026-07-01T08:00:00");
  assert.equal(dateBoundary("2026-01-05"), "2026-01-05T06:00:00.000Z");
  assert.equal(weekStart(Date.parse("2026-09-20T18:00:00Z")), "2026-09-14");
  assert.equal(shiftDay("2026-01-31",1), "2026-02-01");
  assert.deepEqual(timeCandidates("2026-03-08T02:30"), []);
  assert.deepEqual(timeCandidates("2026-11-01T01:30"), ["2026-11-01T06:30:00.000Z","2026-11-01T07:30:00.000Z"]);
  assert.deepEqual(timeCandidates("2026-02-30T12:00"), []);
  const entry = { clock_in: "2026-01-05T04:00:00Z", clock_out: "2026-01-05T14:00:00Z" };
  assert.equal(duration(elapsedMs(entry, Date.now())), "10h 00m");
  assert.equal(duration(elapsedMs(entry, Date.now(), Date.parse(dateBoundary("2026-01-05")))), "8h 00m");
  assert.equal(duration(elapsedMs({ clock_in: "2026-11-01T06:30:00Z", clock_out: "2026-11-01T07:30:00Z" }, Date.now())), "1h 00m");
});
