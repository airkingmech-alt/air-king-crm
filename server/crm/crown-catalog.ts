import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  crownCatalogPrices, crownCatalogSchema, crownCatalogStale, crownTierIds,
  defaultCrownCatalog, type CrownCatalog,
} from "../../shared/crown-tiers";
import { caller, db, hash, result } from "./core";

export const crownCatalogUpdate = z.object({
  version: z.string().min(1).max(100), prices: crownCatalogPrices,
}).strict();
type CatalogEdit = {
  at: string; actorId: string; requestKey: string; requestHash: string;
  before: CrownCatalog; after: CrownCatalog;
};
type CatalogRow = { version: string; catalog: CrownCatalog; history: CatalogEdit[] };
const fail = (message: string, status = 400, code?: string) => Object.assign(new Error(message), { status, code });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  try { await fn(req, res); }
  catch (e: any) {
    res.status(e.status || 400).json({
      error: e instanceof z.ZodError ? e.issues[0]?.message || "Check the catalog prices." : e.message,
      ...(e.code ? { code: e.code } : {}),
    });
  }
};

async function catalogRow(company: string): Promise<CatalogRow | null> {
  const response = await db().from("crown_care_catalogs")
    .select("version,catalog,history").eq("company_id", company).maybeSingle();
  if (response.error) throw fail("Crown Care pricing is temporarily unavailable. Please try again.", 503);
  if (!response.data) return null;
  const catalog = crownCatalogSchema.safeParse(response.data.catalog);
  if (!catalog.success || catalog.data.version !== response.data.version || !Array.isArray(response.data.history)) {
    throw fail("Crown Care pricing needs an administrator review before it can be used.", 503);
  }
  return { ...response.data, catalog: catalog.data } as CatalogRow;
}

// A company without an edited row uses the immutable first published catalog.
// A missing/unavailable table fails closed rather than silently using old prices.
export async function loadCrownCatalog(company: string): Promise<CrownCatalog> {
  return (await catalogRow(company))?.catalog || crownCatalogSchema.parse(defaultCrownCatalog);
}

function replay(row: CatalogRow | null, key: string, requestHash: string) {
  const prior = row?.history.find(edit => edit.requestKey === key);
  if (!prior) return null;
  if (prior.requestHash !== requestHash) throw fail("This save reference was already used with different prices. Refresh and try again.", 409, "CROWN_CATALOG_REQUEST_CONFLICT");
  return row!.catalog;
}

export async function saveCrownCatalog(company: string, actorId: string, key: string, input: z.infer<typeof crownCatalogUpdate>) {
  const requestHash = hash(JSON.stringify(input));
  const row = await catalogRow(company);
  const repeated = replay(row, key, requestHash);
  if (repeated) return repeated;
  const before = row?.catalog || crownCatalogSchema.parse(defaultCrownCatalog);
  if (before.version !== input.version) throw crownCatalogStale();
  const version = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}`;
  const catalog: CrownCatalog = {
    version,
    tiers: Object.fromEntries(crownTierIds.map(id => [id, { ...before.tiers[id], annualPerSystemCents: input.prices[id] }])) as CrownCatalog["tiers"],
  };
  const edit: CatalogEdit = { at: new Date().toISOString(), actorId, requestKey: key, requestHash, before, after: catalog };
  const change = { version, catalog, history: [...(row?.history || []), edit], updated_at: edit.at };
  const saved = row
    ? await db().from("crown_care_catalogs").update(change).eq("company_id", company).eq("version", row.version).select("catalog").maybeSingle()
    : await db().from("crown_care_catalogs").insert({ company_id: company, ...change }).select("catalog").single();
  if (saved.error && saved.error.code !== "23505") throw fail("Could not save Crown Care prices. Please try again.", 503);
  if (saved.data) return crownCatalogSchema.parse(saved.data.catalog);
  // A simultaneous identical request can safely return the confirmed result.
  // Other competing edits must be reviewed; never overwrite a newer catalog.
  const confirmed = replay(await catalogRow(company), key, requestHash);
  if (confirmed) return confirmed;
  throw crownCatalogStale();
}

export function registerCrownCatalog(app: Express) {
  app.get("/api/crm/crown-care/catalog", wrap(async (req, res) => {
    const user = await caller(req);
    if (user.role !== "owner") {
      const profile = await result(db().from("profiles").select("permissions").eq("id", user.id).single());
      if (profile.permissions?.memberships === false) throw fail("Crown Care access is disabled. Ask the owner.", 403);
    }
    const catalog = await loadCrownCatalog(user.company);
    res.json({ catalog, version: catalog.version });
  }));
  app.patch("/api/crm/crown-care/catalog", wrap(async (req, res) => {
    const user = await caller(req);
    if (user.role !== "owner") throw fail("Only the owner can change Crown Care catalog prices.", 403);
    const key = z.string().uuid().parse(req.headers["idempotency-key"]);
    const input = crownCatalogUpdate.parse(req.body);
    const catalog = await saveCrownCatalog(user.company, user.id, key, input);
    res.json({ catalog, version: catalog.version });
  }));
}
