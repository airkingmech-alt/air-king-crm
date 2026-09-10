import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Check,
  Crown,
  Droplet,
  Filter,
  Shield,
  ShieldCheck,
  Star,
  Thermometer,
  TrendingUp,
  Wind,
  Zap,
} from "lucide-react";
import { crm } from "@/lib/crm-api";
import {
  addOnServices,
  formatEquipmentDescription,
  getTieredEquipment,
  pricebook,
} from "@/data/pricebook";

const addOnIcons: Record<string, typeof Wind> = {
  wind: Wind,
  droplet: Droplet,
  zap: Zap,
  thermostat: Thermometer,
  filter: Filter,
  crown: Crown,
};
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n || 0,
  );
export default function CustomerDocument() {
  const { token } = useParams<{ token: string }>();
  const [option, setOption] = useState("");
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
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
          addons: selectedAddOns,
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
  const chosenTier = option || d.selectedOption;
  const selectedQuoteOption = d.options?.find(
    (o: any) => o.tier === chosenTier,
  );
  const addOnTotal = addOnServices
    .filter((a) => selectedAddOns.includes(a.id))
    .reduce((sum, a) => sum + a.price, 0);
  const proposalTotal = (selectedQuoteOption?.customerPrice || 0) + addOnTotal;
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
                {d.equipmentItems?.length > 0 && (
                  <section className="rounded-xl border p-5 space-y-3">
                    <h2 className="font-semibold">Equipment Included</h2>
                    {(chosenTier
                      ? getTieredEquipment(d.equipmentItems, chosenTier)
                      : d.equipmentItems
                          .map((id: string) =>
                            pricebook.find((p) => p.id === id),
                          )
                          .filter(Boolean)
                    ).map((item: any) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border p-3"
                      >
                        <div className="rounded-lg bg-sky-50 p-2 text-sky-600">
                          <Zap size={15} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {formatEquipmentDescription(item)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.model}
                          </p>
                        </div>
                        <Badge variant="outline">{item.brand}</Badge>
                      </div>
                    ))}
                  </section>
                )}
                <div className="grid md:grid-cols-3 gap-4 pt-2">
                  {d.options.map((o: any) => (
                    <Card
                      key={o.tier}
                      onClick={() => !closed && setOption(o.tier)}
                      className={`relative cursor-pointer transition-all ${chosenTier === o.tier ? "ring-2 ring-primary shadow-lg" : "hover:shadow-md"} ${o.isPopular ? "md:scale-105" : ""}`}
                    >
                      {o.isPopular && (
                        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                          <Star size={10} className="mr-1" /> Most Popular
                        </Badge>
                      )}
                      <CardContent className="p-5 space-y-4">
                        <div className="text-center">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">
                            {o.tier}
                          </p>
                          <h2 className="text-lg font-bold">{o.label}</h2>
                          <p className="mt-3 text-2xl font-extrabold">
                            {money(o.customerPrice)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Installed · all-inclusive
                          </p>
                        </div>
                        <div className="space-y-2 text-xs">
                          <p className="font-semibold text-muted-foreground">
                            {o.equipment}
                          </p>
                          <p className="font-medium text-primary">
                            {o.efficiency}
                          </p>
                          <Separator />
                          {(o.features || []).map((f: string, i: number) => (
                            <p key={i} className="flex gap-2">
                              <Check
                                size={14}
                                className="text-emerald-500 shrink-0"
                              />
                              {f}
                            </p>
                          ))}
                        </div>
                        <Button
                          type="button"
                          className="w-full"
                          variant={
                            chosenTier === o.tier ? "default" : "outline"
                          }
                          disabled={closed}
                        >
                          {chosenTier === o.tier
                            ? "Selected"
                            : `Select ${o.tier}`}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <section className="rounded-xl border p-5">
                  <h2 className="font-semibold">Enhance Your System</h2>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Optional add-ons — select to add to your package
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {addOnServices.map((addon) => {
                      const selected = selectedAddOns.includes(addon.id);
                      const Icon = addOnIcons[addon.icon] || Zap;
                      return (
                        <button
                          type="button"
                          disabled={closed}
                          key={addon.id}
                          onClick={() =>
                            setSelectedAddOns((current) =>
                              current.includes(addon.id)
                                ? current.filter((id) => id !== addon.id)
                                : [...current, addon.id],
                            )
                          }
                          className={`flex items-start gap-3 rounded-lg border p-3 text-left ${selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                        >
                          <Icon size={16} className="mt-1 text-primary" />
                          <span className="flex-1">
                            <span className="block text-xs font-medium">
                              {addon.name}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">
                              {addon.description}
                            </span>
                            <span className="block text-xs font-semibold">
                              {money(addon.price)}
                            </span>
                          </span>
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? "bg-primary text-primary-foreground" : ""}`}
                          >
                            {selected && <Check size={12} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                {chosenTier && (
                  <section className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                    <h2 className="font-semibold">Your Selection</h2>
                    <div className="flex justify-between text-sm">
                      <span>{selectedQuoteOption?.label} Package</span>
                      <span>{money(selectedQuoteOption?.customerPrice)}</span>
                    </div>
                    {selectedAddOns.map((id) => {
                      const addon = addOnServices.find((a) => a.id === id);
                      return addon ? (
                        <div key={id} className="flex justify-between text-sm">
                          <span>{addon.name}</span>
                          <span>{money(addon.price)}</span>
                        </div>
                      ) : null;
                    })}
                    <Separator />
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total Installed Price</span>
                      <span>{money(proposalTotal)}</span>
                    </div>
                    <p className="flex items-center gap-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-700">
                      <TrendingUp size={14} /> Est.{" "}
                      {money(Math.round(proposalTotal / 60))}/mo with financing
                      · Subject to credit approval · Wisetack
                    </p>
                  </section>
                )}
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
                <section className="rounded-xl border p-5 space-y-3 text-xs text-muted-foreground">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Shield size={16} className="text-primary" /> Warranty &
                    Guarantees
                  </h2>
                  <p>
                    ✓ 10-year parts and labor warranty on all Champion equipment
                  </p>
                  <p>
                    ✓ 100% satisfaction guarantee — if you are not happy, we
                    will make it right
                  </p>
                  <p>✓ Licensed and insured HVAC professionals</p>
                  <Separator />
                  <p>
                    Proposal valid for 30 days. Balance is due upon completion.
                    Financing is subject to credit approval. Prices include
                    equipment, labor, and standard materials. Non-standard
                    ductwork, electrical upgrades, or permits may require
                    additional charges.
                  </p>
                </section>
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
