import { useParams } from "wouter";
import { Wind, Check, CircleDollarSign, CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fmtCurrency, fmtCurrencyExact } from "@/data/mock-data";
import { useData } from "@/context/data-context";

const statusStyles: Record<string, string> = {
  Paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  Overdue: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  Partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  Sent: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
  Draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function InvoiceView() {
  const { id } = useParams<{ id: string }>();
  const { invoices } = useData();
  const invoice = invoices.find((i) => i.id === id);

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-sky-50 to-background dark:from-slate-900 dark:to-background px-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Invoice not found.</p>
        </div>
      </div>
    );
  }

  const balanceDue = Math.max(0, invoice.amount - invoice.paidAmount);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-background dark:from-slate-900 dark:to-background print:bg-white print:from-white print:to-white">
      {/* Print-friendly overrides: hide non-essential chrome and let the invoice content print cleanly */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          .print-hide { display: none !important; }
        }
      `}</style>
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 print:p-0 print:max-w-full">
        {/* Brand header */}
        <div className="flex items-center gap-2.5 mb-8" data-testid="header-brand">
          <div className="h-9 w-9 rounded-lg bg-sky-600 flex items-center justify-center shrink-0">
            <Wind size={18} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Air King Mechanical Services</p>
            <p className="text-xs text-muted-foreground leading-tight">Kansas City, MO</p>
          </div>
        </div>

        <Card className="print:shadow-none print:border-0">
          <CardContent className="p-6 sm:p-8 print:p-0">
            <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Invoice</p>
                <h1 className="text-xl font-semibold" data-testid="text-invoice-id">{invoice.id}</h1>
                <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-customer-name">
                  Billed to {invoice.customerName}
                </p>
              </div>
              <Badge className={statusStyles[invoice.status] || statusStyles.Draft} data-testid="badge-invoice-status">
                {invoice.status}
              </Badge>
            </div>

            <Separator className="mb-6" />

            {/* Line items */}
            <div className="space-y-3 mb-6">
              {invoice.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 text-sm" data-testid={`row-item-${idx}`}>
                  <span className="text-muted-foreground">{item.description}</span>
                  <span className="font-medium shrink-0">{fmtCurrency(item.amount)}</span>
                </div>
              ))}
            </div>

            <Separator className="mb-6" />

            {/* Totals */}
            <div className="space-y-2 mb-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">{fmtCurrencyExact(invoice.amount)}</span>
              </div>
              {invoice.paidAmount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    -{fmtCurrencyExact(invoice.paidAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="font-semibold">Balance Due</span>
                <span className="text-lg font-bold" data-testid="text-balance-due">
                  {fmtCurrencyExact(balanceDue)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="flex items-center gap-2 rounded-lg border p-3">
                <CalendarClock size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Due Date</p>
                  <p className="text-sm font-medium" data-testid="text-due-date">{invoice.dueDate}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border p-3">
                <CircleDollarSign size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</p>
                  <p className="text-sm font-medium">{invoice.status}</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              To make a payment or ask a question about this invoice, please contact Air King Mechanical
              Services directly.
            </p>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-start gap-2 text-xs text-muted-foreground justify-center print-hide">
          <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
          <span>Licensed and insured HVAC professionals</span>
        </div>
      </div>
    </div>
  );
}
