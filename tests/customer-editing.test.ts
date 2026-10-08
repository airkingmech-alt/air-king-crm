import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCustomerEdit, customerEditDraft, primaryContactIndex } from "../shared/customer-editing";
import type { AddressProvenance } from "../shared/address-autocomplete";
import type { CustomerRecord } from "../client/src/data/customer-record";

const audit = { id: "act-edit-test", date: "2026-10-08", user: "Test Staff" };
function fixture(): CustomerRecord {
  return {
    id: "cust-test", name: "Test Customer", type: "Commercial", firstName: "Test", lastName: "Customer", companyName: "Example Company",
    contacts: [
      { name: "Other Contact", phone: "2025550120", email: "other@example.test", sourceText: "Untouched import" },
      { name: "Test Customer", role: "Primary", phone: "2025550100", email: "test@example.test", additionalEmails: ["other-primary@example.test"], phoneNumbers: [{ label: "Mobile", value: "2025550100" }, { label: "Office", value: "2025550101" }] },
    ],
    properties: [
      { id: "prop-a", address: "101 Example St, Unit A", street: "101 Example St", unit: "Unit A", city: "Example", state: "MO", zip: "00123", sourceSlot: 1, gateCode: "synthetic", accessNotes: "Test access notes", systems: [{ id: "system-a", type: "AC", brand: "Example", model: "Test", serial: "SYNTHETIC", installDate: "2020-01-01", status: "Active" }] },
      { id: "prop-b", address: "202 Test St", city: "Elsewhere", state: "MO", zip: "00456", systems: [] },
    ],
    billingAddress: { street: "900 Billing St", unit: "Suite 9", city: "Billing City", state: "MO", postalCode: "00999" },
    sourceStatus: "Active", sourceReferences: { markate: { customerId: "999", batchId: "batch", exportSha256: "hash", exportedAt: "2026-09-01", sourceAddedOn: "2020-01-01", sourceRow: 2, status: "Active" } },
    leadSource: "Unknown", tags: ["Preserve"], createdAt: "2020-01-01",
    activity: [{ id: "act-existing", date: "2020-01-01", type: "note", title: "Existing history", description: "Keep me" }],
    customMetadata: { preserve: true },
  } as CustomerRecord;
}

test("no-op editing returns the exact record and does not manufacture addresses, contacts, or history", () => {
  const original = fixture();
  assert.equal(buildCustomerEdit(original, customerEditDraft(original), audit), original);
  const empty = { ...original, contacts: [], properties: [], billingAddress: undefined };
  assert.deepEqual(customerEditDraft(empty).properties, []);
  assert.equal(buildCustomerEdit(empty, customerEditDraft(empty), audit), empty);
});

test("changing names preserves every untouched contact, address, system, import field, and unknown metadata", () => {
  const original = fixture(); const before = structuredClone(original); const draft = customerEditDraft(original);
  draft.name = "  Revised Customer  "; draft.companyName = "Revised Company"; draft.firstName = "Revised";
  const updated = buildCustomerEdit(original, draft, audit);
  assert.equal(updated.name, "Revised Customer"); assert.equal(updated.companyName, "Revised Company"); assert.equal(updated.firstName, "Revised");
  assert.equal(updated.contacts, original.contacts); assert.equal(updated.properties, original.properties); assert.equal(updated.billingAddress, original.billingAddress);
  assert.equal(updated.sourceReferences, original.sourceReferences); assert.deepEqual((updated as any).customMetadata, { preserve: true });
  assert.equal(updated.leadStatus, undefined); assert.deepEqual(updated.activity.slice(1), original.activity);
  assert.equal(updated.activity[0].title, "Customer updated"); assert.equal(updated.activity[0].user, "Test Staff");
  assert.deepEqual(original, before);
});

test("all service addresses can be edited without dropping property IDs, units, systems or billing", () => {
  const original = fixture(); const draft = customerEditDraft(original);
  draft.properties[0].street = "303 Revised St"; draft.properties[1].street = "404 Revised St"; draft.properties[1].unit = "Apt 2"; draft.properties[1].zip = "00001";
  const updated = buildCustomerEdit(original, draft, audit);
  assert.equal(updated.properties.length, 2); assert.equal(updated.properties[0].id, "prop-a");
  assert.equal(updated.properties[0].address, "303 Revised St, Unit A"); assert.equal(updated.properties[0].street, "303 Revised St");
  assert.equal(updated.properties[0].systems, original.properties[0].systems); assert.equal(updated.properties[0].sourceSlot, 1);
  assert.equal(updated.properties[0].gateCode, "synthetic"); assert.equal(updated.properties[0].accessNotes, "Test access notes");
  assert.equal(updated.properties[1].address, "404 Revised St, Apt 2"); assert.equal(updated.properties[1].zip, "00001");
  assert.equal(updated.billingAddress, original.billingAddress);
});

