import { z } from "zod";

// Historical draft helpers are intentionally frozen for existing planning records.
// New enrollment and inquiry writes use the explicit published catalog helpers below.
export const crownCatalogVersion = "2026-10-draft-1" as const;
export const crownTierIds = ["bronze", "silver", "gold"] as const;
export type CrownTierId = typeof crownTierIds[number];
export const crownTiers = {
  bronze: { name: "Bronze", annualPerSystemCents: 19900, repairDiscountPercent: 5, priorityService: false, diagnosticWaiversPerYear: 0, suppliedOneInchFiltersPerVisitPerSystem: 0 },
  silver: { name: "Silver", annualPerSystemCents: 27900, repairDiscountPercent: 10, priorityService: true, diagnosticWaiversPerYear: 1, suppliedOneInchFiltersPerVisitPerSystem: 1 },
  gold: { name: "Gold", annualPerSystemCents: 34900, repairDiscountPercent: 15, priorityService: true, diagnosticWaiversPerYear: 1, suppliedOneInchFiltersPerVisitPerSystem: 1 },
} as const;
export const crownTierSelection = z.object({
  tier: z.enum(crownTierIds), catalogVersion: z.literal(crownCatalogVersion),
  systemCount: z.number().int().min(1).max(100).optional(),
}).strict();
export type CrownTierSelection = z.infer<typeof crownTierSelection>;
export function crownTierSnapshot(selection: CrownTierSelection) {
  const input = crownTierSelection.parse(selection), tier = crownTiers[input.tier];
  return {
    ...input, ...tier, status: "draft" as const, currency: "usd", billingFrequency: "Annual" as const,
    visitsPerYear: 2, seasons: ["spring", "fall"], enrollmentAvailable: false,
    annualTotalCents: input.systemCount ? tier.annualPerSystemCents * input.systemCount : null,
    diagnosticWaiverAmountCents: tier.diagnosticWaiversPerYear ? 9900 : 0,
    diagnosticWaiverScope: tier.diagnosticWaiversPerYear ? "Business hours only; one per year" : "Not included",
    filterPolicy: input.tier === "bronze" ? "Change homeowner-provided filter at tune-ups" : "Supply and change one standard one-inch filter per covered system at each of two annual tune-ups (two per system per year)",
    excludedFilterSupply: "Four-inch and five-inch filters are not included in supplied filters",
    pricingNotice: "Draft pricing pending cost review. Selection is an inquiry or internal planning record, not an agreement or enrollment.",
    benefits: ["Two annual seasonal tune-ups", `${tier.repairDiscountPercent}% discount on eligible repairs`, ...(tier.priorityService ? ["Priority service", "One $99 business-hours diagnostic waiver per year"] : []), input.tier === "bronze" ? "Change homeowner-provided filter" : "One supplied standard one-inch filter per covered system at each tune-up"],
  };
}
export type CrownTierSnapshot = ReturnType<typeof crownTierSnapshot>;
export function crownInquiryMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata || metadata.crownCare === undefined) return metadata;
  const selection = crownTierSelection.parse(metadata.crownCare);
  return { ...metadata, crownCare: { ...crownTierSnapshot(selection), intent: "inquiry" as const } };
}

const catalogVersionSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/);
export const crownCatalogPrice = z.number().int().min(1).max(1_000_000);
export const crownCatalogPrices = z.object({
  bronze: crownCatalogPrice, silver: crownCatalogPrice, gold: crownCatalogPrice,
}).strict();
export const crownTierDefinition = z.object({
  name: z.string().min(1).max(40),
  annualPerSystemCents: crownCatalogPrice,
  repairDiscountPercent: z.number().int().min(0).max(100),
  priorityService: z.boolean(),
  diagnosticWaiversPerYear: z.number().int().min(0).max(52),
  suppliedOneInchFiltersPerVisitPerSystem: z.number().int().min(0).max(10),
}).strict();
export type CrownTierDefinition = z.infer<typeof crownTierDefinition>;
export const crownCatalogSchema = z.object({
  version: catalogVersionSchema,
  tiers: z.object({ bronze: crownTierDefinition, silver: crownTierDefinition, gold: crownTierDefinition }).strict(),
}).strict();
export type CrownCatalog = z.infer<typeof crownCatalogSchema>;
export const defaultCrownCatalog: CrownCatalog = {
  version: "2026-10-08-1",
  tiers: Object.fromEntries(crownTierIds.map(id => [id, { ...crownTiers[id] }])) as CrownCatalog["tiers"],
};
export const crownEnrollmentSelection = z.object({
  tier: z.enum(crownTierIds), catalogVersion: catalogVersionSchema,
  systemCount: z.number().int().min(1).max(100),
}).strict();
export type CrownEnrollmentSelection = z.infer<typeof crownEnrollmentSelection>;
export const crownInquirySelection = crownEnrollmentSelection.extend({
  systemCount: z.number().int().min(1).max(100).optional(),
});

