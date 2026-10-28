import { formatHomeownerEquipment } from "../../../shared/homeowner-equipment";
import { buildManualQuoteOptions, type ManualQuoteOptionInput } from "./manual-quote-options";
import { potentialChampionRebates } from "../../../shared/champion-rebates";
import { addOnServices } from "../../../shared/quote-addons";
import type { ReviewedQuoteMatch } from "./quote-matches";
import { planAcOptions, approximateEfficiencyDisclosure } from "./ac-quote-options";
import { pricebook, type PricebookItem } from "../data/pricebook";
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
  manualOptions?: ManualQuoteOptionInput[];
  servicePrice?: number;
  newHouseSnapshot?: import("./new-house-quote").NewHouseSnapshot;
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

export function buildQuoteOptions(input: QuoteDraftInput, catalog: PricebookItem[] = pricebook, matches?: readonly ReviewedQuoteMatch[]) {
  if (input.manualOptions !== undefined) {
    if (input.servicePrice !== undefined || input.newHouseSnapshot) throw new Error("Manual options cannot be combined with another quote workflow.");
    return { options: buildManualQuoteOptions(input.manualOptions, catalog), unavailable: [] as string[], unavailableOptions: [] as NonNullable<Quote["unavailableOptions"]> };
  }
  if (input.servicePrice !== undefined) {
    if (input.jobType !== "Maintenance" || input.equipmentItems.length || input.equipmentCost !== 0 || input.materialsCost !== 0 || input.selectedAddOns?.length)
      throw new Error("Fixed service pricing requires Maintenance with no equipment, materials, or add-ons.");
    if (!input.laborDescription?.trim() || !Number.isFinite(input.servicePrice) || input.servicePrice <= 0 || !Number.isSafeInteger(Math.round(input.servicePrice * 100)) || Math.abs(input.servicePrice * 100 - Math.round(input.servicePrice * 100)) > 0.000001 || !Number.isFinite(input.laborCost) || input.laborCost < 0)
      throw new Error("Enter a service description, a positive total with at most two decimal places, and a valid labor estimate.");
    return { options: [{ tier: "Better" as const, label: "Maintenance service", equipment: "", equipmentItems: [], equipmentSummary: "", efficiency: "", features: [input.laborDescription.trim()], equipmentCost: 0, purchaseTax: 0, totalCost: calculateQuotePricing(0, input.laborCost, 0).totalCost, customerPrice: input.servicePrice }], unavailable: [] as string[], unavailableOptions: [] as NonNullable<Quote["unavailableOptions"]> };
  }
  if (!input.equipmentItems.length) throw new Error("Select equipment or use the service-only Maintenance form.");
  const selected = input.equipmentItems.map(id => {
    const item = catalog.find(item => item.id === id);
    if (!item) throw new Error("Selected equipment is missing from the pricebook. Review the quote before saving.");
    return item;
  });
  const unavailable: string[] = [];
  const unavailableOptions: NonNullable<Quote["unavailableOptions"]> = [];
  const option = (items: PricebookItem[], tier: QuoteOption["tier"], label: string): QuoteOption => {
    const pricing = calculateQuotePricing(items.reduce((sum, item) => sum + item.cost, 0), input.laborCost, input.materialsCost);
    return {
      tier, label, rebateOffer: potentialChampionRebates(items), equipment: items.map(item => item.model).join(" + "),
      equipmentItems: items.map(item => item.id),
      homeownerEquipment: items.map(formatHomeownerEquipment),
      equipmentSummary: items.map(formatHomeownerEquipment).join("\n"),
      efficiency: "Matched-system efficiency to be verified",
      features: ["Installation as described in the scope of work", "10-year parts and labor warranty"],
      equipmentCost: pricing.equipmentCost, purchaseTax: pricing.purchaseTax,
      totalCost: pricing.totalCost, customerPrice: pricing.customerPrice,
    };
  };
  const plans = planAcOptions(selected, catalog, matches);
  if (!plans) return { options: [option(selected, "Better", "Selected system")], unavailable, unavailableOptions };
  const options: QuoteOption[] = [];
  for (const plan of plans) {
    if (!plan.items) {
      unavailable.push(`${plan.label}: ${plan.blocker}`);
      unavailableOptions.push({ tier: plan.tier, label: plan.label, reason: plan.blocker || "Equipment unavailable" });
      continue;
    }
    const result = option(plan.items, plan.tier, plan.label);
    const laborWarrantyCost = plan.tier === "Value" ? 0 : 250;
    const pricing = calculateQuotePricing(result.equipmentCost!, input.laborCost + laborWarrantyCost, input.materialsCost);
    Object.assign(result, { laborWarrantyCost, totalCost: pricing.totalCost, customerPrice: pricing.customerPrice });
    result.efficiency = plan.rating;
    result.features = ["Installation as described in the scope of work", plan.tier === "Value" ? "10-year parts-only warranty; labor coverage not included" : "10-year parts and labor warranty", "Warranty registration and proposal terms apply", "Supplier availability and installation fit to be confirmed", approximateEfficiencyDisclosure, ...(plan.reviewNotes || [])];
    options.push(result);
  }
  if (!options.length) throw new Error(unavailable.join("\n"));
  return { options, unavailable, unavailableOptions };
}

export function buildQuoteDraft(input: QuoteDraftInput, id: string, createdAt: string, catalog: PricebookItem[] = pricebook, matches?: readonly ReviewedQuoteMatch[]): Quote {
  const { options, unavailable, unavailableOptions } = buildQuoteOptions(input, catalog, matches);
  const selectedOption = input.manualOptions ? options[0] : options.find(option => option.equipmentItems?.every((item, index) => item === input.equipmentItems[index])) || options[0];
  const pricing = calculateQuotePricing(selectedOption.equipmentCost || 0, selectedOption.laborCost ?? input.laborCost, selectedOption.materialsCost ?? input.materialsCost);
  return {
    id, customerId: input.customerId, customerName: input.customerName,
    ...(input.newHouseSnapshot ? {newHouseSnapshot: input.newHouseSnapshot} : {}),
    jobType: input.jobType as Quote["jobType"], title: input.title,
    status: "Draft", createdAt,
    equipmentItems: [...(input.manualOptions ? selectedOption.equipmentItems || [] : input.equipmentItems)], equipmentSelectionMode: "explicit",
    laborDescription: input.laborDescription,
    selectedAddOns: [...(input.selectedAddOns || [])],
    addOnCatalog: input.servicePrice !== undefined ? [] : addOnServices.map(addOn => ({ ...addOn })),
    equipmentCost: pricing.equipmentCost, laborCost: pricing.laborCost,
    materialsCost: pricing.materialsCost, taxRate: pricing.taxRate,
    purchaseTax: pricing.purchaseTax, pricingVersion: "purchase-tax-v1",
    internalReviewNote: input.servicePrice !== undefined ? "Fixed service total. Review internal labor costs before accepting; a zero estimate does not establish actual cost." : ["Confirm supplier availability and review physical installation requirements. Approximate series efficiency is disclosed; AHRI certification is not required to generate options.", ...unavailable].join(" "),
    options, unavailableOptions,
  };
}
