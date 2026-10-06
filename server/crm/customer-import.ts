import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller, db, result } from "./core";
import { prepareCustomerImport } from "../../shared/customer-import";

export function registerCustomerImport(app: Express) {
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (e: any) { res.status(e.status || 400).json({ error: e instanceof z.ZodError ? "Import validation failed. Review the customer fields and counts." : String(e.message).slice(0, 300) }); }
  };
  app.get("/api/crm/customers/import/state", wrap(async (req, res) => {
    const c = await caller(req, true);
    res.json(await result(db().rpc("crm_customer_import_state", { p_company: c.company, p_actor: c.id })));
  }));
  app.post("/api/crm/customers/import/markate", wrap(async (req, res) => {
    const c = await caller(req, true);
    const batch = prepareCustomerImport(req.body);
    res.json(await result(db().rpc("crm_import_markate_customers", {
      p_company: c.company, p_actor: c.id, p_batch: batch.batchId,
      p_expected_snapshot: batch.expectedSnapshot, p_expected_new: batch.expectedNew,
      p_expected_links: batch.expectedLinks, p_records: batch.records,
    })));
  }));
}
