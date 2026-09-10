import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wind, ShieldCheck } from "lucide-react";
import { crm } from "@/lib/crm-api";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n || 0,
  );
export default function CustomerDocument() {
  const { token } = useParams<{ token: string }>();
  const [option, setOption] = useState("");
  const [name, setName] = useState("");
  const [signature, setSignature] = useState("");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["public-document", token],
    queryFn: () => crm("public/documents/" + token),
    refetchInterval: 15000,
  });
  async function act(decision?: string) {
    setBusy(true);
    setNotice("");
    try {
      if (decision) {
        await crm("public/documents/" + token + "/decision", "POST", {
          decision,
          name,
          signature,
          option,
          message,
          confirmed,
        });
        setNotice(
          decision === "accepted"
            ? "Thank you. Your acceptance has been recorded. Air King will contact you about next steps."
            : "Your decision has been recorded. Thank you for considering Air King.",
        );
        await refetch();
      } else {
        const r = await crm("public/documents/" + token + "/checkout", "POST", {
          amount:
            amount ||
            String(
              Math.max(0, data.document.amount - data.document.paidAmount),
            ),
        });
        window.location.assign(r.url);
      }
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (isLoading || error)
    return (
      <div className="p-10 text-center">
        {error ? (error as Error).message : "Loading your document…"}
      </div>
    );
  const d = data.document;
  const closed =
    ["Won", "Lost", "Accepted", "Declined", "Expired", "Cancelled"].includes(
      d.status,
    ) ||
    (d.expiresAt && Date.parse(d.expiresAt) < Date.now());
  const due = Math.max(0, d.amount - d.paidAmount);
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-background">
      <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
        <header className="flex gap-3 items-center">
          <div className="p-3 rounded-xl bg-sky-700 text-white">
            <Wind />
          </div>
          <div>
            <p className="font-bold">{data.company}</p>
            <p className="text-sm text-muted-foreground">
              Lathrop, Missouri · Licensed and insured
            </p>
          </div>
        </header>
        <Card>
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-sm uppercase text-muted-foreground">
                  {data.kind} {d.number}
                </p>
                <h1 className="text-2xl font-bold">
                  {data.kind === "quote" ? d.title : "Your invoice"}
                </h1>
                <p className="text-muted-foreground">
                  Prepared for {d.customerName}
                </p>
              </div>
              <span className="text-sm font-medium">
                {(
                  {
                    Won: "Accepted",
                    Lost: "Declined",
                    Partial: "Partially Paid",
                  } as Record<string, string>
                )[d.status] || d.status}
              </span>
            </div>
            {data.kind === "quote" ? (
              <>
                <section>
                  <h2 className="font-semibold mb-2">Scope of work</h2>
                  <p className="whitespace-pre-wrap text-sm">{d.scope}</p>
                </section>
                <div className="grid md:grid-cols-3 gap-3">
                  {d.options.map((o: any) => (
                    <button
                      disabled={closed}
                      key={o.tier}
                      onClick={() => setOption(o.tier)}
                      className={`text-left rounded-xl border-2 p-4 space-y-3 ${(option || d.selectedOption) === o.tier ? "border-sky-600 bg-sky-50" : "border-border"}`}
                    >
                      <div className="text-xs uppercase font-bold text-sky-700">
                        {o.tier}
                      </div>
                      <h2 className="font-bold">{o.label}</h2>
                      <p className="text-2xl font-bold">
                        {money(o.customerPrice)}
                      </p>
                      <p className="text-sm">{o.equipment}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.efficiency}
                      </p>
                      <ul className="text-xs space-y-2">
                        {(o.features || []).map((f: string, i: number) => (
                          <li key={i}>✓ {f}</li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
                {!closed && (
                  <section className="space-y-3 border-t pt-5">
                    <h2 className="font-semibold">Your decision</h2>
                    <Label htmlFor="customer-name">Your name</Label>
                    <Input
                      id="customer-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Label htmlFor="signature">
                      Electronic signature — type your full name
                    </Label>
                    <Input
                      id="signature"
                      value={signature}
                      onChange={(e) => setSignature(e.target.value)}
                    />
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      I agree to the selected option and scope above, and intend
                      my typed name to be my electronic signature.
                    </label>
                    <Label htmlFor="customer-message">
                      Message to Air King (optional)
                    </Label>
                    <Textarea
                      id="customer-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <div className="flex gap-3">
                      <Button
                        disabled={
                          busy || !option || !name || !signature || !confirmed
                        }
                        onClick={() => act("accepted")}
                      >
                        Accept Quote
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || !name}
                        onClick={() => act("declined")}
                      >
                        Decline Quote
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      No payment is required to accept your quote.
                    </p>
                  </section>
                )}
              </>
            ) : (
              <>
                <div className="divide-y">
                  {d.items.map((x: any, i: number) => (
                    <div key={i} className="flex justify-between py-3 gap-4">
                      <span>{x.description}</span>
                      <span>{money(x.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span>Invoice total</span>
                    <strong>{money(d.amount)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Paid</span>
                    <span>{money(d.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between text-xl">
                    <strong>Remaining balance</strong>
                    <strong>{money(due)}</strong>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Due {d.dueDate}
                  </p>
                </div>
                {due > 0 && d.status !== "Void" && (
                  <div className="space-y-3">
                    <Label htmlFor="pay-amount">
                      Pay in full or enter a partial payment
                    </Label>
                    <Input
                      id="pay-amount"
                      inputMode="decimal"
                      placeholder={String(due.toFixed(2))}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <Button
                      className="w-full text-lg py-6"
                      disabled={busy || !data.payments_enabled}
                      onClick={() => act()}
                    >
                      PAY NOW
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {data.payments_enabled
                        ? "Secure card payment through Stripe. The invoice updates after your payment is confirmed."
                        : "Online payments are not enabled yet. Please contact Air King to arrange payment."}
                    </p>
                  </div>
                )}
                <section className="space-y-2">
                  <h2 className="font-semibold">Payment history</h2>
                  {data.payments.map((p: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>
                        {p.source === "opening_balance"
                          ? "Earlier payments"
                          : p.method}{" "}
                        ·{" "}
                        {p.paid_at
                          ? new Date(p.paid_at).toLocaleDateString()
                          : ""}
                      </span>
                      <span>
                        {money(p.amount_cents / 100)}{" "}
                        {p.receipt_url && (
                          <a
                            className="text-sky-700 underline"
                            href={p.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Receipt
                          </a>
                        )}
                      </span>
                    </div>
                  ))}
                </section>
              </>
            )}
            {notice && (
              <p className="rounded-lg bg-sky-50 p-4 text-sm" role="status">
                {notice}
              </p>
            )}
          </CardContent>
        </Card>
        <footer className="flex justify-center items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck size={16} />
          Air King Mechanical Services LLC
        </footer>
      </div>
    </div>
  );
}
export function Unsubscribe() {
  const { token } = useParams<{ token: string }>();
  const [message, setMessage] = useState("");
  return (
    <div className="max-w-lg mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold">Communication preferences</h1>
      <p>
        Stop promotional emails and texts from Air King. This will not cancel
        your service or affect invoice emails.
      </p>
      <Button
        onClick={async () => {
          try {
            const r = await crm("public/unsubscribe/" + token, "POST");
            setMessage(r.message);
          } catch (e: any) {
            setMessage(e.message);
          }
        }}
      >
        Unsubscribe from marketing
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
