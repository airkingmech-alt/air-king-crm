import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { crm } from "@/lib/crm-api";
import { useToast } from "@/hooks/use-toast";
import type { CustomerRecord } from "@/data/customer-record";
import type { HVACSystem } from "@/data/mock-data";
import { equipmentDetails, equipmentTypes, type EquipmentDetails } from "@shared/manual-equipment";
import { confirmedEquipment } from "@shared/equipment-analysis";

type Draft = Omit<EquipmentDetails, "type" | "manufactureYear"> & { type: string; manufactureYear: string };
const labels = { brand: "Brand / manufacturer", model: "Model", serial: "Serial", capacity: "Capacity / tonnage (with units)", efficiency: "Efficiency (rating and units)", refrigerant: "Refrigerant" } as const;
export function EquipmentEditor({ customer, propertyId: initialPropertyId, system }: {
  customer: CustomerRecord; propertyId?: string; system?: HVACSystem;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [form, setForm] = useState<Draft>({ ...equipmentDetails({}), type: "", manufactureYear: "" });
  const original = useRef<EquipmentDetails>();
  const requestId = useRef("");
  const { toast } = useToast();
  function changeOpen(next: boolean) {
    if (saving.current) return;
    if (next) {
      const details = equipmentDetails(system || {});
      original.current = system ? details : undefined;
      setForm({ ...details, type: system?.type || "", manufactureYear: details.manufactureYear?.toString() || "" });
      setPropertyId(initialPropertyId || customer.properties[0]?.id || "");
      requestId.current = crypto.randomUUID();
      setError("");
    }
    setOpen(next);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const parsed = confirmedEquipment.safeParse({ ...form, manufactureYear: form.manufactureYear.trim() === "" ? null : Number(form.manufactureYear) });
    if (!parsed.success) {
      setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" "));
      return;
    }
    if (!propertyId) { setError("Choose an existing customer property."); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      await crm("equipment/manual", "POST", { customerId: customer.id, propertyId, systemId: system?.id,
        requestId: requestId.current, original: original.current, equipment: parsed.data });
      window.dispatchEvent(new Event("crm-refresh"));
      toast({ title: system ? "Equipment updated" : "Equipment added", description: "Saved to this customer's property." });
      setOpen(false);
    } catch (error: any) {
      setError(error.message || "Could not save equipment. Your details are still here.");
      if (error.status === 409) window.dispatchEvent(new Event("crm-refresh"));
    }
    finally { saving.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="outline" size={system ? "sm" : "default"}
      aria-label={system ? `Edit equipment ${system.brand} ${system.type} ${system.model} ${system.serial}` : undefined}>
      {system ? "Edit equipment" : "Add equipment manually"}
    </Button></DialogTrigger>
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{system ? "Edit equipment" : "Add equipment manually"}</DialogTitle>
        <DialogDescription>Save one piece of equipment to {customer.name}'s property. Add another record for each additional unit. Leave unknown details blank.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4 min-w-0">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm">Property<select required disabled={!!system} value={propertyId} onChange={event => setPropertyId(event.target.value)} className="block w-full rounded border p-2 bg-background">
              <option value="">Choose property</option>{customer.properties.map(property => <option key={property.id} value={property.id}>{[property.address, property.city].filter(Boolean).join(", ")}</option>)}
            </select></label>
            <label className="text-sm">Equipment type<select required value={form.type} onChange={event => setForm({ ...form, type: event.target.value })} className="block w-full rounded border p-2 bg-background">
              <option value="">Choose type</option>{equipmentTypes.map(type => <option key={type}>{type}</option>)}
            </select></label>
            {Object.entries(labels).map(([key, label]) => <label key={key} className="text-sm">{label}<Input value={form[key as keyof typeof labels]} maxLength={key === "refrigerant" ? 100 : 200}
              onChange={event => setForm({ ...form, [key]: event.target.value })}/></label>)}
            <label className="text-sm">Manufacture year<Input type="number" min={1900} max={new Date().getUTCFullYear()} step={1} value={form.manufactureYear} onChange={event => setForm({ ...form, manufactureYear: event.target.value })}/></label>
          </div>
          <label className="block text-sm">Notes<Textarea maxLength={2000} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })}/></label>
          <p className="text-xs text-muted-foreground">Manufacture year is separate from installation date. Existing installation, warranty, status, and nameplate photos are retained.</p>
        </fieldset>
        {!customer.properties.length && <p role="alert">Add a property to this customer before saving equipment.</p>}
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button>
          <Button type="submit" disabled={busy || !propertyId || !form.type}>{busy ? "Saving…" : "Save equipment"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
