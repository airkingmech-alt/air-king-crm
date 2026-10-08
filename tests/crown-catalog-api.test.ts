import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerCrownCatalog } from "../server/crm/crown-catalog";
import { defaultCrownCatalog } from "../shared/crown-tiers";
process.env.SUPABASE_URL = "https://catalog-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
const nativeFetch = globalThis.fetch;
const employee = "11111111-1111-4111-8111-111111111111";
let role = "owner", company = "airking", permission = true, writes = 0, unavailable = false;
const rows = new Map<string, any>();
globalThis.fetch = async (input: any, init?: any) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  assert.equal(url.hostname, "catalog-test.supabase.invalid");
  const reply = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/auth/v1/user") return reply({ id: employee, aud: "authenticated" });
  if (url.pathname === "/rest/v1/profiles") return reply({ id: employee, role, company_id: company, permissions: { memberships: permission } });
  if (url.pathname === "/rest/v1/crown_care_catalogs") {
    if (unavailable) return reply({ code: "42P01", message: "relation missing" }, 500);
    if (init?.method === "POST") {
      const data = JSON.parse(init.body);
      assert.equal(data.company_id, company);
      if (rows.has(data.company_id)) return reply({ code: "23505", message: "duplicate" }, 409);
      rows.set(data.company_id, data); writes++; return reply(data);
    }
    const scope = url.searchParams.get("company_id");
    assert.equal(scope, "eq." + company, "Every read/update is tenant-scoped");
    const row = rows.get(company);
    if (init?.method === "PATCH") {
      if (!row || url.searchParams.get("version") !== "eq." + row.version) return reply(null);
      const updated = { ...row, ...JSON.parse(init.body) };
      rows.set(company, updated); writes++; return reply(updated);
    }
    return reply(row || null);
  }
  throw Error("Unexpected operation outside catalog: " + url.pathname);
};
const app = express(); app.use(express.json()); registerCrownCatalog(app);
let server: ReturnType<typeof app.listen>, base: string;
before(async () => { server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.on("listening", r)); base = `http://127.0.0.1:${(server.address() as any).port}`; });
after(async () => { globalThis.fetch = nativeFetch; await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { role = "owner"; company = "airking"; permission = true; unavailable = false; writes = 0; rows.clear(); });
const prices = { bronze: 20900, silver: 28900, gold: 35900 };
const body = (version = defaultCrownCatalog.version) => ({ version, prices });
const send = (data?: any, key: string | undefined = crypto.randomUUID(), auth = true) => nativeFetch(base + "/api/crm/crown-care/catalog", {
  method: data ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(auth ? { Authorization: "Bearer test" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, body: data ? JSON.stringify(data) : undefined,
});

test("authenticated catalog reads are scoped, permission-aware, and never initialize by writing", async () => {
  assert.equal((await send(undefined, undefined, false)).status, 401);
  role = "technician";
  const response = await send(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { catalog: defaultCrownCatalog, version: defaultCrownCatalog.version });
  assert.equal(writes, 0);
  permission = false; assert.equal((await send()).status, 403);
});

test("only owner may publish prices; untrusted benefits and incomplete/invalid prices are rejected", async () => {
  for (const value of ["technician", "dispatcher", "admin"]) { role = value; assert.equal((await send(body())).status, 403); }
  role = "owner";
  for (const invalid of [
    { ...body(), tiers: defaultCrownCatalog.tiers }, { ...body(), prices: { bronze: 20000 } },
    ...[0, -1, 12.5, "19900", 1000001].map(bronze => ({ ...body(), prices: { ...prices, bronze } })),
  ]) assert.equal((await send(invalid)).status, 400);
  assert.equal((await send(body(), "not-a-uuid")).status, 400);
  assert.equal(writes, 0);
});

test("owner edits have versioned prospective prices, immutable benefits, and complete audit history", async () => {
  const key = crypto.randomUUID(); const response = await send(body(), key); assert.equal(response.status, 200);
  const first = await response.json(); assert.notEqual(first.version, defaultCrownCatalog.version);
  assert.equal(first.catalog.version, first.version); assert.equal(first.catalog.tiers.gold.annualPerSystemCents, 35900);
  assert.equal(first.catalog.tiers.gold.repairDiscountPercent, 15);
  let row = rows.get(company); assert.equal(row.history.length, 1); assert.equal(row.history[0].actorId, employee);
  assert.equal(row.history[0].requestKey, key); assert.deepEqual(row.history[0].before, defaultCrownCatalog);
  assert.deepEqual(row.history[0].after, first.catalog);
  assert.equal((await send(body(), key)).status, 200); assert.equal(writes, 1);
  assert.equal((await send({ ...body(), prices: { ...prices, gold: 36900 } }, key)).status, 409);
  const stale = await send(body()); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "CROWN_CATALOG_STALE");
  const secondResponse = await send({ version: first.version, prices: { ...prices, gold: 36900 } }); assert.equal(secondResponse.status, 200);
  row = rows.get(company); assert.equal(row.history.length, 2); assert.deepEqual(row.history[1].before, first.catalog);
  assert.deepEqual(row.history[0].after, first.catalog); assert.equal(writes, 2);
  company = "other-company"; assert.deepEqual((await (await send()).json()).catalog, defaultCrownCatalog);
});

test("competing first publications and updates produce one version and one audit edit", async () => {
  for (const seed of [false, true]) {
    rows.clear(); writes = 0;
    let version = defaultCrownCatalog.version;
    if (seed) version = (await (await send(body())).json()).version;
    const count = writes;
    const responses = await Promise.all([send(body(version)), send(body(version))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(writes, count + 1);
  }
});

test("simultaneous identical idempotent edits are safely replayed without duplicate history", async () => {
  const key = crypto.randomUUID(); const responses = await Promise.all([send(body(), key), send(body(), key)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]); assert.equal(writes, 1); assert.equal(rows.get(company).history.length, 1);
});

test("database problems never silently fall back to stale default prices", async () => {
  unavailable = true; assert.equal((await send()).status, 503); assert.equal((await send(body())).status, 503); assert.equal(writes, 0);
});