test("billing remains independent and can be added, edited, or cleared without touching service locations", () => {
  const original = fixture(); const draft = customerEditDraft(original);
  draft.billingAddress.street = "New Billing St"; const updated = buildCustomerEdit(original, draft, audit);
  assert.equal(updated.properties, original.properties); assert.equal(updated.billingAddress?.street, "New Billing St");
  assert.equal(updated.billingAddress?.unit, "Suite 9"); assert.equal(original.billingAddress?.street, "900 Billing St");
  const withoutBilling = { ...original, billingAddress: undefined }; const add = customerEditDraft(withoutBilling);
  add.billingAddress.street = "100 Postal St"; assert.equal(buildCustomerEdit(withoutBilling, add, audit).billingAddress?.street, "100 Postal St");
  const clear = customerEditDraft(original); clear.billingAddress = { street: "", unit: "", city: "", state: "", postalCode: "" };
  assert.deepEqual(buildCustomerEdit(original, clear, audit).billingAddress, clear.billingAddress);
});

test("primary contact editing respects role and updates the matching labeled phone without dropping other channels", () => {
  const original = fixture(); const draft = customerEditDraft(original); assert.equal(primaryContactIndex(original), 1);
  draft.contactName = "New Contact"; draft.phone = "(202) 555-0199"; draft.email = "new@example.test";
  const updated = buildCustomerEdit(original, draft, audit);
  assert.equal(updated.contacts[0], original.contacts[0]); assert.equal(updated.contacts[1].name, "New Contact");
  assert.equal(updated.contacts[1].email, "new@example.test"); assert.equal(updated.contacts[1].phone, "(202) 555-0199");
  assert.deepEqual(updated.contacts[1].phoneNumbers, [{ label: "Mobile", value: "(202) 555-0199" }, { label: "Office", value: "2025550101" }]);
  assert.deepEqual(updated.contacts[1].additionalEmails, ["other-primary@example.test"]);
  draft.phone = "";
  assert.deepEqual(buildCustomerEdit(original, draft, audit).contacts[1].phoneNumbers, [{ label: "Office", value: "2025550101" }]);
});

test("adding service location to a billing-only imported customer does not move the billing address", () => {
  const original = { ...fixture(), properties: [] }; const draft = customerEditDraft(original);
  draft.properties.push({ id: "new-service", street: "123 Service St", unit: "", city: "Test", state: "MO", zip: "01234" });
  const updated = buildCustomerEdit(original, draft, audit);
  assert.equal(updated.properties[0].address, "123 Service St"); assert.deepEqual(updated.properties[0].systems, []);
  assert.equal(updated.billingAddress, original.billingAddress);
});

test("legacy unit formatting round-trips without duplication and original incomplete data can survive unrelated edits", () => {
  const original = fixture(); original.properties[0].street = undefined;
  const draft = customerEditDraft(original); assert.equal(draft.properties[0].street, "101 Example St");
  draft.properties[0].city = "Changed";
  assert.equal(buildCustomerEdit(original, draft, audit).properties[0].address, "101 Example St, Unit A");
  original.contacts[1].email = "old-invalid"; original.contacts[1].phone = "old-invalid"; original.properties[0].address = ""; original.properties[0].unit = "";
  const rename = customerEditDraft(original); rename.name = "New Display Name";
  assert.doesNotThrow(() => buildCustomerEdit(original, rename, audit));
});

test("validation prevents missing names, malformed contact edits, missing service streets, and address loss", () => {
  const original = fixture();
  for (const [field, value, error] of [["name", "  ", /name is required/], ["email", "invalid", /valid primary email/], ["phone", ".......", /valid primary phone/], ["phone", "abc1234567890", /valid primary phone/], ["companyName", "x".repeat(1001), /1,000/]] as const) {
    const draft = customerEditDraft(original); draft[field] = value; assert.throws(() => buildCustomerEdit(original, draft, audit), error);
  }
  const dropped = customerEditDraft(original); dropped.properties.pop(); assert.throws(() => buildCustomerEdit(original, dropped, audit), /cannot be removed/);
  const empty = customerEditDraft(original); empty.properties[0].street = " "; assert.throws(() => buildCustomerEdit(original, empty, audit), /street address is required/);
  const duplicate = customerEditDraft(original); duplicate.properties[1].id = "prop-a"; assert.throws(() => buildCustomerEdit(original, duplicate, audit), /unique ID/);
});

