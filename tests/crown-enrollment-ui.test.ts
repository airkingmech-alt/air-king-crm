import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrownConfigurationFields } from "../client/src/components/crown-configuration";
import { enrollmentProblem, parseCatalogPrices, selectEnrollmentTier } from "../client/src/lib/crown-enrollment";
import { configurationFor } from "../shared/crown-care";
import { crownEnrollmentSnapshot, crownCatalogVersion, crownTierSnapshot, defaultCrownCatalog } from "../shared/crown-tiers";

// tsx runs this repository's JSX-preserve components with the classic runtime.
(globalThis as any).React = React;
const agreement = { accepted: true, acceptedOn: "2026-10-01", reference: "" };
const config = () => configurationFor({ systemDescription: "One matched AC and furnace system" });
const selected = () => selectEnrollmentTier(config(), defaultCrownCatalog, "silver", 2);
const render = (props: object = {}) => renderToStaticMarkup(React.createElement(CrownConfigurationFields, { value: selected(), onChange() {}, ...props }));

test("tier selection sets annual price, visits and total without mutating existing configuration", () => {
  const original = { ...config(), billingFrequency: "Monthly" as const, visitsIncluded: 5, pricing: { baseAmountCents: 1500, adjustmentCents: 500, adjustmentReason: "Manual terms" }, draftTier: { tier: "gold" as const, catalogVersion: crownCatalogVersion, systemCount: 1 } };
  const next = selectEnrollmentTier(original, defaultCrownCatalog, "gold", 3);
  assert.equal(next.billingFrequency, "Annual");
  assert.equal(next.visitsIncluded, 2);
  assert.deepEqual(next.pricing, { baseAmountCents: 104700, adjustmentCents: 0, adjustmentReason: "" });
  assert.equal(next.draftTier, undefined);
  assert.deepEqual(next.enrollmentTier, { tier: "gold", catalogVersion: defaultCrownCatalog.version, systemCount: 3 });
  assert.equal(original.pricing.baseAmountCents, 1500);
  assert.equal(next.coveredEquipment, original.coveredEquipment);
});

test("enrollment guard requires a loaded current catalog, valid system count, and recorded acceptance", () => {
  const value = selected();
  assert.equal(enrollmentProblem("tier", value, defaultCrownCatalog, agreement), null);
  assert.match(enrollmentProblem("tier", value, undefined, agreement)!, /Load the current/);
  assert.match(enrollmentProblem("tier", config(), defaultCrownCatalog, agreement)!, /Choose a Crown Care tier/);
  assert.match(enrollmentProblem("tier", value, { ...defaultCrownCatalog, version: "new-prices" }, agreement)!, /Prices have changed/);
  assert.match(enrollmentProblem("tier", value, defaultCrownCatalog, { ...agreement, accepted: false })!, /Verify/);
  for (const count of [0, -1, 1.5, 101, Number.NaN]) assert.match(enrollmentProblem("tier", selectEnrollmentTier(config(), defaultCrownCatalog, "bronze", count), defaultCrownCatalog, agreement)!, /whole number/);
  for (const acceptedOn of ["", "2026-02-30", "tomorrow", "2999-01-01"]) assert.ok(enrollmentProblem("tier", value, defaultCrownCatalog, { ...agreement, acceptedOn }));
  assert.equal(enrollmentProblem("tier", value, defaultCrownCatalog, { ...agreement, reference: "A" }), null, "Reference is optional and has no arbitrary minimum");
});

test("enrollment guard rejects price tampering and requires equipment; manual enrollment remains available", () => {
  const value = selected();
  for (const patch of [{ billingFrequency: "Monthly" as const }, { visitsIncluded: 1 }, { pricing: { ...value.pricing, baseAmountCents: 1 } }, { pricing: { ...value.pricing, adjustmentCents: -100 } }]) assert.match(enrollmentProblem("tier", { ...value, ...patch }, defaultCrownCatalog, agreement)!, /Review the selected tier/);
  assert.ok(enrollmentProblem("tier", { ...value, coveredEquipment: [] }, defaultCrownCatalog, agreement));
  assert.equal(enrollmentProblem("manual", config(), undefined, { accepted: false, acceptedOn: "", reference: "" }), null);
});

test("owner price input preserves exact cents and rejects invalid or oversized values", () => {
  assert.deepEqual(parseCatalogPrices({ bronze: "199", silver: "279.50", gold: "349.01" }), { bronze: 19900, silver: 27950, gold: 34901 });
  for (const bronze of ["", "0", "-1", "1.001", "NaN", "Infinity", "1e3", "10,000", "10000.01"]) assert.throws(() => parseCatalogPrices({ bronze, silver: "279", gold: "349" }));
  assert.equal(parseCatalogPrices({ bronze: "0.01", silver: "279", gold: "10000" }).gold, 1_000_000);
});

test("tier selector shows per-system price, count, total and complete benefits without manual price inputs", () => {
  const html = render({ enrollment: true, catalog: defaultCrownCatalog });
  assert.match(html, /select-enrollment-tier/);
  assert.match(html, /input-enrollment-system-count/);
  assert.match(html, /\$558\.00/);
  assert.match(html, /\$279\.00/);
  assert.match(html, /10% discount/);
  assert.match(html, /One \$99 business-hours diagnostic waiver per year/);
  assert.match(html, /Four-inch and five-inch/);
  assert.doesNotMatch(html, /Base price \(\$/);
  assert.doesNotMatch(html, /Reason for adjustment/);
});

test("stale catalog selection asks for explicit price review instead of silently repricing", () => {
  const html = render({ enrollment: true, catalog: { ...defaultCrownCatalog, version: "new-prices" } });
  assert.match(html, /Use latest prices/);
  assert.match(html, /verify customer acceptance again/);
  assert.doesNotMatch(html, /data-testid="enrollment-annual-total"/);
});

test("existing tier editor displays saved terms and locks price, visits, tier and system count", () => {
  const lockedPlan = crownEnrollmentSnapshot(selected().enrollmentTier!, defaultCrownCatalog);
  const html = render({ lockedPlan });
  assert.match(html, /Saved membership terms/);
  assert.match(html, /\$558\.00/);
  assert.match(html, /Later catalog prices do not change this membership/);
  assert.match(html, /Agreed catalog version/);
  assert.doesNotMatch(html, /select-enrollment-tier|input-enrollment-system-count|Base price \(\$|Visits included per year/);
  assert.match(html, /Equipment service notes/);
});

test("legacy editor retains manual controls and historical draft interest without draft rate claims", () => {
  const historicalDraft = crownTierSnapshot({ tier: "gold", catalogVersion: crownCatalogVersion, systemCount: 2 });
  const html = render({ value: config(), historicalDraft });
  assert.match(html, /Base price \(\$/);
  assert.match(html, /Historical draft interest: Gold/);
  assert.match(html, /did not activate benefits or set an agreed price/);
  assert.doesNotMatch(html, /\$349\.00|Draft tier planning|Draft tier<select/);
});
