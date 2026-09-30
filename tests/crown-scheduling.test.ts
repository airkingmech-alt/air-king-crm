import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { crownVisitLink, canBookCrownVisit } from "../shared/crown-scheduling";
import { saveCrownVisit } from "../client/src/lib/crown-scheduling";
import type { WorkOrder } from "../client/src/data/mock-data";

const job: WorkOrder = { id: "WO-test", customerId: "customer", customerName: "Test Customer", property: "Test property",
  type: "Fall Tune-Up (Heating)", description: "Synthetic test", status: "Scheduled", priority: "Normal",
  membershipId: "CC-test", membershipSeason: "fall", scheduledDate: "2026-10-01", scheduledTime: "09:00" };
const confirmed = { workOrder: job, membership: { id: "CC-test", fallVisit: { status: "Scheduled", workOrderId: "WO-test" } } };

test("Crown Care booking requires a structured season and valid explicit appointment", () => {
  assert.equal(crownVisitLink.safeParse(job).success, true);
  for (const patch of [{ membershipId: undefined }, { membershipSeason: undefined }, { membershipSeason: "winter" },
    { scheduledDate: "2026-02-30" }, { scheduledDate: "" }, { scheduledTime: "25:00" }, { scheduledTime: undefined }]) {
    assert.equal(crownVisitLink.safeParse({ ...job, ...patch }).success, false);
  }
});

test("only unowned unscheduled seasonal slots are bookable", () => {
  assert.equal(canBookCrownVisit(), true);
  assert.equal(canBookCrownVisit({ status: "Unscheduled" }), true);
  assert.equal(canBookCrownVisit({ status: "Not Scheduled" }), true);
  for (const visit of [{ status: "Completed" }, { status: "Scheduled" }, { status: "Unscheduled", workOrderId: "existing" }]) {
    assert.equal(canBookCrownVisit(visit), false);
  }
});

test("client awaits paired confirmation and preserves the same work order on retry", async () => {
  let finish!: (result: any) => void;
  let settled = false;
  const pending = saveCrownVisit((name, args) => {
    assert.equal(name, "crm_schedule_crown_visit");
    assert.deepEqual(args.p_work_order, job);
    return new Promise(resolve => { finish = resolve; });
  }, job).then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish({ data: confirmed, error: null });
  assert.deepEqual(await pending, confirmed);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await saveCrownVisit(async (_, args) => {
      assert.equal(args.p_work_order.id, job.id);
      return { data: confirmed, error: null };
    }, job), confirmed);
  }
});

test("missing migration, rejected transaction, and unconfirmed response never report success", async () => {
  for (const message of ["function crm_schedule_crown_visit not found", "Membership unavailable", "This seasonal visit is already scheduled"]) {
    await assert.rejects(saveCrownVisit(async () => ({ data: null, error: { message } }), job), new RegExp(message));
  }
  for (const data of [null, { workOrder: job }, { ...confirmed, membership: { id: "CC-other" } },
    { ...confirmed, membership: { id: "CC-test", fallVisit: { status: "Unscheduled" } } }]) {
    await assert.rejects(saveCrownVisit(async () => ({ data, error: null }), job), /could not be confirmed/);
  }
});

test("schedule dialog guards pending dismissal and exposes a return path after Skip", async () => {
  const source = await readFile("client/src/pages/crown-care.tsx", "utf8");
  assert.match(source, /if \(!form.customer \|\| !enrolledMembershipId \|\| saveLock.current\) return/);
  assert.match(source, /const closeEnrollDialog = \(\) => \{\s+if\(saveLock.current\)return/);
  assert.match(source, /form onSubmit=\{handleScheduleVisit\}[^>]*><fieldset disabled=\{saving\}/);
  assert.match(source, /onClick=\{\(\) => openScheduleVisit\(m\)\}/);
  const context = await readFile("client/src/context/data-context.tsx", "utf8");
  assert.match(context, /crownVersion === crownMutationVersion.current/);
  assert.match(context, /crownMutationVersion.current\+\+;/);
  assert.match(source, /membershipSeason: scheduleForm.visitType === "Spring Tune-Up \(Cooling\)" \? "spring" : "fall"/);
});
