import { Link } from "wouter";
import {
  Calendar,
  Users,
  FileText,
  DollarSign,
  Crown,
  AlertCircle,
  Clock,
  TrendingUp,
  CheckCircle2,
  Phone,
  Mail,
  Package,
  ShoppingCart,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  dashboardMetrics,
  fmtCurrency,
} from "@/data/mock-data";
import { pricebook, formatEquipmentDescription } from "@/data/pricebook";
import { useData } from "@/context/data-context";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { toast } = useToast();
  const { customers, quotes, workOrders, invoices, memberships, updateWorkOrder } = useData();
  const today = new Date().toISOString().slice(0, 10);
  const todaySchedule = workOrders.filter(
    (wo) => wo.scheduledDate === today && wo.status !== "Cancelled"
  );
  const openLeads = customers.filter(
    (c) => ["New", "Contacted", "Appointment"].includes(c.leadStatus)
  );
  const pendingQuotes = quotes.filter((q) => q.status === "Quote Sent");
  const unpaidInvoices = invoices.filter(
    (inv) => ["Sent", "Partial", "Overdue"].includes(inv.status)
  );
  const activeMemberships = memberships.filter((m) => m.status === "Active");

  // Equipment to Order: work orders from accepted quotes that haven't been marked as ordered
  const wonQuotes = quotes.filter((q) => q.status === "Won");
  const wonQuoteIds = new Set(wonQuotes.map((q) => q.id));
  const unassignedWorkOrders = workOrders.filter(
    (wo) => wo.quoteId && wonQuoteIds.has(wo.quoteId) && !(wo as any).ordered
  );

  // Group equipment by work order
  const equipmentByJob = unassignedWorkOrders.map((wo) => {
    const quote = quotes.find((q) => q.id === wo.quoteId);
    const items = (quote?.equipmentItems || []).map((id) => pricebook.find((p) => p.id === id)).filter(Boolean);
    return { workOrder: wo, quote, items };
  }).filter((job) => job.items.length > 0);

  const cashCollected = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

  const stats = [
    {
      label: "Today's Schedule",
      value: todaySchedule.length,
      icon: Calendar,
      color: "text-sky-500",
      bg: "bg-sky-50 dark:bg-sky-950/30",
    },
    {
      label: "Open Leads",
      value: openLeads.length,
      icon: Users,
      color: "text-indigo-500",
      bg: "bg-indigo-50 dark:bg-indigo-950/30",
    },
    {
      label: "Quotes Pending",
      value: pendingQuotes.length,
      icon: FileText,
      color: "text-amber-500",
      bg: "bg-amber-50 dark:bg-amber-950/30",
    },
    {
      label: "Unpaid Invoices",
      value: unpaidInvoices.length,
      icon: DollarSign,
      color: "text-rose-500",
      bg: "bg-rose-50 dark:bg-rose-950/30",
    },
    {
      label: "Cash Collected (MTD)",
      value: fmtCurrency(cashCollected),
      icon: TrendingUp,
      color: "text-emerald-500",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
    },
    {
      label: "Crown Care Active",
      value: activeMemberships.length,
      icon: Crown,
      color: "text-yellow-600",
      bg: "bg-yellow-50 dark:bg-yellow-950/30",
    },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} — Kansas City, MO
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-border">
              <CardContent className="p-4">
                <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${stat.bg} mb-3`}>
                  <Icon size={18} className={stat.color} />
                </div>
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Equipment to Order */}
      {equipmentByJob.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShoppingCart size={16} className="text-amber-500" />
              Equipment to Order ({equipmentByJob.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {equipmentByJob.map((job) => (
              <div key={job.workOrder.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <Link href={`/customers/${job.workOrder.customerId}`}>
                      <p className="text-sm font-semibold hover:text-primary cursor-pointer">{job.workOrder.customerName}</p>
                    </Link>
                    <p className="text-[10px] text-muted-foreground">{job.workOrder.id} · {job.workOrder.type}</p>
                  </div>
                  {job.quote && (
                    <Link href={`/proposals/${job.quote.id}`}>
                      <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-muted">{job.quote.id}</Badge>
                    </Link>
                  )}
                </div>
                <div className="space-y-1 mb-3">
                  {job.items.map((item) => (
                    <div key={item!.id} className="flex items-center gap-2 text-xs">
                      <Package size={12} className="text-muted-foreground shrink-0" />
                      <span className="font-medium">{formatEquipmentDescription(item!)}</span>
                      <span className="text-muted-foreground ml-auto text-[10px]">{item!.model}</span>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => {
                    updateWorkOrder(job.workOrder.id, { ordered: true } as any);
                    toast({
                      title: "Equipment ordered",
                      description: `Equipment for ${job.workOrder.customerName} (${job.workOrder.id}) marked as ordered.`,
                    });
                  }}
                  data-testid={`button-mark-ordered-${job.workOrder.id}`}
                >
                  <CheckCircle2 size={14} className="mr-1.5" />
                  Mark as Ordered
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Schedule */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Today's Schedule</CardTitle>
            <Link href="/schedule">
              <span className="text-xs text-primary font-medium hover:underline cursor-pointer">View all</span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {todaySchedule.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No jobs scheduled for today</p>
            ) : (
              todaySchedule.map((wo) => (
                <div
                  key={wo.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400">
                    <Clock size={16} />
                    <span className="text-[10px] font-semibold mt-0.5">{wo.scheduledTime || "--"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{wo.customerName}</p>
                    <p className="text-xs text-muted-foreground truncate">{wo.type}</p>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        wo.status === "Completed" ? "default" :
                        wo.status === "Scheduled" ? "secondary" : "outline"
                      }
                      className="text-[10px]"
                    >
                      {wo.status}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">{wo.technician || "Unassigned"}</p>
                  </div>
                </div>
              ))
            )}
            {todaySchedule.length === 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border">
                <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-muted">
                  <Calendar size={16} className="text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No appointments today. Enjoy the day!</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Crown Care Summary */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Crown size={16} className="text-yellow-600" />
              Crown Care
            </CardTitle>
            <Link href="/crown-care">
              <span className="text-xs text-primary font-medium hover:underline cursor-pointer">Manage</span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xl font-bold">{activeMemberships.length}</p>
                <p className="text-xs text-muted-foreground">Active Members</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{fmtCurrency(dashboardMetrics.annualRecurringValue)}</p>
                <p className="text-xs text-muted-foreground">Annual Recurring</p>
              </div>
            </div>
            <div className="space-y-2">
              {memberships.filter(m => m.paymentStatus === "Overdue" || m.paymentStatus === "Pending").map(m => (
                <div key={m.id} className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate flex-1">{m.customerName}</span>
                  <Badge variant={m.paymentStatus === "Overdue" ? "destructive" : "secondary"} className="text-[10px] ml-2">
                    {m.paymentStatus}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
              <AlertCircle size={14} className="text-yellow-600 shrink-0" />
              <p className="text-xs text-yellow-700 dark:text-yellow-500">
                {dashboardMetrics.unbookedVisits} unbooked seasonal visit(s)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Leads */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Open Leads</CardTitle>
            <Link href="/customers">
              <span className="text-xs text-primary font-medium hover:underline cursor-pointer">View all</span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {openLeads.slice(0, 5).map((lead) => (
              <div key={lead.id} className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                  lead.type === "Commercial" ? "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400" : "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
                }`}>
                  {lead.name.split(" ").filter(n => /^[A-Za-z]/.test(n)).map(n => n[0]).slice(0, 2).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/customers/${lead.id}`}>
                    <p className="text-sm font-medium truncate hover:text-primary cursor-pointer">{lead.name}</p>
                  </Link>
                  <p className="text-xs text-muted-foreground">{lead.leadSource} · {lead.properties[0]?.city}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {lead.leadStatus}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Unpaid Invoices */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Unpaid Invoices</CardTitle>
            <Link href="/invoices">
              <span className="text-xs text-primary font-medium hover:underline cursor-pointer">View all</span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {unpaidInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  inv.status === "Overdue" ? "bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400" : "bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
                }`}>
                  <DollarSign size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inv.customerName}</p>
                  <p className="text-xs text-muted-foreground">{inv.id} · Due {inv.dueDate}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{fmtCurrency(inv.amount - inv.paidAmount)}</p>
                  <Badge
                    variant={inv.status === "Overdue" ? "destructive" : "outline"}
                    className="text-[10px] mt-0.5"
                  >
                    {inv.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
