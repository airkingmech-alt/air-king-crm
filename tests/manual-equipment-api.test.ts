import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { registerEquipmentAnalysis } from "../server/crm/equipment-analysis";
import { equipmentDetails } from "../shared/manual-equipment";

process.env.SUPABASE_URL = "https://equipment-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-only";
const nativeFetch = globalThis.fetch;
const pg = new PGlite();
let permission = true, stale = false, failWrite = false;
const scanned = { id: "scanned", type: "AC", brand: "Existing", model: "original", serial: "old", installDate: "2020-01-01", warrantyExp: "2030-01-01", status: "Warranty", sourcePhotoId: "photo-old", sourcePhotoIds: ["photo-old"], filterSize: "20x25", customField: "keep" };
const initial = { id: "customer", name: "Synthetic", notes: "Keep customer details", properties: [
  { id: "property-a", address: "Synthetic A", systems: [scanned] },
  { id: "property-b", address: "Synthetic B", systems: [] },
] };
const reply = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input: any, init?: any) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  assert.equal(url.hostname, "equipment-test.supabase.invalid", "No production calls");
  if (url.pathname === "/auth/v1/user") return reply({ id: "staff", aud: "authenticated" });
  if (url.pathname === "/rest/v1/profiles") return reply({ id: "staff", company_id: "company", role: "technician", permissions: { customers: permission } });
  assert.equal(url.searchParams.get("company_id"), "eq.company");
  if (url.pathname === "/rest/v1/customer_photos") return reply({ id: "photo-new", company_id: "company", customer_id: "customer" });
  assert.equal(url.pathname, "/rest/v1/customers");
  const id = url.searchParams.get("id")!.slice(3);
  if (init?.method === "PATCH") {
    assert.ok(url.searchParams.has("updated_at"), "Saves must use optimistic locking");
    if (failWrite) return reply({ message: "Synthetic storage unavailable" }, 503);
    if (stale) return reply(null);
    const body = JSON.parse(init.body);
    const result = await pg.query("update customers set data=$1, updated_at=$2 where id=$3 and company_id=$4 and updated_at=$5 returning id", [body.data, body.updated_at, id, "company", url.searchParams.get("updated_at")!.slice(3)]);
    return reply(result.rows[0] || null);
  }
  const result = await pg.query("select * from customers where id=$1 and company_id=$2", [id, "company"]);
  return reply(result.rows[0] || null);
};
const app = express(); app.use(express.json()); registerEquipmentAnalysis(app);
let server: ReturnType<typeof app.listen>, base: string;
before(async () => {
  await pg.exec("create table customers(id text primary key, company_id text, data jsonb, updated_at text)");
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(async () => {
  permission = true; stale = false; failWrite = false;
  await pg.exec("truncate customers");
  for (const [id, company] of [["customer", "company"], ["other-customer", "company"], ["foreign", "other-company"]])
    await pg.query("insert into customers values($1,$2,$3,$4)", [id, company, { ...initial, id }, "initial-version"]);
});
after(async () => { globalThis.fetch = nativeFetch; await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); });
const send = (body: any, path = "manual", authenticated = true) => nativeFetch(base + "/api/equipment/" + path, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { Authorization: "Bearer synthetic" } : {}) }, body: JSON.stringify(body) });
const payload = () => ({ customerId: "customer", propertyId: "property-a", requestId: randomUUID(), equipment: equipmentDetails({ type: "Furnace", brand: "Test brand", model: "model-1", serial: "serial-1", manufactureYear: 2020 }) });
const load = async (id = "customer") => (await pg.query<{ data: any }>("select data from customers where id=$1", [id])).rows[0].data;

test("multiple manual records persist in PostgreSQL with correct customer/property association", async () => {
  const first = payload(); const second = { ...payload(), propertyId: "property-b", equipment: { ...payload().equipment, type: "Heat Pump", serial: "serial-2" } };
  const one = await send(first); assert.equal(one.status, 200); const firstSaved = (await one.json()).equipment;
  const two = await send(second); assert.equal(two.status, 200); const secondSaved = (await two.json()).equipment;
  assert.notEqual(firstSaved.id, secondSaved.id);
  const third = await send(payload()); assert.equal(third.status, 200);
  const stored = await load(); // Fresh query, not the API response or client cache.
  assert.equal(stored.properties[0].systems.length, 3);
  assert.equal(stored.properties[1].systems.length, 1);
  assert.equal(stored.properties[1].systems[0].serial, "serial-2");
  assert.deepEqual(stored.properties[0].systems[0], scanned);
  assert.equal(stored.notes, initial.notes);
  assert.deepEqual((await load("other-customer")).properties, initial.properties);
});

