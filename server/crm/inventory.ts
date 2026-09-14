import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller, db, result } from "./core";

const uuid = z.string().uuid();
const text = z.string().trim().max(2000);
const integer = z.number().int().min(0).max(9007199254740991);
const details = z.record(
  z.string(),
  z.union([text, z.boolean(), z.number().finite(), z.null()]),
);
const itemSchema = z.object({
  id: uuid,
  name: text.min(1).max(200),
  sku: text.min(1).max(100),
  category: text.max(100),
  serialized: z.boolean(),
  tracked: z.boolean(),
  active: z.boolean(),
  cost_cents: integer,
  sale_cents: integer,
  details,
});
const locationSchema = z.object({
  id: uuid,
  name: text.min(1).max(200),
  type: z.enum([
    "Shop",
    "Warehouse",
    "Service Truck",
    "Install Truck",
    "Job Staging",
    "Returns",
    "Damaged",
    "Other",
  ]),
  assigned_to: uuid.nullable(),
  active: z.boolean(),
  details,
});
const vendorSchema = z.object({
  id: uuid,
  name: text.min(1).max(200),
  active: z.boolean(),
  details,
});
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      res.status(e.status || 400).json({
        error:
          e instanceof z.ZodError
            ? "Please check the inventory fields."
            : String(e.message || "Inventory request failed").slice(0, 400),
      });
    }
  };
