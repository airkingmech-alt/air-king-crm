import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryAfterTypeChange, matchesPricebookTab, newItemDefaults, SHEET_METAL_CATEGORY } from "../shared/pricebook-sections";

test("sheet metal appears in its own section and all items, outside Parts", () => {
  const sheet = { item_type: "part" as const, category: SHEET_METAL_CATEGORY };
  assert.equal(matchesPricebookTab(sheet, "sheet-metal"), true);
  assert.equal(matchesPricebookTab(sheet, "all"), true);
  assert.equal(matchesPricebookTab(sheet, "part"), false);
  assert.equal(matchesPricebookTab(sheet, "ductwork"), false);
  for (const category of ["Thermostats", "Capacitors", "Replacement Parts", "Ductwork & Fittings"]) {
    assert.equal(matchesPricebookTab({ ...sheet, category }, "sheet-metal"), false);
    assert.equal(matchesPricebookTab({ ...sheet, category }, "part"), true);
  }
  assert.equal(matchesPricebookTab({ ...sheet, item_type: "equipment" }, "sheet-metal"), false);
  assert.equal(matchesPricebookTab({ ...sheet, category: ` ${SHEET_METAL_CATEGORY.toLowerCase()} ` }, "sheet-metal"), true);
});

test("new sheet metal items keep the supported part type and category", () => {
  assert.deepEqual(newItemDefaults("sheet-metal"), { item_type: "part", category: SHEET_METAL_CATEGORY });
  assert.equal(categoryAfterTypeChange(SHEET_METAL_CATEGORY, "part"), SHEET_METAL_CATEGORY);
  assert.equal(categoryAfterTypeChange(SHEET_METAL_CATEGORY, "service"), "Services");
});
