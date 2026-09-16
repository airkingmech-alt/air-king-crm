import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, LogIn, LogOut, Plus, Pencil, History, Download, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { crm } from "@/lib/crm-api";
import { duration, elapsedMs, localTime, shiftDay, timeCandidates, TIME_ZONE, weekStart, type TimeEntry } from "@shared/time-clock";

type Person = { id: string; full_name: string | null; role: string };
type Sheet = { entries: TimeEntry[]; active: TimeEntry | null; people: Person[]; manager: boolean;
  canEdit: boolean; from: string; to: string; serverNow: string };
type TimeEvent = { id: string; actor: { full_name: string | null }; action: string; reason: string;
  before_data: TimeEntry | null; after_data: TimeEntry; created_at: string };
const stamp = (s: string | null) => s ? new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
}).format(new Date(s)) : "Still clocked in";
const selectClass = "h-10 rounded-md border border-input bg-background px-3 text-sm w-full";

function TimeInput({ label, value, onChange, optional = false }: {
  label: string; value: string; onChange: (v: string) => void; optional?: boolean;
}) {
  const wall = value && value.endsWith("Z") ? localTime(value) : value;
  const candidates = timeCandidates(wall);
  return <div className="space-y-2"><Label>{label}</Label>
    <Input aria-label={label} type="datetime-local" step="1" value={wall}
      onChange={e => { const values = timeCandidates(e.target.value); onChange(values.length === 1 ? values[0] : e.target.value); }} />
    {candidates.length === 2 && <select className={selectClass} aria-label={`${label} daylight saving time choice`}
      value={value.endsWith("Z") ? value : ""} onChange={e => onChange(e.target.value)}>
      <option value="" disabled>Choose which occurrence of this hour</option>
      {candidates.map((v, i) => <option key={v} value={v}>{i === 0 ? "First" : "Second"} occurrence — {stamp(v)}</option>)}
    </select>}
    {wall && candidates.length === 0 && <p className="text-xs text-destructive">This time does not exist in Central Time. Check the date and daylight saving change.</p>}
    {optional && <p className="text-xs text-muted-foreground">Leave blank to keep the current shift running.</p>}
  </div>;
}