test("editing preserves scan provenance, warranty, installation, status and unrelated data", async () => {
  const input = { ...payload(), systemId: scanned.id, original: equipmentDetails(scanned as any), equipment: { ...equipmentDetails(scanned as any), model: "corrected", capacity: "3 tons" } };
  assert.equal((await send(input)).status, 200);
  const stored = await load(); const updated = stored.properties[0].systems[0];
  assert.equal(updated.model, "corrected"); assert.equal(updated.capacity, "3 tons");
  for (const key of ["id", "installDate", "warrantyExp", "status", "sourcePhotoId", "sourcePhotoIds", "filterSize", "customField"])
    assert.deepEqual(updated[key], scanned[key as keyof typeof scanned]);
  assert.equal(stored.properties[0].systems.length, 1);
  assert.equal((await send(input)).status, 200, "Lost-response edit retry is idempotent");
  assert.equal((await send({ ...input, requestId: randomUUID() })).status, 409, "Stale edit must not overwrite correction");
});

test("create retries do not duplicate, even after a subsequent edit", async () => {
  const input = payload(); assert.equal((await send(input)).status, 200); assert.equal((await send(input)).status, 200);
  assert.equal((await send({ ...input, propertyId: "property-b" })).status, 409, "Retry cannot move a completed creation to another property");
  const original = (await load()).properties[0].systems[1];
  assert.equal((await send({ ...payload(), systemId: original.id, original: equipmentDetails(original), equipment: { ...equipmentDetails(original), serial: "edited" } })).status, 200);
  assert.equal((await send(input)).status, 409);
  assert.equal((await load()).properties[0].systems.length, 2);
});

test("validation, missing properties, cross-property edits and access boundaries reject without writes", async () => {
  const input = payload();
  assert.equal((await send(input, "manual", false)).status, 401);
  permission = false; assert.equal((await send(input)).status, 403); permission = true;
  assert.equal((await send({ ...input, customerId: "foreign" })).status, 404);
  for (const patch of [{ propertyId: "missing" }, { propertyId: "property-b", systemId: scanned.id, original: equipmentDetails(scanned as any) }, { systemId: "missing", original: input.equipment }, { systemId: scanned.id }])
    assert.equal((await send({ ...input, ...patch })).status, 400);
  for (const patch of [{ type: "" }, { manufactureYear: 3000 }, { manufactureYear: 2020.5 }, { brand: "x".repeat(201) }])
    assert.equal((await send({ ...input, equipment: { ...input.equipment, ...patch } })).status, 400);
  assert.deepEqual((await load()).properties, initial.properties);
});

test("storage failures and concurrent customer writes never report success", async () => {
  const input = payload();
  stale = true; assert.equal((await send(input)).status, 409); stale = false;
  failWrite = true; assert.equal((await send(input)).status, 400); failWrite = false;
  assert.deepEqual((await load()).properties, initial.properties);
  assert.equal((await send(input)).status, 200);
});

test("scan confirmation still requires review and supports new and existing records", async () => {
  const input = { customerId: "customer", propertyId: "property-a", photoId: "photo-new", confirmed: true, equipment: payload().equipment };
  assert.equal((await send({ ...input, confirmed: false }, "confirm")).status, 400);
  assert.equal((await send({ ...input, customerId: "other-customer" }, "confirm")).status, 400);
  assert.equal((await send({ ...input, systemId: scanned.id }, "confirm")).status, 200);
  assert.equal((await send({ ...input, systemId: scanned.id }, "confirm")).status, 200);
  const stored = await load(); assert.equal(stored.properties[0].systems.length, 1);
  assert.deepEqual(stored.properties[0].systems[0].sourcePhotoIds, ["photo-old", "photo-new"]);
  assert.equal(stored.properties[0].systems[0].warrantyExp, scanned.warrantyExp);
});

test("scan adds a distinct unit alongside manual equipment without duplicate confirmation", async () => {
  assert.equal((await send(payload())).status, 200);
  const input = { customerId: "customer", propertyId: "property-a", photoId: "photo-new", confirmed: true, equipment: payload().equipment };
  assert.equal((await send(input, "confirm")).status, 200);
  assert.equal((await send(input, "confirm")).status, 200);
  const systems = (await load()).properties[0].systems;
  assert.equal(systems.length, 3); assert.equal(new Set(systems.map((s: any) => s.id)).size, 3);
  assert.deepEqual(systems[0], scanned); assert.equal(systems[2].sourcePhotoId, "photo-new");
});
