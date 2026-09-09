import { useState } from "react";
import { Link } from "wouter";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  User,
  Plus,
  Calendar as CalendarIcon,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-context";
import { teamMembers, type WorkOrderStatus } from "@/data/mock-data";
import { CustomerCombobox } from "@/components/customer-combobox";

const statusColors: Record<WorkOrderStatus, string> = {
  Unscheduled: "bg-muted text-muted-foreground",
  Scheduled: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  Dispatched: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400",
  "In Progress": "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  Completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  Cancelled: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400",
  "Needs Follow-up": "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400",
};

const priorityColors: Record<string, string> = {
  Low: "text-muted-foreground",
  Normal: "text-sky-600",
  High: "text-amber-600",
  Emergency: "text-rose-600",
};

const jobTypes = [
  "Service Call",
  "Maintenance - Spring Tune-up",
  "Maintenance - Fall Tune-up",
  "Installation",
  "Estimate / Quote Visit",
  "Crown Care Visit",
  "Emergency Repair",
];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildWeekDays(weekStart: Date) {
  const days = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push({
      day: dayNames[i],
      date: d.getDate(),
      full: formatDate(d),
    });
  }
  return days;
}

export default function Schedule() {
  const { toast } = useToast();
  const { workOrders, createInvoice, createWorkOrder, updateWorkOrder, customers } = useData();
  const [view, setView] = useState<"week" | "list">("week");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({ technician: "", date: formatDate(new Date(Date.now() + 86400000)), time: "09:00", priority: "Normal" });
  const [form, setForm] = useState({
    customer: "",
    jobType: "Service Call",
    date: formatDate(new Date(Date.now() + 86400000)),
    time: "09:00",
    technician: "",
    priority: "Normal",
    description: "",
  });

  const weekDays = buildWeekDays(weekStart);
  const todayStr = formatDate(new Date());
  const weekStartStr = weekDays[0].full;
  const weekEnd = weekDays[6];
  const weekEndStr = weekEnd.full;

  const handlePrevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const handleNextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer) {
      toast({ title: "Select a customer", description: "Please choose a customer for this job.", variant: "destructive" });
      return;
    }
    const selectedCustomer = customers.find((c) => c.id === form.customer);
    const custName = selectedCustomer?.name || "Customer";
    const propertyAddress = selectedCustomer?.properties?.[0]?.address || "TBD";
    const wo = createWorkOrder({
      customerId: form.customer,
      customerName: custName,
      type: form.jobType,
      property: propertyAddress,
      description: form.description,
    });
    // Update with date, time, technician, priority
    updateWorkOrder(wo.id, {
      scheduledDate: form.date,
      scheduledTime: form.time,
      technician: form.technician || undefined,
      priority: form.priority as any,
      status: form.technician ? "Scheduled" : "Unscheduled",
    });
    toast({
      title: "Job scheduled",
      description: `${form.jobType} for ${custName} on ${form.date} at ${form.time}.`,
    });
    setShowScheduleDialog(false);
    setForm({ customer: "", jobType: "Service Call", date: formatDate(new Date(Date.now() + 86400000)), time: "09:00", technician: "", priority: "Normal", description: "" });
  };

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget) return;
    if (!assignForm.technician) {
      toast({ title: "Select a technician", description: "Please assign a technician.", variant: "destructive" });
      return;
    }
    updateWorkOrder(assignTarget, {
      technician: assignForm.technician,
      scheduledDate: assignForm.date,
      scheduledTime: assignForm.time,
      priority: assignForm.priority as any,
      status: "Scheduled",
    });
    const wo = workOrders.find((w) => w.id === assignTarget);
    toast({
      title: "Job assigned",
      description: `${wo?.customerName || "Job"} assigned to ${assignForm.technician} on ${assignForm.date} at ${assignForm.time}.`,
    });
    setShowAssignDialog(false);
    setAssignTarget(null);
    setAssignForm({ technician: "", date: formatDate(new Date(Date.now() + 86400000)), time: "09:00", priority: "Normal" });
  };

  const openAssignDialog = (woId: string) => {
    const wo = workOrders.find((w) => w.id === woId);
    setAssignTarget(woId);
    setAssignForm({
      technician: wo?.technician || "",
      date: wo?.scheduledDate || formatDate(new Date(Date.now() + 86400000)),
      time: wo?.scheduledTime || "09:00",
      priority: wo?.priority || "Normal",
    });
    setShowAssignDialog(true);
  };

  const unassignedJobs = workOrders.filter((wo) => wo.status === "Unscheduled" || wo.status === "Needs Follow-up");

  // Format week range for display
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const startMonth = monthNames[new Date(weekStart).getMonth()];
  const endMonth = monthNames[new Date(weekEnd.full).getMonth()];
  const startDate = new Date(weekStart).getDate();
  const endDate = new Date(weekEnd.full).getDate();
  const startYear = new Date(weekStart).getFullYear();
  const endYear = new Date(weekEnd.full).getFullYear();
  const weekLabel = startMonth === endMonth && startYear === endYear
    ? `${startMonth} ${startDate} — ${endDate}, ${startYear}`
    : startYear === endYear
    ? `${startMonth} ${startDate} — ${endMonth} ${endDate}, ${startYear}`
    : `${startMonth} ${startDate}, ${startYear} — ${endMonth} ${endDate}, ${endYear}`;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Schedule & Dispatch</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {weekLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setView(view === "week" ? "list" : "week")}>
            {view === "week" ? "List View" : "Week View"}
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowScheduleDialog(true)} data-testid="button-schedule-job">
            <Plus size={16} className="mr-1.5" /> Schedule Job
          </Button>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={handlePrevWeek}>
          <ChevronLeft size={16} /> Prev
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekStart(getWeekStart(new Date()))}>
          Today
        </Button>
        <Button variant="ghost" size="sm" onClick={handleNextWeek}>
          Next <ChevronRight size={16} />
        </Button>
      </div>

      {view === "week" ? (
        /* Week View */
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const dayJobs = workOrders.filter(
              (wo) => wo.scheduledDate === day.full && wo.status !== "Cancelled" && wo.status !== "Unscheduled"
            );
            const isToday = day.full === todayStr;
            return (
              <div
                key={day.full}
                className={`rounded-lg border min-h-[200px] ${isToday ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className={`px-3 py-2 border-b ${isToday ? "border-primary/30 bg-primary/10" : "border-border"}`}>
                  <p className="text-xs font-semibold">{day.day}</p>
                  <p className={`text-lg font-bold ${isToday ? "text-primary" : ""}`}>{day.date}</p>
                </div>
                <div className="p-2 space-y-2">
                  {dayJobs.map((wo) => (
                    <Link key={wo.id} href={`/customers/${wo.customerId}`}>
                      <div className="p-2 rounded-lg bg-card border border-border hover:shadow-sm cursor-pointer transition-shadow">
                        <div className="flex items-center gap-1 mb-1">
                          <Clock size={10} className="text-muted-foreground" />
                          <span className="text-[10px] font-semibold">{wo.scheduledTime}</span>
                          <span className={`text-[10px] font-medium ml-auto ${priorityColors[wo.priority]}`}>
                            {wo.priority}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium leading-tight truncate">{wo.customerName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{wo.type}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${statusColors[wo.status]}`}>
                            {wo.status}
                          </span>
                        </div>
                        {wo.technician && (
                          <p className="text-[9px] text-muted-foreground mt-1 truncate">{wo.technician}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                  {dayJobs.length === 0 && (
                    <div className="text-center py-4">
                      <CalendarIcon size={20} className="mx-auto text-muted-foreground/30" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="space-y-3">
          {workOrders.map((wo) => (
            <Card key={wo.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-muted shrink-0">
                    {wo.scheduledDate ? (
                      <>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(wo.scheduledDate).toLocaleDateString('en-US', { weekday: 'short' })}
                        </span>
                        <span className="text-lg font-bold">{new Date(wo.scheduledDate).getDate()}</span>
                        <span className="text-[10px] text-muted-foreground">{wo.scheduledTime}</span>
                      </>
                    ) : (
                      <CalendarIcon size={20} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-semibold">{wo.id}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${statusColors[wo.status]}`}>
                        {wo.status}
                      </span>
                      <span className={`text-[10px] font-medium ${priorityColors[wo.priority]}`}>
                        {wo.priority} priority
                      </span>
                    </div>
                    <Link href={`/customers/${wo.customerId}`}>
                      <p className="text-sm font-medium hover:text-primary cursor-pointer">{wo.customerName}</p>
                    </Link>
                    <p className="text-xs text-muted-foreground">{wo.type}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <MapPin size={11} /> {wo.property}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{wo.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {wo.technician ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 text-[10px] font-bold">
                          {wo.technician.split(" ").filter((n: string) => /^[A-Za-z]/.test(n)).map((n: string) => n[0]).join("")}
                        </div>
                        <span className="text-xs font-medium">{wo.technician}</span>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px]"
                        onClick={() => openAssignDialog(wo.id)}
                        data-testid={`button-assign-${wo.id}`}
                      >
                        <User size={11} className="mr-1" /> Assign
                      </Button>
                    )}
                    {(wo.status === "Completed" || wo.status === "In Progress") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-7"
                        onClick={() => {
                          const inv = createInvoice({
                            customerId: wo.customerId,
                            customerName: wo.customerName,
                            amount: 0,
                            description: `${wo.type} — ${wo.description}`,
                            workOrderId: wo.id,
                          });
                          toast({ title: "Invoice created", description: `${inv.id} created for ${wo.customerName}. Edit the invoice to set the amount.` });
                        }}
                        data-testid={`button-create-invoice-${wo.id}`}
                      >
                        <Plus size={11} className="mr-1" /> Create Invoice
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Unassigned Queue */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Clock size={16} className="text-amber-500" />
            Unassigned / Needs Scheduling ({unassignedJobs.length})
          </h3>
          <div className="space-y-2">
            {unassignedJobs.map((wo) => (
              <div key={wo.id} className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{wo.customerName}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${statusColors[wo.status]}`}>
                      {wo.status}
                    </span>
                    {wo.quoteId && (
                      <Badge variant="outline" className="text-[9px]">From {wo.quoteId}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{wo.type}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{wo.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs shrink-0"
                  onClick={() => openAssignDialog(wo.id)}
                  data-testid={`button-assign-queue-${wo.id}`}
                >
                  <User size={12} className="mr-1" /> Assign
                </Button>
              </div>
            ))}
            {unassignedJobs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">All jobs assigned</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Team */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {teamMembers.map((member) => (
          <Card key={member.name}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${member.color} text-white text-sm font-bold`}>
                {member.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{member.name}</p>
                <p className="text-xs text-muted-foreground">{member.role}</p>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-muted-foreground">Available</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Schedule Job Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Schedule New Job</DialogTitle>
            <DialogDescription>Create a work order and assign it to a technician.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <CustomerCombobox
                value={form.customer}
                onChange={(v) => setForm({ ...form, customer: v })}
                testId="select-schedule-customer"
              />
            </div>
            <div className="space-y-2">
              <Label>Job Type</Label>
              <Select value={form.jobType} onValueChange={(v) => setForm({ ...form, jobType: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {jobTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="job-date">Date</Label>
                <Input
                  id="job-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-time">Time</Label>
                <Input
                  id="job-time"
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Technician</Label>
                <Select value={form.technician} onValueChange={(v) => setForm({ ...form, technician: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Assign to..." />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((t) => (
                      <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Emergency">Emergency</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-desc">Description</Label>
              <Input
                id="job-desc"
                placeholder="Brief description of the job..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowScheduleDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-schedule">Schedule Job</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Assign Technician</DialogTitle>
            <DialogDescription>Assign a technician and schedule date for this work order.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAssign} className="space-y-4">
            <div className="space-y-2">
              <Label>Technician *</Label>
              <Select value={assignForm.technician} onValueChange={(v) => setAssignForm({ ...assignForm, technician: v })}>
                <SelectTrigger data-testid="select-assign-technician">
                  <SelectValue placeholder="Assign to..." />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((t) => (
                    <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="assign-date">Date</Label>
                <Input
                  id="assign-date"
                  type="date"
                  value={assignForm.date}
                  onChange={(e) => setAssignForm({ ...assignForm, date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assign-time">Time</Label>
                <Input
                  id="assign-time"
                  type="time"
                  value={assignForm.time}
                  onChange={(e) => setAssignForm({ ...assignForm, time: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={assignForm.priority} onValueChange={(v) => setAssignForm({ ...assignForm, priority: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
              <Button type="submit" className="bg-primary text-primary-foreground" data-testid="button-submit-assign">Assign & Schedule</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
