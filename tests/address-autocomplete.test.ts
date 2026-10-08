import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { addressSuggestions, mapAddressSuggestions, registerAddressAutocomplete } from "../server/crm/address-autocomplete";
import { distinctAddressAttributions, safeAttributionUrl } from "../shared/address-autocomplete";

const fixture = { results: [
  { place_id: "public-mo", country_code: "us", housenumber: "414", street: "East 12th Street", city: "Kansas City", state_code: "MO", postcode: "64106", formatted: "414 East 12th Street, Kansas City, MO 64106", datasource: { sourcename: "openstreetmap", attribution: "© OpenStreetMap contributors", license: "ODbL", url: "https://www.openstreetmap.org/copyright" } },
  { place_id: "public-ks", country_code: "us", housenumber: "701", street: "North 7th Street", city: "Kansas City", state_code: "KS", postcode: "66101" },
] };

test("mapping preserves KS, ZIP text and source metadata without coordinates or query", () => {
  const suggestions = mapAddressSuggestions(fixture);
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[1].state, "KS"); assert.equal(suggestions[1].postalCode, "66101");
  assert.equal(suggestions[0].street, "414 East 12th Street");
  assert.equal(suggestions[0].provenance.source?.license, "ODbL");
  assert.deepEqual(Object.keys(suggestions[0]).sort(), ["city", "id", "label", "postalCode", "provenance", "state", "street"]);
});
test("mapping rejects wrong-country/amenity-only results, bounds/deduplicates output and clears absent locality", () => {
  const raw = [{ country_code: "ca", street: "Test" }, { country_code: "us", address_line1: "City Hall" }, fixture.results[0], fixture.results[0],
    ...Array.from({ length: 9 }, (_, i) => ({ country_code: "us", street: `Example ${i}`, address_line1: "Amenity", state_code: "US-KS", postcode: "00123" }))];
  const result = mapAddressSuggestions({ results: raw });
  assert.equal(result.length, 5); assert.equal(result[1].city, ""); assert.equal(result[1].state, "KS"); assert.equal(result[1].postalCode, "00123");
  assert.equal(result[1].street, "Example 0");
  assert.deepEqual(mapAddressSuggestions({ error: "provider error" }), []);
});
test("attribution links reject executable schemes, credentials and malformed URLs", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "https://user:password@example.com", "not a url"]) assert.equal(safeAttributionUrl(value), undefined);
  assert.equal(safeAttributionUrl("https://www.openstreetmap.org/copyright"), "https://www.openstreetmap.org/copyright");
});
test("shared attribution footer contains only distinct public credits, no selected-address identifiers", () => {
  const provenance = mapAddressSuggestions(fixture)[0].provenance;
  const result = distinctAddressAttributions([undefined, provenance, { ...provenance, placeId: "another-private-place", selectedAt: "another-time" }]);
  assert.equal(result.length, 1); assert.equal(result[0].provider, "geoapify");
  assert.equal(result[0].placeId, undefined); assert.equal(result[0].selectedAt, "");
  assert.equal(result[0].source?.license, "ODbL");
  assert.ok(!JSON.stringify(result).includes("public-mo"));
});
test("missing configuration or invalid queries never reserve or call the provider", async () => {
  const never = async () => { throw new Error("Must not be called"); };
  assert.equal((await addressSuggestions("414 East", { apiKey: () => undefined, reserve: never, fetch: never })).available, false);
  assert.equal((await addressSuggestions("ab", { apiKey: () => "test-only", reserve: never, fetch: never })).available, false);
});
test("quota denial, DB failure, or invalid reservation always fail closed", async () => {
  let calls = 0;
  const network = async () => { calls++; return new Response(JSON.stringify(fixture)); };
  for (const reserve of [async () => ({ allowed: false, retry_after_seconds: 1 }), async () => { throw new Error("database secret detail"); }, async () => ({} as any)]) {
    const result = await addressSuggestions("414 East", { apiKey: () => "test-only", reserve, fetch: network });
    assert.equal(result.available, false); assert.deepEqual(result.suggestions, []);
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
  assert.equal(calls, 0);
});
test("every external attempt is reserved before sending; failures are counted without automatic retries", async () => {
  let reservations = 0, calls = 0;
  const result = await addressSuggestions("414 East", {
    apiKey: () => "placeholder-only", reserve: async () => { reservations++; return { allowed: true }; },
    fetch: async (url, init) => {
      calls++; assert.equal(reservations, calls);
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, "https://api.geoapify.com"); assert.equal(parsed.pathname, "/v1/geocode/autocomplete");
      assert.equal(parsed.searchParams.get("filter"), "countrycode:us"); assert.equal(parsed.searchParams.get("limit"), "5");
      assert.equal(parsed.searchParams.get("bias"), "proximity:-94.5786,39.0997"); assert.equal(parsed.searchParams.get("type"), null);
      assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      return new Response(JSON.stringify(fixture));
    },
  });
  assert.equal(result.available, true); assert.equal(result.suggestions.length, 2);
  for (const fetch of [async () => new Response("provider secret", { status: 429 }), async () => { throw new Error("timeout containing private URL"); }, async () => new Response("invalid json")]) {
    const unavailable = await addressSuggestions("414 East", { apiKey: () => "placeholder-only", reserve: async () => { reservations++; return { allowed: true }; }, fetch: async (...args: any[]) => { calls++; return fetch(); } });
    assert.equal(unavailable.available, false);
    assert.ok(!JSON.stringify(unavailable).includes("private"));
  }
  assert.equal(reservations, 4); assert.equal(calls, 4);
});

