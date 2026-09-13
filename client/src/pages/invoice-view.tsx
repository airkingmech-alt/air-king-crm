import { DocumentActions, InvoicePayments } from "@/components/document-actions";
import { BrandedInvoice } from "@/components/branded-invoice";
import { useParams } from "wouter";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useData } from "@/context/data-context";

export default function InvoiceView() {
  const { id } = useParams<{ id: string }>();
  const { invoices } = useData();
  const invoice = invoices.find((item) => item.id === id);

  if (!invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-50 to-background px-4 dark:from-slate-900 dark:to-background">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Invoice not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-background dark:from-slate-900 dark:to-background print:bg-white print:from-white print:to-white">
      <style>{`
        @media print {
          body { background: #fff !important; }
          .print-hide { display: none !important; }
        }
      `}</style>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:py-12 print:max-w-full print:p-0">
        <Card className="overflow-hidden shadow-xl print:border-0 print:shadow-none">
          <BrandedInvoice
            invoiceNumber={invoice.id}
            customerName={invoice.customerName}
            status={invoice.status}
            dueDate={invoice.dueDate}
            sentDate={invoice.sentDate}
            items={invoice.items}
            amount={invoice.amount}
            paidAmount={invoice.paidAmount}
          />
        </Card>

        <Card className="print-hide">
          <CardContent className="p-6">
            <DocumentActions kind="invoice" id={invoice.id} />
            <InvoicePayments id={invoice.id} />
          </CardContent>
        </Card>

        <div className="print-hide flex items-start justify-center gap-2 text-xs text-muted-foreground">
          <Check size={12} className="mt-0.5 shrink-0 text-emerald-500" />
          <span>Licensed and insured HVAC professionals</span>
        </div>
      </div>
    </div>
  );
}
