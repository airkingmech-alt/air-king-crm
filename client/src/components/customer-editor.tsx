import { useRef, useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useData } from "@/context/data-context";
import type { CustomerRecord } from "@/data/customer-record";
import { saveRecords } from "@/lib/confirmed-save";
import { useToast } from "@/hooks/use-toast";
import { canAccess } from "../../../shared/access";
import { buildCustomerEdit, customerEditDraft, type CustomerEditDraft, type ServiceAddressDraft } from "../../../shared/customer-editing";
import { AddressAutocomplete } from "./address-autocomplete";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

type EditSession = { original: CustomerRecord; draft: CustomerEditDraft; audit: { id: string; date: string; user: string } };
export function CustomerEditor({ customer }: { customer: CustomerRecord }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { acceptSavedRecord } = useData();
  const [session, setSession] = useState<EditSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  if (!canAccess(profile, "customers")) return null;
  const changeOpen = (open: boolean) => {
    if (saving.current) return;
    setError("");
    if (!open) { setSession(null); return; }
    // Capture the entire baseline once. Background refreshes must not erase edits
    // or silently turn a stale record into an overwrite of somebody else's work.
    const original = structuredClone(customer);
    setSession({ original, draft: customerEditDraft(original), audit: { id: `act-${crypto.randomUUID()}`, date: new Date().toISOString().slice(0, 10), user: profile?.full_name || "Staff" } });
  };
  const patch = (updates: Partial<CustomerEditDraft>) => setSession(current => current ? { ...current, draft: { ...current.draft, ...updates } } : current);
  const patchProperty = (id: string, updates: Partial<ServiceAddressDraft>) => setSession(current => current ? { ...current, draft: { ...current.draft, properties: current.draft.properties.map(property => property.id === id ? { ...property, ...updates } : property) } } : current);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const updated = buildCustomerEdit(session.original, session.draft, session.audit);
      if (updated !== session.original) {
        const [saved] = await saveRecords([{ table: "customers", id: session.original.id, data: updated, previous: session.original }]);
        if (!saved || saved.id !== session.original.id) throw new Error("The save was not confirmed. Your edits are still here; please try again.");
        acceptSavedRecord("customers", saved);
        window.dispatchEvent(new Event("crm-refresh"));
        toast({ title: "Customer updated", description: "Name, contact details, and addresses were saved." });
      }
      setSession(null);
    } catch (error: any) {
      setError(error.message || "Could not save this customer. Your edits are still here; please try again.");
    } finally { saving.current = false; setBusy(false); }
  };
  const draft = session?.draft;
  return <Dialog open={!!session} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="edit-customer"><Pencil size={14} className="mr-1.5" />Edit customer</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={event => { if (saving.current) event.preventDefault(); }} onInteractOutside={event => { if (saving.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Edit customer</DialogTitle><DialogDescription>Update this customer’s name, primary contact, and service and billing addresses. Existing quotes, invoices, and jobs keep their saved details.</DialogDescription></DialogHeader>
      {draft && session && <form onSubmit={save} className="space-y-5" noValidate aria-busy={busy}>
        <fieldset disabled={busy} className="space-y-5 min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1"><Label htmlFor="edit-customer-name">Customer name *</Label><Input id="edit-customer-name" autoFocus required maxLength={1000} value={draft.name} onChange={event => patch({ name: event.target.value })} /></div>
            <div className="sm:col-span-2 space-y-1"><Label htmlFor="edit-customer-company">Company name (optional)</Label><Input id="edit-customer-company" maxLength={1000} value={draft.companyName} onChange={event => patch({ companyName: event.target.value })} /></div>
          </div>
          <section className="space-y-3" aria-labelledby="edit-contact-heading">
            <h3 id="edit-contact-heading" className="font-semibold text-sm">Primary contact</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1"><Label htmlFor="edit-customer-contact">Contact name</Label><Input id="edit-customer-contact" maxLength={1000} value={draft.contactName} onChange={event => patch({ contactName: event.target.value })} /></div>
              {(session.original.firstName !== undefined || session.original.lastName !== undefined) && <>
                <div className="space-y-1"><Label htmlFor="edit-customer-first">First name</Label><Input id="edit-customer-first" maxLength={1000} value={draft.firstName} onChange={event => patch({ firstName: event.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="edit-customer-last">Last name</Label><Input id="edit-customer-last" maxLength={1000} value={draft.lastName} onChange={event => patch({ lastName: event.target.value })} /></div>
              </>}
              <div className="space-y-1"><Label htmlFor="edit-customer-phone">Primary phone</Label><Input id="edit-customer-phone" type="tel" maxLength={1000} value={draft.phone} onChange={event => patch({ phone: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="edit-customer-email">Primary email</Label><Input id="edit-customer-email" type="email" maxLength={1000} value={draft.email} onChange={event => patch({ email: event.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Additional contacts and their phone numbers stay on this customer.</p>
          </section>
          <section className="space-y-3" aria-labelledby="edit-service-heading">
            <h3 id="edit-service-heading" className="font-semibold text-sm">Service addresses</h3>
            {!draft.properties.length && <p className="text-sm text-muted-foreground">No service address recorded yet.</p>}
            {draft.properties.map((property, index) => <fieldset key={property.id} className="rounded-md border p-3 space-y-3 min-w-0">
              <legend className="px-1 font-medium text-sm">Service address {index + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1"><Label htmlFor={`service-${index}-street`}>Street address</Label><AddressAutocomplete id={`service-${index}-street`} maxLength={1000} value={property.street} disabled={busy} provenance={property.addressProvenance} onChange={street => patchProperty(property.id, { street })} onSelect={suggestion => patchProperty(property.id, { street: suggestion.street, city: suggestion.city, state: suggestion.state, zip: suggestion.postalCode, addressProvenance: suggestion.provenance })} /></div>
                <div className="space-y-1"><Label htmlFor={`service-${index}-unit`}>Apartment / unit</Label><Input id={`service-${index}-unit`} maxLength={1000} value={property.unit} onChange={event => patchProperty(property.id, { unit: event.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor={`service-${index}-city`}>City</Label><Input id={`service-${index}-city`} maxLength={1000} value={property.city} onChange={event => patchProperty(property.id, { city: event.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor={`service-${index}-state`}>State</Label><Input id={`service-${index}-state`} maxLength={1000} value={property.state} onChange={event => patchProperty(property.id, { state: event.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor={`service-${index}-zip`}>ZIP / postal code</Label><Input id={`service-${index}-zip`} maxLength={1000} value={property.zip} onChange={event => patchProperty(property.id, { zip: event.target.value })} /></div>
              </div>
              {!session.original.properties.some(original => original.id === property.id) && <Button type="button" variant="ghost" size="sm" onClick={() => patch({ properties: draft.properties.filter(item => item.id !== property.id) })}><X size={14} className="mr-1" />Remove new address</Button>}
            </fieldset>)}
            <Button type="button" variant="outline" size="sm" onClick={() => patch({ properties: [...draft.properties, { id: `prop-${crypto.randomUUID()}`, street: "", unit: "", city: "", state: "", zip: "" }] })}><Plus size={14} className="mr-1" />Add service address</Button>
          </section>
          <fieldset className="rounded-md border p-3 space-y-3 min-w-0">
            <legend className="px-1 font-medium text-sm">Billing address (optional)</legend>
            <p className="text-xs text-muted-foreground">Separate from the service locations above. Leave blank if no billing address is recorded.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['street', 'Street address'], ['unit', 'Apartment / unit'], ['city', 'City'], ['state', 'State'], ['postalCode', 'ZIP / postal code']] as const).map(([field, label]) => <div key={field} className={`space-y-1 ${field === 'street' ? 'sm:col-span-2' : ''}`}>
                <Label htmlFor={`billing-${field}`}>{label}</Label>{field === "street" ? <AddressAutocomplete id="billing-street" maxLength={1000} value={draft.billingAddress.street} disabled={busy} provenance={draft.billingAddressProvenance} onChange={street => patch({ billingAddress: { ...draft.billingAddress, street } })} onSelect={suggestion => patch({ billingAddress: { ...draft.billingAddress, street: suggestion.street, city: suggestion.city, state: suggestion.state, postalCode: suggestion.postalCode }, billingAddressProvenance: suggestion.provenance })} /> : <Input id={`billing-${field}`} maxLength={1000} value={draft.billingAddress[field]} onChange={event => patch({ billingAddress: { ...draft.billingAddress, [field]: event.target.value } })} />}
              </div>)}
            </div>
          </fieldset>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy} data-testid="save-customer">{busy && <Loader2 size={14} className="mr-1.5 animate-spin" />}{busy ? "Saving…" : "Save changes"}</Button></DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
