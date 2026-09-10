import {DocumentActions} from "@/components/document-actions";
import { useState } from "react";
import { Link } from "wouter";
import { Search, DollarSign, Download, Send, Plus, Copy, Mail, MessageSquare } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import {
  fmtCurrency,
  type InvoiceStatus,
} from "@/data/mock-data";
import { CustomerCombobox } from "@/components/customer-combobox";

const statusConfig: Record<InvoiceStatus, { color: string; badge: string }> = {
  Void: {color:"text-muted-foreground",badge:"bg-muted text-muted-foreground"},
  Draft: { color: "text-muted-foreground", badge: "bg-muted text-muted-foreground" },
  Sent: { color: "text-sky-600", badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400" },
  Paid: { color: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" },
  Overdue: { color: "text-rose-600", badge: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400" },
  Partial: { color: "text-amber-600", badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
};

export default function Invoices() {
  const { toast } = useToast();
  const { invoices, createInvoice, customers } = useData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | InvoiceStatus>("All");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [sendInvoice, setSendInvoice] = useState<typeof invoices[0] | null>(null);
  const [sendTarget, setSendTarget] = useState({ email: "", phone: "" });
  const [form, setForm] = useState({
    customer: "",
    description: "",
    amount: "",
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  });

  const filtered = invoices.filter((inv) => {
    const matchesSearch =
      inv.customerName.toLowerCase().includes(search.toLowerCase()) ||
      inv.id.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All" || inv.status === filter;
    return matchesSearch && matchesFilter;
  });

  const totalOutstanding = invoices
    .filter((inv) => ["Sent", "Partial", "Overdue"].includes(inv.status))
    .reduce((sum, inv) => sum + (inv.amount - inv.paidAmount), 0);
  const totalPaid = invoices
    .filter((inv) => inv.status === "Paid")
    .reduce((sum, inv) => sum + inv.paidAmount, 0);
  const overdueCount = invoices.filter((inv) => inv.status === "Overdue").length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer) {
      toast({ title: "Select a customer", description: "Please choose a customer for this invoice.", variant: "destructive" });
      return;
    }
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast({ title: "Invalid amount", description: "Please enter a valid invoice amount.", variant: "destructive" });
      return;
    }
    const custName = customers.find((c) => c.id === form.customer)?.name || "Customer";
    createInvoice({
      customerId: form.customer,
      customerName: custName,
      amount: parseFloat(form.amount),
      description: form.description || "Service",
    });
    toast({
      title: "Invoice created",
      description: `Invoice for ${custName} — ${fmtCurrency(parseFloat(form.amount))} — due ${form.dueDate}.`,
    });
    setShowCreateDialog(false);
    setForm({ customer: "", description: "", amount: "", dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{invoices.length} invoices · {overdueCount} overdue</p>
        </div>
        <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowCreateDialog(true)} data-testid="button-create-invoice">
          <Plus size={16} className="mr-1.5" /> Create Invoice
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-xl font-bold text-rose-600 mt-1">{fmtCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Collected (MTD)</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{fmtCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-xl font-bold text-amber-600 mt-1">{overdueCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by invoice # or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(["All", "Draft", "Sent", "Partial", "Paid", "Overdue"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
              className="text-xs"
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {/* Invoice List */}
      <div className="space-y-3">
        {filtered.map((inv) => {
          const outstanding = inv.amount - inv.paidAmount;
          return (
            <Card key={inv.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex flex-col items-center justify-center w-14 h-14 rounded-lg bg-muted shrink-0">
                    <DollarSign size={18} className={statusConfig[inv.status].color} />
                    <span className="text-[9px] font-semibold mt-0.5 text-muted-foreground">{inv.id}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/customers/${inv.customerId}`}>
                      <p className="text-sm font-medium hover:text-primary cursor-pointer">{inv.customerName}</p>
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${statusConfig[inv.status].badge}`}>
                        {inv.status}
                      </span>
                      <span className="text-xs text-muted-foreground">Due {inv.dueDate}</span>
                      {inv.sentDate && <span className="text-xs text-muted-foreground">· Sent {inv.sentDate}</span>}
                    </div>
                    {/* Line items preview */}
                    {inv.items.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {inv.items.slice(0, 2).map((item, i) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-muted-foreground truncate">{item.description}</span>
                            <span className="text-muted-foreground">{fmtCurrency(item.amount)}</span>
                          </div>
                        ))}
                        {inv.items.length > 2 && (
                          <p className="text-[10px] text-muted-foreground">+{inv.items.length - 2} more items</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-lg font-bold">{fmtCurrency(inv.amount)}</p>
                    {inv.paidAmount > 0 && inv.paidAmount < inv.amount && (
                      <p className="text-xs text-emerald-600">Paid: {fmtCurrency(inv.paidAmount)}</p>
                    )}
                    {outstanding > 0 && inv.status !== "Paid" && inv.status !== "Draft" && (
                      <p className="text-xs text-rose-600">Balance: {fmtCurrency(outstanding)}</p>
                    )}
                    <div className="flex gap-1 mt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-7 px-2"
                        onClick={() => {
                          setSendInvoice(inv);
                          setSendTarget({ email: "", phone: "" });
                        }}
                        data-testid={`button-send-invoice-${inv.id}`}
                      >
                        <Send size={11} className="mr-1" /> Send
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-[10px] h-7 px-2"
                        onClick={() => {
                          window.open(`${window.location.origin}/#/invoices/view/${inv.id}`, '_blank');
                          toast({
                            title: "Opening invoice",
                            description: "Use your browser's print option (Ctrl/Cmd+P) on the invoice page to save it as a PDF.",
                          });
                        }}
                        data-testid={`button-download-invoice-${inv.id}`}
                      >
                        <Download size={11} className="mr-1" /> PDF
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No invoices found.</p>
        </div>
      )}

      {/* Create Invoice Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create New Invoice</DialogTitle>
            <DialogDescription>Generate an invoice for a customer. It will be saved as a draft.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <CustomerCombobox
                value={form.customer}
                onChange={(v) => setForm({ ...form, customer: v })}
                testId="select-invoice-customer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-desc">Description</Label>
              <Input
                id="inv-desc"
                placeholder="e.g. AC repair — recharge refrigerant"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="inv-amount">Amount *</Label>
                <div className="relative">
                  <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="inv-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="pl-9"
                    data-testid="input-invoice-amount"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-due">Due Date</Label>
                <Input
                  id="inv-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-invoice">Create Invoice</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send Invoice Dialog */}
      <Dialog open={!!sendInvoice} onOpenChange={open=>!open&&setSendInvoice(null)}><DialogContent><DialogHeader><DialogTitle>Send to Customer</DialogTitle><DialogDescription>Share this document securely.</DialogDescription></DialogHeader>{sendInvoice&&<DocumentActions kind="invoice" id={sendInvoice.id}/>}</DialogContent></Dialog>
    </div>
  );
}