const paged = async (table: string, company: string) => {
  const rows: any[] = [];
  // A hard cap is explicit: never silently present a partial inventory as complete.
  for (let offset = 0; offset < 20000; offset += 1000) {
    let query = db().from(table).select("*").eq("company_id", company);
    query =
      table === "inventory_stock"
        ? query.order("item_id").order("location_id")
        : query.order("id");
    const batch = await result(query.range(offset, offset + 999));
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
  throw new Error(
    "This inventory exceeds the current screen limit. Contact support to enable larger-page reporting.",
  );
};
export function registerInventory(app: Express) {
  app.get(
    "/api/crm/inventory",
    wrap(async (req, res) => {
      const c = await caller(req),
        admin = ["owner", "admin"].includes(c.role);
      const [
        items,
        locations,
        stock,
        vendors,
        documents,
        lines,
        movements,
        staff,
        serials,
      ] = await Promise.all([
        paged("inventory_items", c.company),
        paged("inventory_locations", c.company),
        paged("inventory_stock", c.company),
        admin ? paged("inventory_vendors", c.company) : Promise.resolve([]),
        paged("inventory_documents", c.company),
        paged("inventory_document_lines", c.company),
        result(
          db()
            .from("inventory_movements")
            .select("*")
            .eq("company_id", c.company)
            .order("created_at", { ascending: false })
            .limit(500),
        ),
        result(
          db()
            .from("profiles")
            .select("id,full_name,role")
            .eq("company_id", c.company),
        ),
        paged("inventory_serials", c.company),
      ]);
      const allowedLocations = admin
        ? locations
        : locations.filter((l) => l.assigned_to === c.id);
      const allowed = new Set(allowedLocations.map((l) => l.id));
      const visibleDocs = admin
        ? documents
        : documents.filter(
            (d) =>
              ["Transfer", "Count", "Allocation"].includes(d.kind) &&
              (allowed.has(d.location_id) || allowed.has(d.destination_id)),
          );
      const documentIds = new Set(visibleDocs.map((d) => d.id));
      const clean = (rows: any[]) =>
        admin
          ? rows
          : rows.map(
              ({
                cost_cents,
                unit_cost_cents,
                unit_sale_cents,
                details,
                ...r
              }) => r,
            );
      res.json({
        admin,
        actor: c.id,
        items: clean(items),
        locations: allowedLocations,
        stock: stock.filter((s: any) => admin || allowed.has(s.location_id)),
        vendors,
        documents: visibleDocs,
        lines: clean(lines.filter((l) => documentIds.has(l.document_id))),
        movements: clean(
          movements.filter((m: any) => admin || allowed.has(m.location_id)),
        ),
        serials: clean(
          serials.filter((s) => admin || allowed.has(s.location_id)),
        ),
        staff,
        history_limit: 500,
      });
    }),
  );
  for (const [name, schema] of [
    ["items", itemSchema],
    ["locations", locationSchema],
    ["vendors", vendorSchema],
  ] as const) {
    app.post(
      `/api/crm/inventory/${name}`,
      wrap(async (req, res) => {
        const c = await caller(req, true),
          data = schema.parse(req.body),
          table = `inventory_${name}`;
        const existing = await result(
          db().from(table).select("*").eq("id", data.id).maybeSingle(),
        );
        if (existing && existing.company_id !== c.company)
          throw new Error("Record not found");
        if (name === "locations") {
          const loc = data as z.infer<typeof locationSchema>;
          if (
            loc.name === "Inventory in transit" ||
            loc.details.system_transit ||
            existing?.details?.system_transit
          )
            throw new Error(
              "The transit location is managed by inventory transfers.",
            );
          if (
            loc.assigned_to &&
            !(await result(
              db()
                .from("profiles")
                .select("id")
                .eq("id", loc.assigned_to)
                .eq("company_id", c.company)
                .maybeSingle(),
            ))
          )
            throw new Error("Technician not found");
        }
        if (name === "items" && existing) {
          const item = data as z.infer<typeof itemSchema>;
          if (
            item.serialized !== existing.serialized ||
            item.tracked !== existing.tracked
          )
            throw new Error(
              "Tracking type cannot change on an existing item. Archive it and create a new item.",
            );
        }
        const row = await result(
          db()
            .from(table)
            .upsert({
              ...data,
              company_id: c.company,
              updated_at: new Date().toISOString(),
            })
            .select()
            .single(),
        );
        res.json(row);
      }),
    );
  }
  app.post(
    "/api/crm/inventory/policy",
    wrap(async (req, res) => {
      const c = await caller(req, true),
        body = z
          .object({
            item_id: uuid,
            location_id: uuid,
            minimum: integer,
            target: integer,
            bin: text.max(200),
          })
          .parse(req.body);
      if (body.target < body.minimum)
        throw new Error("Target must be at least the minimum.");
      const row = await result(
        db().rpc("inventory_set_policy", {
          p_company: c.company,
          p_actor: c.id,
          p_item: body.item_id,
          p_location: body.location_id,
          p_minimum: body.minimum,
          p_target: body.target,
          p_bin: body.bin,
        }),
      );
      res.json(row);
    }),
  );
  app.post(
    "/api/crm/inventory/movements",
    wrap(async (req, res) => {
      const c = await caller(req),
        key = uuid.parse(req.headers["idempotency-key"]);
      const body = z
        .object({
          lines: z
            .array(
              z.object({
                item_id: uuid,
                location_id: uuid,
                quantity_units: z
                  .number()
                  .int()
                  .min(-9007199254740991)
                  .max(9007199254740991),
                kind: z.enum(["Opening", "Adjustment", "Job Usage", "Return"]),
                notes: text.min(1).max(1000),
                job_id: text.optional(),
                invoice_id: text.optional(),
              }),
            )
            .min(1)
            .max(200),
        })
        .parse(req.body);
      res.json({
        id: await result(
          db().rpc("inventory_post", {
            p_company: c.company,
            p_actor: c.id,
            p_key: key,
            p_payload: body,
          }),
        ),
      });
    }),
  );
  app.post(
    "/api/crm/inventory/workflow",
    wrap(async (req, res) => {
      const c = await caller(req),
        key = uuid.parse(req.headers["idempotency-key"]);
      const body = z
        .object({
          document_id: uuid,
          action: z.enum([
            "create",
            "submit",
            "order",
            "reserve",
            "pick",
            "dispatch",
            "receive",
            "post",
            "consume",
            "cancel",
            "apply",
          ]),
          kind: z
            .enum([
              "Purchase Order",
              "Transfer",
              "Count",
              "Allocation",
              "Template",
            ])
            .optional(),
          location_id: uuid.optional(),
          destination_id: uuid.nullable().optional(),
          vendor_id: uuid.nullable().optional(),
          job_id: text.optional(),
          details: details.optional(),
          lines: z
            .array(
              z.object({
                item_id: uuid.optional(),
                line_id: uuid.optional(),
                quantity: integer,
                cost_cents: integer.optional(),
              }),
            )
            .min(1)
            .max(200)
            .optional(),
        })
        .parse(req.body);
      res.json({
        id: await result(
          db().rpc("inventory_workflow", {
            p_company: c.company,
            p_actor: c.id,
            p_key: key,
            p_body: body,
          }),
        ),
      });
    }),
  );
  app.post(
    "/api/crm/inventory/serials",
    wrap(async (req, res) => {
      const c = await caller(req, true),
        key = uuid.parse(req.headers["idempotency-key"]);
      const body = z
        .object({
          id: uuid,
          action: z.enum(["receive", "allocate", "release", "install"]),
          item_id: uuid.optional(),
          location_id: uuid.optional(),
          serial: text.min(1).max(150).optional(),
          job_id: text.optional(),
          invoice_id: text.optional(),
          property_id: text.optional(),
          existing_system_id: text.optional(),
          equipment_type: text.optional(),
          installed_at: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          warranty_exp: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          details: details.optional(),
        })
        .parse(req.body);
      res.json({
        id: await result(
          db().rpc("inventory_serial_action", {
            p_company: c.company,
            p_actor: c.id,
            p_key: key,
            p_body: body,
          }),
        ),
      });
    }),
  );
}
