import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dollarsToCents,
  missingCatalogRows,
  sellingPriceFromCost,
} from "../client/src/lib/pricebook-utils";

test("Air King selling price preserves a 20 percent margin", () => {
  assert.equal(sellingPriceFromCost("800"), "1000.00");
  assert.equal(sellingPriceFromCost(960), "1200.00");
});

test("money input is rounded safely and rejects invalid values", () => {
  assert.equal(dollarsToCents("12.345"), 1235);
  assert.throws(() => dollarsToCents("not-a-number"));
  assert.throws(() => dollarsToCents(-1));
});

test("catalog import is case-insensitive and does not create duplicates", () => {
  const rows = [
    { sku: "ABC", name: "Existing" },
    { sku: "new-1", name: "New" },
    { sku: "NEW-1", name: "Duplicate in import" },
  ];
  assert.deepEqual(missingCatalogRows(rows, ["abc"]).map((row) => row.name), ["New"]);
});
