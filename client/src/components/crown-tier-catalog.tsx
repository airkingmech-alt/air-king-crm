import { useRef, useState } from "react";
import { crownEnrollmentSnapshot, crownTierIds, type CrownCatalog, type CrownTierId } from "../../../shared/crown-tiers";
import { crownMoney } from "@/components/crown-configuration";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { crm } from "@/lib/crm-api";
import { parseCatalogPrices } from "@/lib/crown-enrollment";

export type CrownCatalogResponse = { catalog: CrownCatalog; version: string };

type Props = {
  data?: CrownCatalogResponse;
  loading: boolean;
  error: Error | null;
  isOwner: boolean;
  reload: () => void;
  onSaved: (data: CrownCatalogResponse) => void;
};

export function CrownTierCatalog({ data, loading, error, isOwner, reload, onSaved }: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<{ version: string; prices: Record<CrownTierId, string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saveLock = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const catalog = data?.catalog;
  function openEditor() {
    if (!data || !isOwner) return;
    requestKey.current = crypto.randomUUID();
    setSaveError("");
    setDraft({ version: data.version, prices: Object.fromEntries(crownTierIds.map(id => [id, (data.catalog.tiers[id].annualPerSystemCents / 100).toFixed(2)])) as Record<CrownTierId, string> });
    reload();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !isOwner || saveLock.current) return;
    if (draft.version !== data?.version) { setSaveError("Prices changed while this editor was open. Cancel and reopen to review the latest prices."); return; }
    let prices;
    try { prices = parseCatalogPrices(draft.prices); } catch (error: any) { setSaveError(error.message); return; }
    saveLock.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const result: CrownCatalogResponse = await crm("crm/crown-care/catalog", "PATCH", { version: draft.version, prices }, requestKey.current);
      onSaved(result);
      setDraft(null);
      toast({ title: "Crown Care prices saved", description: "The new annual per-system prices apply to new enrollments only. Existing memberships keep their agreed prices." });
    } catch (error: any) { setSaveError(error.message); reload(); }
    finally { saveLock.current = false; setSaving(false); }
  }
  return <section className="space-y-3" aria-label="Crown Care tier catalog">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">Crown Care annual tiers</h2><p className="text-sm text-muted-foreground">Annual pricing per covered complete system. Existing memberships keep their agreed prices and benefits.</p></div>
      {isOwner && <Button type="button" size="sm" variant="outline" disabled={!data || loading || !!error} onClick={openEditor} data-testid="button-edit-tier-prices">Edit tier prices</Button>}
    </div>
    {error && <div role="alert" className="rounded border border-destructive p-3 text-sm">Current tier prices could not be loaded. {error.message} <Button type="button" variant="outline" size="sm" onClick={reload}>Retry prices</Button></div>}
    {!catalog && !error && <p role="status" className="text-sm text-muted-foreground">Loading current tier prices…</p>}
    {catalog && <>
      <div className="grid gap-3 md:grid-cols-3">{crownTierIds.map(tier => {
        const plan = crownEnrollmentSnapshot({ tier, catalogVersion: catalog.version, systemCount: 1 }, catalog);
        return <Card key={tier}><CardContent className="p-4 space-y-3"><h3 className="font-bold">{plan.name}</h3><p className="text-xl font-semibold">{crownMoney(plan.annualPerSystemCents)}<span className="text-xs font-normal"> / complete system / year</span></p><ul className="text-sm list-disc pl-4 space-y-1">{plan.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul><p className="text-xs text-muted-foreground">{plan.filterPolicy}. {plan.excludedFilterSupply}.</p></CardContent></Card>;
      })}</div>
      <p className="text-xs text-muted-foreground">Price version: {catalog.version}</p>
    </>}
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !saveLock.current) setDraft(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Edit Crown Care tier prices</DialogTitle><DialogDescription>Owner-only pricing for new enrollments. Existing members keep their agreed annual price, tier benefits, and covered system count.</DialogDescription></DialogHeader>
        {draft && <form onSubmit={save} className="space-y-4"><fieldset disabled={saving} className="space-y-4">
          {crownTierIds.map(id => <label key={id} className="block text-sm">{catalog?.tiers[id].name || id} annual price per complete system ($)<Input type="number" min="0.01" max="10000" step="0.01" required value={draft.prices[id]} data-testid={`input-tier-price-${id}`} onChange={e => { requestKey.current = crypto.randomUUID(); setDraft({ ...draft, prices: { ...draft.prices, [id]: e.target.value } }); }} /></label>)}
          <p className="text-xs text-muted-foreground">Saving creates a new price version. Benefits are unchanged. No existing membership is repriced and no payment is charged.</p>
          {draft.version !== data?.version && <p role="alert" className="text-sm text-destructive">Prices changed while this editor was open. Cancel and reopen before saving.</p>}
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" disabled={saving || draft.version !== data?.version} data-testid="button-save-tier-prices">{saving ? "Saving…" : "Save new enrollment prices"}</Button></DialogFooter>
        </fieldset></form>}
      </DialogContent>
    </Dialog>
  </section>;
}
