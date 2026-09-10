import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crm } from "@/lib/crm-api";
import { Mail, MessageSquare, Copy, Send } from "lucide-react";
export function DocumentActions({
  kind,
  id,
}: {
  kind: "quote" | "invoice";
  id: string;
}) {
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const { data: config } = useQuery({
    queryKey: ["crm-config"],
    queryFn: () => crm("crm/config"),
  });
  const smsReady = Boolean(config?.connections.twilio);
  async function act(channels?: string[]) {
    setBusy(true);
    setNotice("");
    try {
      if (!channels) {
        const data = await crm(`crm/${kind}/${id}/link`, "POST");
        setUrl(data.url);
        await navigator.clipboard.writeText(data.url);
        setNotice("Secure link copied.");
      } else {
        const data = await crm(
          `crm/${kind}/${id}/send`,
          "POST",
          { channels },
          key.current,
        );
        const failed = data.messages.filter((m: any) => m.status === "failed");
        setNotice(
          failed.length
            ? failed.map((m: any) => m.error).join(" ")
            : data.message,
        );
        key.current = crypto.randomUUID();
      }
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Send to the primary contact saved on the customer profile. Texts require
        recorded customer consent.
      </p>
      {config && !config.settings.sending_enabled && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Sending is turned off. Messages will remain queued until it is enabled
          in Integrations.
        </p>
      )}
      {config && !smsReady && (
        <p className="text-sm text-muted-foreground">
          Texting is not set up yet. You can add Twilio later in Integrations.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={() => act(["email"])}>
          <Mail size={16} className="mr-2" />
          Email
        </Button>
        <Button disabled={busy || !smsReady} onClick={() => act(["sms"])}>
          <MessageSquare size={16} className="mr-2" />
          Text
        </Button>
        <Button
          disabled={busy || !smsReady}
          variant="outline"
          onClick={() => act(["email", "sms"])}
        >
          <Send size={16} className="mr-2" />
          Email + Text
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => act()}>
          <Copy size={16} className="mr-2" />
          Copy Link
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Use Email or Text again to resend. Each delivery is saved in the
        customer timeline.
      </p>
      {url && <Input readOnly value={url} aria-label="Secure customer link" />}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}
export function InvoicePayments({ id }: { id: string }) {
  const { data = [], refetch } = useQuery({
    queryKey: ["invoice-payments", id],
    queryFn: () => crm(`crm/invoices/${id}/payments`),
  });
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const save = async () => {
    setBusy(true);
    try {
      await crm(
        `crm/invoices/${id}/payments`,
        "POST",
        { amount, method, reference },
        key.current,
      );
      key.current = crypto.randomUUID();
      setAmount("");
      setNotice("Payment recorded.");
      await refetch();
      window.dispatchEvent(new Event("crm-refresh"));
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6 border-t pt-5 space-y-3 print:hidden">
      <h2 className="font-semibold">Payment history</h2>
      {data.map((p: any) => (
        <div key={p.id} className="flex justify-between text-sm">
          <span>
            {p.source === "opening_balance" ? "Opening balance" : p.method} ·{" "}
            {p.paid_at
              ? new Date(p.paid_at).toLocaleDateString()
              : "Earlier payments"}
          </span>
          <strong>${(p.amount_cents / 100).toFixed(2)}</strong>
        </div>
      ))}
      <h3 className="font-medium">Record a payment</h3>
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-32"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Payment amount"
        />
        <select
          className="rounded border bg-background px-3"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          aria-label="Payment method"
        >
          {["Cash", "Check", "ACH", "Other"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <Input
          placeholder="Check number or reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Button disabled={busy || !amount} onClick={save}>
          Record Payment
        </Button>
      </div>
      <Button
        variant="ghost"
        disabled={busy || data.length > 0}
        onClick={async () => {
          if (
            !window.confirm(
              "Void this unpaid invoice? It will no longer accept payments or send reminders.",
            )
          )
            return;
          try {
            await crm(`crm/invoices/${id}/void`, "POST");
            setNotice("Invoice voided.");
            window.dispatchEvent(new Event("crm-refresh"));
          } catch (e: any) {
            setNotice(e.message);
          }
        }}
      >
        Void Invoice
      </Button>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
