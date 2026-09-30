import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeLeadSource, UNKNOWN_LEAD_SOURCE } from "../shared/customer-lead-source";

test("missing or blank source stays Unknown and deliberately selected sources are preserved", () => {
  for (const value of [undefined, null, "", "   ", "Unknown"]) assert.equal(normalizeLeadSource(value), UNKNOWN_LEAD_SOURCE);
  for (const value of ["Google Ads", "Referral", "Walk-in", "Angi", "Repeat Customer", "Website", "meta", "Custom source"]) assert.equal(normalizeLeadSource(value), value);
});

test("every customer-creation initial/reset state uses Unknown, with an explicit selectable Unknown option", async () => {
  for (const file of ["client/src/pages/customers.tsx", "client/src/components/customer-combobox.tsx", "client/src/pages/crown-care.tsx"]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /leadSource:\s*"Google Ads"/);
    assert.equal((source.match(/leadSource: UNKNOWN_LEAD_SOURCE/g) || []).length, 2, `${file}: initial state and successful-save reset`);
  }
  const form = await readFile("client/src/pages/customers.tsx", "utf8");
  assert.match(form, /<SelectItem value=\{UNKNOWN_LEAD_SOURCE\}>Unknown \/ not recorded<\/SelectItem>/);
  assert.match(form, /<SelectItem value="Google Ads">Google Ads<\/SelectItem>/);
  const context = await readFile("client/src/context/data-context.tsx", "utf8");
  assert.match(context, /leadSource: normalizeLeadSource\(data.leadSource\)/);
  assert.match(context, /lead source: \$\{normalizeLeadSource\(data.leadSource\)\}/);
});
