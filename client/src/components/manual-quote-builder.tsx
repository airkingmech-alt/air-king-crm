import { QuoteAccessoryPicker } from './quote-accessory-picker';
import { accessoryTotals, optionAccessoryServiceIds } from '@shared/quote-accessories';
import { useState } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LaborDescriptionBuilder } from "@/components/labor-description-builder";
import { QuoteRebates, QuoteRebateTerms } from "@/components/quote-rebates";
import { useData } from "@/context/data-context";
import { useToast } from "@/hooks/use-toast";
import { guardSave } from "@/lib/confirmed-save";
import { buildManualQuoteOption, type ManualQuoteOptionInput } from "@/lib/manual-quote-options";
import { pricebook, addOnServices, type EquipmentCategory, type PricebookItem } from "@/data/pricebook";
import { fmtCurrencyExact, type Quote } from "@/data/mock-data";
import { documentNumber } from "@shared/document-number";
import { potentialChampionRebates, championRebateSummary } from "@shared/champion-rebates";

const sharedAddOns = addOnServices.filter(item => !optionAccessoryServiceIds.includes(item.id));
const tiers: ManualQuoteOptionInput["tier"][] = ["Value", "Good", "Better", "Best"];
const categories: EquipmentCategory[] = ["Condenser", "Furnace", "Evaporator Coil", "Heat Pump", "Air Handler", "Heat Strip", "Accessory"];
type OptionForm = Omit<ManualQuoteOptionInput, "laborCost" | "materialsCost" | "customerPriceOverride"> & {
  key: number; laborCost: string; materialsCost: string; override: boolean; customerPriceOverride: string;
};
const money = (value: string, field: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error(`${field} must be zero or more, with at most two decimal places.`);
  return Number(value);
};
const optionInput = (option: OptionForm): ManualQuoteOptionInput => ({ ...option,
  laborCost: money(option.laborCost, "Labor cost"), materialsCost: money(option.materialsCost, "Materials cost"),
  customerPriceOverride: option.override ? money(option.customerPriceOverride, "Selling price") : undefined,
});

