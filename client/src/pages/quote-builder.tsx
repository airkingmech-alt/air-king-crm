import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerCombobox } from "@/components/customer-combobox";
import { MaintenanceQuoteForm } from "@/components/maintenance-quote-form";
import { ManualQuoteBuilder } from "@/components/manual-quote-builder";
import { useData } from "@/context/data-context";
import { fmtCurrency } from "@/data/mock-data";
import { documentNumber } from "../../../shared/document-number";

export default function Quotes() {
  const { quotes, customers, workOrders, invoices } = useData();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [pendingOnly,setPendingOnly]=useState(()=>new URLSearchParams(window.location.hash.split("?")[1] || "").get("status")==="pending");
  const [serviceOnly, setServiceOnly] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("");

  if (showBuilder) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <Button variant="ghost" size="sm" onClick={() => setShowBuilder(false)}>
          <ArrowLeft size={16} className="mr-1.5" /> Back to Quotes
        </Button>

        <div>
          <h1 className="text-xl font-bold tracking-tight">New Quote</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Build a draft with actual model-priced options
          </p>
        </div>

        {/* Customer Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              1. Select Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerCombobox
              value={selectedCustomer}
              onChange={setSelectedCustomer}
              testId="select-quote-customer"
            />
          </CardContent>
        </Card>

        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={serviceOnly} onChange={e => setServiceOnly(e.target.checked)} data-testid="service-only-toggle" />Maintenance — service only</label>
        {serviceOnly ? <MaintenanceQuoteForm key={selectedCustomer} customer={customers.find(c => c.id === selectedCustomer)} onCancel={() => setShowBuilder(false)} onSaved={quote => { setShowBuilder(false); setLocation(`/proposals/${quote.id}`); }} /> : <ManualQuoteBuilder customerId={selectedCustomer} onCancel={() => setShowBuilder(false)} onSaved={quote => { setShowBuilder(false); setLocation(`/proposals/${quote.id}`); }} />}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Quotes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {quotes.length} quotes ·{" "}
            {quotes.filter((q) => q.status === "Quote Sent").length} pending
          </p>
        </div>
        <div className="flex gap-2"><Link href="/quotes/new-house"><Button size="sm" variant="outline">New House Quote</Button></Link><Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowBuilder(true)}><Plus size={16} className="mr-1.5" />New Quote</Button></div>
      </div>

      <Input aria-label="Search quotes" placeholder="Search number, customer or title" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="grid grid-cols-1 gap-4">
        {pendingOnly && <div className="col-span-full flex items-center gap-3 text-sm"><span>Showing pending quotes</span><Button variant="outline" size="sm" onClick={()=>setPendingOnly(false)}>Show all quotes</Button></div>}
        {quotes.filter(quote=>(!pendingOnly || quote.status==="Quote Sent") && [documentNumber(quote), quote.id, quote.customerName, quote.title].some(value=>value.toLowerCase().includes(search.toLowerCase()))).map((quote) => {
          const linkedJob = workOrders.find((job) => job.quoteId === quote.id);
          const linkedInvoice = invoices.find(
            (invoice) => invoice.quoteId === quote.id,
          );
          return (
            <Card key={quote.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-semibold">{documentNumber(quote)}</p>
                      <Badge
                        variant={
                          quote.status === "Won" ? "default" : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {quote.status}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {quote.jobType}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium">{quote.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {quote.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created {quote.createdAt}
                    </p>
                    {quote.newHouseSnapshot && <Link className="text-sm underline" href={`/quotes/new-house/${quote.id}`}>View saved new-house takeoff</Link>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-1.5">
                      {quote.options.map((opt) => (
                        <div key={opt.tier} className="text-center">
                          <Badge
                            variant={opt.isPopular ? "default" : "outline"}
                            className="text-[10px] mb-1"
                          >
                            {opt.manualConfiguration ? opt.label : opt.tier}
                            {opt.isPopular && " ★"}
                          </Badge>
                          <p className="text-xs font-semibold">
                            {fmtCurrency(opt.customerPrice)}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {quote.status === "Won" && linkedJob && (
                        <Link href={`/schedule?job=${linkedJob.id}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                          >
                            Schedule Job
                          </Button>
                        </Link>
                      )}
                      {linkedInvoice && (
                        <Link href={`/invoices/view/${linkedInvoice.id}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                          >
                            Open Invoice
                          </Button>
                        </Link>
                      )}
                      <Link href={`/proposals/${quote.id}`}>
                        <Button size="sm" className="text-xs">
                          {quote.status === "Won"
                            ? "Continue"
                            : "View Proposal"}
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
