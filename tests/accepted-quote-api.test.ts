import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAcceptedQuotes } from "../server/crm/accepted-quotes";

// All Supabase transport is mocked and restricted to an invalid test hostname.
// Only the Express listener uses native fetch, on loopback.
process.env.SUPABASE_URL = "https://accepted-quote-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-test-only";
const nativeFetch = globalThis.fetch;
const employee = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
let profile: any, quote: any, authenticated: boolean, rpcError: string | null;
let calls: { path: string; body: any }[], reads: string[];
const confirmedInvoice = { id: "INV-authoritative", quoteId: "quote-one", amount: 10975, items: [{ description: "Accepted scope", amount: 10975 }] };
const confirmedRevision = { id: "Q-R-" + requestId, revisionOf: "quote-one", status: "Draft" };
function response(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
globalThis.fetch = async (input: any, init: any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  assert.equal(url.hostname, "accepted-quote-test.supabase.invalid", "No external network requests permitted");
  if (url.pathname === "/auth/v1/user") return authenticated
    ? response({ id: employee, aud: "authenticated" })
    : response({ message: "Invalid JWT", code: "bad_jwt" }, 401);
  if (url.pathname === "/rest/v1/profiles") {
    assert.equal(url.searchParams.get("id"), "eq." + employee);
    return response(profile);
  }
  if (url.pathname === "/rest/v1/quotes") {
    reads.push(url.pathname);
    assert.equal(url.searchParams.get("id"), "eq.quote-one");
    assert.equal(url.searchParams.get("company_id"), "eq.airking", "Entity read must use verified caller company");
    return response(quote);
  }
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body);
    calls.push({ path: url.pathname, body });
    if (rpcError) return response({ code: "P0001", message: rpcError }, 400);
    if (url.pathname.endsWith("/crm_invoice_accepted_quote")) return response(confirmedInvoice);
    if (url.pathname.endsWith("/crm_revise_accepted_quote")) return response(confirmedRevision);
  }
  throw new Error("Unexpected database request: " + url.pathname);
};
const app = express(); app.use(express.json()); registerAcceptedQuotes(app);
let server: ReturnType<typeof app.listen>, base: string;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/crm/quotes/quote-one`;
});
after(async () => {
  globalThis.fetch = nativeFetch;
  await new Promise<void>(resolve => server.close(() => resolve()));
});
beforeEach(() => {
  profile = { id: employee, company_id: "airking", role: "technician", permissions: {} };
  quote = { id: "quote-one", company_id: "airking", data: { id: "quote-one", status: "Won" } };
  authenticated = true; rpcError = null; calls = []; reads = [];
});
async function post(route: "invoice" | "revise", body: any = {}, authorized = true) {
  const result = await nativeFetch(base + "/" + route, { method: "POST",
    headers: { "content-type": "application/json", ...(authorized ? { authorization: "Bearer test-token" } : {}) },
    body: JSON.stringify(body) });
  return { status: result.status, body: await result.json() };
}

for (const route of ["invoice", "revise"] as const) {
  test(`${route} requires an authenticated user and never calls an RPC for missing/invalid credentials`, async () => {
    assert.equal((await post(route, { requestId }, false)).status, 401);
    authenticated = false;
    assert.equal((await post(route, { requestId })).status, 401);
    assert.equal(calls.length, 0);
  });
  test(`${route} rejects nonstaff, missing and invalid-company profiles`, async () => {
    for (const invalid of [null, { ...profile, role: "customer" }, { ...profile, company_id: "" }, { ...profile, company_id: "   " }, { ...profile, company_id: null }]) {
      profile = invalid;
      assert.equal((await post(route, { requestId })).status, 403);
    }
    assert.equal(calls.length, 0); assert.equal(reads.length, 0);
  });
  test(`${route} requires quotes permission before reading private quote data`, async () => {
    profile.permissions.quotes = false;
    assert.equal((await post(route, { requestId })).status, 403);
    assert.equal(calls.length, 0); assert.equal(reads.length, 0);
  });
  test(`${route} excludes missing, cross-company and soft-deleted quote records`, async () => {
    // The mocked table read is company filtered; an inaccessible quote yields null.
    quote = null;
    assert.equal((await post(route, { requestId })).status, 404);
    quote = { id: "quote-one", company_id: "airking", data: { deletedAt: "2026-10-05" } };
    assert.equal((await post(route, { requestId })).status, 404);
    assert.equal(calls.length, 0);
  });
}

test("invoice creation requires invoice permission in addition to quote permission", async () => {
  profile.permissions.invoices = false;
  assert.equal((await post("invoice")).status, 403);
  assert.equal(calls.length, 0); assert.equal(reads.length, 0);
  assert.equal((await post("revise", { requestId })).status, 200, "revision requires quote permission only");
});

test("invoice RPC uses only verified actor, company and URL quote; arbitrary client prices and selections are ignored", async () => {
  const result = await post("invoice", {
    amount: 0.01, items: [{ description: "Unapproved", amount: 0.01 }], selectedAddOns: ["free-upgrade"],
    selectedOption: "unauthorized-tier", addOnCatalog: [{ id: "free-upgrade", price: 0 }],
    company: "other", companyId: "other", actor: requestId, quoteId: "other-quote",
    p_company: "other", p_actor: requestId, p_quote: "other-quote",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { invoice: confirmedInvoice });
  assert.deepEqual(calls, [{ path: "/rest/v1/rpc/crm_invoice_accepted_quote", body: {
    p_company: "airking", p_actor: employee, p_quote: "quote-one",
  } }]);
});

test("revision RPC accepts only a valid request UUID and ignores arbitrary scope/client identity", async () => {
  const result = await post("revise", { requestId, amount: 1, status: "Won", acceptedScope: { amount: 1 },
    selectedAddOns: ["unknown"], companyId: "other", p_quote: "other-quote", p_actor: requestId });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { quote: confirmedRevision });
  assert.deepEqual(calls, [{ path: "/rest/v1/rpc/crm_revise_accepted_quote", body: {
    p_company: "airking", p_actor: employee, p_quote: "quote-one", p_request: requestId,
  } }]);
});

test("revision rejects missing, malformed and non-string request IDs before any RPC", async () => {
  for (const requestId of [undefined, null, 123, "not-a-uuid", ""] ) {
    const result = await post("revise", { requestId });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "Please check the request.");
  }
  assert.equal(calls.length, 0);
});

test("owner permissions remain available and verified server results are returned unchanged", async () => {
  profile.role = "owner"; profile.permissions = { quotes: false, invoices: false };
  assert.equal((await post("invoice")).status, 200);
  assert.equal((await post("revise", { requestId })).status, 200);
});

test("server rejection is returned as an error without inventing an invoice or revision", async () => {
  rpcError = "This legacy acceptance has no verified price snapshot. Review a draft revision and obtain approval before invoicing";
  const result = await post("invoice");
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: rpcError });
  assert.equal(result.body.invoice, undefined);
});
