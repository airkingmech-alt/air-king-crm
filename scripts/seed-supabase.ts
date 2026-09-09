// Inserts seed data into Supabase via the REST API (no SQL pasting needed).
// Run AFTER 002_schema_only.sql has been executed in the Supabase SQL editor:
//   npx tsx scripts/seed-supabase.ts
import {
  customers,
  quotes,
  workOrders,
  invoices,
  memberships,
} from "../client/src/data/mock-data";
import { readFileSync } from "node:fs";

// Load the public anon key + URL from the client env (public, browser-safe).
const envText = readFileSync(
  "/home/user/workspace/air-king-crm/client/.env",
  "utf-8"
);
const getEnv = (key: string) =>
  (envText.match(new RegExp(`^${key}=(.*)$`, "m")) || [])[1]?.trim() || "";

const url = getEnv("VITE_SUPABASE_URL");
const anonKey = getEnv("VITE_SUPABASE_ANON_KEY");

if (!url || !anonKey) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in client/.env");
  process.exit(1);
}

async function upsertTable(table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log(`${table}: no rows to insert`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${table} insert failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  console.log(`${table}: inserted ${Array.isArray(data) ? data.length : "?"} rows`);
}

// jsonb-blob rows: store the full entity as `data`.
// `customers` has no customer_id column (its id IS the customer id);
// the other tables do, so we pass includeCustomerId=true for them.
const blobRows = (
  items: { id: string; customerId?: string }[],
  includeCustomerId: boolean
) =>
  items.map((it) => {
    const row: Record<string, unknown> = {
      id: it.id,
      company_id: "air-king",
      data: it,
    };
    if (includeCustomerId) row.customer_id = (it as any).customerId ?? it.id;
    return row;
  });

(async () => {
  console.log(`Seeding ${url} ...`);
  await upsertTable("customers", blobRows(customers, false));
  await upsertTable("quotes", blobRows(quotes, true));
  await upsertTable("work_orders", blobRows(workOrders, true));
  await upsertTable("invoices", blobRows(invoices, true));
  await upsertTable("memberships", blobRows(memberships, true));
  console.log("Seed complete.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