export default function TimeClock() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(() => weekStart());
  const [to, setTo] = useState(() => shiftDay(weekStart(), 6));
  const [employee, setEmployee] = useState(profile?.id || "");
  const [tick, setTick] = useState(Date.now());
  const [editing, setEditing] = useState<TimeEntry | "new" | null>(null);
  const [history, setHistory] = useState<TimeEntry | null>(null);
  const [form, setForm] = useState({ employee_id: profile?.id || "", clock_in: "", clock_out: "", notes: "", reason: "" });
  const [formError, setFormError] = useState("");
  const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  const key = ["time-clock", profile?.id, from, to, employee];
  const query = useQuery<Sheet>({ queryKey: key,
    queryFn: () => crm(`time-clock?${new URLSearchParams({ from, to, employee })}`),
    enabled: !!profile?.id && !!employee, refetchInterval: 30000, refetchOnWindowFocus: "always", retry: 1 });
  const data = query.data;
  const now = data ? Date.parse(data.serverNow) + Math.max(0, tick - query.dataUpdatedAt) : tick;
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const audit = useQuery<{ events: TimeEvent[]; limit: number }>({
    queryKey: ["time-history", profile?.id, history?.id], enabled: !!history,
    queryFn: () => crm(`time-clock/${history!.id}/history`), staleTime: 0,
  });
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const payload = JSON.stringify(body);
      if (pendingRequest.current?.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() };
      return crm("time-clock", "POST", body, pendingRequest.current.key);
    },
    onSuccess: (_response, body) => {
      pendingRequest.current = null; setEditing(null); setFormError("");
      toast({ title: body.action === "clock_in" ? "You’re clocked in" : body.action === "clock_out" ? "You’re clocked out" : "Time entry saved" });
    },
    onError: (error: Error) => { setFormError(error.message); toast({ title: "Time not confirmed", description: error.message, variant: "destructive" }); },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: ["time-clock"] }); queryClient.invalidateQueries({ queryKey: ["time-history"] }); },
  });
  const openEdit = (entry: TimeEntry | "new") => {
    setEditing(entry); setFormError("");
    setForm(entry === "new" ? { employee_id: employee === "all" ? profile!.id : employee, clock_in: "", clock_out: "", notes: "", reason: "" }
      : { employee_id: entry.employee_id, clock_in: new Date(entry.clock_in).toISOString(), clock_out: entry.clock_out ? new Date(entry.clock_out).toISOString() : "", notes: entry.notes, reason: "" });
  };
  const submit = () => {
    if (!form.clock_in.endsWith("Z") || (form.clock_out && !form.clock_out.endsWith("Z")) || (editing === "new" && !form.clock_out)) {
      setFormError("Choose valid clock-in and clock-out times. If an hour repeats, choose its first or second occurrence."); return;
    }
    if (form.reason.trim().length < 3) { setFormError("Add a short reason for this correction."); return; }
    const fields = { clock_in: form.clock_in, clock_out: form.clock_out || null, notes: form.notes, reason: form.reason.trim() };
    save.mutate(editing === "new" ? { action: "create", employee_id: form.employee_id, ...fields }
      : { action: "edit", id: (editing as TimeEntry).id, version: (editing as TimeEntry).version, ...fields });
  };
  const name = (id: string) => data?.people.find(p => p.id === id)?.full_name || "Team member";
  const inRange = (e: TimeEntry) => elapsedMs(e, now, Date.parse(data!.from), Date.parse(data!.to));
  const complete = data?.entries.filter(e => e.clock_out).reduce((total, e) => total + inRange(e), 0) || 0;
  const running = data?.entries.filter(e => !e.clock_out).reduce((total, e) => total + inRange(e), 0) || 0;
  const moveWeek = (amount: number) => { setFrom(shiftDay(from, amount)); setTo(shiftDay(to, amount)); };
  const exportCsv = () => {
    if (!data) return;
    const cell = (v: unknown) => '"' + String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"','""') + '"';
    const rows = [["Employee","Clock in (Central)","Clock out (Central)","Hours in selected dates","Status","Notes"],
      ...data.entries.map(e => [name(e.employee_id), stamp(e.clock_in), e.clock_out ? stamp(e.clock_out) : "",
        (inRange(e) / 3600000).toFixed(4), e.clock_out ? "Complete" : "Running — provisional", e.notes])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `air-king-time-${from}-to-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
    <div><h1 className="text-2xl font-bold tracking-tight">Time Clock</h1><p className="text-muted-foreground mt-1">Clock in, get to work, and keep your hours in one place.</p></div>
    {query.isLoading && <p role="status">Loading your time entries…</p>}
    {query.error && <div role="alert" className="rounded-lg border border-destructive/40 p-4"><p>{query.error.message}</p><Button variant="outline" className="mt-2" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try Again</Button></div>}
    {data && <>
      <Card className={data.active ? "border-emerald-500/50 bg-emerald-500/5" : "border-primary/20"}><CardContent className="p-6 flex flex-col sm:flex-row gap-5 sm:items-center sm:justify-between">
        <div><div className="flex gap-2 items-center font-medium"><span className={`h-2.5 w-2.5 rounded-full ${data.active ? "bg-emerald-500" : "bg-muted-foreground"}`} />{data.active ? "You’re on the clock" : "You’re clocked out"}</div>
          <p className="text-4xl font-bold tabular-nums mt-3">{data.active ? duration(elapsedMs(data.active, now)) : "Ready for your day?"}</p>
          <p className="text-sm text-muted-foreground mt-2">{data.active ? `Started ${stamp(data.active.clock_in)}` : "Your time saves when you clock in or out."}</p>
          {data.active && elapsedMs(data.active, now) > 16 * 3600000 && <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mt-2">Long shift — forgot to clock out? Use Edit on the entry to correct it.</p>}
        </div>
        <Button size="lg" disabled={save.isPending || query.isError} className={`h-14 px-8 text-lg ${data.active ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-emerald-700 hover:bg-emerald-800 text-white"}`}
          onClick={() => save.mutate(data.active ? { action: "clock_out", id: data.active.id, version: data.active.version } : { action: "clock_in" })}>
          {data.active ? <LogOut className="mr-2 h-5 w-5" /> : <LogIn className="mr-2 h-5 w-5" />}{save.isPending ? "Saving…" : data.active ? "Clock Out" : "Clock In"}
        </Button>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Times use Central Time. Your clock keeps running when you close the app. For an unpaid break, clock out and back in; no breaks are deducted automatically.</p>
    </>}
    <section className="space-y-4" aria-label="Time entries">
      <div className="flex flex-wrap gap-3 items-center justify-between"><h2 className="text-xl font-semibold">{data?.manager && employee !== profile?.id ? "Team hours" : "My hours"}</h2><div className="flex gap-2">
        {data?.canEdit && <Button variant="outline" onClick={() => openEdit("new")}><Plus className="mr-2 h-4 w-4" />Add Missed Time</Button>}
        <Button variant="outline" disabled={!data?.entries.length} onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export</Button>
      </div></div>
      <div className="rounded-lg border bg-card p-4 flex flex-wrap gap-3 items-end">
        {data?.manager && <div className="min-w-44 flex-1 space-y-1"><Label htmlFor="employee-filter">Employee</Label><select id="employee-filter" className={selectClass} value={employee} onChange={e => setEmployee(e.target.value)}><option value="all">All employees</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.id === profile?.id ? `${p.full_name || "Me"} (me)` : p.full_name || "Team member"}</option>)}</select></div>}
        <div className="space-y-1"><Label htmlFor="time-from">From</Label><Input id="time-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="time-to">Through</Label><Input id="time-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Previous week" disabled={!from || !to} onClick={() => moveWeek(-7)}><ChevronLeft size={16} /></Button><Button variant="outline" onClick={() => { setFrom(weekStart()); setTo(shiftDay(weekStart(),6)); }}>This Week</Button><Button variant="outline" size="icon" aria-label="Next week" disabled={!from || !to} onClick={() => moveWeek(7)}><ChevronRight size={16} /></Button></div>
      </div>
      {data && !query.isError && <>
        <div className="grid grid-cols-2 gap-3"><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Completed hours</p><p className="text-2xl font-bold tabular-nums mt-1">{duration(complete)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Still running</p><p className="text-2xl font-bold tabular-nums mt-1">{duration(running)}</p></CardContent></Card></div>
        <p className="text-xs text-muted-foreground">Totals include only time within the selected dates. Each entry below shows the full shift.</p>
        {!data.entries.length ? <div className="rounded-lg border border-dashed p-10 text-center"><Clock className="mx-auto h-8 w-8 text-muted-foreground mb-3" /><p className="font-medium">No time entries for these dates</p><p className="text-sm text-muted-foreground mt-1">Clock in to start, or add a missed shift.</p></div>
          : <div className="space-y-3">{data.entries.map(entry => <Card key={entry.id}><CardContent className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{name(entry.employee_id)} <span className={`inline-block ml-2 text-xs font-medium rounded-full px-2 py-1 ${entry.clock_out ? "bg-muted" : "bg-emerald-100 text-emerald-900"}`}>{entry.clock_out ? "Complete" : "On the clock"}</span>{entry.version > (entry.clock_out ? 2 : 1) && <span className="ml-2 text-xs text-muted-foreground">Updated</span>}</p><p className="text-lg font-bold tabular-nums mt-2">{duration(elapsedMs(entry, now))}</p></div>
              <div className="flex gap-1">{data.canEdit && <Button variant="outline" size="sm" onClick={() => openEdit(entry)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>}<Button variant="ghost" size="sm" onClick={() => setHistory(entry)}><History className="mr-1 h-3.5 w-3.5" />History</Button></div>
            </div><div className="grid sm:grid-cols-2 gap-2 mt-3 text-sm"><p><span className="text-muted-foreground">In: </span>{stamp(entry.clock_in)}</p><p><span className="text-muted-foreground">Out: </span>{stamp(entry.clock_out)}</p></div>
            {entry.notes && <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap break-words">{entry.notes}</p>}
          </CardContent></Card>)}</div>}
      </>}
    </section>
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !save.isPending) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing === "new" ? "Add Missed Time" : "Correct Time Entry"}</DialogTitle><DialogDescription>All times are Central Time. Your name, reason, and original times will stay in the history.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        {editing === "new" && data?.manager && <div className="space-y-2"><Label htmlFor="entry-employee">Employee</Label><select id="entry-employee" className={selectClass} value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>{data.people.map(p => <option key={p.id} value={p.id}>{p.full_name || "Team member"}</option>)}</select></div>}
        <TimeInput label="Clock in" value={form.clock_in} onChange={clock_in => setForm({ ...form, clock_in })} />
        <TimeInput label="Clock out" value={form.clock_out} optional={editing !== "new" && !!editing && !editing.clock_out} onChange={clock_out => setForm({ ...form, clock_out })} />
        <div className="space-y-2"><Label htmlFor="time-reason">Reason for correction *</Label><Input id="time-reason" value={form.reason} maxLength={500} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Example: Forgot to clock out at 4:30" /></div>
        <div className="space-y-2"><Label htmlFor="time-notes">Notes (optional)</Label><Textarea id="time-notes" value={form.notes} maxLength={2000} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={save.isPending} onClick={() => setEditing(null)}>Cancel</Button><Button disabled={save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save Time Entry"}</Button></div>
      </div>
    </DialogContent></Dialog>
    <Dialog open={!!history} onOpenChange={open => !open && setHistory(null)}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Time Entry History</DialogTitle><DialogDescription>Original times and every correction are kept here.</DialogDescription></DialogHeader>
      {audit.isLoading && <p>Loading history…</p>}{audit.error && <p role="alert" className="text-destructive">{audit.error.message}</p>}
      {audit.data?.events.map(event => <div key={event.id} className="border-l-2 border-primary/30 pl-4 py-2 space-y-1 text-sm"><p className="font-semibold">{{ clock_in: "Clocked in", clock_out: "Clocked out", create: "Missed time added", edit: "Time corrected" }[event.action] || event.action}</p><p className="text-xs text-muted-foreground">{event.actor?.full_name || "Team member"} · {stamp(event.created_at)}</p>{event.reason && <p className="break-words">{event.reason}</p>}
        {event.before_data && <div className="text-muted-foreground"><p>Before: {stamp(event.before_data.clock_in)} → {stamp(event.before_data.clock_out)}</p>{event.before_data.notes && <p className="break-words">Notes: {event.before_data.notes}</p>}</div>}
        <p>Saved: {stamp(event.after_data.clock_in)} → {stamp(event.after_data.clock_out)}</p>{event.after_data.notes && <p className="break-words">Notes: {event.after_data.notes}</p>}
      </div>)}{audit.data && audit.data.events.length >= audit.data.limit && <p className="text-xs text-muted-foreground">Showing the latest 100 events. Earlier history is retained.</p>}
    </DialogContent></Dialog>
  </div>;
}
