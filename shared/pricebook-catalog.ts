export type CatalogMetadata = {
  subcategory?: string;
  supplier?: string;
  supplier_sku?: string | null;
  price_status?: "priced" | "missing" | "confirmed";
  unit_status?: "shown" | "missing" | "confirmed";
  source_unit?: string | null;
  pricing_date?: string;
  source_url?: string;
  source_description?: string;
  source_notes?: string[];
  dimensions_inches?: number[];
  search_aliases?: string[];
  [key: string]: unknown;
};
export type SearchableCatalogItem = {
  name: string; description?: string | null; sku?: string | null; brand?: string | null;
  model?: string | null; category?: string; item_type?: string; unit?: string;
  cost_cents?: number; price_cents?: number; metadata?: CatalogMetadata;
};

function normalize(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/×/g, "x")
    .replace(/[\"″]/g, "").replace(/\b(?:inches|inch)\b/g, "in")
    .replace(/(\d)\s*x\s*(?=\d)/g, "$1x").replace(/\s+/g, " ").trim();
}
export function matchesCatalogSearch(item: SearchableCatalogItem, query: string) {
  const term = normalize(query);
  if (!term) return true;
  const text = normalize([
    item.name, item.description, item.sku, item.brand, item.model, item.category, item.item_type,
    item.metadata?.supplier, item.metadata?.supplier_sku, item.metadata?.subcategory,
    item.metadata?.source_description,
    item.metadata?.search_aliases?.join(" "),
    item.metadata?.dimensions_inches?.join("x"),
  ].filter(Boolean).join(" "));
  const compact = text.replace(/[^a-z0-9.]/g, "");
  return term.split(" ").every(token => text.includes(token) || compact.includes(token.replace(/[^a-z0-9.]/g, "")));
}
export function needsCatalogPrice(item: Pick<SearchableCatalogItem, "metadata">) {
  return item.metadata?.price_status === "missing" || item.metadata?.unit_status === "missing";
}
export function assertCatalogPrice(item: SearchableCatalogItem) {
  if (needsCatalogPrice(item)) throw new Error("Enter and save this item's cost, selling price, and unit in Price Book before adding it to an invoice.");
}
const natural = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });
export type CatalogSort = "category" | "name" | "cost-low" | "cost-high";
export function compareCatalogItems(a: SearchableCatalogItem, b: SearchableCatalogItem, sort: CatalogSort = "category") {
  if (sort.startsWith("cost")) {
    if (needsCatalogPrice(a) !== needsCatalogPrice(b)) return needsCatalogPrice(a) ? 1 : -1;
    const cost = (a.cost_cents ?? 0) - (b.cost_cents ?? 0);
    if (cost) return sort === "cost-high" ? -cost : cost;
  }
  if (sort === "category") {
    const group = natural.compare(a.category ?? "", b.category ?? "") || natural.compare(a.metadata?.subcategory ?? "", b.metadata?.subcategory ?? "");
    if (group) return group;
    const x = a.metadata?.dimensions_inches ?? [], y = b.metadata?.dimensions_inches ?? [];
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  }
  return natural.compare(a.name, b.name) || natural.compare(a.sku ?? "", b.sku ?? "");
}

export function catalogSourceUrl(item: SearchableCatalogItem) {
  try {
    const url = new URL(item.metadata?.source_url ?? "");
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}
