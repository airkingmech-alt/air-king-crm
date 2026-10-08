import { crownConfiguration, type CrownConfiguration } from "../../../shared/crown-care";
import { crownEnrollmentSnapshot, crownTierIds, type CrownCatalog, type CrownTierId } from "../../../shared/crown-tiers";

export type EnrollmentMode = "tier" | "manual";
export type EnrollmentAgreement = { accepted: boolean; acceptedOn: string; reference: string };

export function selectEnrollmentTier(configuration: CrownConfiguration, catalog: CrownCatalog, tier: CrownTierId, systemCount: number): CrownConfiguration {
  const selection = { tier, catalogVersion: catalog.version, systemCount };
  return { ...configuration, draftTier: undefined, enrollmentTier: selection, billingFrequency: "Annual", visitsIncluded: 2,
    pricing: { baseAmountCents: catalog.tiers[tier].annualPerSystemCents * systemCount, adjustmentCents: 0, adjustmentReason: "" } };
}

export function enrollmentProblem(mode: EnrollmentMode, configuration: CrownConfiguration, catalog: CrownCatalog | undefined, agreement: EnrollmentAgreement): string | null {
  if (mode === "tier") {
    if (!catalog) return "Load the current tier prices before enrolling.";
    if (!configuration.enrollmentTier) return "Choose a Crown Care tier.";
    if (configuration.enrollmentTier.catalogVersion !== catalog.version) return "Prices have changed. Review the latest prices and verify customer acceptance again.";
    try {
      const plan = crownEnrollmentSnapshot(configuration.enrollmentTier, catalog);
      if (configuration.billingFrequency !== "Annual" || configuration.visitsIncluded !== 2 || configuration.pricing.baseAmountCents !== plan.annualTotalCents || configuration.pricing.adjustmentCents !== 0 || configuration.pricing.adjustmentReason) return "Review the selected tier and annual price.";
    } catch { return "Choose a whole number of covered complete systems from 1 to 100."; }
    if (!agreement.accepted) return "Verify that the customer accepted the selected plan, displayed benefits, annual price, and covered systems.";
    const date = new Date(agreement.acceptedOn + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(agreement.acceptedOn) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== agreement.acceptedOn) return "Choose a valid customer acceptance date.";
    if (agreement.acceptedOn > new Date().toISOString().slice(0, 10)) return "Customer acceptance cannot be recorded for a future date.";
    if (agreement.reference.length > 5000) return "Keep the optional agreement reference within 5,000 characters.";
  }
  const parsed = crownConfiguration.safeParse(configuration);
  if (!parsed.success) return parsed.error.issues[0]?.message || "Check the membership details.";
  return null;
}

export function parseCatalogPrices(values: Record<CrownTierId, string>): Record<CrownTierId, number> {
  const prices = {} as Record<CrownTierId, number>;
  for (const tier of crownTierIds) {
    const value = values[tier].trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid dollar price with no more than two decimal places for every tier.");
    const cents = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > 1_000_000) throw new Error("Each annual per-system price must be between $0.01 and $10,000.");
    prices[tier] = cents;
  }
  return prices;
}