test("same session retries generate the same write for the RPC idempotency check", () => {
  const original = fixture(); const draft = customerEditDraft(original); draft.name = "Changed";
  assert.deepEqual(buildCustomerEdit(original, draft, audit), buildCustomerEdit(original, draft, audit));
});

test("customer editor retains the opening snapshot, uses guarded confirmed saves, refreshes cache, and resets on cancellation", async () => {
  const source = await readFile("client/src/components/customer-editor.tsx", "utf8");
  assert.match(source, /structuredClone\(customer\)/); assert.match(source, /previous: session\.original/);
  assert.match(source, /if \(!session \|\| saving\.current\) return/); assert.match(source, /if \(saving\.current\) return/);
  assert.match(source, /acceptSavedRecord\("customers", saved\)/); assert.match(source, /setError\(error\.message/);
  assert.match(source, /if \(!open\) \{ setSession\(null\); return; \}/); assert.match(source, /role="alert"/);
  assert.match(source, /max-h-\[90dvh\] overflow-y-auto/);
  const detail = await readFile("client/src/pages/customer-detail.tsx", "utf8"); assert.match(detail, /<CustomerEditor key=\{customer\.id\} customer=\{customer\}/);
});

const provenance: AddressProvenance = { provider: "geoapify", selectedAt: "2026-10-08T00:00:00Z", placeId: "synthetic-place", source: { name: "openstreetmap", attribution: "© OpenStreetMap contributors", license: "ODbL", url: "https://www.openstreetmap.org/copyright" } };

test("selected service and billing provenance persists independently and survives later manual changes", () => {
  const original = fixture(); const draft = customerEditDraft(original);
  draft.properties[0].street = "500 Selected St"; draft.properties[0].addressProvenance = provenance;
  draft.billingAddress.street = "600 Selected Billing St"; draft.billingAddressProvenance = { ...provenance, placeId: "synthetic-billing" };
  const saved = buildCustomerEdit(original, draft, audit);
  assert.deepEqual(saved.properties[0].addressProvenance, provenance);
  assert.equal(saved.properties[0].unit, "Unit A"); assert.equal(saved.billingAddress?.unit, "Suite 9");
  assert.equal(saved.billingAddressProvenance?.placeId, "synthetic-billing");
  assert.deepEqual(Object.keys(saved.billingAddress!).sort(), ["city", "postalCode", "state", "street", "unit"]);
  const reopened = customerEditDraft(saved);
  assert.deepEqual(reopened.properties[0].addressProvenance, provenance);
  assert.equal(reopened.billingAddressProvenance?.placeId, "synthetic-billing");
  assert.equal(buildCustomerEdit(saved, reopened, audit), saved);
  reopened.properties[0].street = "501 Manual Correction"; reopened.billingAddress.street = "601 Manual Correction";
  const corrected = buildCustomerEdit(saved, reopened, audit);
  assert.deepEqual(corrected.properties[0].addressProvenance, provenance);
  assert.deepEqual(corrected.billingAddressProvenance, saved.billingAddressProvenance);
  assert.equal(corrected.properties[0].systems, original.properties[0].systems);
});

test("selecting the same address still records new provenance and never mutates the source record", () => {
  const original = fixture(); const draft = customerEditDraft(original);
  draft.properties[0].addressProvenance = provenance; draft.billingAddressProvenance = provenance;
  const saved = buildCustomerEdit(original, draft, audit);
  assert.deepEqual(saved.properties[0].addressProvenance, provenance);
  assert.deepEqual(saved.billingAddressProvenance, provenance);
  assert.equal(original.properties[0].addressProvenance, undefined); assert.equal(original.billingAddressProvenance, undefined);
  assert.equal(saved.activity[0].description, "Updated service addresses, billing address.");
});

test("autocomplete selection explicitly fills locality fields while preserving units and requiring Save", async () => {
  const source = await readFile("client/src/components/customer-editor.tsx", "utf8");
  assert.match(source, /<AddressAutocomplete id=\{`service-\$\{index\}-street`\}/);
  assert.match(source, /street: suggestion.street, city: suggestion.city, state: suggestion.state, zip: suggestion.postalCode, addressProvenance: suggestion.provenance/);
  assert.match(source, /billingAddress: \{ \.\.\.draft.billingAddress, street: suggestion.street, city: suggestion.city, state: suggestion.state, postalCode: suggestion.postalCode \}, billingAddressProvenance: suggestion.provenance/);
  assert.match(source, /provenance=\{property.addressProvenance\}/);
  assert.match(source, /provenance=\{draft.billingAddressProvenance\}/);
});
