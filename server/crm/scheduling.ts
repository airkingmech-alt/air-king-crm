import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller, db, result, entity, hash } from "./core";
import { conflictingJobs, scheduleChange } from "../../shared/scheduling";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  try { await fn(req, res); }
  catch (e: any) { res.status(e.status || 400).json({ error: e instanceof z.ZodError ? "Check the appointment date, time, and duration." : e.message }); }
};
async function access(req: Request) {
  const user = await caller(req);
  const profile = await result(db().from("profiles").select("permissions").eq("id", user.id).single());
  if (user.role !== "owner" && profile.permissions?.schedule === false)
    throw Object.assign(new Error("Schedule access is disabled. Ask the owner."), { status: 403 });
  return user;
}
async function companyJobs(company: string) {
  const rows: any[] = [];
  for (let start = 0; start < 50000; start += 500) {
    const page = await result(db().from("work_orders").select("id,data,updated_at")
      .eq("company_id",company).order("id").range(start,start+499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  throw new Error("There are too many jobs to load safely. Contact the administrator.");
}
export function registerScheduling(app: Express) {
  app.get("/api/scheduling", wrap(async (req, res) => {
    const user = await access(req);
    const [jobs, people] = await Promise.all([
      companyJobs(user.company),
      result(db().from("profiles").select("id,full_name,role").eq("company_id", user.company)
        .in("role", ["owner", "admin", "technician", "dispatcher"]).order("full_name")),
    ]);
    res.json({ jobs: jobs.map((row: any) => ({...row, version: hash(JSON.stringify(row.data))})), people, timezone: "America/Chicago" });
  }));
  app.patch("/api/scheduling/:id", wrap(async (req, res) => {
    const user = await access(req);
    const body = z.object({ change: scheduleChange, version: z.string(), allowConflict: z.boolean().default(false) }).parse(req.body);
    const row = await entity("work_orders", String(req.params.id), user.company);
    if (["Completed", "Cancelled"].includes(row.data.status)) throw new Error("Closed jobs cannot be moved.");
    if (hash(JSON.stringify(row.data)) !== body.version) throw Object.assign(new Error("This job changed. Refresh and try again."), { status: 409 });
    if (body.change.technicianId) {
      const person = await result(db().from("profiles").select("full_name").eq("company_id", user.company)
        .eq("id", body.change.technicianId).in("role", ["owner","admin","technician","dispatcher"]).maybeSingle());
      if (!person?.full_name) throw new Error("Choose an active team member.");
      body.change.technician = person.full_name;
    } else if (body.change.technician && body.change.technician !== row.data.technician) {
      throw new Error("Choose a team member from the list.");
    }
    const data = { ...row.data, ...body.change, status: row.data.status === "Unscheduled" || row.data.status === "Needs Follow-up" ? "Scheduled" : row.data.status,
      scheduleHistory: [...(row.data.scheduleHistory || []), { actorId:user.id, at:new Date().toISOString(), before:{scheduledDate:row.data.scheduledDate,scheduledTime:row.data.scheduledTime,durationMinutes:row.data.durationMinutes,technician:row.data.technician}, after:body.change, conflictOverride:body.allowConflict }] };
    const others = await companyJobs(user.company);
    const conflicts = conflictingJobs({ ...data, id: row.id }, others.map((r: any) => ({ ...r.data, id: r.id })));
    if (conflicts.length && !body.allowConflict) return res.status(409).json({ error: "This technician already has an overlapping job. Review the conflict before saving.", conflicts: conflicts.map(c => ({ id: c.id, customerName: c.customerName })) });
    const updated = await result(db().from("work_orders").update({ data, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("company_id", user.company).eq("updated_at", row.updated_at).select("id,data,updated_at").maybeSingle());
    if (!updated) throw Object.assign(new Error("This job changed. Refresh and try again."), { status: 409 });
    res.json({ job: updated });
  }));
}
