import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSupplierMaterialsRows } from "../shared/supplier-materials-import";
import { matchesPricebookTab, newItemDefaults, categoryAfterTypeChange } from "../shared/pricebook-sections";
import { assertCatalogPrice, compareCatalogItems, matchesCatalogSearch, needsCatalogPrice } from "../shared/pricebook-catalog";

// Synthetic examples only. Supplier account prices must remain outside the source repository.
const source = {
  source_row: 1, source_page: 1, supplier: "Baker", manufacturer: "Test Brand",
  supplier_sku: "TEST-0001", model: "0001", category: "Ductwork & Fittings", subcategory: "Rectangular Duct",
  name: "25x10x96 in Rectangular Duct - Baker", source_description: '25" x 10" 96" Trunk Duct',
  source_url: "https://www.bakerdist.com/permalink/sku/test", cost_cents: 8004, source_unit: "EA", unit: "each",
  dimensions_inches: [25,10,96], source_notes: [],
};
const manifest = (rows: unknown[]) => ({pricing_date: "2026-10-25", source_filename: "synthetic.pdf", source_sha256: "a".repeat(64), rows});

test("ductwork has its own view and remains in Parts; creation preserves its category", () => {
  const row = {category:"Ductwork & Fittings",item_type:"part" as const};
  assert.equal(matchesPricebookTab(row,"ductwork"),true);
  assert.equal(matchesPricebookTab(row,"part"),true);
  assert.equal(matchesPricebookTab(row,"mini-splits"),false);
  assert.deepEqual(newItemDefaults("ductwork"),{item_type:"part",category:"Ductwork & Fittings"});
  assert.equal(categoryAfterTypeChange(row.category,"part"),row.category);
  assert.equal(categoryAfterTypeChange(row.category,"labor"),"Labor");
  assert.equal(matchesPricebookTab({category:"Thermostats",item_type:"part"},"thermostats"),true);
});

test("supplier costs, units, model strings and sources survive import; selling prices use existing margin", () => {
  const [row] = buildSupplierMaterialsRows(manifest([source]),"test-company");
  assert.equal(row.cost_cents,8004); assert.equal(row.price_cents,10005);
  assert.equal(row.unit,"each"); assert.equal(row.model,"0001"); assert.equal(row.metadata.supplier,"Baker");
  assert.equal(row.metadata.source_cost_cents,8004); assert.equal(row.metadata.source_page,1);
  const [carton] = buildSupplierMaterialsRows(manifest([{...source,source_unit:"CT",unit:"carton"}]),"test-company");
  assert.equal(carton.unit,"carton"); assert.equal(carton.cost_cents,8004);
  assert.throws(()=>buildSupplierMaterialsRows(manifest([source,{...source,supplier_sku:"test-0001"}]),"test-company"),/Duplicate/);
  assert.throws(()=>buildSupplierMaterialsRows(manifest([source]),""),/Company/);
});

test("unknown prices stay explicitly missing and cannot be added to invoices", () => {
  const [row] = buildSupplierMaterialsRows(manifest([{...source,cost_cents:null,source_unit:null,unit:"unit not shown"}]),"test-company");
  assert.equal(row.metadata.source_cost_cents,null);
  assert.equal(needsCatalogPrice(row),true);
  assert.throws(()=>assertCatalogPrice(row),/before adding/);
  assert.doesNotThrow(()=>assertCatalogPrice({...row,metadata:{...row.metadata,price_status:"confirmed",unit_status:"confirmed"},price_cents:100}));
  assert.throws(()=>buildSupplierMaterialsRows(manifest([{...source,cost_cents:null}]),"test-company"),/explicitly missing/);
});

test("search handles size punctuation, multiple fields, supplier, model and SKU", () => {
  const [row] = buildSupplierMaterialsRows(manifest([source]),"test-company");
  for (const query of ["25x10x96","25 x 10 x 96",'25" × 10" × 96"',"baker 25x10x96","baker rectangular","test0001","0001"])
    assert.equal(matchesCatalogSearch(row,query),true,query);
  assert.equal(matchesCatalogSearch(row,"winsupply 25x10x96"),false);
  assert.equal(matchesCatalogSearch(row," "),true);
});

test("natural size sorting and price sorting place missing prices last", () => {
  const [row] = buildSupplierMaterialsRows(manifest([source]),"test-company");
  const smaller={...row,name:"6x8x60 in Rectangular Duct - Baker",metadata:{...row.metadata,dimensions_inches:[6,8,60]}};
  assert.ok(compareCatalogItems(smaller,row)<0);
  const missing={...row,cost_cents:0,metadata:{...row.metadata,price_status:"missing" as const}};
  for (const sort of ["cost-low","cost-high"] as const) assert.ok(compareCatalogItems(row,missing,sort)<0);
});
