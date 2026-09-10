import { saveCallback, processCallbacks } from "./callbacks";
import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import twilio from "twilio";
import { Resend } from "resend";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  db,
  result,
  caller,
  entity,
  settings,
  origin,
  publicDocument,
  publicFields,
  linkFor,
  cents,
  phone,
  merge,
  mergeFields,
  event,
  type Row,
} from "./core";
import { context, queueMessage, readUnsubscribe } from "./delivery";
import {
  automationSchema,
  templateSchema,
  triggers,
  conditionFields,
  starters,
  bodies,
} from "./catalog";
import { tick } from "./worker";
import {
  smsConfigured,
  requireSmsForChannels,
  requireAutomationProviders,
} from "./readiness";
const stripe = () => {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new Error("Stripe is not connected.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};
const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      res.status(e.status || 400).json({
        error:
          e instanceof z.ZodError
            ? "Please check the form fields."
            : String(e.message || "Unable to complete this request.").slice(
                0,
                300,
              ),
      });
    }
  };
const references = (r: Row, kind: string) => ({
  company_id: r.company_id,
  customer_id: r.customer_id,
  [kind + "_id"]: r.id,
});
const key = (req: Request) =>
  z.string().uuid().parse(req.headers["idempotency-key"]);
const publicLimiter = new Map<string, { n: number; until: number }>();
function limit(req: Request, res: Response, next: () => void) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  if (publicLimiter.size > 10000)
    for (const [k, v] of Array.from(publicLimiter))
      if (v.until < now) publicLimiter.delete(k);
  const item = publicLimiter.get(ip);
  if (item && item.until > now) {
    if (++item.n > 120) {
      res.status(429).json({ error: "Please wait a moment and try again." });
      return;
    }
  } else publicLimiter.set(ip, { n: 1, until: now + 60000 });
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  });
  next();
}

