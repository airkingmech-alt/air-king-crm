import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuoteDraft, type QuoteDraftInput } from "../client/src/lib/quote-pricing";
import { publicFields } from "../server/crm/core";
const input: QuoteDraftInput = { customerId: "synthetic", customerName: "Synthetic", jobType: "Maintenance", title: "Maintenance", laborDescription: "Furnace tune-up — heating only, one system", equipmentCost: 0, laborCost: 0, materialsCost: 0, equipmentItems: [], servicePrice: 99 };
test("service-only maintenance preserves exact total, scope and empty equipment without surcharges or warranty claims", () => {
  const before = structuredClone(input);
  const q = buildQuoteDraft(input, "Q-SERVICE", "2026-10-25");
  assert.deepEqual(input, before); assert.equal(q.jobType, "Maintenance"); assert.equal(q.status, "Draft");
  assert.deepEqual(q.equipmentItems, []); assert.deepEqual(q.addOnCatalog, []); assert.deepEqual(q.selectedAddOns, []);
  assert.equal(q.purchaseTax, 0); assert.equal(q.materialsCost, 0); assert.equal(q.equipmentCost, 0);
  assert.equal(q.options.length, 1); assert.equal(q.options[0].customerPrice, 99);
  assert.equal(q.laborDescription, input.laborDescription);
  assert.doesNotMatch(JSON.stringify(q.options), /warranty|installation|SEER/i);
  assert.equal(publicFields("quote", q).options[0].customerPrice, 99);
  assert.equal(publicFields("quote", q).internalReviewNote, undefined);
});
test("labor estimate changes internal cost only, never fixed customer total", () => {
  const q = buildQuoteDraft({ ...input, laborCost: 45.25 }, "Q-S", "2026-10-25");
  assert.equal(q.options[0].totalCost, 45.25); assert.equal(q.options[0].customerPrice, 99); assert.equal(q.purchaseTax, 0);
});
test("empty quotes and invalid service scope or prices are rejected", () => {
  for (const patch of [{servicePrice: undefined}, {laborDescription: " "}, {servicePrice: 0}, {servicePrice: -1}, {servicePrice: Infinity}, {servicePrice: Number.MAX_VALUE}, {servicePrice: NaN}, {servicePrice: 99.001}, {laborCost: -1}, {laborCost: NaN}])
    assert.throws(() => buildQuoteDraft({...input, ...patch}, "Q-S", "2026-10-25"));
});
test("service price cannot silently override equipment or another job type", () => {
  for (const patch of [{jobType:"Changeout"}, {equipmentItems:["fake"]}, {equipmentCost:1}, {materialsCost:1}, {selectedAddOns:["extra"]}])
    assert.throws(() => buildQuoteDraft({...input, ...patch}, "Q-S", "2026-10-25"));
});