function OptionCard({ option, index, canDuplicate, onChange, onDuplicate, onRemove }: {
  option: OptionForm; index: number; canDuplicate: boolean;
  onChange: (changes: Partial<OptionForm>) => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const [search, setSearch] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ model: "", description: "", brand: "Champion", category: "Condenser", cost: "" });
  const [manualError, setManualError] = useState("");
  const items = option.equipmentItems.map(id => pricebook.find(item => item.id === id)).filter(item => !!item);
  const offer = potentialChampionRebates(items);
  const manualItems = option.manualEquipment || [];
  const rebateAvailable = !!offer && !championRebateSummary(offer).expired && !championRebateSummary(offer).beforeWindow;
  let preview: ReturnType<typeof buildManualQuoteOption> | undefined, error = "";
  try { preview = buildManualQuoteOption(optionInput(option)); } catch (e) { error = (e as Error).message; }
  const changeEquipment = (ids: string[]) => onChange({ equipmentItems: ids, rebateConfirmed: false });
  return <Card data-testid="manual-option" className="min-w-0">
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
      <CardTitle className="text-base">Option {index + 1}</CardTitle>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!canDuplicate} onClick={onDuplicate}><Copy size={14} className="mr-1" />Duplicate option</Button>
        <Button type="button" size="sm" variant="outline" onClick={onRemove} aria-label={`Remove option ${index + 1}`}><Trash2 size={14} /></Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <Label className="block">Option name<Input aria-label={`Option ${index + 1} name`} className="mt-1" maxLength={200} value={option.label} onChange={e => onChange({ label: e.target.value })} /></Label>
      <div className="space-y-2">
        <Label className="block">Search equipment<Input className="mt-1" value={search} onChange={e => setSearch(e.target.value)} placeholder="Model, description, or brand" /></Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {categories.map(category => <Label className="block" key={category}>Add {category}
            <select aria-label={`Option ${index + 1} add ${category}`} value="" onChange={e => { if (e.target.value) changeEquipment([...option.equipmentItems, e.target.value]); }} className="mt-1 w-full min-w-0 rounded-md border bg-background p-2 text-sm">
              <option value="">Choose {category.toLowerCase()}…</option>
              {pricebook.filter(item => item.category === category && !option.equipmentItems.includes(item.id) && item.model !== "RG19080C20MPS1" && `${item.model} ${item.description} ${item.brand}`.toLowerCase().includes(search.toLowerCase())).map(item => <option key={item.id} value={item.id}>{item.brand} {item.model} — {fmtCurrencyExact(item.cost)}</option>)}
            </select>
          </Label>)}
        </div>
        <ul className="space-y-2" aria-label={`Option ${index + 1} equipment`}>
          {[...items, ...manualItems].map(item => <li key={item.id} className="flex items-start gap-2 rounded-md border p-2 text-sm"><div className="min-w-0 flex-1"><p className="font-medium break-words">{item.model}</p><p className="text-xs text-muted-foreground">{item.description}</p><p className="text-xs">Cost: {fmtCurrencyExact(item.cost)}</p></div><Button type="button" size="sm" variant="ghost" aria-label={`Remove ${item.model}`} onClick={() => { if (manualItems.some(manual => manual.id === item.id)) onChange({ manualEquipment: manualItems.filter(manual => manual.id !== item.id), rebateConfirmed: false }); else changeEquipment(option.equipmentItems.filter(id => id !== item.id)); }}><X size={14} /></Button></li>)}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={() => setManualOpen(!manualOpen)}>Enter equipment manually</Button>
        {manualOpen && <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Enter a supplier-confirmed model and cost. Manual equipment is saved only on this quote and requires installation review. Rebates are suggested from pricebook equipment only.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Label className="block">Brand<select className="mt-1 w-full rounded-md border bg-background p-2" value={manual.brand} onChange={e => setManual({ ...manual, brand: e.target.value })}>{["Champion", "Guardian"].map(brand => <option key={brand}>{brand}</option>)}</select></Label>
            <Label className="block">Category<select className="mt-1 w-full rounded-md border bg-background p-2" value={manual.category} onChange={e => setManual({ ...manual, category: e.target.value })}>{categories.map(category => <option key={category}>{category}</option>)}</select></Label>
            <Label className="block">Model<Input className="mt-1" value={manual.model} onChange={e => setManual({ ...manual, model: e.target.value })} /></Label>
            <Label className="block">Equipment cost<Input className="mt-1" type="number" min="0.01" step="0.01" value={manual.cost} onChange={e => setManual({ ...manual, cost: e.target.value })} /></Label>
          </div>
          <Label className="block">Description<Input className="mt-1" value={manual.description} onChange={e => setManual({ ...manual, description: e.target.value })} /></Label>
          {manualError && <p role="alert" className="text-sm text-destructive">{manualError}</p>}
          <Button type="button" size="sm" onClick={() => { try {
            const cost = money(manual.cost, "Equipment cost");
            if (!manual.model.trim() || !manual.description.trim() || cost <= 0) throw new Error("Enter a model, description, and positive supplier cost.");
            if (manual.model.trim().toUpperCase() === "RG19080C20MPS1") throw new Error("This unavailable furnace model is excluded.");
            const item: PricebookItem = { id: `manual-${crypto.randomUUID()}`, brand: manual.brand as PricebookItem["brand"], category: manual.category as EquipmentCategory, model: manual.model.trim(), description: manual.description.trim(), cost };
            onChange({ manualEquipment: [...manualItems, item], rebateConfirmed: false }); setManual({ ...manual, model: "", description: "", cost: "" }); setManualError(""); setManualOpen(false);
          } catch (e) { setManualError((e as Error).message); } }}>Add manual equipment</Button>
        </div>}
      </div>
      <QuoteAccessoryPicker value={option.accessories || []} onChange={accessories => onChange({accessories})} optionNumber={index + 1} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Label className="block">Labor cost<Input aria-label={`Option ${index + 1} labor cost`} type="number" min="0" step="0.01" className="mt-1" value={option.laborCost} onChange={e => onChange({ laborCost: e.target.value })} /></Label>
        <Label className="block">Other materials cost (excludes listed accessory parts)<Input aria-label={`Option ${index + 1} materials cost`} type="number" min="0" step="0.01" className="mt-1" value={option.materialsCost} onChange={e => onChange({ materialsCost: e.target.value })} /></Label>
      </div>
      <fieldset className="space-y-2"><legend className="text-sm font-semibold mb-2">Warranty</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={option.partsWarranty} onChange={e => onChange({ partsWarranty: e.target.checked })} />10-year parts warranty</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={option.laborWarranty} onChange={e => onChange({ laborWarranty: e.target.checked })} />10-year labor warranty — $350 cost allowance</label>
      </fieldset>
      <div className="space-y-2">
        {offer ? <QuoteRebates offer={offer} /> : <p className="text-sm text-muted-foreground">No potential rebate found for this option’s selected models.</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!rebateAvailable} checked={option.rebateConfirmed} onChange={e => onChange({ rebateConfirmed: e.target.checked })} /><span>Include the suggested potential rebate on this option. I have reviewed the models and program requirements.</span></label>
        <p className="text-xs text-muted-foreground">Rebates are separate from the selling price. Changing equipment clears this confirmation.</p>
      </div>
      <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm" aria-label={`Option ${index + 1} pricing`}>
        {preview && <><div className="flex justify-between gap-2"><span>Equipment cost</span><span>{fmtCurrencyExact(preview.equipmentCost || 0)}</span></div>
          <div className="flex justify-between gap-2"><span>Purchase tax allowance</span><span>{fmtCurrencyExact(preview.purchaseTax || 0)}</span></div>
          <div className="flex justify-between gap-2"><span>{accessoryTotals(option.accessories).missingServiceCost ? "Known internal cost (service costs incomplete)" : "Total internal cost"}</span><span>{fmtCurrencyExact(preview.totalCost)}</span></div>
          <div className="flex justify-between gap-2 font-semibold"><span>{option.override ? "Selling price override" : "Calculated selling price"}</span><span>{fmtCurrencyExact(preview.customerPrice)}</span></div>
          <p className="text-xs text-muted-foreground">Includes this option’s equipment, accessories, labor, other materials, and selected warranty coverage. Remove itemized accessory parts from any existing materials allowance to avoid counting them twice.</p></>}
        {error && <p role="status" className="text-amber-700">{error}</p>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={option.override} onChange={e => onChange({ override: e.target.checked, customerPriceOverride: option.customerPriceOverride || String(preview?.customerPrice || "") })} />Override selling price</label>
        {option.override && <Label className="block">Selling price<Input aria-label={`Option ${index + 1} selling price`} type="number" min="0.01" step="0.01" className="mt-1" value={option.customerPriceOverride} onChange={e => onChange({ customerPriceOverride: e.target.value })} /><span className="text-xs text-muted-foreground">This price stays fixed when costs change. Uncheck to return to calculated pricing.</span></Label>}
      </div>
      {preview?.efficiency && <p className="text-xs text-muted-foreground">{preview.efficiency}</p>}
    </CardContent>
  </Card>;
}

