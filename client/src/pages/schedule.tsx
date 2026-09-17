import { guardSave } from "@/lib/confirmed-save";
import { useEffect, useRef, useState } from "react";
import { DispatchCalendar } from "@/components/dispatch-calendar";
import { useQuery } from "@tanstack/react-query";
import { crm } from "@/lib/crm-api";
import { Link, useLocation } from "wouter";
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
import { Card, CardContent } from "@/components/ui/card";
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
import { type WorkOrderStatus } from "@/data/mock-data";
import { CustomerCombobox } from "@/components/customer-combobox";
import { addOnServices, getTieredEquipment } from "@/data/pricebook";

const statusColors: Record<WorkOrderStatus, string> = {
  Unscheduled: "bg-muted text-muted-foreground",
  Scheduled: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  Dispatched:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400",
  "In Progress":
    "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  Completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  Cancelled: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400",
  "Needs Follow-up":
    "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400",
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

function getSelectedAddOnIds(workOrder: unknown): string[] {
  const selectedAddOns = (workOrder as { selectedAddOns?: unknown })
    .selectedAddOns;
  return Array.isArray(selectedAddOns)
    ? selectedAddOns.filter((id): id is string => typeof id === "string")
    : [];
}

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
  const { data: scheduling } = useQuery({ queryKey:["dispatch-calendar"], queryFn:()=>crm("scheduling") });
  const teamMembers: {name:string;role:string;initials:string;color:string}[] = (scheduling?.people || []).filter((person:any)=>person.full_name).map((person:any)=>({name:person.full_name,role:person.role,initials:person.full_name.split(" ").map((part:string)=>part[0]).join("").slice(0,2),color:"bg-sky-700"}));
  const { toast } = useToast();
  const {
    workOrders,
    createInvoice,
    createWorkOrder,
    updateWorkOrder,
    customers,
    quotes,
    invoices,
  } = useData();
  const [, setLocation] = useLocation();
  const openedLinkedJob = useRef(false);
  const [view, setView] = useState<"week" | "list">("week");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({
    technician: "",
    date: formatDate(new Date(Date.now() + 86400000)),
    time: "09:00",
    priority: "Normal",
  });
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

  const handleSubmit = guardSave("pages/schedule.tsx:handleSubmit", async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer) {
      toast({
        title: "Select a customer",
        description: "Please choose a customer for this job.",
        variant: "destructive",
      });
      return;
    }
    const selectedCustomer = customers.find((c) => c.id === form.customer);
    const custName = selectedCustomer?.name || "Customer";
    const propertyAddress = selectedCustomer?.properties?.[0]?.address || "TBD";
    const wo = await createWorkOrder({
      customerId: form.customer,
      customerName: custName,
      type: form.jobType,
      property: propertyAddress,
      description: form.description,
      scheduledDate: form.date,
      scheduledTime: form.time,
      technician: form.technician || undefined,
      priority: form.priority as any,
    });
    toast({
      title: "Job scheduled",
      description: `${form.jobType} for ${custName} on ${form.date} at ${form.time}.`,
    });
    setShowScheduleDialog(false);
    setForm({
      customer: "",
      jobType: "Service Call",
      date: formatDate(new Date(Date.now() + 86400000)),
      time: "09:00",
      technician: "",
      priority: "Normal",
      description: "",
    });
  });

  const handleAssign = guardSave("pages/schedule.tsx:handleAssign", async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget) return;
    if (!assignForm.technician) {
      toast({
        title: "Select a technician",
        description: "Please assign a technician.",
        variant: "destructive",
      });
      return;
    }
    await updateWorkOrder(assignTarget, {
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
    setAssignForm({
      technician: "",
      date: formatDate(new Date(Date.now() + 86400000)),
      time: "09:00",
      priority: "Normal",
    });
  });

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

  useEffect(() => {
    if (openedLinkedJob.current || !workOrders.length) return;
    const query = window.location.hash.split("?")[1] || "";
    const jobId = new URLSearchParams(query).get("job");
    if (jobId && workOrders.some((workOrder) => workOrder.id === jobId)) {
      openedLinkedJob.current = true;
      setView("list");
      openAssignDialog(jobId);
    }
  }, [workOrders]);

  const openOrCreateInvoice = guardSave("schedule-invoice", async (wo: (typeof workOrders)[number]) => {
    const existing = invoices.find(
      (invoice) =>
        invoice.workOrderId === wo.id ||
        (!!wo.quoteId && invoice.quoteId === wo.quoteId),
    );
    if (existing) {
      setLocation(`/invoices/view/${existing.id}`);
      return;
    }
    const quote = quotes.find((item) => item.id === wo.quoteId);
    const option = quote?.options.find(
      (item) => item.tier === quote.selectedOption,
    );
    const selectedAddOnIds = getSelectedAddOnIds(wo).length
      ? getSelectedAddOnIds(wo)
      : quote?.selectedAddOns || [];
    const addons = addOnServices.filter((item) =>
      selectedAddOnIds.includes(item.id),
    );
    const amount =
      (option?.customerPrice || 0) +
      addons.reduce((sum, item) => sum + item.price, 0);
    const equipmentItems =
      quote?.equipmentItems && option
        ? getTieredEquipment(quote.equipmentItems, option.tier).map(
            (item) => item.id,
          )
        : [];
    const invoice = await createInvoice({
      customerId: wo.customerId,
      customerName: wo.customerName,
      amount,
      description: quote
        ? `${quote.title} — ${option?.label || quote.selectedOption || "Approved"} package`
        : `${wo.type} — ${wo.description}`,
      items: quote
        ? [
            {
              description: `${option?.label || quote.selectedOption || "Approved"} package — ${quote.title}`,
              amount: option?.customerPrice || 0,
            },
            ...addons.map((addOn) => ({
              description: `Add-on — ${addOn.name}`,
              amount: addOn.price,
            })),
          ]
        : undefined,
      workOrderId: wo.id,
      quoteId: quote?.id,
      equipmentItems,
    });
    toast({
      title: "Invoice created",
      description: `${invoice.id} is linked to ${wo.id} and ready to review.`,
    });
    setLocation(`/invoices/view/${invoice.id}`);
  });

  const unassignedJobs = workOrders.filter(
    (wo) => wo.status === "Unscheduled" || wo.status === "Needs Follow-up",
  );

  // Format week range for display
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const startMonth = monthNames[new Date(weekStart).getMonth()];
  const endMonth = monthNames[new Date(weekEnd.full).getMonth()];
  const startDate = new Date(weekStart).getDate();
  const endDate = new Date(weekEnd.full).getDate();
  const startYear = new Date(weekStart).getFullYear();
  const endYear = new Date(weekEnd.full).getFullYear();
  const weekLabel =
    startMonth === endMonth && startYear === endYear
      ? `${startMonth} ${startDate} — ${endDate}, ${startYear}`
      : startYear === endYear
        ? `${startMonth} ${startDate} — ${endMonth} ${endDate}, ${startYear}`
        : `${startMonth} ${startDate}, ${startYear} — ${endMonth} ${endDate}, ${endYear}`;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Schedule & Dispatch
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Appointments, team assignments, and ready-to-schedule jobs</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView(view === "week" ? "list" : "week")}
          >
            {view === "week" ? "List View" : "Calendar View"}
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground"
            onClick={() => setShowScheduleDialog(true)}
            data-testid="button-schedule-job"
          >
            <Plus size={16} className="mr-1.5" /> Schedule Job
          </Button>
        </div>
      </div>

      {/* Week navigation */}
      <div className="hidden">
        <Button variant="ghost" size="sm" onClick={handlePrevWeek}>
          <ChevronLeft size={16} /> Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekStart(getWeekStart(new Date()))}
        >
          Today
        </Button>
        <Button variant="ghost" size="sm" onClick={handleNextWeek}>
          Next <ChevronRight size={16} />
        </Button>
      </div>

      {view === "week" ? (
        <DispatchCalendar />
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
                          {new Date(wo.scheduledDate).toLocaleDateString(
                            "en-US",
                            { weekday: "short" },
                          )}
                        </span>
                        <span className="text-lg font-bold">
                          {new Date(wo.scheduledDate).getDate()}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {wo.scheduledTime}
                        </span>
                      </>
                    ) : (
                      <CalendarIcon
                        size={20}
                        className="text-muted-foreground"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-semibold">{wo.id}</p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${statusColors[wo.status]}`}
                      >
                        {wo.status}
                      </span>
                      <span
                        className={`text-[10px] font-medium ${priorityColors[wo.priority]}`}
                      >
                        {wo.priority} priority
                      </span>
                    </div>
                    <Link href={`/customers/${wo.customerId}`}>
                      <p className="text-sm font-medium hover:text-primary cursor-pointer">
                        {wo.customerName}
                      </p>
                    </Link>
                    <p className="text-xs text-muted-foreground">{wo.type}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <MapPin size={11} /> {wo.property}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {wo.description}
                    </p>
                    {!!getSelectedAddOnIds(wo).length && (
                      <p className="text-xs text-foreground mt-1">
                        <span className="font-medium">Add-ons:</span>{" "}
                        {addOnServices
                          .filter((addOn) =>
                            getSelectedAddOnIds(wo).includes(addOn.id),
                          )
                          .map((addOn) => addOn.name)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {wo.technician ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 text-[10px] font-bold">
                          {wo.technician
                            .split(" ")
                            .filter((n: string) => /^[A-Za-z]/.test(n))
                            .map((n: string) => n[0])
                            .join("")}
                        </div>
                        <span className="text-xs font-medium">
                          {wo.technician}
                        </span>
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
                    {(wo.status === "Completed" ||
                      wo.status === "In Progress") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-7"
                        onClick={() => openOrCreateInvoice(wo)}
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
              <div
                key={wo.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{wo.customerName}</p>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${statusColors[wo.status]}`}
                    >
                      {wo.status}
                    </span>
                    {wo.quoteId && (
                      <Badge variant="outline" className="text-[9px]">
                        From {wo.quoteId}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{wo.type}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {wo.description}
                  </p>
                  {!!getSelectedAddOnIds(wo).length && (
                    <p className="text-xs text-foreground mt-1">
                      <span className="font-medium">Add-ons:</span>{" "}
                      {addOnServices
                        .filter((addOn) =>
                          getSelectedAddOnIds(wo).includes(addOn.id),
                        )
                        .map((addOn) => addOn.name)
                        .join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {wo.quoteId && (
                    <Link href={`/proposals/${wo.quoteId}`}>
                      <Button size="sm" variant="ghost" className="text-xs">
                        View Quote
                      </Button>
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => openOrCreateInvoice(wo)}
                  >
                    {invoices.some(
                      (invoice) =>
                        invoice.workOrderId === wo.id ||
                        (!!wo.quoteId && invoice.quoteId === wo.quoteId),
                    )
                      ? "Open Invoice"
                      : "Create Invoice"}
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs"
                    onClick={() => openAssignDialog(wo.id)}
                    data-testid={`button-assign-queue-${wo.id}`}
                  >
                    <User size={12} className="mr-1" /> Schedule
                  </Button>
                </div>
              </div>
            ))}
            {unassignedJobs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                All jobs assigned
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Team */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {teamMembers.map((member) => (
          <Card key={member.name}>
            <CardContent className="p-4 flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full ${member.color} text-white text-sm font-bold`}
              >
                {member.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{member.name}</p>
                <p className="text-xs text-muted-foreground">{member.role}</p>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-muted-foreground">
                  Team member
                </span>
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
            <DialogDescription>
              Create a work order and assign it to a technician.
            </DialogDescription>
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
              <Select
                value={form.jobType}
                onValueChange={(v) => setForm({ ...form, jobType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {jobTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
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
                <Select
                  value={form.technician}
                  onValueChange={(v) => setForm({ ...form, technician: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Assign to..." />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v })}
                >
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
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowScheduleDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="button-submit-schedule">
                Schedule Job
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Assign Technician</DialogTitle>
            <DialogDescription>
              Assign a technician and schedule date for this work order.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAssign} className="space-y-4">
            <div className="space-y-2">
              <Label>Technician *</Label>
              <Select
                value={assignForm.technician}
                onValueChange={(v) =>
                  setAssignForm({ ...assignForm, technician: v })
                }
              >
                <SelectTrigger data-testid="select-assign-technician">
                  <SelectValue placeholder="Assign to..." />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
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
                  onChange={(e) =>
                    setAssignForm({ ...assignForm, date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assign-time">Time</Label>
                <Input
                  id="assign-time"
                  type="time"
                  value={assignForm.time}
                  onChange={(e) =>
                    setAssignForm({ ...assignForm, time: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={assignForm.priority}
                onValueChange={(v) =>
                  setAssignForm({ ...assignForm, priority: v })
                }
              >
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAssignDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-primary text-primary-foreground"
                data-testid="button-submit-assign"
              >
                Assign & Schedule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
