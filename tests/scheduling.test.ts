import test from "node:test";
import assert from "node:assert/strict";
import { conflictingJobs, jobDuration, scheduleChange } from "../shared/scheduling";
const job = { id:"one", status:"Scheduled", scheduledDate:"2026-09-17", scheduledTime:"09:00", technician:"Colton", durationMinutes:60 };
test("schedule validates real dates, times, and duration", () => {
  assert.equal(scheduleChange.safeParse(job).success,true);
  for (const patch of [{scheduledDate:"2026-02-30"},{scheduledTime:"25:00"},{durationMinutes:0},{durationMinutes:1441}])
    assert.equal(scheduleChange.safeParse({...job,...patch}).success,false);
});
test("same technician overlaps warn; adjacent and different technicians do not", () => {
  assert.equal(conflictingJobs(job,[{...job,id:"two",scheduledTime:"09:30"}]).length,1);
  assert.equal(conflictingJobs(job,[{...job,id:"two",scheduledTime:"10:00"}]).length,0);
  assert.equal(conflictingJobs(job,[{...job,id:"two",technician:"Mike"}]).length,0);
  assert.equal(conflictingJobs(job,[{...job,id:"two",status:"Cancelled"}]).length,0);
  assert.equal(conflictingJobs(job,[job]).length,0);
});
test("overnight jobs and duration defaults", () => {
  assert.equal(conflictingJobs({...job, scheduledTime:"23:30",durationMinutes:120},[{...job,id:"two",scheduledDate:"2026-09-18",scheduledTime:"00:30"}]).length,1);
  assert.equal(jobDuration({laborHours:2}),120);
  assert.equal(jobDuration({}),60);
  assert.equal(jobDuration({durationMinutes:-10}),60);
});