export function ManualQuoteBuilder({ customerId, jobType = "Changeout", onCancel, onSaved }: { customerId: string; jobType?: Quote["jobType"]; onCancel: () => void; onSaved: (quote: Quote) => void }) {
  const { customers, createQuote } = useData();
  const { toast } = useToast();
  const [options, setOptions] = useState<OptionForm[]>([]);
  const [title, setTitle] = useState("Equipment installation options");
  const [description, setDescription] = useState("Remove old equipment and install the equipment listed in the selected option. Reconnect applicable utilities and controls, complete startup, and clean the work area.");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [scopeNotes, setScopeNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const updateOptions = (next: OptionForm[]) => setOptions(next.map((option, index) => ({ ...option, tier: tiers[index] })));
  const addOption = () => updateOptions([...options, { key: Date.now(), tier: tiers[options.length], label: `Option ${options.length + 1}`, equipmentItems: [], accessories: [], laborCost: "1200", materialsCost: "450", partsWarranty: false, laborWarranty: false, rebateConfirmed: false, override: false, customerPriceOverride: "" }]);
  let valid = options.length > 0;
  try { options.forEach(option => buildManualQuoteOption(optionInput(option))); } catch { valid = false; }
  return <div className="space-y-5" data-testid="manual-quote-builder">
    <div className="space-y-2"><h2 className="font-semibold">Build your options</h2><p className="text-sm text-muted-foreground">Add up to four independent options. The customer chooses one; their prices are never combined.</p></div>
    <Label className="block">Quote title<Input className="mt-1" maxLength={2000} value={title} onChange={e => setTitle(e.target.value)} /></Label>
    <fieldset disabled={saving} className="space-y-4">
      {options.map((option, index) => <OptionCard key={option.key} option={option} index={index} canDuplicate={options.length < 4}
        onChange={changes => updateOptions(options.map((current, i) => i === index ? { ...current, ...changes } : current))}
        onDuplicate={() => updateOptions([...options, { ...structuredClone(option), key: Date.now(), label: `${option.label} copy`.slice(0,200), rebateConfirmed: false }])}
        onRemove={() => updateOptions(options.filter((_, i) => i !== index))} />)}
      <Button type="button" variant="outline" disabled={options.length >= 4} onClick={addOption} data-testid="add-quote-option"><Plus size={16} className="mr-1" />Add option</Button>
      <p className="text-xs text-muted-foreground">The description helper below writes shared installation scope. Alternative equipment remains listed separately in each option.</p>
      <LaborDescriptionBuilder equipment={[]} addOns={sharedAddOns.filter(addOn => addOns.includes(addOn.id))} scope={scopeNotes} onScopeChange={setScopeNotes} onApply={setDescription} />
      <Label className="block">Shared scope of work<Textarea className="mt-1" rows={4} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)} /><span className="text-xs text-muted-foreground">Applies to whichever option the customer chooses. Each option lists its own equipment.</span></Label>
      <Card><CardHeader><CardTitle className="text-sm">Customer add-on choices</CardTitle></CardHeader><CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">{sharedAddOns.map(addOn => <label key={addOn.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={addOns.includes(addOn.id)} onChange={e => setAddOns(e.target.checked ? [...addOns, addOn.id] : addOns.filter(id => id !== addOn.id))} /><span>{addOn.name} — {fmtCurrencyExact(addOn.price)}</span></label>)}</CardContent></Card>
    </fieldset>
    {options.some(option => option.rebateConfirmed) && <QuoteRebateTerms />}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button><Button type="button" data-testid="button-generate-quote" disabled={saving || !valid || !customerId || !title.trim() || !description.trim()} onClick={guardSave("create-manual-quote", async () => {
      const customer = customers.find(c => c.id === customerId);
      if (!customer) throw new Error("Select a customer before saving.");
      setSaving(true);
      try {
        const manualOptions = options.map(optionInput), first = manualOptions[0];
        const quote = await createQuote({ customerId, customerName: customer.name, jobType, title: title.trim(), laborDescription: description.trim(), equipmentItems: first.equipmentItems, equipmentCost: 0, laborCost: first.laborCost, materialsCost: first.materialsCost, selectedAddOns: addOns, manualOptions });
        toast({ title: "Draft quote saved", description: `${documentNumber(quote)} saved with ${manualOptions.length} independent option${manualOptions.length === 1 ? "" : "s"}.` });
        onSaved(quote);
      } finally { setSaving(false); }
    })}>{saving ? "Saving…" : "Save Draft Quote"}</Button></div>
  </div>;
}
