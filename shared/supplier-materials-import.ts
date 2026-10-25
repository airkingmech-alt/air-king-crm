import { z } from "zod";
import { dollarsToCents, sellingPriceFromCost } from "../client/src/lib/pricebook-utils";
import { DUCTWORK_CATEGORY } from "./pricebook-sections";

const rowSchema = z.object({
  source_row: z.number().int().positive(), source_page: z.number().int().positive(),
  supplier: z.enum(["Baker", "Kearney Winsupply"]),
  manufacturer: z.string().trim().min(1), supplier_sku: z.string().trim().min(1), model: z.string().trim().min(1),
  category: z.enum([DUCTWORK_CATEGORY, "Replacement Parts", "Thermostats", "Indoor Air Quality"]),
  subcategory: z.string().trim().min(1), name: z.string().trim().min(1),
  source_description: z.string().min(1), source_url: z.url().startsWith("https://"),
  cost_cents: z.number().int().positive().max(1_000_000_000).nullable(),
  source_unit: z.enum(["EA", "CT", "BG", "PK", "PC", "BX", "RL", "FT"]).nullable(),
  unit: z.string().min(1), dimensions_inches: z.array(z.number().positive()).max(20), source_notes: z.array(z.string()),
  search_aliases: z.array(z.string()).optional(),
});
const manifestSchema = z.object({
  pricing_date: z.iso.date(), source_filename: z.string().min(1), source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(rowSchema).min(1).max(2000),
});
export function buildSupplierMaterialsRows(input: unknown, companyId: string) {
  if (!companyId.trim()) throw new Error("Company is required.");
  const manifest = manifestSchema.parse(input);
  const skus = new Set<string>();
  return manifest.rows.map(row => {
    const sku = row.supplier_sku;
    if (skus.has(sku.toLowerCase())) throw new Error("Duplicate supplier SKU in import.");
    skus.add(sku.toLowerCase());
    if ((row.cost_cents === null) !== (row.source_unit === null)) throw new Error("Missing prices and units must remain explicitly missing.");
    const missing = row.cost_cents === null;
    return {
      company_id: companyId, item_type: "part" as const, category: row.category,
      name: row.name, description: row.source_description, sku, brand: row.manufacturer, model: row.model,
      unit: row.unit, cost_cents: row.cost_cents ?? 0,
      price_cents: missing ? 0 : dollarsToCents(sellingPriceFromCost(row.cost_cents! / 100)),
      // Unpriced rows stay searchable in the catalog, but inactive in older invoice clients.
      taxable: true, active: !missing,
      metadata: {
        subcategory: row.subcategory, supplier: row.supplier, supplier_sku: row.supplier_sku,
        pricing_date: manifest.pricing_date, source_filename: manifest.source_filename, source_sha256: manifest.source_sha256,
        source_row: row.source_row, source_page: row.source_page, source_url: row.source_url,
        source_description: row.source_description, source_unit: row.source_unit, source_cost_cents: row.cost_cents,
        price_status: missing ? "missing" : "priced", unit_status: missing ? "missing" : "shown",
        source_notes: row.source_notes, dimensions_inches: row.dimensions_inches,
        search_aliases: row.search_aliases ?? [],
        price_basis: "supplier unit cost", margin: 0.2,
        import_batch: `supplier-materials-${manifest.pricing_date}-${manifest.source_sha256.slice(0, 12)}`,
      },
    };
  });
}
