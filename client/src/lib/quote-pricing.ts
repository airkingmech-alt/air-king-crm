import { addOnServices } from "../../../shared/quote-addons";
import { reviewedQuoteMatches } from "./quote-matches";
import { pricebook, formatEquipmentDescription, type PricebookItem } from "../data/pricebook";
import type { Quote, QuoteOption } from "../data/mock-data";
import { dollarsToCents, AIR_KING_MARGIN } from "./pricebook-utils";

// Purchase-tax allowance belongs in job cost, before Air King's 20% margin.
// It is not a customer sales-tax surcharge, and labor is never in the tax base.
export const PURCHASE_TAX_RATE = 0.09;
export function calculateQuotePricing(equipment: number, labor: number, materials: number) {
  const equipmentCents = dollarsToCents(equipment);
  const laborCents = dollarsToCents(labor);
  const materialsCents = dollarsToCents(materials);
  const purchaseTaxCents = Math.round((equipmentCents + materialsCents) * PURCHASE_TAX_RATE);
  const totalCostCents = equipmentCents + laborCents + materialsCents + purchaseTaxCents;
  const totalCost = totalCostCents / 100;
  return {
    equipmentCost: equipmentCents / 100,
    laborCost: laborCents / 100,
    materialsCost: materialsCents / 100,
    taxRate: PURCHASE_TAX_RATE,
    purchaseTax: purchaseTaxCents / 100,
    totalCost,
    customerPrice: Math.round(totalCostCents / (1 - AIR_KING_MARGIN)) / 100,
  };
}

export interface QuoteDraftInput {
  customerId: string;
  customerName: string;
  jobType: string;
  title: string;
  equipmentCost: number;
  laborCost: number;
  materialsCost: number;
  equipmentItems: string[];
  laborDescription?: string;
  selectedAddOns?: string[];
}

export function buildQuoteOptions(input: QuoteDraftInput, catalog: PricebookItem[] = pricebook) {
  const selected = input.equipmentItems.map(id => {
    const item = catalog.find(item => item.id === id);
    if (!item) throw new Error("Selected equipment is missing from the pricebook. Review the quote before saving.");
    return item;
  });
  const condensers = selected.filter(item => item.category === "Condenser");
  const ac = condensers.length === 1 ? condensers[0] : undefined;
  const supportsTiers = ac?.brand === "Champion" && /^XC[34]/.test(ac.model) && ac.tonnage && !selected.some(item => item.category === "Heat Pump");
  const unavailable: string[] = [];
  const option = (items: PricebookItem[], tier: QuoteOption["tier"], label: string): QuoteOption => {
    const pricing = calculateQuotePricing(items.reduce((sum, item) => sum + item.cost, 0), input.laborCost, input.materialsCost);
    return {
      tier, label, equipment: items.map(item => item.model).join(" + "),
      equipmentItems: items.map(item => item.id),
      equipmentSummary: items.map(item => `${formatEquipmentDescription(item.category === "Condenser" ? { ...item, tier: undefined } : item)} — ${item.model}`).join("\n"),
      efficiency: "Matched-system efficiency to be verified",
      features: ["Installation as described in the scope of work", "10-year parts and labor warranty"],
      equipmentCost: pricing.equipmentCost, purchaseTax: pricing.purchaseTax,
      totalCost: pricing.totalCost, customerPrice: pricing.customerPrice,
    };
  };
  if (!supportsTiers) return { options: [option(selected, "Better", "Selected system")], unavailable };
  const options: QuoteOption[] = [];
  for (const [tier, series, label] of [["Good", "XC3", "Essential"], ["Better", "XC4", "Enhanced"], ["Best", "XC6", "Ultimate"]] as const) {
    // Owner-approved XC6 rule: its full-size range steps half-ton selections up.
    // Keep the actual larger capacity visible; matching must still be reviewed.
    const capacity = series === "XC6" ? Math.ceil(ac.tonnage!) : ac.tonnage;
    const candidates = catalog.filter(item => item.brand === ac.brand && item.category === "Condenser" && item.tonnage === capacity && item.model.startsWith(series));
    if (candidates.length !== 1) {
      unavailable.push(`${tier}: ${capacity}-ton ${series} needs a confirmed model and price`);
      continue;
    }
    const condenser = candidates[0];
    const coils = selected.filter(item => item.category === "Evaporator Coil");
    const furnaces = selected.filter(item => item.category === "Furnace");
    const reviewed = coils.length === 1 && furnaces.length === 1
      ? reviewedQuoteMatches.find(match => match.condenser === condenser.model && match.furnace === furnaces[0].model && (capacity !== ac.tonnage || match.coil === coils[0].model))
      : undefined;
    const matchedCoils = reviewed ? catalog.filter(item => item.model === reviewed.coil && item.category === "Evaporator Coil" && item.brand === ac.brand) : [];
    const matchedCoil = matchedCoils.length === 1 ? matchedCoils[0] : undefined;
    if (capacity !== ac.tonnage && (!reviewed || !matchedCoil)) {
      unavailable.push(`${tier}: ${capacity}-ton ${series} needs a verified indoor equipment match before it can be quoted`);
      continue;
    }
    const items = selected.map(item => item.id === ac.id ? condenser : matchedCoil && item.id === coils[0]?.id ? matchedCoil : item);
    const tierOption = option(items, tier, label);
    if (reviewed) {
      tierOption.efficiency = `${reviewed.seer2} SEER2 · AHRI ${reviewed.ahri}`;
      tierOption.features.push("Supplier availability and installation fit to be confirmed");
    }
    tierOption.equipment = `${condenser.model} (${capacity}-ton${series === "XC6" ? ", two-stage" : ""}) with selected indoor equipment`;
    if (capacity !== ac.tonnage) {
      tierOption.features.unshift(`Outdoor capacity steps up from ${ac.tonnage} to ${capacity} tons with ${matchedCoil!.model} coil`);
      tierOption.features.push("Larger coil: verify cabinet height, duct fit, and required airflow before installation");
    }
    options.push(tierOption);
  }
  if (!options.length) throw new Error("No same-capacity options are available. Review the pricebook before saving.");
  return { options, unavailable };
}

export function buildQuoteDraft(input: QuoteDraftInput, id: string, createdAt: string, catalog: PricebookItem[] = pricebook): Quote {
  const { options, unavailable } = buildQuoteOptions(input, catalog);
  const selectedOption = options.find(option => option.equipmentItems?.every((item, index) => item === input.equipmentItems[index])) || options[0];
  const pricing = calculateQuotePricing(selectedOption.equipmentCost || 0, input.laborCost, input.materialsCost);
  return {
    id, customerId: input.customerId, customerName: input.customerName,
    jobType: input.jobType as Quote["jobType"], title: input.title,
    status: "Draft", createdAt,
    equipmentItems: [...input.equipmentItems], equipmentSelectionMode: "explicit",
    laborDescription: input.laborDescription,
    selectedAddOns: [...(input.selectedAddOns || [])],
    addOnCatalog: addOnServices.map(addOn => ({ ...addOn })),
    equipmentCost: pricing.equipmentCost, laborCost: pricing.laborCost,
    materialsCost: pricing.materialsCost, taxRate: pricing.taxRate,
    purchaseTax: pricing.purchaseTax, pricingVersion: "purchase-tax-v1",
    internalReviewNote: ["Confirm manufacturer/AHRI matching and supplier availability for each option before sending.", ...unavailable].join(" "),
    options,
  };
}
