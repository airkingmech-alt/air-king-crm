import { useEffect, useRef, useState } from "react";
import { useData } from "@/context/data-context";
import { useToast } from "@/hooks/use-toast";
import { buildQuoteOptions, type QuoteDraftInput } from "@/lib/quote-pricing";
import type { Customer, Quote } from "@/data/mock-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function MaintenanceQuoteForm({ customer, onCancel, onSaved }: { customer?: Pick<Customer, "id" | "name">; onCancel: () => void; onSaved: (quote: Quote) => void }) {
  const { createQuote } = useData();
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [labor, setLabor] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const input: QuoteDraftInput = { customerId: customer?.id || "", customerName: customer?.name || "", jobType: "Maintenance", title: `Maintenance — ${description.trim().slice(0, 100)}`, laborDescription: description.trim(), equipmentItems: [], equipmentCost: 0, materialsCost: 0, laborCost: Number(labor), selectedAddOns: [], servicePrice: Number(price) };
  let valid = !!customer;
  try { buildQuoteOptions(input); } catch { valid = false; }
  return <section className="space-y-4 rounded-lg border p-4" data-testid="maintenance-form">
    <h2 className="font-semibold">Service-only maintenance</h2>
    <label className="block text-sm space-y-2"><span>Service description</span><Textarea data-testid="service-description" value={description} disabled={saving} onChange={e => setDescription(e.target.value)} placeholder="Describe the work, system count, and exclusions" /></label>
    <label className="block text-sm space-y-2"><span>Customer total ($)</span><Input data-testid="service-price" type="number" min="0.01" step="0.01" value={price} disabled={saving} onChange={e => setPrice(e.target.value)} /></label>
    <p className="text-sm text-muted-foreground">This is the complete fixed service price. No equipment, add-ons, tax surcharge, or margin markup will be added.</p>
    <label className="block text-sm space-y-2"><span>Internal labor cost estimate ($, optional)</span><Input data-testid="service-labor" type="number" min="0" step="0.01" value={labor} disabled={saving} onChange={e => setLabor(e.target.value)} /></label>
    <p className="text-xs text-muted-foreground">Leave blank if unknown; the draft records zero estimated cost with a review reminder. This does not change the customer total.</p>
    <div className="flex gap-2 justify-end"><Button variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button><Button data-testid="save-maintenance" disabled={!valid || saving} onClick={async () => {
      if (!valid || pending.current) return;
      pending.current = true; setSaving(true);
      try {
        const quote = await createQuote(input);
        if (mounted.current) { toast({title: "Maintenance draft saved", description: quote.id}); onSaved(quote); }
      } catch (error) {
        if (mounted.current) toast({title: "Could not save", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive"});
      } finally { pending.current = false; if (mounted.current) setSaving(false); }
    }}>{saving ? "Saving…" : "Save Draft Quote"}</Button></div>
  </section>;
}
