import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useQuery } from "@tanstack/react-query";
import { crm } from "@/lib/crm-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useData } from "@/context/data-context";
import { EquipmentScanner } from "./equipment-scanner";
import { conflictingJobs, jobDuration, jobStart } from "../../../shared/scheduling";
import "./dispatch-calendar.css";

const colors: Record<string,string> = { Scheduled: "#0369a1", Dispatched: "#7c3aed", "In Progress": "#b45309", Completed: "#047857", "Needs Follow-up": "#be123c" };
function businessNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`;
}
export function DispatchCalendar() {
  const { customers } = useData();
  const calendar = useRef<FullCalendar>(null);
  const { data, isPending, error, refetch } = useQuery({ queryKey: ["dispatch-calendar"], queryFn: () => crm("scheduling"), refetchInterval: 30000 });
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => { const refresh = () => { void refetch(); }; window.addEventListener("crm-refresh",refresh); return () => window.removeEventListener("crm-refresh",refresh); }, [refetch]);
  const jobs = (data?.jobs || []).map((r: any) => ({ ...r.data, id: r.id, version: r.version }));
  const open = (job: any) => {
    setSelected(job); setNotice("");
    setForm({ scheduledDate: job.scheduledDate || businessNow().slice(0,10), scheduledTime: job.scheduledTime || "09:00", durationMinutes: jobDuration(job), technician: job.technician || "", technicianId: job.technicianId || null });
  };
  async function save(job: any, change: any) {
    if (lock.current) throw new Error("Wait for the current change to finish.");
    lock.current = true; setBusy(true); setNotice("");
    try {
      const conflicts = conflictingJobs({ ...job, ...change }, jobs);
      let allowConflict = false;
      if (conflicts.length) {
        allowConflict = window.confirm(`Schedule conflict with ${conflicts.map(c => c.customerName).join(", ")}. Save this overlapping appointment anyway?`);
        if (!allowConflict) throw new Error("Change cancelled. Appointment was not moved.");
      }
      await crm(`scheduling/${encodeURIComponent(job.id)}`, "PATCH", { change, version: job.version, allowConflict });
      setNotice("Schedule saved."); setSelected(null);
      window.dispatchEvent(new Event("crm-refresh"));
    } finally { lock.current = false; setBusy(false); await refetch(); }
  }
  async function move(info: any) {
    const job = jobs.find((j: any) => j.id === info.event.id);
    try {
      if (!job || !info.event.start) throw new Error("Refresh the calendar and try again.");
      const start = info.event.start.toISOString();
      const duration = info.event.end ? (info.event.end.getTime() - info.event.start.getTime()) / 60000 : jobDuration(job);
      await save(job, { scheduledDate: start.slice(0, 10), scheduledTime: start.slice(11, 16), durationMinutes: duration, technician: job.technician || "", technicianId: job.technicianId || null });
    } catch (e: any) { info.revert(); setNotice(e.message); }
  }
  if (isPending) return <p role="status">Loading calendar…</p>;
  if (error) return <div role="alert">Unable to load the calendar. <Button onClick={() => refetch()}>Try Again</Button></div>;
  const closed = selected && ["Completed", "Cancelled"].includes(selected.status);
  return <section className="dispatch-calendar space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">Jump to date <Input type="date" className="w-auto" onChange={e => e.target.value && calendar.current?.getApi().gotoDate(e.target.value)} /></label>
      <label className="text-sm">Team member <select className="block rounded border p-2 bg-background" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">All team members</option><option value="unassigned">Unassigned</option>
        {Array.from(new Set<string>(jobs.map((j: any) => j.technician).filter(Boolean))).sort().map(name => <option key={name}>{name}</option>)}
      </select></label>
      <p className="text-xs text-muted-foreground">Central time · Drag to move; resize in Week or Day. On mobile, hold a job to drag or tap it to edit.</p>
    </div>
    <div className="flex flex-wrap gap-3 text-xs">{Object.entries(colors).map(([status,color]) => <span key={status} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{background:color}} />{status}</span>)}</div>
    {notice && <p role="status" className="rounded border p-3 text-sm">{notice}</p>}
    <FullCalendar ref={calendar} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView={window.innerWidth < 640 ? "timeGridDay" : "dayGridMonth"}
      initialDate={businessNow().slice(0,10)} now={businessNow}
      headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
      buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day" }}
      timeZone="UTC" height="auto" editable={!busy} allDaySlot={false} eventDurationEditable
      slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime="07:00:00" slotDuration="00:15:00" dayMaxEvents={4}
      longPressDelay={500} eventDrop={move} eventResize={move}
      eventClick={info => open(jobs.find((j: any) => j.id === info.event.id))}
      events={jobs.filter((j: any) => j.scheduledDate && Number.isFinite(jobStart(j)) && !["Cancelled", "Unscheduled"].includes(j.status)
        && (filter === "all" || (filter === "unassigned" ? !j.technician : j.technician === filter)))
        .map((j: any) => ({ id: j.id, title: `${j.customerName} · ${j.type}${j.technician ? " · " + j.technician : " · Unassigned"}`, start: new Date(jobStart(j)).toISOString(), end: new Date(jobStart(j) + jobDuration(j) * 60000).toISOString(), backgroundColor: colors[j.status] || "#475569", borderColor: colors[j.status] || "#475569", editable: !busy && !["Completed", "Cancelled"].includes(j.status) }))} />
    <div className="rounded-lg border p-3"><h3 className="font-semibold">Ready to schedule</h3><div className="flex flex-wrap gap-2 mt-2">
      {jobs.filter((j: any) => ["Unscheduled", "Needs Follow-up"].includes(j.status)).map((j: any) => <Button key={j.id} variant="outline" onClick={() => open(j)}>{j.customerName} · {j.type}</Button>)}
    </div></div>
    <Dialog open={!!selected} onOpenChange={v => !busy && !v && setSelected(null)}><DialogContent><DialogHeader><DialogTitle>{selected?.customerName} · {selected?.type}</DialogTitle></DialogHeader>
      <p className="text-sm">{selected?.property}</p><p className="text-sm whitespace-pre-wrap">{selected?.description}</p>
      <p className="text-sm">Status: {selected?.status}</p>
      {customers.find(c=>c.id===selected?.customerId) && <EquipmentScanner customer={customers.find(c=>c.id===selected?.customerId)!} />}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Date<Input disabled={busy || closed} type="date" value={form.scheduledDate || ""} onChange={e => setForm({...form, scheduledDate:e.target.value})}/></label>
        <label className="text-sm">Time (Central)<Input disabled={busy || closed} type="time" value={form.scheduledTime || ""} onChange={e => setForm({...form, scheduledTime:e.target.value})}/></label>
        <label className="text-sm">Duration (minutes)<Input disabled={busy || closed} type="number" min={15} max={1440} step={15} value={form.durationMinutes || 60} onChange={e => setForm({...form,durationMinutes:Number(e.target.value)})}/></label>
        <label className="text-sm">Team member<select className="block w-full rounded border p-2 bg-background" disabled={busy || closed} value={form.technicianId || ""} onChange={e => { const person = data.people.find((p: any) => p.id === e.target.value); setForm({...form,technicianId:person?.id || null,technician:person?.full_name || ""}); }}>
          <option value="">{form.technician && !form.technicianId ? `${form.technician} (existing)` : "Unassigned"}</option>
          {data.people.filter((p: any) => p.full_name).map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select></label>
      </div>
      <div className="flex gap-2"><Link href={`/customers/${selected?.customerId}`}><Button variant="outline">Customer & Equipment</Button></Link>
        {!closed && <Button disabled={busy} onClick={() => save(selected,form).catch(e => setNotice(e.message))}>{busy ? "Saving…" : "Save Appointment"}</Button>}</div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </DialogContent></Dialog>
  </section>;
}
