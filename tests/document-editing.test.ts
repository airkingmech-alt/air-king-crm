import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceEditChanges, invoiceEditForm, invoiceScopeLocked, quoteEditChanges, quoteEditForm, recalculateQuoteOption, editMoney, persistDocumentEdit } from "../client/src/lib/document-editing";
import { buildQuoteDraft } from "../client/src/lib/quote-pricing";
import { getQuoteEquipment } from "../client/src/data/pricebook";
import type { Invoice } from "../client/src/data/mock-data";
const quote = () => buildQuoteDraft({ customerId: "qa-customer", customerName: "Synthetic Customer", title: "Original scope", jobType: "Changeout", equipmentCost: 0, laborCost: 1000, materialsCost: 300, equipmentItems: ["chp-z9e080c20", "chp-ec42", "chp-xc342"], selectedAddOns: ["surge-protector"], laborDescription: "Original labor scope" }, "Q-QA", "2026-10-08");
const invoice = (): Invoice => ({ id: "INV-QA", customerId: "qa-customer", customerName: "Synthetic Customer", status: "Draft", amount: 100.10, paidAmount: 0, dueDate: "2026-11-08", items: [{ description: "Original scope", amount: 100.10 }] });
test("reopened quotes preserve saved options and prices without consulting current catalog", () => {
  const saved = quote(); saved.options[0].customerPrice = 1234.56; saved.options[0].equipmentSummary = "Historical quoted equipment";
  const form = quoteEditForm(saved); form.title = "Revised scope";
  assert.deepEqual(quoteEditChanges(saved, form), { title: "Revised scope" });
  const reloaded = { ...saved, ...quoteEditChanges(saved, form) }; assert.equal(reloaded.options[0].customerPrice, 1234.56);
  assert.equal(saved.title, "Original scope"); assert.equal(quoteEditForm(saved).title, "Original scope", "cancel leaves the source intact");
});
test("quote changes preserve custom option metadata while allowing descriptions, cents and add-ons", () => {
  const saved = quote(); (saved.options[0] as any).customReference = "retain-me";
  const form = quoteEditForm(saved); form.customerName = "Corrected Name"; form.laborDescription = "Updated scope";
  form.options[0].customerPrice = "2500.25"; form.options[0].featureText = "Feature one\nFeature two"; form.selectedAddOns = [];
  const changes: any = quoteEditChanges(saved, form);
  assert.equal(changes.options[0].customerPrice, 2500.25); assert.equal(changes.options[0].customReference, "retain-me");
  assert.deepEqual(changes.options[0].features, ["Feature one", "Feature two"]);
  for (const key of ["id", "customerId", "status", "createdAt", "acceptedScope", "addOnCatalog", "equipmentItems"]) assert.equal(key in changes, false);
});
test("changing internal quote costs does not silently raise quoted prices", () => {
  const saved = quote(); const form = quoteEditForm(saved); form.laborCost = "1500";
  const changes: any = quoteEditChanges(saved, form);
  assert.equal(changes.options[0].customerPrice, saved.options[0].customerPrice);
  assert.equal(changes.options[0].totalCost, saved.options[0].totalCost + 500);
});
test("explicit equipment recalculation keeps exact SKU selections and recalculates the reviewed option", () => {
  const saved = quote(); const form = quoteEditForm(saved); const option = recalculateQuoteOption(form.options[0], ["chp-xc342"], "1000", "300");
  assert.deepEqual(option.equipmentItems, ["chp-xc342"]); assert.match(option.equipment, /XC3/); assert.equal(option.efficiency, "Matched-system efficiency to be verified");
  assert.notEqual(option.customerPrice, form.options[0].customerPrice);
  const legacy = { equipmentItems: ["chp-xc342"], options: [{ tier: "Best", equipmentItems: ["chp-xc342"] }] };
  assert.deepEqual(getQuoteEquipment(legacy, "Best").map(item => item.id), ["chp-xc342"], "explicit edited option must not silently substitute a tier model");
  assert.throws(() => recalculateQuoteOption(form.options[0], ["missing"], "1", "1"), /no longer/);
});
test("accepted quote edits are blocked and invalid input never prepares a save", () => {
  const saved = quote(); const form = quoteEditForm(saved);
  assert.throws(() => quoteEditChanges({ ...saved, status: "Won" }, form), /draft revision/);
  for (const value of ["", "-1", "1.001", "NaN", "Infinity", "1e3", "100000001"]) assert.throws(() => editMoney(value, "Price"));
  assert.equal(editMoney("0", "Price"), 0);
  assert.throws(() => quoteEditChanges(saved, { ...form, options: [] }), /one to three/);
  assert.throws(() => quoteEditChanges(saved, { ...form, title: " " }), /required/);
});
test("invoice edit saves changed lines and recomputes a cent-exact total while preserving status and links", () => {
  const saved = invoice(); const form = invoiceEditForm(saved); form.items = [{ description: "Changed scope", amount: "10.10" }, { description: "Labor", amount: "20.20" }]; form.dueDate = "2026-12-08";
  assert.deepEqual(invoiceEditChanges(saved, form, false), { dueDate: "2026-12-08", items: [{ description: "Changed scope", amount: 10.1 }, { description: "Labor", amount: 20.2 }], amount: 30.3 });
  assert.deepEqual(saved, invoice());
  const reloaded = { ...saved, ...invoiceEditChanges(saved, form, false) }; assert.equal(invoiceEditForm(reloaded as Invoice).items[1].amount, "20.2");
});
test("quote-linked invoices edit only operational details and protect accepted scope", () => {
  const saved = { ...invoice(), quoteId: "Q-QA" }; const form = invoiceEditForm(saved); form.customerName = "Must not change"; form.items[0].amount = "999"; form.projectName = "Lot 12";
  assert.equal(invoiceScopeLocked(saved), true);
  assert.deepEqual(invoiceEditChanges(saved, form, true), { projectName: "Lot 12" });
  assert.equal(invoiceScopeLocked({ ...invoice(), workOrderId: "job" }, [{ id: "job", quoteId: "quote" } as any]), true);
});
test("paid, partially paid, void invoices and malformed data are not editable", () => {
  const saved = invoice(), form = invoiceEditForm(saved);
  for (const status of ["Paid", "Partial", "Void"] as const) assert.throws(() => invoiceEditChanges({ ...saved, status }, form, false), /billing history/);
  assert.throws(() => invoiceEditChanges({ ...saved, paidAmount: 1 }, form, false), /billing history/);
  for (const dueDate of ["2026-02-30", "bad", "2026-13-01", ""]) assert.throws(() => invoiceEditChanges(saved, { ...form, dueDate }, false), /valid due date/);
  assert.throws(() => invoiceEditChanges(saved, { ...form, items: [{ description: "", amount: "10" }] }, false), /description/);
  assert.throws(() => invoiceEditChanges(saved, { ...form, items: [{ description: "Zero", amount: "0" }] }, false), /greater than zero/);
});

test("unchanged dialogs still compare with the server and cannot restore stale cached status", async () => {
  const saved = invoice(); let writes = 0;
  await assert.rejects(persistDocumentEdit("invoice", saved, {}, async (name, args) => {
    writes++; assert.equal(name, "crm_edit_document"); assert.deepEqual(args.p_previous, saved); assert.deepEqual(args.p_changes, {});
    return { data: null, error: { message: "This record changed. Refresh and review before saving again." } };
  }), /record changed/);
  assert.equal(writes, 1);
  const confirmed = { ...saved, status: "Sent" };
  assert.equal(await persistDocumentEdit("invoice", saved, {}, async () => ({ data: confirmed, error: null })), confirmed);
});

test("changing quote models clears stale model-dependent feature promises", () => {
  const saved = quote(); const best = quoteEditForm(saved).options.find(option => option.tier === "Best")!;
  assert.match(best.featureText, /Outdoor capacity steps up/);
  const changed = recalculateQuoteOption(best, ["chp-xc342"], "1000", "300");
  assert.equal(changed.featureText, "");
  const unchanged = recalculateQuoteOption(best, best.equipmentItems!, "1500", "300");
  assert.equal(unchanged.featureText, best.featureText);
});
