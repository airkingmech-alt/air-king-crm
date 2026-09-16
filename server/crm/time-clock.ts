import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller, db, result } from "./core";
import { dateBoundary, shiftDay, TIME_ZONE } from "../../shared/time-clock";

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clock_in") }).strict(),
  z.object({ action: z.literal("clock_out"), id: uuid, version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("create"), employee_id: uuid, clock_in: timestamp, clock_out: timestamp,
    notes: z.string().max(2000), reason: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal("edit"), id: uuid, version: z.number().int().positive(),
    clock_in: timestamp, clock_out: timestamp.nullable(), notes: z.string().max(2000),
    reason: z.string().trim().min(3).max(500) }).strict(),
]);
const failure = (message: string, status = 400) => Object.assign(new Error(message), { status });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  try { await fn(req, res); }
  catch (error: any) {
    const known = error.status || error instanceof z.ZodError;
    if (!known) console.error("Time clock request failed", error.code || error.name);
    res.status(error.status || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error instanceof z.ZodError ? "Please check the dates, times, and reason, then try again."
        : known ? error.message : "Unable to load or save your time. Refresh and try again.",
    });
  }
};
async function access(req: Request) {
  const user = await caller(req);
  const profile = await result(db().from("profiles").select("permissions, full_name").eq("id", user.id).single());
  if (user.role !== "owner" && profile.permissions?.time_clock === false)
    throw failure("Time Clock access is disabled. Ask the owner.", 403);
  return { ...user, manager: ["owner", "admin"].includes(user.role), profile };
}

export function registerTimeClock(app: Express) {
  app.get("/api/time-clock", wrap(async (req, res) => {
    const user = await access(req);
    const params = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), employee: z.union([uuid, z.literal("all")]).optional() }).parse(req.query);
    let from: string, to: string;
    try { from = dateBoundary(params.from); to = dateBoundary(shiftDay(params.to, 1)); }
    catch { throw failure("Choose valid dates."); }
    // Validate the inclusive end date too (Date normalizes February 30).
    try { dateBoundary(params.to); } catch { throw failure("Choose valid dates."); }
    const span = Date.parse(to) - Date.parse(from);
    if (span <= 0 || (Date.parse(params.to + "T00:00:00Z") - Date.parse(params.from + "T00:00:00Z")) >= 31 * 86400000) throw failure("Choose up to 31 days of time entries.");
    const employee = params.employee || user.id;
    if (!user.manager && employee !== user.id) throw failure("You can only view your own hours.", 403);
    let entriesQuery = db().from("employee_time_entries").select("*", { count: "exact" })
      .eq("company_id", user.company).lt("clock_in", to).or(`clock_out.gt.${from},clock_out.is.null`)
      .order("clock_in", { ascending: false }).limit(1000);
    if (employee !== "all") entriesQuery = entriesQuery.eq("employee_id", employee);
    const [entriesResult, active, people] = await Promise.all([
      entriesQuery,
      result(db().from("employee_time_entries").select("*").eq("company_id", user.company)
        .eq("employee_id", user.id).is("clock_out", null).maybeSingle()),
      user.manager ? result(db().from("profiles").select("id,full_name,role")
        .eq("company_id", user.company).in("role", ["owner","admin","technician","dispatcher"]).order("full_name"))
        : Promise.resolve([{ id: user.id, full_name: user.profile.full_name, role: user.role }]),
    ]);
    if (entriesResult.error) throw entriesResult.error;
    if ((entriesResult.count || 0) > 1000) throw failure("There are too many entries. Choose a shorter date range or one employee.");
    res.json({ entries: entriesResult.data, active, people, manager: user.manager,
      canEdit: user.manager || user.profile.permissions?.time_clock_edit_own !== false,
      from, to, timezone: TIME_ZONE, serverNow: new Date().toISOString() });
  }));

  app.get("/api/time-clock/:id/history", wrap(async (req, res) => {
    const user = await access(req);
    const id = uuid.parse(req.params.id);
    const entry = await result(db().from("employee_time_entries").select("employee_id")
      .eq("id", id).eq("company_id", user.company).maybeSingle());
    if (!entry || (!user.manager && entry.employee_id !== user.id)) throw failure("Time entry not found.", 404);
    const events = await result(db().from("employee_time_events")
      .select("id,actor_id,action,reason,before_data,after_data,created_at,actor:profiles!actor_id(full_name)")
      .eq("company_id", user.company).eq("entry_id", id).order("created_at", { ascending: false }).limit(100));
    res.json({ events, limit: 100 });
  }));

  app.post("/api/time-clock", wrap(async (req, res) => {
    const user = await access(req);
    const { action, ...data } = mutation.parse(req.body);
    const key = uuid.parse(req.headers["idempotency-key"]);
    const outcome = await db().rpc("time_clock_write", {
      p_actor: user.id, p_action: action, p_request: key, p_data: data,
    });
    if (outcome.error) {
      const code = outcome.error.code;
      if (["42501","22023","P0002","40001"].includes(code))
        throw failure(outcome.error.message, code === "42501" ? 403 : code === "P0002" ? 404 : code === "40001" ? 409 : 400);
      throw outcome.error;
    }
    res.json({ entry: outcome.data });
  }));
}
