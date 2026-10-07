import { z } from "zod";

// Immutable release catalog. Publish a new version rather than rewriting saved snapshots.
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
