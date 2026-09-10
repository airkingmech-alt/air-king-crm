import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { caller, entity } from "../server/crm/core";

// Isolated process, no real tokens or network calls.
process.env.SUPABASE_URL = "https://access-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-only";
const originalFetch = globalThis.fetch;
let role = "owner";
let company: string | null = "test-company";
let authFails = false;
let requests = 0;
const request = (token?: string) =>
  ({ headers: token ? { authorization: `Bearer ${token}` } : {} }) as Request;
globalThis.fetch = async (input: any) => {
  requests++;
  const url = new URL(
    typeof input === "string" ? input : input.url || String(input),
  );
  assert.equal(
    url.hostname,
    "access-test.supabase.invalid",
    "No live network in tests",
  );
  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (url.pathname === "/auth/v1/user") {
    if (authFails) return json({ message: "Invalid token" }, 401);
    return json({
      id: "11111111-1111-4111-8111-111111111111",
      aud: "authenticated",
      // Deliberately spoofed metadata must never grant staff privileges.
      user_metadata: { role: "owner", company_id: "victim-company" },
    });
  }
  if (url.pathname === "/rest/v1/profiles")
    return json({ role, company_id: company });
  assert.equal(url.pathname, "/rest/v1/invoices");
  assert.equal(url.searchParams.get("company_id"), "eq.test-company");
  return json(null);
};
after(() => {
  globalThis.fetch = originalFetch;
});

test("missing authorization is rejected without querying the database", async () => {
  const before = requests;
  await assert.rejects(caller(request()), { status: 401 });
  assert.equal(requests, before);
});
test("invalid staff sessions are rejected by server verification", async () => {
  authFails = true;
  try {
    await assert.rejects(caller(request("invalid")), { status: 401 });
  } finally {
    authFails = false;
  }
});
test("staff roles come from the profile, never editable user metadata", async () => {
  role = "customer";
  try {
    await assert.rejects(caller(request("test")), { status: 403 });
  } finally {
    role = "owner";
  }
});
test("an unassigned staff profile cannot bypass company filtering", async () => {
  try {
    for (const value of [null, "", "   "]) {
      company = value;
      await assert.rejects(caller(request("test")), { status: 403 });
    }
  } finally {
    company = "test-company";
  }
});
test("technicians cannot change administrator settings", async () => {
  role = "technician";
  try {
    await assert.rejects(caller(request("test"), true), { status: 403 });
    assert.equal((await caller(request("test"))).company, "test-company");
  } finally {
    role = "owner";
  }
});
test("owner access remains company scoped", async () => {
  const c = await caller(request("test"), true);
  assert.equal(c.company, "test-company");
  await assert.rejects(entity("invoices", "other-company-invoice", c.company), {
    status: 404,
  });
});
