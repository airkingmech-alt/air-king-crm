import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addPropertyCoverage, propertyServiceDetails, savedEquipmentCoverage } from "../shared/property-coverage";
import { serviceDetails } from "../shared/crown-care";
import type { Property } from "../client/src/data/mock-data";
const property: Property = { id: "p", address: "Synthetic house", city: "Lathrop", state: "CA", zip: "", gateCode: "Synthetic gate", serviceContacts: [{ name: "Tenant", role: "Tenant", phone: "2025550111", email: "" }], systems: [
  { id: "f", type: "Furnace", brand: "Test", model: "", serial: "", installDate: "", status: "Active", filterSize: "20x25x4", filterQuantity: 2, filterNotes: "Customer supplies", location: "Hall closet" },
  { id: "a", type: "AC", brand: "", model: "", serial: "", installDate: "", status: "Active" },
  { id: "old", type: "AC", brand: "", model: "", serial: "", installDate: "", status: "Inactive" },
] };
test("property coverage is repeatable, preserves edits, and copies only selected active systems", () => {
  const first = addPropertyCoverage([], property, randomUUID);
  assert.equal(first.length, 2); assert.ok(first.every(e => e.propertyId === "p"));
  assert.equal(first[0].filterQuantity, 2); assert.equal(first[0].filterNotes, "Customer supplies");
  assert.match(first[0].description, /Hall closet/);
  first[0].filterNotes = "Reviewed agreement";
  assert.deepEqual(addPropertyCoverage(first, property, randomUUID), first);
  const other = addPropertyCoverage(first, { ...property, id: "other" }, randomUUID);
  assert.equal(other.length, 4); assert.equal(other[2].propertyId, "other");
  assert.throws(() => addPropertyCoverage(Array.from({length:100}, () => ({ ...first[0], systemId: "unrelated" })), property, randomUUID), /100/);
});
test("unknown quantities remain flagged for review and visit details identify properties", () => {
  const unknown = savedEquipmentCoverage("p", property.systems[1], randomUUID());
  assert.match(unknown.filterNotes, /Verify filter quantity/);
  assert.equal(unknown.filterSize, "");
  assert.match(propertyServiceDetails(property), /Tenant · Tenant · 2025550111/);
  assert.match(propertyServiceDetails(property), /Gate code: Synthetic gate/);
  assert.match(serviceDetails({coveredEquipment:[unknown]}, [property]), /Synthetic house\n1 × AC/);
});
