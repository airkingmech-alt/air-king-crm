import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CircleDollarSign, Loader2, PackageOpen, Pencil, Plus, RefreshCw, RotateCcw, Search, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { addOnServices, pricebook as legacyEquipment } from "@/data/pricebook";
import { dollarsToCents, missingCatalogRows, sellingPriceFromCost } from "@/lib/pricebook-utils";

type ItemType = "equipment" | "part" | "service" | "labor";
type PriceItem = {
  id: string; company_id: string; item_type: ItemType; category: string; name: string;
  description: string; sku: string | null; brand: string | null; model: string | null;
  unit: string; cost_cents: number; price_cents: number; taxable: boolean; active: boolean;
};
type PriceForm = {
  item_type: ItemType; category: string; name: string; description: string; sku: string;
  brand: string; model: string; unit: string; cost: string; price: string;
  taxable: boolean; active: boolean;
};

const newForm = (): PriceForm => ({
  item_type: "part", category: "Parts", name: "", description: "", sku: "", brand: "",
  model: "", unit: "each", cost: "0.00", price: "0.00", taxable: true, active: true,
});
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const tabNames: Record<"all" | ItemType, string> = {
  all: "All items", equipment: "Equipment", part: "Parts", service: "Services", labor: "Labor",
};

export default function Pricebook() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"all" | ItemType>("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PriceItem | null>(null);
  const [form, setForm] = useState<PriceForm>(newForm);
  const attemptedInitialImport = useRef(false);
  const key = ["price-book", profile?.company_id];
  const canManageCatalog = !!profile && ["owner", "admin"].includes(profile.role);

  const catalog = useQuery({
    queryKey: key,
    enabled: !!profile?.company_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("price_book_items").select("*")
        .eq("company_id", profile!.company_id).order("active", { ascending: false }).order("name");
      if (error) throw error;
      return data as PriceItem[];
    },
  });
  const items = catalog.data ?? [];

  const legacyRows = () => [
    ...legacyEquipment.map((item) => ({
      company_id: profile!.company_id, item_type: "equipment" as const, category: item.category,
      name: item.description, description: item.description, sku: item.model, brand: item.brand,
      model: item.model, unit: "each", cost_cents: Math.round(item.cost * 100),
      price_cents: Math.round((item.cost / 0.8) * 100), taxable: true, active: true,
      metadata: { legacy_id: item.id, tier: item.tier || null, tonnage: item.tonnage || null },
    })),
    ...addOnServices.map((item) => ({
      company_id: profile!.company_id, item_type: "service" as const, category: "Add-ons",
      name: item.name, description: item.description, sku: `ADDON-${item.id}`, brand: null,
      model: null, unit: "each", cost_cents: 0, price_cents: Math.round(item.price * 100),
      taxable: true, active: true, metadata: { legacy_id: item.id },
    })),
  ];

  const importCatalog = useMutation({
    mutationFn: async () => {
      const { data: existing, error: readError } = await supabase.from("price_book_items")
        .select("sku").eq("company_id", profile!.company_id);
      if (readError) throw readError;
      const rows = missingCatalogRows(legacyRows(), (existing ?? []).map((item) => item.sku));
      if (!rows.length) return 0;
      const { error } = await supabase.from("price_book_items").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: key });
      if (count) toast({ title: `${count} catalog items loaded` });
    },
    onError: (error: Error) => toast({
      title: "Could not load the Air King catalog", description: error.message, variant: "destructive",
    }),
  });

  useEffect(() => {
    if (!canManageCatalog || !catalog.isSuccess || items.length || attemptedInitialImport.current) return;
    attemptedInitialImport.current = true;
    importCatalog.mutate();
  }, [canManageCatalog, catalog.isSuccess, items.length]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) =>
      (tab === "all" || item.item_type === tab) && (showArchived || item.active) &&
      (!term || [item.name, item.description, item.sku, item.brand, item.model, item.category]
        .filter(Boolean).some((value) => value!.toLowerCase().includes(term))),
    );
  }, [items, tab, search, showArchived]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Item name is required.");
      const row = {
        company_id: profile!.company_id, item_type: form.item_type,
        category: form.category.trim() || tabNames[form.item_type], name: form.name.trim(),
        description: form.description.trim(), sku: form.sku.trim() || null,
        brand: form.brand.trim() || null, model: form.model.trim() || null,
        unit: form.unit.trim() || "each", cost_cents: dollarsToCents(form.cost),
        price_cents: dollarsToCents(form.price), taxable: form.taxable, active: form.active,
      };
      const query = editing
        ? supabase.from("price_book_items").update(row).eq("id", editing.id)
        : supabase.from("price_book_items").insert(row);
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key }); setOpen(false); setEditing(null); setForm(newForm());
      toast({ title: editing ? "Item updated" : "Item added" });
    },
    onError: (error: Error) => toast({ title: "Could not save item", description: error.message, variant: "destructive" }),
  });

  const setActive = useMutation({
    mutationFn: async ({ item, active }: { item: PriceItem; active: boolean }) => {
      const { error } = await supabase.from("price_book_items").update({ active }).eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: key });
      toast({ title: variables.active ? "Item restored" : "Item archived" });
    },
    onError: (error: Error) => toast({ title: "Could not update item", description: error.message, variant: "destructive" }),
  });

  const edit = (item: PriceItem) => {
    setEditing(item);
    setForm({ item_type: item.item_type, category: item.category, name: item.name,
      description: item.description, sku: item.sku || "", brand: item.brand || "",
      model: item.model || "", unit: item.unit, cost: (item.cost_cents / 100).toFixed(2),
      price: (item.price_cents / 100).toFixed(2), taxable: item.taxable, active: item.active });
    setOpen(true);
  };
  const openNew = () => {
    setEditing(null);
    const next = newForm();
    if (tab !== "all") { next.item_type = tab; next.category = tabNames[tab]; }
    setForm(next); setOpen(true);
  };
  const counts = (type: "all" | ItemType) => items.filter((item) => item.active && (type === "all" || item.item_type === type)).length;

  return <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Price Book</h1><p className="text-sm text-muted-foreground">Manage equipment, parts, services, and labor used on quotes and invoices.</p></div>
      <Button onClick={openNew} className="sm:self-start"><Plus size={16} className="mr-2" /> Add item</Button>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Summary icon={PackageOpen} label="Equipment" value={counts("equipment")} />
      <Summary icon={Wrench} label="Parts" value={counts("part")} />
      <Summary icon={CircleDollarSign} label="Services" value={counts("service")} />
      <Summary icon={Wrench} label="Labor" value={counts("labor")} />
    </div>

    <Card><CardContent className="p-4 space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(tabNames) as Array<"all" | ItemType>).map((value) => <Button key={value} size="sm" variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)} className="shrink-0">{tabNames[value]} <span className="ml-1 opacity-70">({counts(value)})</span></Button>)}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} /><Input className="pl-9" placeholder="Search name, SKU, brand, model, or category" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <Button variant={showArchived ? "secondary" : "outline"} onClick={() => setShowArchived((value) => !value)}><Archive size={16} className="mr-2" />{showArchived ? "Hide archived" : "Show archived"}</Button>
      </div>
    </CardContent></Card>

    {catalog.isError && <Alert variant="destructive"><AlertTitle>Price Book could not be loaded</AlertTitle><AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3"><span>{catalog.error instanceof Error ? catalog.error.message : "Please try again."}</span><Button size="sm" variant="outline" onClick={() => catalog.refetch()}><RefreshCw size={14} className="mr-2" /> Retry</Button></AlertDescription></Alert>}

    {(catalog.isLoading || importCatalog.isPending) && <div className="flex items-center justify-center py-16 text-sm text-muted-foreground"><Loader2 size={18} className="mr-2 animate-spin" />{importCatalog.isPending ? "Loading the Air King catalog…" : "Loading price book…"}</div>}

    {!catalog.isLoading && !importCatalog.isPending && !catalog.isError && shown.length > 0 && <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {shown.map((item) => <Card key={item.id} className={!item.active ? "opacity-60" : ""}><CardContent className="p-4 space-y-3">
        <div className="flex justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-1.5 items-center"><Badge variant="secondary" className="capitalize">{item.item_type}</Badge><Badge variant="outline">{item.category}</Badge>{!item.active && <Badge variant="outline">Archived</Badge>}</div><h3 className="font-semibold mt-2 break-words">{item.name}</h3><p className="text-xs text-muted-foreground break-all">{[item.sku, item.brand, item.model].filter(Boolean).join(" • ") || "No SKU"}</p></div><div className="text-right shrink-0"><p className="font-bold">{money(item.price_cents)}</p><p className="text-xs text-muted-foreground">Cost {money(item.cost_cents)}</p></div></div>
        <p className="text-sm text-muted-foreground line-clamp-2 min-h-10">{item.description || "No customer-facing description"}</p>
        <div className="flex justify-end gap-1 border-t pt-2"><Button size="sm" variant="ghost" onClick={() => edit(item)}><Pencil size={15} className="mr-1.5" /> Edit</Button><Button size="sm" variant="ghost" disabled={setActive.isPending} onClick={() => setActive.mutate({ item, active: !item.active })}>{item.active ? <><Archive size={15} className="mr-1.5" /> Archive</> : <><RotateCcw size={15} className="mr-1.5" /> Restore</>}</Button></div>
      </CardContent></Card>)}
    </div>}

    {!catalog.isLoading && !importCatalog.isPending && !catalog.isError && !shown.length && <Card><CardContent className="py-14 text-center space-y-3"><PackageOpen className="mx-auto text-muted-foreground" size={36} /><div><p className="font-medium">No matching {tabNames[tab].toLowerCase()}</p><p className="text-sm text-muted-foreground">{items.length ? "Change the filters or add a new item." : "Start with the existing Air King catalog or add an item."}</p></div><div className="flex justify-center gap-2 flex-wrap"><Button onClick={openNew}><Plus size={16} className="mr-2" /> Add item</Button>{!items.length && canManageCatalog && <Button variant="outline" onClick={() => importCatalog.mutate()}><RefreshCw size={16} className="mr-2" /> Load Air King catalog</Button>}</div></CardContent></Card>}

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Edit price book item" : "Add price book item"}</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-4">
      <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Type"><Select value={form.item_type} onValueChange={(value: ItemType) => setForm({ ...form, item_type: value, category: tabNames[value] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(["equipment", "part", "service", "labor"] as const).map((value) => <SelectItem key={value} value={value}>{tabNames[value]}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
      <Field label="SKU / part number"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
      <Field label="Brand"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
      <Field label="Model"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
      <Field label="Unit"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="each, hour, foot…" /></Field><div />
      <Field label="Cost"><Input type="number" min="0" step=".01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
      <Field label="Selling price"><div className="flex gap-2"><Input type="number" min="0" step=".01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /><Button type="button" variant="outline" className="shrink-0" onClick={() => { try { setForm({ ...form, price: sellingPriceFromCost(form.cost) }); } catch (error) { toast({ title: "Enter a valid cost", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); } }}>20% margin</Button></div></Field>
      <div className="sm:col-span-2"><Field label="Customer-facing description"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
      <Toggle label="Taxable" checked={form.taxable} onCheckedChange={(taxable) => setForm({ ...form, taxable })} />
      <Toggle label="Active" checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} />
    </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 size={16} className="mr-2 animate-spin" />}{save.isPending ? "Saving…" : "Save item"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Toggle({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) { return <div className="flex items-center justify-between rounded-lg border p-3"><Label>{label}</Label><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>; }
function Summary({ icon: Icon, label, value }: { icon: typeof PackageOpen; label: string; value: number }) { return <Card><CardContent className="p-4 flex items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon size={18} /></div><div><p className="text-xl font-bold leading-none">{value}</p><p className="text-xs text-muted-foreground mt-1">{label}</p></div></CardContent></Card>; }
