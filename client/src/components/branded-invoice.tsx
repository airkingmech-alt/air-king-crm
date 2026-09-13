import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fmtCurrencyExact } from "@/data/mock-data";
import airKingLogo from "@/assets/air-king-logo.jpg";

const statusStyles: Record<string, string> = {
  Paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  Overdue: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  Partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Sent: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  Viewed: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  Void: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  Draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const statusLabel = (status: string) =>
  status === "Partial" ? "Partially Paid" : status;

const displayDate = (value: string) => {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
};

export function BrandedInvoice({
  invoiceNumber,
  customerName,
  status,
  dueDate,
  sentDate,
  items,
  amount,
  paidAmount,
  children,
}: {
  invoiceNumber: string;
  customerName: string;
  status: string;
  dueDate: string;
  sentDate?: string;
  items: { description: string; amount: number }[];
  amount: number;
  paidAmount: number;
  children?: ReactNode;
}) {
  const balanceDue = Math.max(0, amount - paidAmount);

  return (
    <article className="overflow-hidden border-t-[7px] border-t-[#b7192f] bg-card text-card-foreground print:border-x-0 print:border-b-0">
      <div className="p-6 sm:p-8 print:p-0">
        <header className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:gap-8">
          <div className="min-w-[250px]">
            <img
              src={airKingLogo}
              alt="Air King logo"
              className="h-[78px] w-[132px] bg-white object-contain"
            />
            <p className="mt-2 text-sm font-semibold">Mechanical Services LLC</p>
            <address className="mt-1 text-xs not-italic leading-relaxed text-muted-foreground">
              1820 NE 288th St
              <br />
              Turney, MO 64493
              <br />
              <a href="mailto:airkingmech@gmail.com">airkingmech@gmail.com</a>
              <br />
              <a href="tel:+18165196067">(816) 519-6067</a>
            </address>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Licensed &amp; insured · Champion Elite Dealer
            </p>
          </div>

          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Invoice
            </p>
            <h1
              className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl"
              data-testid="text-invoice-id"
            >
              {invoiceNumber}
            </h1>
            {sentDate && (
              <p className="mt-1 text-sm text-muted-foreground">
                Sent {displayDate(sentDate)}
              </p>
            )}
            <Badge
              className={`mt-3 ${statusStyles[status] || statusStyles.Draft}`}
              data-testid="badge-invoice-status"
            >
              {statusLabel(status)}
            </Badge>
          </div>
        </header>

        <div className="my-6 h-[3px] bg-[linear-gradient(90deg,#c99828_0_35%,#b7192f_35%_100%)]" />

        <section className="mb-6 grid gap-6 sm:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Bill to
            </p>
            <p className="mt-1 font-semibold" data-testid="text-customer-name">
              {customerName}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Payment details
            </p>
            <p className="mt-1 font-semibold" data-testid="text-due-date">
              Due {displayDate(dueDate)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Status: {statusLabel(status)}
            </p>
          </div>
        </section>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Service &amp; equipment
                </th>
                <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr className="border-b" key={`${item.description}-${index}`} data-testid={`row-item-${index}`}>
                  <td className="py-4 pr-4">{item.description}</td>
                  <td className="whitespace-nowrap py-4 text-right font-medium tabular-nums">
                    {fmtCurrencyExact(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="ml-auto mt-4 w-full max-w-[310px] text-sm">
          <div className="flex justify-between gap-6 py-1">
            <span>Invoice total</span>
            <span className="font-medium tabular-nums">{fmtCurrencyExact(amount)}</span>
          </div>
          {paidAmount > 0 && (
            <div className="flex justify-between gap-6 py-1 text-muted-foreground">
              <span>Payments received</span>
              <span className="tabular-nums">−{fmtCurrencyExact(paidAmount)}</span>
            </div>
          )}
        </section>

        <section className="my-5 flex items-center justify-between gap-4 border-l-4 border-l-[#b7192f] bg-[#b7192f]/[0.07] px-4 py-3">
          <span className="font-semibold">Balance due</span>
          <strong className="text-2xl text-[#b7192f] tabular-nums" data-testid="text-balance-due">
            {fmtCurrencyExact(balanceDue)}
          </strong>
        </section>

        {children}

        <Separator className="my-6" />
        <section className="text-[11px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">Terms &amp; Conditions</p>
          <p className="mt-1">
            Payment is due by the date shown above. Approved additions or changes may be billed separately.
            Equipment warranties are subject to manufacturer registration and terms. Please contact Air King
            Mechanical Services LLC promptly with questions about this invoice.
          </p>
        </section>
        <p className="mt-5 text-center text-xs font-medium text-muted-foreground">
          Thank you for trusting Air King Mechanical Services LLC.
        </p>
      </div>
    </article>
  );
}