process.env.SUPABASE_URL = "https://address-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only";
const nativeFetch = globalThis.fetch;
let role = "owner", permissions = {}, lookupCalls = 0;
globalThis.fetch = async (input: any, init?: any) => {
  const url = new URL(String(input));
  if (url.hostname !== "address-test.invalid") throw new Error("Unexpected external fetch blocked by test");
  return new Response(JSON.stringify(url.pathname === "/auth/v1/user" ? { id: "staff" } : { id: "staff", role, permissions, company_id: "airking" }), { headers: { "content-type": "application/json" } });
};
const app = express(); app.use(express.json());
registerAddressAutocomplete(app, async () => { lookupCalls++; return { available: true, suggestions: mapAddressSuggestions(fixture) }; });
let server: ReturnType<typeof app.listen>, base: string;
before(async () => { server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve)); base = `http://127.0.0.1:${(server.address() as any).port}`; });
after(async () => { globalThis.fetch = nativeFetch; await new Promise<void>(resolve => server.close(() => resolve())); });
const call = (body: unknown, auth = true, path = "/api/crm/customers/address-suggestions") => nativeFetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { Authorization: "Bearer synthetic" } : {}) }, body: JSON.stringify(body) });
test("endpoint authenticates and authorizes before provider lookup and never caches addresses", async () => {
  assert.equal((await call({ text: "414 East" }, false)).status, 401);
  role = "member"; assert.equal((await call({ text: "414 East" })).status, 403);
  role = "technician"; permissions = { customers: false }; assert.equal((await call({ text: "414 East" })).status, 403);
  assert.equal((await call({ text: "414 East" }, true, "/API/CRM/CUSTOMERS/ADDRESS-SUGGESTIONS/")).status, 403);
  permissions = {}; assert.equal((await call({ text: "ab" })).status, 400);
  assert.equal((await call({ text: "x".repeat(251) })).status, 400);
  assert.equal((await call({ text: "414 East", customer: "extra private field" })).status, 400);
  assert.equal(lookupCalls, 0);
  const response = await call({ text: "414 East" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).suggestions[1].state, "KS"); assert.equal(lookupCalls, 1);
});

test("UI source keeps suggestions user-triggered, explicit, cancelable and isolated from saves", async () => {
  const component = await readFile("client/src/components/address-autocomplete.tsx", "utf8");
  assert.match(component, /ADDRESS_DEBOUNCE_MS/); assert.match(component, /ADDRESS_MIN_CHARACTERS/);
  assert.match(component, /AbortController/); assert.match(component, /query\.sequence === sequence\.current/);
  assert.match(component, /role="combobox"/); assert.match(component, /role="listbox"/); assert.match(component, /aria-activedescendant/);
  assert.match(component, /event\.key === "Escape"/); assert.match(component, /event\.key === "Enter"/);
  assert.match(component, /useState<\{ text: string; sequence: number \} \| null>\(null\)/);
  assert.doesNotMatch(component, /saveRecords|addCustomer|console\.|localStorage|sessionStorage/);
});
test("global parser error handling redacts autocomplete request bodies including alternate casing and trailing slash", async () => {
  const source = await readFile("server/index.ts", "utf8");
  assert.match(source, /const addressRequest = _req\.path\.toLowerCase\(\)\.replace/);
  assert.match(source, /if \(addressRequest\) console\.error\("Address suggestion request failed:", status\)/);
  assert.match(source, /const message = addressRequest \? "Address suggestions are unavailable/);
});
