import { DeleteRecord } from "@/components/delete-record";
import {
  DocumentActions,
  InvoicePayments,
} from "@/components/document-actions";
import { BrandedInvoice } from "@/components/branded-invoice";
import { Link, useParams } from "wouter";
import { ArrowLeft, Calendar, Check, FileText, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
        <div className="print-hide flex flex-wrap items-center justify-between gap-2">
          <Link href="/invoices">
            <Button variant="ghost" size="sm">
              <ArrowLeft size={15} className="mr-1.5" /> All Invoices
            </Button>
          </Link>
          <div className="flex flex-wrap gap-2">
              <DeleteRecord kind="invoice" record={invoice} destination="/invoices" />
            {invoice.quoteId && (
              <Link href={`/proposals/${invoice.quoteId}`}>
                <Button variant="outline" size="sm">
                  <FileText size={14} className="mr-1.5" /> Open Quote
                </Button>
              </Link>
            )}
            {invoice.workOrderId && (
              <Link href={`/schedule?job=${invoice.workOrderId}`}>
                <Button variant="outline" size="sm">
                  <Calendar size={14} className="mr-1.5" /> Open Job
                </Button>
              </Link>
            )}
            <Link href={`/customers/${invoice.customerId}`}>
              <Button variant="outline" size="sm">
                <User size={14} className="mr-1.5" /> Customer
              </Button>
            </Link>
          </div>
        </div>
        <Card className="overflow-hidden shadow-xl print:border-0 print:shadow-none">
          <BrandedInvoice
            invoiceNumber={invoice.id}
            customerName={invoice.customerName}
            projectName={invoice.projectName}
            constructionStage={invoice.constructionStage}
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
            <InvoicePayments id={invoice.id} total={invoice.amount} status={invoice.status} />
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
