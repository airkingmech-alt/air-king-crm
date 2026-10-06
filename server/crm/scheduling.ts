import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller, db, result, entity, hash } from "./core";
import { scheduleChange } from "../../shared/scheduling";

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
  return { ...user, permissions: profile.permissions };
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
const newWorkOrder = z.object({
  id: z.string().trim().min(1).max(200), customerId: z.string().trim().min(1).max(200),
  customerName: z.string().trim().min(1).max(300), property: z.string().max(1000),
  type: z.string().trim().min(1).max(200), description: z.string().max(20000),
  projectName: z.string().max(200).optional(),
  status: z.enum(["Scheduled", "Unscheduled"]), priority: scheduleChange.shape.priority.default("Normal"),
  scheduledDate: scheduleChange.shape.scheduledDate.optional(), scheduledTime: scheduleChange.shape.scheduledTime.optional(),
  durationMinutes: scheduleChange.shape.durationMinutes.default(60),
  technician: scheduleChange.shape.technician.optional(), technicianId: scheduleChange.shape.technicianId,
}).strict().refine(job => (!job.scheduledDate && !job.scheduledTime && job.status === "Unscheduled") ||
  Boolean(job.scheduledDate && job.scheduledTime), "Choose an appointment date and time.");

async function resolveTechnician(company: string, change: { technician?: string; technicianId?: string | null }) {
  if (!change.technicianId && !change.technician?.trim()) {
    change.technician = ""; change.technicianId = null;
    return;
  }
  let query = db().from("profiles").select("id,full_name").eq("company_id", company)
    .in("role", ["owner", "admin", "technician", "dispatcher"]);
  // Resolve legacy name selections only when exactly one active team member matches.
  if (change.technicianId) query = query.eq("id", change.technicianId);
  const people = await result(query);
  const matches = people.filter((person: any) => person.full_name?.trim() &&
    (change.technicianId || person.full_name.trim().toLowerCase() === change.technician?.trim().toLowerCase()));
  if (matches.length !== 1) throw new Error("Choose an active team member from the list. Duplicate names require a team member ID.");
  change.technician = matches[0].full_name; change.technicianId = matches[0].id;
}
async function writeScheduledJob(user: { id: string; company: string }, data: any, create: boolean, expected?: string, allowConflict = false) {
  const { data: saved, error } = await db().rpc("crm_write_scheduled_work_order", {
    p_actor_id: user.id, p_company_id: user.company, p_work_order: data,
    p_create: create, p_expected_updated_at: expected || null, p_allow_conflict: allowConflict,
  });
  if (error) throw Object.assign(new Error(error.message), {
    status: ["23P01", "40001", "40P01"].includes(error.code) ? 409 : error.code === "42501" ? 403 : 400,
  });
  if (!saved?.id || saved.id !== data.id || !saved.data) throw new Error("The job save could not be confirmed. Refresh before trying again.");
  return saved;
}
export function registerScheduling(app: Express) {
  app.get("/api/scheduling", wrap(async (req, res) => {
    const user = await access(req);
    const [jobs, people] = await Promise.all([
      companyJobs(user.company),
      result(db().from("profiles").select("id,full_name,role").eq("company_id", user.company)
        .in("role", ["owner", "admin", "technician", "dispatcher"]).order("full_name")),
    ]);
    res.json({ jobs: jobs.filter((row: any) => !row.data?.deletedAt).map((row: any) => ({...row, version: hash(JSON.stringify(row.data))})), people, timezone: "America/Chicago" });
  }));
  app.post("/api/scheduling", wrap(async (req, res) => {
    const user = await access(req);
    const data = newWorkOrder.parse(req.body?.workOrder);
    await resolveTechnician(user.company, data);
    const saved = await writeScheduledJob(user, data, true);
    res.status(201).json({ job: saved });
  }));
  app.patch("/api/scheduling/:id", wrap(async (req, res) => {
    const user = await access(req);
    const body = z.object({ change: scheduleChange, version: z.string(), allowConflict: z.boolean().default(false) }).parse(req.body);
    const row = await entity("work_orders", String(req.params.id), user.company);
    if (row.data.membershipId && user.role !== "owner" && user.permissions?.memberships === false)
      throw Object.assign(new Error("Crown Care access is disabled. Ask the owner."), { status: 403 });
    if (["Completed", "Cancelled"].includes(row.data.status)) throw new Error("Closed jobs cannot be moved.");
    if (hash(JSON.stringify(row.data)) !== body.version) throw Object.assign(new Error("This job changed. Refresh and try again."), { status: 409 });
    await resolveTechnician(user.company, body.change);
    const data = { ...row.data, ...body.change, status: row.data.status === "Unscheduled" || row.data.status === "Needs Follow-up" ? "Scheduled" : row.data.status,
      scheduleHistory: [...(row.data.scheduleHistory || []), { actorId:user.id, at:new Date().toISOString(), before:{scheduledDate:row.data.scheduledDate,scheduledTime:row.data.scheduledTime,durationMinutes:row.data.durationMinutes,technician:row.data.technician}, after:body.change, conflictOverride:body.allowConflict }] };
    const updated = await writeScheduledJob(user, data, false, row.updated_at, body.allowConflict);
    res.json({ job: updated });
  }));
}
