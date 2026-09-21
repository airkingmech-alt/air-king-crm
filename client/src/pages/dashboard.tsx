import { guardSave } from "@/lib/confirmed-save";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { crm } from "@/lib/crm-api";
import { supabase } from "@/lib/supabase";
import { canAccess } from "../../../shared/access";
import { businessDay, membershipSummary, isUnpaidInvoice } from "../../../shared/dashboard";
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
  ArrowUpRight,
  RefreshCw,
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
  fmtCurrency,
} from "@/data/mock-data";

import { useData } from "@/context/data-context";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { toast } = useToast();
  const { quotes, workOrders, invoices, memberships, updateWorkOrder } = useData();
  const {profile}=useAuth();
  const can=(feature:string)=>canAccess(profile,feature);
  const leadsQuery=useQuery({queryKey:["dashboard-leads",profile?.id,profile?.company_id],enabled:can("leads"),refetchInterval:30000,queryFn:async()=>{
    const {data,error,count}=await supabase.from("leads").select("id,name,status,source,city",{count:"exact"}).eq("company_id",profile!.company_id).not("status","in","(won,lost,spam)").order("created_at",{ascending:false}).order("id").limit(5);
    if(error)throw error;return {items:(data || []) as {id:string;name:string;status:string;source:string;city:string|null}[],count:count || 0};
  }});
  const reportsAllowed=canAccess(profile,"reports") && canAccess(profile,"invoices");
  const receipts=useQuery({queryKey:["receipt-summary",profile?.id],queryFn:()=>crm("crm/reports/receipts"),enabled:reportsAllowed,refetchInterval:30000});
  const catalog=useQuery({queryKey:["dashboard-catalog",profile?.id],enabled:canAccess(profile,"pricebook"),queryFn:async()=>{const {data,error}=await supabase.from("price_book_items").select("id,brand,model,category,description").eq("company_id",profile!.company_id);if(error)throw error;return data || [];}});
  const membershipMetrics=membershipSummary(memberships);
  const today = businessDay(new Date());
  const todaySchedule = workOrders.filter(
    (wo) => wo.scheduledDate === today && wo.status !== "Cancelled"
  ).sort((a,b)=>(a.scheduledTime || "").localeCompare(b.scheduledTime || ""));
  const openLeads = leadsQuery.data?.items || [];
  const pendingQuotes = quotes.filter((q) => q.status === "Quote Sent");
  const unpaidInvoices = invoices.filter(isUnpaidInvoice);
  const activeMemberships = memberships.filter((m) => m.status === "Active");

  // Equipment to Order: work orders from accepted quotes that haven't been marked as ordered
  const wonQuotes = quotes.filter((q) => q.status === "Won");
  const wonQuoteIds = new Set(wonQuotes.map((q) => q.id));
  const unassignedWorkOrders = workOrders.filter(
    (wo) => wo.quoteId && wonQuoteIds.has(wo.quoteId) && !["Cancelled", "Completed"].includes(wo.status) && !(wo as any).ordered
  );

  // Group equipment by work order
  const equipmentByJob = unassignedWorkOrders.map((wo) => {
    const quote = quotes.find((q) => q.id === wo.quoteId);
    const items = (quote?.equipmentItems || []).map((id) => {const saved=catalog.data?.find(p=>p.id===id);return saved || {id,brand:"",model:id,category:"Equipment",description:"Review saved quote for equipment details",cost:0};});
    return { workOrder: wo, quote, items };
  }).filter((job) => job.items.length > 0);

  const cashCollected = receipts.data?.monthToDateCents / 100;

  const stats = [
    {
      label: "Today's Schedule", feature: "schedule", href: "/schedule",
      value: todaySchedule.length,
      icon: Calendar,
      color: "text-sky-500",
      bg: "bg-sky-50 dark:bg-sky-950/30",
    },
    {
      label: "Open Leads", feature: "leads", href: "/leads",
      value: leadsQuery.isError ? "Unavailable" : leadsQuery.isPending ? "…" : leadsQuery.data?.count ?? 0,
      icon: Users,
      color: "text-indigo-500",
      bg: "bg-indigo-50 dark:bg-indigo-950/30",
    },
    {
      label: "Quotes Pending", feature: "quotes", href: "/quotes?status=pending",
      value: pendingQuotes.length,
      icon: FileText,
      color: "text-amber-500",
      bg: "bg-amber-50 dark:bg-amber-950/30",
    },
    {
      label: "Unpaid Invoices", feature: "invoices", href: "/invoices?filter=Unpaid",
      value: unpaidInvoices.length,
      icon: DollarSign,
      color: "text-rose-500",
      bg: "bg-rose-50 dark:bg-rose-950/30",
    },
    {
      label: "Cash Collected (MTD)", feature: "reports", href: "/invoices",
      value: !reportsAllowed ? "Restricted" : receipts.isError ? "Unavailable" : receipts.isPending ? "…" : fmtCurrency(cashCollected),
      icon: TrendingUp,
      color: "text-emerald-500",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
    },
    {
      label: "Crown Care Active", feature: "memberships", href: "/crown-care",
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
          {new Date().toLocaleDateString("en-US", { timeZone:"America/Chicago", weekday: "long", year: "numeric", month: "long", day: "numeric" })} — Air King Mechanical Services
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>CRM records refresh every 30 seconds. Cash collected includes confirmed payments this month.</span><Button variant="outline" size="sm" onClick={()=>{window.dispatchEvent(new Event("crm-refresh"));if(can("leads"))void leadsQuery.refetch();if(reportsAllowed)void receipts.refetch();if(can("pricebook"))void catalog.refetch();}}><RefreshCw size={14} className="mr-1.5"/>Refresh</Button></div>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.filter(stat=>can(stat.feature) && (stat.feature!=="reports" || reportsAllowed)).map((stat) => {
          const Icon = stat.icon;
          return (
            <Link key={stat.label} href={stat.href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Open ${stat.label}`}><Card className="border-border h-full hover:bg-muted/50 hover:border-primary/40 transition-colors">
              <CardContent className="p-4">
                <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${stat.bg} mb-3`}>
                  <Icon size={18} className={stat.color} />
                </div>
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label} <ArrowUpRight size={12} className="inline ml-1" /></p>
              </CardContent>
            </Card></Link>
          );
        })}
      </div>

      {/* Equipment to Order */}
      {can("schedule") && can("quotes") && equipmentByJob.length > 0 && (
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
                    <Link href={`/schedule?job=${encodeURIComponent(job.workOrder.id)}`}>
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
                      <span className="font-medium">{item!.description || [item!.brand,item!.model,item!.category].filter(Boolean).join(" ")}</span>
                      <span className="text-muted-foreground ml-auto text-[10px]">{item!.model}</span>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={guardSave("mark-ordered", async () => {
                    await updateWorkOrder(job.workOrder.id, { ordered: true } as any);
                    toast({
                      title: "Equipment ordered",
                      description: `Equipment for ${job.workOrder.customerName} (${job.workOrder.id}) marked as ordered.`,
                    });
                  })}
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
        {can("schedule") && <Card className="lg:col-span-2">
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
                <Link
                  key={wo.id}
                  href={`/schedule?job=${encodeURIComponent(wo.id)}`}
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
                </Link>
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
        </Card>}

        {/* Crown Care Summary */}
        {can("memberships") && <Card>
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
                <p className="text-2xl font-bold">{fmtCurrency(membershipMetrics.annualCents/100)}</p>
                <p className="text-xs text-muted-foreground">Annual Recurring</p>
              </div>
            </div>
            <div className="space-y-2">
              {memberships.filter(m => m.paymentStatus === "Overdue" || m.paymentStatus === "Pending").map(m => (
                <Link href="/crown-care" key={m.id} className="flex items-center justify-between text-xs rounded hover:bg-muted/50 p-1">
                  <span className="font-medium truncate flex-1">{m.customerName}</span>
                  <Badge variant={m.paymentStatus === "Overdue" ? "destructive" : "secondary"} className="text-[10px] ml-2">
                    {m.paymentStatus}
                  </Badge>
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
              <AlertCircle size={14} className="text-yellow-600 shrink-0" />
              <p className="text-xs text-yellow-700 dark:text-yellow-500">
                {membershipMetrics.unbooked} unbooked seasonal visit(s)
              </p>
            </div>
          </CardContent>
        </Card>}
      </div>

      {can("quotes") && <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3"><CardTitle className="text-base font-semibold">Quotes Awaiting a Decision</CardTitle><Link href="/quotes?status=pending" className="text-xs text-primary hover:underline">View all</Link></CardHeader>
        <CardContent className="space-y-2">{pendingQuotes.length ? pendingQuotes.slice(0,5).map(quote=><Link key={quote.id} href={`/proposals/${encodeURIComponent(quote.id)}`} className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary"><div className="min-w-0"><p className="text-sm font-medium truncate">{quote.customerName}</p><p className="text-xs text-muted-foreground truncate">{quote.id} · {quote.title}</p></div><ArrowUpRight size={16} className="shrink-0 text-primary"/></Link>):<p className="text-sm text-muted-foreground">No quotes awaiting a decision.</p>}</CardContent>
      </Card>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Leads */}
        {can("leads") && <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Open Leads</CardTitle>
            <Link href="/leads">
              <span className="text-xs text-primary font-medium hover:underline cursor-pointer">View all</span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {leadsQuery.isError ? <p role="alert" className="text-sm text-destructive">Could not load leads. Use Refresh to try again.</p> : leadsQuery.isPending ? <p>Loading leads…</p> : !openLeads.length ? <p className="text-sm text-muted-foreground">No open leads.</p> : null}
            {!leadsQuery.isError && openLeads.map((lead) => (
              <div key={lead.id} className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
                  {lead.name.split(" ").filter(n => /^[A-Za-z]/.test(n)).map(n => n[0]).slice(0, 2).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/leads?lead=${encodeURIComponent(lead.id)}`}>
                    <p className="text-sm font-medium truncate hover:text-primary cursor-pointer">{lead.name}</p>
                  </Link>
                  <p className="text-xs text-muted-foreground">{lead.source} · {lead.city}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {lead.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>}

        {/* Unpaid Invoices */}
        {can("invoices") && <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Unpaid Invoices</CardTitle>
            <Link href="/invoices?filter=Unpaid">
              <span className="text-xs text-primary font-medium hover:underline cursor-pointer">View all</span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {!unpaidInvoices.length && <p className="text-sm text-muted-foreground">No unpaid invoices.</p>}
            {unpaidInvoices.slice(0,5).map((inv) => (
              <Link href={`/invoices/view/${encodeURIComponent(inv.id)}`} key={inv.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary">
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
              </Link>
            ))}
          </CardContent>
        </Card>}
      </div>
    </div>
  );
}
