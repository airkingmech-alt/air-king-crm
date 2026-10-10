import { z } from "zod";
import { dollarsToCents, sellingPriceFromCost } from "../client/src/lib/pricebook-utils";
import { MINI_SPLITS_CATEGORY } from "./pricebook-sections";
import { canAccess } from "./access";

const rowSchema = z.object({
  model: z.string().trim().min(1), supplier_sku: z.string().min(1).nullable(),
  label: z.string().min(1), description: z.string().min(1),
  source_section: z.enum(["Equipment", "Parts and accessories"]),
  subcategory: z.string().min(1), manufacturer: z.string().min(1),
  currency: z.literal("USD"), unit: z.literal("each"),
  supplier_unit_cost: z.string().regex(/^\d+\.\d{2}$/),
  supplier_unit_cost_cents: z.number().int().nonnegative().max(1_000_000_000),
  supplier: z.string().min(1), supplier_branch: z.string().min(1),
  pricing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_filename: z.string().min(1), source_library_file_id: z.string().min(1),
  source_page: z.number().int().positive(), source_notes: z.array(z.string()),
});
const manifestSchema = z.object({ rows: z.array(rowSchema).min(1).max(1000) });

export function authorizeMiniSplitsImport(profile: { company_id: string; role: string; permissions?: Record<string, boolean> } | null) {
  if (!profile?.company_id || !["owner", "admin"].includes(profile.role) || !canAccess(profile, "pricebook")) {
    throw new Error("A signed-in owner/admin with Price Book access is required.");
  }
  return profile.company_id;
}

export function buildMiniSplitsRows(input: unknown, companyId: string) {
  if (!companyId.trim()) throw new Error("Company is required.");
  const manifest = manifestSchema.parse(input);
  const models = new Set<string>();
  const skus = new Set<string>();
  return manifest.rows.map(row => {
    const modelKey = row.model.toLowerCase();
    // SKU is a catalog identity; supplier_sku remains distinct from model.
    const sku = row.supplier_sku ?? row.model;
    if (models.has(modelKey) || skus.has(sku.trim().toLowerCase())) throw new Error("Duplicate model or SKU in import.");
    models.add(modelKey); skus.add(sku.trim().toLowerCase());
    if (dollarsToCents(row.supplier_unit_cost) !== row.supplier_unit_cost_cents) throw new Error("Supplier cost does not match cents.");
    return {
      company_id: companyId, item_type: row.source_section === "Equipment" ? "equipment" : "part",
      category: MINI_SPLITS_CATEGORY, name: row.label, description: row.description,
      sku, brand: row.manufacturer, model: row.model, unit: row.unit,
      cost_cents: row.supplier_unit_cost_cents,
      price_cents: dollarsToCents(sellingPriceFromCost(row.supplier_unit_cost)),
      taxable: true, active: true,
      metadata: {
        subcategory: row.subcategory, supplier_sku: row.supplier_sku,
        supplier: row.supplier, supplier_branch: row.supplier_branch,
        pricing_date: row.pricing_date, currency: row.currency,
        source_filename: row.source_filename, source_library_file_id: row.source_library_file_id,
        source_page: row.source_page, source_notes: row.source_notes,
        price_basis: "supplier unit cost", margin: 0.2, availability_ignored: true,
      },
    };
  });
}

export function planMiniSplitsImport<T extends { sku: string; model: string; brand: string }>(
  rows: T[], existing: Array<{ sku: string | null; model: string | null; brand: string | null }>,
) {
  const norm = (value: string | null) => value?.trim().toLowerCase();
  const skus = new Set(existing.map(row => norm(row.sku)).filter(Boolean));
  const models = new Set(existing.map(row => `${norm(row.brand)}:${norm(row.model)}`));
  return rows.filter(row => !skus.has(norm(row.sku)) && !models.has(`${norm(row.brand)}:${norm(row.model)}`));
}
