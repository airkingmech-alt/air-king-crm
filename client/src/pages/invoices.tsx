import { prepareInvoiceLines, saveInvoiceThenSend } from "../../../shared/invoice-workflow";
import { guardSave } from "@/lib/confirmed-save";
import { DocumentActions } from "@/components/document-actions";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Search,
  DollarSign,
  Download,
  Send,
  Plus,
  Copy,
  Mail,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { fmtCurrency, type InvoiceStatus } from "@/data/mock-data";
import { CustomerCombobox } from "@/components/customer-combobox";
import { pricebook } from "@/data/pricebook";
import { crm } from "@/lib/crm-api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";

type CatalogItem = {
  id: string;
  item_type: "equipment" | "part" | "service" | "labor";
  name: string;
  description: string;
  price_cents: number;
  active: boolean;
  brand: string | null;
  model: string | null;
  category: string;
};

const statusConfig: Record<InvoiceStatus, { color: string; badge: string }> = {
  Void: {
    color: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  Draft: {
    color: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  Sent: {
    color: "text-sky-600",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  },
  Paid: {
    color: "text-emerald-600",
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  },
  Overdue: {
    color: "text-rose-600",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400",
  },
  Partial: {
    color: "text-amber-600",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  },
};

export default function Invoices() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { invoices, createInvoice, customers } = useData();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | InvoiceStatus>("All");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [sendInvoice, setSendInvoice] = useState<(typeof invoices)[0] | null>(
    null,
  );
  const [sendTarget, setSendTarget] = useState({ email: "", phone: "" });
  const [invoiceEquipment, setInvoiceEquipment] = useState<string[]>([]);
  const [lineItems, setLineItems] = useState([{ description: "", quantity: "1", unitPrice: "" }]);
  const [saving, setSaving] = useState(false);
  const [savedResult,setSavedResult]=useState<{id:string;deliveryError:string|null}|null>(null);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogEquipment, setCatalogEquipment] = useState<CatalogItem[]>([]);
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
  const overdueCount = invoices.filter(
    (inv) => inv.status === "Overdue",
  ).length;

  useEffect(() => {
    if (!showCreateDialog || !profile) return;
    supabase
      .from("price_book_items")
      .select("id,item_type,name,description,price_cents,active,brand,model,category")
      .eq("company_id", profile.company_id)
      .eq("active", true)
      .order("item_type")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          toast({ title: "Could not load the Price Book", description: error.message, variant: "destructive" });
          return;
        }
        setCatalogItems((data as CatalogItem[]) || []);
      });
  }, [profile, showCreateDialog, toast]);

  const addCatalogItem = (item: CatalogItem) => {
    if (item.item_type === "equipment") {
      setCatalogEquipment((current) => current.some((candidate) => candidate.id === item.id) ? current : [...current, item]);
    }
    setLineItems((current) => {
      const blankIndex = current.findIndex((line) => !line.description.trim() && !line.unitPrice);
      const line = {
        description: item.description.trim() || item.name,
        quantity: "1",
        unitPrice: (item.price_cents / 100).toFixed(2),
      };
      return blankIndex >= 0
        ? current.map((candidate, index) => (index === blankIndex ? line : candidate))
        : [...current, line];
    });
  };

  const handleSubmit = guardSave("invoice-form", async (e: React.FormEvent, sendNow = false) => {
    e.preventDefault();
    if (!form.customer) {
      toast({ title: "Select a customer", description: "Please choose a customer for this invoice.", variant: "destructive" });
      return;
    }
    const {items:cleanItems,amount}=prepareInvoiceLines(lineItems);
    setSaving(true);
    try {
      const custName = customers.find((customer) => customer.id === form.customer)?.name || "Customer";
      const outcome = await saveInvoiceThenSend(() => createInvoice({
        customerId: form.customer,
        customerName: custName,
        amount,
        description: cleanItems[0].description,
        items: cleanItems,
        dueDate: form.dueDate,
        equipmentItems: invoiceEquipment,
        installedEquipment: catalogEquipment.map((item) => ({
          brand: item.brand,
          model: item.model,
          category: item.category,
          description: item.description || item.name,
        })),
      }), invoice => {
        setSavedResult({id:invoice.id,deliveryError:null});
        setShowCreateDialog(false);
        setForm({customer:"",description:"",amount:"",dueDate:new Date(Date.now()+30*86400000).toISOString().slice(0,10)});
        setLineItems([{description:"",quantity:"1",unitPrice:""}]);
        setInvoiceEquipment([]);setCatalogEquipment([]);
      }, sendNow ? async invoice => {
        const response=await crm(`crm/invoice/${invoice.id}/send`,"POST",{channels:["email"]},crypto.randomUUID());
        const failed=response.messages?.filter((message:any)=>message.status==="failed") || [];
        if(failed.length)throw new Error(failed.map((message:any)=>message.error || "Email could not be queued.").join(" "));
      } : undefined);
      setSavedResult({id:outcome.invoice.id,deliveryError:outcome.deliveryError});
      window.dispatchEvent(new Event("crm-refresh"));
      toast({
        title:outcome.deliveryError ? "Invoice saved; email needs attention" : sendNow ? "Invoice saved and queued for email" : "Invoice saved as draft",
        description:outcome.deliveryError || `${custName} — ${fmtCurrency(amount)}`,
        ...(outcome.deliveryError ? {variant:"destructive" as const} : {}),
      });
    } catch (error: any) {
      toast({ title: "Could not save invoice", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {savedResult&&<div role="status" className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium">Invoice {savedResult.id} saved</p>
        <p className="text-sm text-muted-foreground">{savedResult.deliveryError ? `${savedResult.deliveryError} Open this invoice to review delivery before retrying.` : "Open the saved invoice to review its details or delivery history."}</p></div>
        <Link href={`/invoices/view/${savedResult.id}`}><Button variant="outline">Open invoice</Button></Link>
      </div>}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {invoices.length} invoices · {overdueCount} overdue
          </p>
        </div>
        <Button
          size="sm"
          className="bg-primary text-primary-foreground"
          onClick={() => setShowCreateDialog(true)}
          data-testid="button-create-invoice"
        >
          <Plus size={16} className="mr-1.5" /> Create Invoice
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-xl font-bold text-rose-600 mt-1">
              {fmtCurrency(totalOutstanding)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Collected (MTD)</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">
              {fmtCurrency(totalPaid)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-xl font-bold text-amber-600 mt-1">
              {overdueCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search by invoice # or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(
            ["All", "Draft", "Sent", "Partial", "Paid", "Overdue"] as const
          ).map((f) => (
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
            <Card key={inv.id} className="hover:shadow-md transition-shadow cursor-pointer focus-within:ring-2 focus-within:ring-primary"
              onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,select,textarea")) navigate(`/invoices/view/${inv.id}`); }}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex flex-col items-center justify-center w-14 h-14 rounded-lg bg-muted shrink-0">
                    <DollarSign
                      size={18}
                      className={statusConfig[inv.status].color}
                    />
                    <Link href={`/invoices/view/${inv.id}`} className="text-[9px] font-semibold mt-0.5 text-primary underline" aria-label={`Open invoice ${inv.id}`}>
                      {inv.id}
                    </Link>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/customers/${inv.customerId}`}>
                      <p className="text-sm font-medium hover:text-primary cursor-pointer">
                        {inv.customerName}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${statusConfig[inv.status].badge}`}
                      >
                        {inv.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Due {inv.dueDate}
                      </span>
                      {inv.sentDate && (
                        <span className="text-xs text-muted-foreground">
                          · Sent {inv.sentDate}
                        </span>
                      )}
                    </div>
                    {/* Line items preview */}
                    {inv.items.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {inv.items.slice(0, 2).map((item, i) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-muted-foreground truncate">
                              {item.description}
                            </span>
                            <span className="text-muted-foreground">
                              {fmtCurrency(item.amount)}
                            </span>
                          </div>
                        ))}
                        {inv.items.length > 2 && (
                          <p className="text-[10px] text-muted-foreground">
                            +{inv.items.length - 2} more items
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-lg font-bold">
                      {fmtCurrency(inv.amount)}
                    </p>
                    {inv.paidAmount > 0 && inv.paidAmount < inv.amount && (
                      <p className="text-xs text-emerald-600">
                        Paid: {fmtCurrency(inv.paidAmount)}
                      </p>
                    )}
                    {outstanding > 0 &&
                      inv.status !== "Paid" &&
                      inv.status !== "Draft" && (
                        <p className="text-xs text-rose-600">
                          Balance: {fmtCurrency(outstanding)}
                        </p>
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
                          window.open(
                            `${window.location.origin}/#/invoices/view/${inv.id}`,
                            "_blank",
                          );
                          toast({
                            title: "Opening invoice",
                            description:
                              "Use your browser's print option (Ctrl/Cmd+P) on the invoice page to save it as a PDF.",
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
        <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Invoice</DialogTitle>
            <DialogDescription>
              Build an itemized invoice, then save it as a draft or email it immediately.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Add from Price Book</Label>
              <Input
                placeholder="Search equipment, parts, services, or labor…"
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
              />
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2">
                {catalogItems
                  .filter((item) => [item.name, item.description, item.item_type].some((value) => value.toLowerCase().includes(catalogSearch.toLowerCase())))
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => addCatalogItem(item)}
                      className="flex w-full items-center justify-between gap-3 rounded-md p-2 text-left text-xs hover:bg-muted"
                    >
                      <span><span className="font-semibold">{item.name}</span><span className="ml-2 capitalize text-muted-foreground">{item.item_type}</span></span>
                      <span className="font-semibold">{fmtCurrency(item.price_cents / 100)}</span>
                    </button>
                  ))}
                {!catalogItems.length && <p className="p-2 text-xs text-muted-foreground">No active Price Book items yet. You can still enter invoice lines manually.</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Customer *</Label>
              <CustomerCombobox
                value={form.customer}
                onChange={(v) => setForm({ ...form, customer: v })}
                testId="select-invoice-customer"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Invoice items *</Label><Button type="button" size="sm" variant="outline" onClick={() => setLineItems([...lineItems,{description:"",quantity:"1",unitPrice:""}])}><Plus size={14} className="mr-1"/>Add line</Button></div>
              <div className="space-y-2">
                {lineItems.map((item,index)=><div key={index} className="grid grid-cols-[1fr_76px_110px_36px] gap-2 items-end">
                  <div><Label className="text-xs">Description / labor details</Label><Input value={item.description} onChange={e=>setLineItems(lineItems.map((x,i)=>i===index?{...x,description:e.target.value}:x))} placeholder={index===0?"Diagnostic labor, capacitor, installation…":""}/></div>
                  <div><Label className="text-xs">Qty</Label><Input type="number" min=".001" step=".001" value={item.quantity} onChange={e=>setLineItems(lineItems.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/></div>
                  <div><Label className="text-xs">Unit price</Label><Input type="number" min="0" step=".01" value={item.unitPrice} onChange={e=>setLineItems(lineItems.map((x,i)=>i===index?{...x,unitPrice:e.target.value}:x))}/></div>
                  <Button type="button" size="icon" variant="ghost" disabled={lineItems.length===1} onClick={()=>setLineItems(lineItems.filter((_,i)=>i!==index))}>×</Button>
                </div>)}
              </div>
              <div className="text-right font-semibold">Invoice total: {fmtCurrency(lineItems.reduce((sum,item)=>sum+Number(item.quantity||0)*Number(item.unitPrice||0),0))}</div>
            </div>
            <div className="space-y-2"><Label htmlFor="inv-due">Due Date</Label><Input id="inv-due" type="date" value={form.dueDate} onChange={(e)=>setForm({...form,dueDate:e.target.value})}/></div>
            <div className="space-y-2">
              <Label>Equipment installed</Label>
              <p className="text-xs text-muted-foreground">
                Optional — selected equipment is added to the customer's
                Equipment tab.
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border p-2 space-y-1">
                {pricebook
                  .filter((item) =>
                    [
                      "Condenser",
                      "Evaporator Coil",
                      "Air Handler",
                      "Furnace",
                      "Heat Pump",
                    ].includes(item.category),
                  )
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() =>
                        setInvoiceEquipment((current) =>
                          current.includes(item.id)
                            ? current.filter((id) => id !== item.id)
                            : [...current, item.id],
                        )
                      }
                      className={`w-full rounded-md border p-2 text-left text-xs ${invoiceEquipment.includes(item.id) ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                    >
                      <span className="font-semibold">{item.model}</span> —{" "}
                      {item.description}
                    </button>
                  ))}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="outline" disabled={saving} data-testid="button-submit-invoice">
                {saving ? "Saving…" : "Save Draft"}
              </Button>
              <Button type="button" disabled={saving} onClick={(e) => handleSubmit(e as any, true)}>
                Save & Send
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send Invoice Dialog */}
      <Dialog
        open={!!sendInvoice}
        onOpenChange={(open) => !open && setSendInvoice(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to Customer</DialogTitle>
            <DialogDescription>Share this document securely.</DialogDescription>
          </DialogHeader>
          {sendInvoice && (
            <DocumentActions kind="invoice" id={sendInvoice.id} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