export function registerCrm(app: Express) {
  app.use("/api/public", limit);
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get(
    "/api/crm/config",
    wrap(async (req, res) => {
      const c = await caller(req);
      const config = await settings(c.company);
      res.json({
        settings: config,
        role: c.role,
        triggers,
        conditionFields,
        mergeFields,
        connections: {
          stripe: !!process.env.STRIPE_SECRET_KEY,
          stripe_mode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
            ? "live"
            : "test",
          stripe_webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
          twilio: smsConfigured(),
          email: !!process.env.RESEND_API_KEY,
          email_webhook: !!process.env.RESEND_WEBHOOK_SECRET,
          worker: !!process.env.CRM_WORKER_SECRET,
          unsubscribe: !!process.env.COMMUNICATION_SIGNING_SECRET,
          surcharge_available: false,
        },
      });
    }),
  );
  app.put(
    "/api/crm/config",
    wrap(async (req, res) => {
      const c = await caller(req, true);
      const schema = z.object({
        company_name: z.string().min(1).max(120),
        timezone: z.string().refine((x) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: x });
            return true;
          } catch {
            return false;
          }
        }),
        sms_start: z.number().int().min(0).max(23),
        sms_end: z.number().int().min(1).max(24),
        sending_enabled: z.boolean(),
        payments_enabled: z.boolean(),
        fee_enabled: z.boolean(),
        fee_basis_points: z.number().int().min(0).max(300),
        fee_fixed_cents: z.number().int().min(0).max(100),
        sender_name: z.string().min(1).max(120),
        sender_email: z.union([z.email(), z.literal("")]),
        reply_to_email: z.union([z.email(), z.literal("")]),
        review_url: z.union([
          z.url().refine((s) => s.startsWith("https://")),
          z.literal(""),
        ]),
      });
      const data = schema.parse(req.body);
      if (data.sms_start >= data.sms_end)
        throw new Error("Sending start time must be before the end time.");
      if (data.fee_enabled)
        throw new Error(
          "Card fees are not available until credit-card eligibility can be verified. Debit and prepaid cards must not be surcharged.",
        );
      if (
        data.payments_enabled &&
        (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
      )
        throw new Error(
          "Connect Stripe and its webhook before enabling payments.",
        );
      await result(
        db()
          .from("crm_settings")
          .update({ data, updated_at: new Date().toISOString() })
          .eq("company_id", c.company),
      );
      res.json({ message: "Settings saved" });
    }),
  );
  for (const [path, table, schema] of [
    ["templates", "message_templates", templateSchema],
    ["automations", "automations", automationSchema],
  ] as const) {
    app.get(
      "/api/crm/" + path,
      wrap(async (req, res) => {
        const c = await caller(req);
        const rows = await result(
          db()
            .from(table)
            .select("*")
            .eq("company_id", c.company)
            .order("created_at"),
        );
        const runs =
          path === "automations"
            ? await result(
                db()
                  .from("automation_runs")
                  .select("automation_id,status")
                  .eq("company_id", c.company),
              )
            : [];
        res.json(
          rows.map((r: Row) => ({
            ...r,
            ...(path === "automations"
              ? {
                  runs_count: runs.filter((x: Row) => x.automation_id === r.id)
                    .length,
                  success_count: runs.filter(
                    (x: Row) =>
                      x.automation_id === r.id && x.status === "completed",
                  ).length,
                  failure_count: runs.filter(
                    (x: Row) =>
                      x.automation_id === r.id && x.status === "failed",
                  ).length,
                }
              : {}),
          })),
        );
      }),
    );
    const save = wrap(async (req, res) => {
      const c = await caller(req, true);
      const data: any = schema.parse(req.body);
      if (path === "templates") {
        merge(data.body, {});
        merge(data.subject, {});
        if (data.channel === "sms" && data.body.length > 1500)
          throw new Error("Keep text messages under 1,500 characters.");
      }
      if (path === "automations") requireAutomationProviders(data);
      if (path === "automations")
        for (const step of data.steps) {
          if (["email", "sms"].includes(step.action)) {
            if (!step.template_id)
              throw new Error("Choose a message template for each send step.");
            const t = await entity(
              "message_templates",
              step.template_id,
              c.company,
            );
            if (t.channel !== step.action || t.archived)
              throw new Error(
                "Choose an available template for the selected channel.",
              );
          }
        }
      if (req.params.id) {
        await entity(table, String(req.params.id), c.company);
        await result(
          db()
            .from(table)
            .update({ ...data, updated_at: new Date().toISOString() })
            .eq("id", req.params.id)
            .eq("company_id", c.company),
        );
      } else
        await result(
          db()
            .from(table)
            .insert({ ...data, company_id: c.company }),
        );
      res.json({ message: "Saved" });
    });
    app.post("/api/crm/" + path, save);
    app.put("/api/crm/" + path + "/:id", save);
  }
  app.post(
    "/api/crm/automations/:id/toggle",
    wrap(async (req, res) => {
      const c = await caller(req, true);
      const enabled = z.boolean().parse(req.body.enabled);
      const automation = await entity(
        "automations",
        String(req.params.id),
        c.company,
      );
      requireAutomationProviders({ enabled, steps: automation.steps });
      await result(
        db()
          .from("automations")
          .update({ enabled, updated_at: new Date().toISOString() })
          .eq("id", req.params.id)
          .eq("company_id", c.company),
      );
      res.json({ enabled });
    }),
  );
  app.get(
    "/api/crm/runs",
    wrap(async (req, res) => {
      const c = await caller(req);
      res.json(
        await result(
          db()
            .from("automation_runs")
            .select("*")
            .eq("company_id", c.company)
            .order("created_at", { ascending: false })
            .limit(200),
        ),
      );
    }),
  );
  app.get(
    "/api/crm/messages",
    wrap(async (req, res) => {
      const c = await caller(req);
      res.json(
        await result(
          db()
            .from("communications")
            .select("*")
            .eq("company_id", c.company)
            .order("created_at", { ascending: false })
            .limit(200),
        ),
      );
    }),
  );
  app.post(
    "/api/crm/starters",
    wrap(async (req, res) => {
      const c = await caller(req, true);
      // Company advisory lock in SQL provides serialized installation across requests.
      const existing = await result(
        db()
          .from("automations")
          .select("id")
          .eq("company_id", c.company)
          .limit(1),
      );
      if (existing.length)
        throw new Error(
          "Starter setup is already complete. You can add or duplicate automations individually.",
        );
      const definitions = [];
      for (const [name, trigger, bodyKey, category, steps] of starters) {
        const templates = [];
        for (const channel of ["email", "sms"])
          templates.push({
            purpose: bodyKey,
            name: name + " — " + (channel === "sms" ? "Text" : "Email"),
            description: "Editable Air King starter",
            channel,
            category,
            subject:
              bodyKey === "receipt" ? "Thank you for your payment" : name,
            body: bodies[bodyKey],
            active: true,
          });
        definitions.push({
          name,
          trigger,
          description: name + " — edit timing and messages before enabling.",
          templates,
          steps: steps.map(([wait_minutes, action]) => ({
            wait_minutes,
            action,
            conditions: [],
          })),
        });
      }
      await result(
        db().rpc("crm_install_starters", {
          p_company: c.company,
          p_definitions: definitions,
        }),
      );
      res.json({ message: "Starter automations created. All are turned off." });
    }),
  );
  app.get(
    "/api/crm/customers/:id/history",
    wrap(async (req, res) => {
      const c = await caller(req);
      await entity("customers", String(req.params.id), c.company);
      const [events, messages, prefs] = await Promise.all([
        result(
          db()
            .from("communication_events")
            .select("*")
            .eq("company_id", c.company)
            .eq("customer_id", req.params.id)
            .order("created_at", { ascending: false })
            .limit(200),
        ),
        result(
          db()
            .from("communications")
            .select("*")
            .eq("company_id", c.company)
            .eq("customer_id", req.params.id)
            .order("created_at", { ascending: false })
            .limit(200),
        ),
        result(
          db()
            .from("customer_communication_preferences")
            .select("*")
            .eq("company_id", c.company)
            .eq("customer_id", req.params.id)
            .maybeSingle(),
        ),
      ]);
      res.json({ events, messages, preferences: prefs });
    }),
  );
  app.put(
    "/api/crm/customers/:id/preferences",
    wrap(async (req, res) => {
      const c = await caller(req);
      const row = await entity("customers", String(req.params.id), c.company);
      const p = z
        .object({
          email_transactional: z.boolean(),
          sms_transactional: z.boolean(),
          email_marketing: z.boolean(),
          sms_marketing: z.boolean(),
          consent_source: z.string().min(3).max(500),
        })
        .parse(req.body);
      await result(
        db()
          .from("customer_communication_preferences")
          .upsert({
            ...p,
            company_id: c.company,
            customer_id: row.id,
            consent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
      );
      await event(
        { company_id: c.company, customer_id: row.id, actor_id: c.id },
        "preferences.updated",
        p,
      );
      res.json({ message: "Preferences saved" });
    }),
  );
  app.post(
    "/api/crm/:kind/:id/link",
    wrap(async (req, res) => {
      const c = await caller(req);
      const kind = z.enum(["quote", "invoice"]).parse(req.params.kind);
      const row = await entity(kind + "s", String(req.params.id), c.company);
      res.json({ url: await linkFor(row, kind) });
    }),
  );
  app.post(
    "/api/crm/:kind/:id/send",
    wrap(async (req, res) => {
      const c = await caller(req);
      const kind = z.enum(["quote", "invoice"]).parse(req.params.kind);
      const row = await entity(kind + "s", String(req.params.id), c.company);
      const channels = z
        .array(z.enum(["email", "sms"]))
        .min(1)
        .max(2)
        .parse(req.body.channels);
      const requestKey = key(req);
      requireSmsForChannels(channels);
      const messages = [];
      for (const channel of Array.from(new Set(channels))) {
        const defaultTemplate = await result(
          db()
            .from("message_templates")
            .select("*")
            .eq("company_id", c.company)
            .eq("purpose", kind)
            .eq("channel", channel)
            .eq("active", true)
            .eq("archived", false)
            .limit(1),
        );
        const template = req.body.template_id
          ? await entity(
              "message_templates",
              z.string().uuid().parse(req.body.template_id),
              c.company,
            )
          : defaultTemplate[0] || {
              channel,
              category: "transactional",
              subject:
                kind === "quote"
                  ? "Your Air King Mechanical quote is ready."
                  : "Your Air King Mechanical invoice is ready.",
              body: bodies[kind],
            };
        if (
          template.channel !== channel ||
          template.archived ||
          template.active === false
        )
          throw new Error("Choose an active template for this channel.");
        messages.push(
          await queueMessage(
            references(row, kind),
            channel,
            template,
            `manual:${c.company}:${requestKey}:${channel}`,
            "document_delivery",
            c.id,
          ),
        );
      }
      res.json({
        message: "Delivery queued. Check the customer timeline for results.",
        messages,
      });
    }),
  );
  app.post(
    "/api/crm/invoices/:id/void",
    wrap(async (req, res) => {
      const c = await caller(req, true);
      await result(
        db().rpc("crm_void_invoice", {
          p_invoice: String(req.params.id),
          p_company: c.company,
        }),
      );
      res.json({ message: "Invoice voided" });
    }),
  );
  app.get(
    "/api/crm/invoices/:id/payments",
    wrap(async (req, res) => {
      const c = await caller(req);
      await entity("invoices", String(req.params.id), c.company);
      res.json(
        await result(
          db()
            .from("payments")
            .select("*")
            .eq("invoice_id", req.params.id)
            .eq("company_id", c.company)
            .order("created_at", { ascending: false }),
        ),
      );
    }),
  );
  app.post(
    "/api/crm/invoices/:id/payments",
    wrap(async (req, res) => {
      const c = await caller(req);
      const row = await entity("invoices", String(req.params.id), c.company);
      const method = z
        .enum(["Cash", "Check", "ACH", "Other"])
        .parse(req.body.method);
      const payment = await result(
        db().rpc("crm_record_payment", {
          p_invoice: row.id,
          p_company: c.company,
          p_amount: cents(req.body.amount),
          p_method: method,
          p_external: `manual:${c.company}:${key(req)}`,
          p_actor: c.id,
          p_reference: z
            .string()
            .max(300)
            .parse(req.body.reference || ""),
        }),
      );
      res.json({ message: "Payment recorded", payment });
    }),
  );
  app.get(
    "/api/public/documents/:token",
    wrap(async (req, res) => {
      const { kind, row } = await publicDocument(String(req.params.token));
      const config = await settings(row.company_id);
      await result(
        db().rpc("crm_document_lifecycle", {
          p_kind: kind,
          p_id: row.id,
          p_company: row.company_id,
          p_action: "viewed",
        }),
      );
      const payments =
        kind === "invoice"
          ? await result(
              db()
                .from("payments")
                .select(
                  "amount_cents,fee_cents,method,source,paid_at,receipt_url",
                )
                .eq("invoice_id", row.id)
                .order("created_at"),
            )
          : [];
      res.json({
        kind,
        document: publicFields(kind, row.data),
        company: config.company_name,
        payments,
        payments_enabled:
          config.payments_enabled && !!process.env.STRIPE_SECRET_KEY,
        fee_enabled: false,
      });
    }),
  );
  app.post(
    "/api/public/documents/:token/decision",
    wrap(async (req, res) => {
      const { kind, row } = await publicDocument(String(req.params.token));
      if (kind !== "quote") throw new Error("This is not a quote.");
      const d = z
        .object({
          name: z.string().trim().min(2).max(150),
          decision: z.enum(["accepted", "declined"]),
          signature: z.string().max(150).default(""),
          option: z.string().max(30).default(""),
          addons: z
            .array(
              z
                .string()
                .regex(/^[a-z0-9-]+$/)
                .max(80),
            )
            .max(20)
            .default([]),
          message: z.string().max(2000).default(""),
          confirmed: z.boolean(),
        })
        .parse(req.body);
      if (d.decision === "accepted" && !d.confirmed)
        throw new Error(
          "Confirm that your typed name is your electronic signature.",
        );
      const decision = await result(
        db().rpc("crm_decide_quote", {
          p_quote: row.id,
          p_company: row.company_id,
          p_name: d.name,
          p_decision: d.decision,
          p_signature: d.signature,
          p_option: d.option,
          p_addons: d.addons,
          p_message: d.message,
        }),
      );
      res.json({ decision: decision.decision });
    }),
  );
  app.post(
    "/api/public/documents/:token/checkout",
    wrap(async (req, res) => {
      const { kind, row } = await publicDocument(String(req.params.token));
      if (kind !== "invoice") throw new Error("Only invoices can be paid.");
      const config = await settings(row.company_id);
      if (!config.payments_enabled)
        throw new Error(
          "Online payments are not enabled yet. Please contact Air King.",
        );
      const amount = cents(req.body.amount);
      const attempt = await result(
        db().rpc("crm_reserve_checkout", {
          p_invoice: row.id,
          p_company: row.company_id,
          p_amount: amount,
        }),
      );
      if (attempt.session_url) {
        res.json({ url: attempt.session_url });
        return;
      }
      const base = `${origin()}/#/customer/${req.params.token}`;
      const session = await stripe().checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],
          client_reference_id: attempt.id,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: attempt.amount_cents,
                product_data: { name: `Air King invoice ${row.id}` },
              },
              quantity: 1,
            },
          ],
          metadata: { attempt_id: attempt.id },
          payment_intent_data: { metadata: { attempt_id: attempt.id } },
          success_url: base + "?payment=processing",
          cancel_url: base,
          expires_at:
            Math.floor(new Date(attempt.created_at).getTime() / 1000) + 30 * 60,
        },
        { idempotencyKey: "checkout:" + attempt.id },
      );
      await result(
        db()
          .from("checkout_attempts")
          .update({
            state: "open",
            session_id: session.id,
            session_url: session.url,
          })
          .eq("id", attempt.id)
          .eq("state", "reserved"),
      );
      res.json({ url: session.url });
    }),
  );
  app.post(
    "/api/public/unsubscribe/:token",
    wrap(async (req, res) => {
      const data = readUnsubscribe(String(req.params.token));
      await entity("customers", data.customer, data.company);
      await result(
        db().from("customer_communication_preferences").upsert({
          customer_id: data.customer,
          company_id: data.company,
          email_marketing: false,
          sms_marketing: false,
          updated_at: new Date().toISOString(),
        }),
      );
      await event(
        { company_id: data.company, customer_id: data.customer },
        "customer.opted_out",
        { scope: "marketing" },
      );
      res.json({
        message: "You have been unsubscribed from marketing messages.",
      });
    }),
  );
  app.post(
    "/api/webhooks/stripe",
    wrap(async (req, res) => {
      if (!process.env.STRIPE_WEBHOOK_SECRET)
        throw new Error("Stripe webhook is not configured.");
      // Configuration errors are distinct from an invalid request signature.
      const webhookClient = stripe();
      let e: Stripe.Event;
      try {
        e = webhookClient.webhooks.constructEvent(
          req.rawBody as Buffer,
          req.headers["stripe-signature"] as string,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch {
        res.status(400).json({ error: "Invalid webhook signature." });
        return;
      }
      if (
        [
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ].includes(e.type)
      ) {
        const s = e.data.object as Stripe.Checkout.Session;
        if (s.payment_status === "paid") {
          const a = await entity(
            "checkout_attempts",
            s.metadata?.attempt_id || "",
          );
          if (a.session_id && a.session_id !== s.id)
            throw new Error("Checkout session mismatch.");
          if (
            s.currency !== "usd" ||
            s.amount_total !== Number(a.amount_cents) + Number(a.fee_cents) ||
            s.livemode !== process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
          )
            throw new Error("Payment verification mismatch.");
          const intent = await stripe().paymentIntents.retrieve(
            String(s.payment_intent),
            { expand: ["latest_charge"] },
          );
          if (
            intent.status !== "succeeded" ||
            intent.amount_received !== s.amount_total
          )
            throw new Error("Payment has not been confirmed.");
          const charge = intent.latest_charge as Stripe.Charge;
          const card = charge?.payment_method_details?.card;
          await result(
            db().rpc("crm_record_payment", {
              p_invoice: a.invoice_id,
              p_company: a.company_id,
              p_amount: a.amount_cents,
              p_method: card ? `${card.brand} •••• ${card.last4}` : "Card",
              p_external: intent.id,
              p_attempt: a.id,
              p_event: e.id,
              p_event_type: e.type,
              p_fee: a.fee_cents,
              p_receipt: charge?.receipt_url || null,
            }),
          );
        }
      } else if (
        [
          "checkout.session.expired",
          "checkout.session.async_payment_failed",
        ].includes(e.type)
      ) {
        const s = e.data.object as Stripe.Checkout.Session;
        const attempt = await result(
          db()
            .from("checkout_attempts")
            .select("*")
            .eq("session_id", s.id)
            .maybeSingle(),
        );
        if (attempt) {
          await result(
            db()
              .from("checkout_attempts")
              .update({
                state: e.type.endsWith("expired") ? "expired" : "failed",
              })
              .eq("id", attempt.id)
              .neq("state", "paid"),
          );
          const inv = await entity(
            "invoices",
            attempt.invoice_id,
            attempt.company_id,
          );
          await event(
            references(inv, "invoice"),
            "payment.failed",
            { session_id: s.id },
            e.id,
          );
        }
      }
      res.json({ received: true });
    }),
  );
  const twilioValid = (req: Request) =>
    !!process.env.TWILIO_AUTH_TOKEN &&
    twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      req.headers["x-twilio-signature"] as string,
      origin() + req.originalUrl,
      req.body,
    );
  app.post(
    "/api/webhooks/twilio/status",
    wrap(async (req, res) => {
      if (!twilioValid(req)) {
        res.sendStatus(403);
        return;
      }
      await saveCallback(
        "sms",
        `twilio:${req.body.MessageSid}:${req.body.MessageStatus}`,
        req.body.MessageSid,
        { status: req.body.MessageStatus, error_code: req.body.ErrorCode },
      );
      await processCallbacks();
      res.sendStatus(204);
    }),
  );
  app.post(
    "/api/webhooks/twilio/inbound",
    wrap(async (req, res) => {
      if (!twilioValid(req)) {
        res.sendStatus(403);
        return;
      }
      const from = phone(req.body.From);
      const sent: Row[] = await result(
        db()
          .from("communications")
          .select("customer_id,company_id")
          .eq("channel", "sms")
          .eq("recipient", from),
      );
      const customers: Row[] = await result(
        db().from("customers").select("id,company_id,data"),
      );
      for (const c of customers) {
        if (
          (c.data.contacts || []).some((contact: Row) => {
            try {
              return phone(contact.phone) === from;
            } catch {
              return false;
            }
          })
        )
          sent.push({ customer_id: c.id, company_id: c.company_id });
      }
      const seen = new Set();
      for (const m of sent) {
        if (seen.has(m.customer_id)) continue;
        seen.add(m.customer_id);
        const stop =
          req.body.OptOutType === "STOP" ||
          /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(
            String(req.body.Body).trim(),
          );
        if (stop)
          await result(
            db().from("customer_communication_preferences").upsert({
              customer_id: m.customer_id,
              company_id: m.company_id,
              sms_stopped: true,
              updated_at: new Date().toISOString(),
            }),
          );
        if (
          req.body.OptOutType === "START" ||
          /^(START|UNSTOP)$/i.test(String(req.body.Body).trim())
        )
          await result(
            db().from("customer_communication_preferences").upsert({
              customer_id: m.customer_id,
              company_id: m.company_id,
              sms_stopped: false,
              consent_source: "Customer replied START",
              consent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }),
          );
        await event(
          {
            company_id: m.company_id,
            customer_id: m.customer_id,
            channel: "sms",
          },
          stop ? "customer.opted_out" : "sms.received",
          { body: String(req.body.Body).slice(0, 2000) },
          `inbound:${req.body.MessageSid}:${m.customer_id}`,
        );
      }
      res.type("text/xml").send("<Response/>");
    }),
  );
  app.post(
    "/api/webhooks/email",
    wrap(async (req, res) => {
      if (!process.env.RESEND_WEBHOOK_SECRET)
        throw new Error("Email webhook is not configured.");
      let payload: any;
      try {
        payload = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
          payload: (req.rawBody as Buffer).toString(),
          headers: {
            id: String(req.headers["svix-id"]),
            timestamp: String(req.headers["svix-timestamp"]),
            signature: String(req.headers["svix-signature"]),
          },
          webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
        });
      } catch {
        res.sendStatus(403);
        return;
      }
      await saveCallback(
        "email",
        String(req.headers["svix-id"]),
        payload.data.email_id,
        { status: payload.type, created_at: payload.created_at },
      );
      await processCallbacks();
      res.sendStatus(204);
    }),
  );
  app.post(
    "/api/internal/communications/tick",
    wrap(async (req, res) => {
      const secret = process.env.CRM_WORKER_SECRET;
      const provided = req.headers.authorization?.replace(/^Bearer /, "") || "";
      if (
        !secret ||
        secret.length !== provided.length ||
        !timingSafeEqual(Buffer.from(secret), Buffer.from(provided))
      ) {
        res.sendStatus(401);
        return;
      }
      res.json(await tick());
    }),
  );
}
