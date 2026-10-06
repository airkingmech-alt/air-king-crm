import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller, db, entity, result } from "./core";

export function registerAcceptedQuotes(app: Express) {
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (error: any) { res.status(error.status || 400).json({ error: error instanceof z.ZodError ? "Please check the request." : String(error.message).slice(0, 300) }); }
  };
  app.post("/api/crm/quotes/:id/invoice", wrap(async (req, res) => {
    const c = await caller(req);
    await entity("quotes", String(req.params.id), c.company);
    // No client amount, line items, current catalog, or mutable selections are accepted.
    const invoice = await result(db().rpc("crm_invoice_accepted_quote", {
      p_company: c.company, p_actor: c.id, p_quote: String(req.params.id),
    }));
    res.json({ invoice });
  }));
  app.post("/api/crm/quotes/:id/revise", wrap(async (req, res) => {
    const c = await caller(req);
    await entity("quotes", String(req.params.id), c.company);
    const requestId = z.string().uuid().parse(req.body.requestId);
    const quote = await result(db().rpc("crm_revise_accepted_quote", {
      p_company: c.company, p_actor: c.id, p_quote: String(req.params.id), p_request: requestId,
    }));
    res.json({ quote });
  }));
}
