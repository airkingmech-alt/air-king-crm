import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Invoice, Quote } from "@/data/mock-data";
import { fmtCurrencyExact } from "@/data/mock-data";
import { pricebook, addOnServices, getQuoteEquipment } from "@/data/pricebook";
import { useData } from "@/context/data-context";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { invoiceEditChanges, invoiceEditForm, invoiceIsSettled, invoiceScopeLocked, quoteEditChanges, quoteEditForm, quoteIsAccepted, quoteJobTypes, recalculateQuoteOption, persistDocumentEdit, type QuoteOptionForm } from "@/lib/document-editing";

const selectClass = "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The change could not be saved. Try again.";
async function saveEdit(kind: "quote" | "invoice", original: Quote | Invoice, changes: Record<string, unknown>) {
  return persistDocumentEdit(kind, original, changes, (name, args) => supabase.rpc(name, args));
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>;
}
function EquipmentEditor({ option, initialIds, labor, materials, onApply }: { option: QuoteOptionForm; initialIds: string[]; labor: string; materials: string; onApply: (option: QuoteOptionForm) => void }) {
  const [ids, setIds] = useState(option.equipmentItems ?? initialIds);
  // A manual description explicitly clears the saved model list. Keep the
  // temporary equipment picker in sync with that deliberate parent edit.
  useEffect(() => { setIds(option.equipmentItems ?? initialIds); }, [JSON.stringify(option.equipmentItems), JSON.stringify(initialIds)]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  return <details className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Change equipment / recalculate price</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">This uses current model costs, 9% purchase tax on equipment and materials, and a 20% margin. Confirm matching and availability after changing models. Prices change only when you apply below. Changing models clears the old included features so you can review and enter the new equipment’s coverage.</p>
      <Field label={`${option.tier} equipment search`}><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search model or description" /></Field>
      <Field label={`${option.tier} add equipment`}><select className={selectClass} value="" onChange={event => { if (event.target.value && !ids.includes(event.target.value)) setIds([...ids, event.target.value]); }}>
        <option value="">Choose equipment…</option>
        {pricebook.filter(item => !search || `${item.model} ${item.description}`.toLowerCase().includes(search.toLowerCase())).map(item => <option key={item.id} value={item.id}>{item.model} · {fmtCurrencyExact(item.cost)}</option>)}
      </select></Field>
      {ids.map(id => <div key={id} className="flex items-center justify-between gap-2"><span className="break-words">{pricebook.find(item => item.id === id)?.model || `${id} (not in current catalog)`}</span><Button size="sm" variant="ghost" type="button" aria-label={`Remove ${id}`} onClick={() => setIds(ids.filter(item => item !== id))}><Trash2 size={14} /></Button></div>)}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button type="button" variant="outline" onClick={() => { try { onApply(recalculateQuoteOption(option, ids, labor, materials)); setError(""); } catch (error) { setError(errorMessage(error)); } }}>Apply equipment & recalculate {option.tier.toLowerCase()} price</Button>
    </div>
  </details>;
}

export function QuoteEditor({ quote }: { quote: Quote }) {
  const { acceptSavedRecord } = useData();
  const { toast } = useToast();
  const [original, setOriginal] = useState<Quote | null>(null);
  const [form, setForm] = useState(() => quoteEditForm(quote));
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  if (quoteIsAccepted(quote) && !original) return null;
  const setOption = (index: number, changes: Partial<QuoteOptionForm>) => setForm(current => ({ ...current, options: current.options.map((option, i) => i === index ? { ...option, ...changes } : option) }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!original || pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try {
      const saved = await saveEdit("quote", original, quoteEditChanges(original, form));
      acceptSavedRecord("quotes", saved); setOriginal(null);
      toast({ title: "Quote saved", description: "The updated quote is ready to review." });
    } catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setSaving(false); }
  };
  return <>
    <Button size="sm" variant="outline" data-testid="button-edit-quote" onClick={() => { setOriginal(structuredClone(quote)); setForm(quoteEditForm(quote)); setError(""); }}><Pencil size={14} className="mr-1.5" />Edit Quote</Button>
    <Dialog open={!!original} onOpenChange={open => { if (!open && !pending.current) setOriginal(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Edit Quote {quote.id}</DialogTitle><DialogDescription>Save changes to this quote. Its existing status and links stay with it. Existing customer links show the saved version.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-5" data-testid="form-edit-quote">
          <fieldset disabled={saving} className="min-w-0 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer name on quote"><Input value={form.customerName} onChange={event => setForm({ ...form, customerName: event.target.value })} maxLength={300} required /></Field>
              <Field label="Job type"><select value={form.jobType} className={selectClass} onChange={event => setForm({ ...form, jobType: event.target.value as Quote["jobType"] })}>{quoteJobTypes.map(type => <option key={type}>{type}</option>)}</select></Field>
            </div>
            <Field label="Quote title"><Input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} maxLength={2000} required /></Field>
            <Field label="Scope / labor description"><Textarea value={form.laborDescription} onChange={event => setForm({ ...form, laborDescription: event.target.value })} rows={4} maxLength={10000} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Internal labor cost ($)"><Input inputMode="decimal" value={form.laborCost} onChange={event => setForm({ ...form, laborCost: event.target.value })} required /></Field>
              <Field label="Internal materials cost ($)"><Input inputMode="decimal" value={form.materialsCost} onChange={event => setForm({ ...form, materialsCost: event.target.value })} required /></Field>
            </div>
            <p className="text-xs text-muted-foreground">Quoted prices stay as entered. Use each option's recalculation control to apply new labor, materials, or equipment costs.</p>
            {form.options.map((option, index) => <section key={option.tier} className="min-w-0 rounded-lg border p-4 space-y-3">
              <div className="flex justify-between items-center gap-2"><h3 className="font-semibold">{option.tier} option</h3>{form.options.length > 1 && <Button variant="ghost" size="sm" type="button" aria-label={`Remove ${option.tier} option`} onClick={() => setForm({ ...form, options: form.options.filter((_, i) => i !== index) })}><Trash2 size={14} /></Button>}</div>
              <div className="grid gap-3 sm:grid-cols-2"><Field label={`${option.tier} option name`}><Input value={option.label} maxLength={200} required onChange={event => setOption(index, { label: event.target.value })} /></Field><Field label={`${option.tier} customer price ($)`}><Input inputMode="decimal" value={option.customerPrice} required onChange={event => setOption(index, { customerPrice: event.target.value })} /></Field></div>
              <Field label={`${option.tier} equipment description`}><Textarea value={option.equipmentSummary ?? option.equipment} rows={3} maxLength={10000} onChange={event => setOption(index, { equipment: event.target.value, equipmentSummary: event.target.value, equipmentItems: [], ...(option.equipmentItems?.length ? { featureText: "", efficiency: "Manual equipment description; verify matching and efficiency" } : {}) })} /></Field>
              <p className="text-xs text-muted-foreground">Typing a manual equipment description clears this option’s model list and model-specific features for review. Use the equipment control below to select exact models.</p>
              <Field label={`${option.tier} efficiency / match details`}><Input value={option.efficiency} maxLength={2000} onChange={event => setOption(index, { efficiency: event.target.value })} /></Field>
              <Field label={`${option.tier} included features (one per line)`}><Textarea value={option.featureText} maxLength={10000} onChange={event => setOption(index, { featureText: event.target.value })} /></Field>
              <EquipmentEditor option={option} initialIds={getQuoteEquipment(original || quote, option.tier).map(item => item.id)} labor={form.laborCost} materials={form.materialsCost} onApply={updated => setOption(index, updated)} />
            </section>)}
            {form.options.length < 3 && <Button variant="outline" type="button" onClick={() => { const tier = (["Good", "Better", "Best"] as const).find(tier => !form.options.some(option => option.tier === tier))!; setForm({ ...form, options: [...form.options, { tier, label: `${tier} option`, equipment: "", efficiency: "Matched-system efficiency to be verified", totalCost: 0, customerPrice: "", featureText: "", equipmentItems: [] }] }); }}><Plus size={14} className="mr-1.5" />Add option</Button>}
            <section className="space-y-2"><h3 className="font-semibold text-sm">Selected add-ons</h3>{(quote.addOnCatalog || addOnServices).map(addon => <label key={addon.id} className="flex gap-2 items-start text-sm"><input type="checkbox" className="mt-1" checked={form.selectedAddOns.includes(addon.id)} onChange={event => setForm({ ...form, selectedAddOns: event.target.checked ? [...form.selectedAddOns, addon.id] : form.selectedAddOns.filter(id => id !== addon.id) })} /><span>{addon.name} · {fmtCurrencyExact(addon.price)}</span></label>)}</section>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive" data-testid="document-edit-error">{error}</p>}
          <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setOriginal(null)}>Cancel</Button><Button type="submit" disabled={saving} data-testid="button-save-quote">{saving ? "Saving…" : "Save Quote"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

export function InvoiceEditor({ invoice }: { invoice: Invoice }) {
  const { acceptSavedRecord, workOrders } = useData();
  const { toast } = useToast();
  const [original, setOriginal] = useState<Invoice | null>(null);
  const [form, setForm] = useState(() => invoiceEditForm(invoice));
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const locked = invoiceScopeLocked(invoice, workOrders);
  if (invoiceIsSettled(invoice) && !original) return <p className="max-w-xs text-xs text-muted-foreground">{invoice.status === "Void" ? "Void invoice" : "Payment recorded"}: the original billing history is retained. Contact the owner about a correction or adjustment.</p>;
  const total = form.items.reduce((sum, item) => sum + (Number.isFinite(Number(item.amount)) ? Math.round(Number(item.amount) * 100) : 0), 0) / 100;
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!original || pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try {
      const saved = await saveEdit("invoice", original, invoiceEditChanges(original, form, locked));
      acceptSavedRecord("invoices", saved); setOriginal(null);
      toast({ title: "Invoice saved", description: "The updated invoice is ready to review." });
    } catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setSaving(false); }
  };
  return <>
    <Button size="sm" variant="outline" data-testid="button-edit-invoice" onClick={() => { setOriginal(structuredClone(invoice)); setForm(invoiceEditForm(invoice)); setError(""); }}><Pencil size={14} className="mr-1.5" />Edit Invoice</Button>
    <Dialog open={!!original} onOpenChange={open => { if (!open && !pending.current) setOriginal(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Edit Invoice {invoice.id}</DialogTitle><DialogDescription>Save changes without sending a message or recording a payment. Existing customer links show the saved invoice.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-4" data-testid="form-edit-invoice">
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            {locked && <div className="rounded-md bg-amber-50 text-amber-950 p-3 text-sm">This invoice uses accepted quote pricing. Project details and the due date can be edited here. To change the approved scope or price, open the quote and create a draft revision.{invoice.quoteId && <Link href={`/proposals/${invoice.quoteId}`} className="ml-1 underline">Open Quote</Link>}</div>}
            <Field label="Customer name on invoice"><Input value={form.customerName} disabled={locked} maxLength={300} required onChange={event => setForm({ ...form, customerName: event.target.value })} /></Field>
            <Field label="Project name"><Input value={form.projectName} maxLength={200} onChange={event => setForm({ ...form, projectName: event.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Construction stage"><select className={selectClass} value={form.constructionStage} onChange={event => setForm({ ...form, constructionStage: event.target.value })}><option value="">Not applicable</option><option>Rough-in</option><option>Finish</option></select></Field><Field label="Due date"><Input type="date" value={form.dueDate} required onChange={event => setForm({ ...form, dueDate: event.target.value })} /></Field></div>
            <section className="space-y-3"><h3 className="font-semibold text-sm">Invoice items</h3>{form.items.map((item, index) => <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_130px_auto]">
              <Field label={`Item ${index + 1} description`}><Textarea value={item.description} disabled={locked} required maxLength={2000} onChange={event => setForm({ ...form, items: form.items.map((line, i) => i === index ? { ...line, description: event.target.value } : line) })} /></Field>
              <Field label={`Item ${index + 1} amount ($)`}><Input inputMode="decimal" value={item.amount} disabled={locked} required onChange={event => setForm({ ...form, items: form.items.map((line, i) => i === index ? { ...line, amount: event.target.value } : line) })} /></Field>
              {!locked && <Button type="button" variant="ghost" size="sm" aria-label={`Remove item ${index + 1}`} className="sm:mt-6" disabled={form.items.length < 2} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}><Trash2 size={14} /></Button>}
            </div>)}{!locked && <Button type="button" variant="outline" onClick={() => setForm({ ...form, items: [...form.items, { description: "", amount: "" }] })}><Plus size={14} className="mr-1.5" />Add item</Button>}</section>
            <p className="text-right font-semibold">Invoice total: {fmtCurrencyExact(total)}</p>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive" data-testid="document-edit-error">{error}</p>}
          <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setOriginal(null)}>Cancel</Button><Button type="submit" disabled={saving} data-testid="button-save-invoice">{saving ? "Saving…" : "Save Invoice"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