export function crownCatalogStale() {
  return Object.assign(new Error("Crown Care pricing changed. Refresh the plans and review the current price before continuing."), {
    status: 409, code: "CROWN_CATALOG_STALE",
  });
}

// Only pass a server-loaded catalog when accepting a write. Client prices, benefits,
// and totals are never accepted as part of the enrollment selection.
export function crownEnrollmentSnapshot(selection: CrownEnrollmentSelection, catalog: CrownCatalog) {
  const input = crownEnrollmentSelection.parse(selection);
  const current = crownCatalogSchema.parse(catalog);
  if (input.catalogVersion !== current.version) throw crownCatalogStale();
  const tier = current.tiers[input.tier];
  const filterPolicy = input.tier === "bronze"
    ? "Change homeowner-provided filter at tune-ups"
    : "Supply and change one standard one-inch filter per covered system at each of two annual tune-ups (two per system per year)";
  return {
    ...input, ...tier, status: "published" as const, currency: "usd" as const,
    billingFrequency: "Annual" as const, visitsPerYear: 2, seasons: ["spring", "fall"],
    enrollmentAvailable: true,
    annualTotalCents: tier.annualPerSystemCents * input.systemCount,
    diagnosticWaiverAmountCents: tier.diagnosticWaiversPerYear ? 9900 : 0,
    diagnosticWaiverScope: tier.diagnosticWaiversPerYear ? "Business hours only; one per year" : "Not included",
    filterPolicy,
    excludedFilterSupply: "Four-inch and five-inch filters are not included in supplied filters",
    pricingNotice: "Annual per-system pricing. Saved membership terms remain unchanged when catalog prices change.",
    benefits: ["Two annual seasonal tune-ups", `${tier.repairDiscountPercent}% discount on eligible repairs`,
      ...(tier.priorityService ? ["Priority service"] : []),
      ...(tier.diagnosticWaiversPerYear ? ["One $99 business-hours diagnostic waiver per year"] : []),
      input.tier === "bronze" ? "Change homeowner-provided filter" : "One supplied standard one-inch filter per covered system at each tune-up"],
  };
}
export type CrownEnrollmentSnapshot = ReturnType<typeof crownEnrollmentSnapshot>;

export function currentCrownInquiryMetadata(metadata: Record<string, unknown> | undefined, catalog: CrownCatalog) {
  if (!metadata || metadata.crownCare === undefined) return metadata;
  const selection = crownInquirySelection.parse(metadata.crownCare);
  const snapshot = crownEnrollmentSnapshot({ ...selection, systemCount: selection.systemCount ?? 1 }, catalog);
  return { ...metadata, crownCare: { ...snapshot, systemCount: selection.systemCount,
    annualTotalCents: selection.systemCount === undefined ? null : snapshot.annualTotalCents,
    enrollmentAvailable: false, intent: "inquiry" as const,
    pricingNotice: "This is an inquiry, not an agreement or enrollment. Air King will confirm coverage and enrollment details.",
  } };
}

export function publicCrownCatalog(catalog: CrownCatalog) {
  return { catalogVersion: catalog.version, plans: crownTierIds.map(id => {
    const plan = crownEnrollmentSnapshot({ tier: id, catalogVersion: catalog.version, systemCount: 1 }, catalog);
    return { id, name: plan.name, annualPrice: plan.annualPerSystemCents / 100,
      repairDiscount: plan.repairDiscountPercent, filter: plan.filterPolicy,
      priority: plan.priorityService,
      diagnosticWaiver: plan.diagnosticWaiversPerYear ? "One $99 business-hours diagnostic fee waived per year" : "",
    };
  }) };
}
