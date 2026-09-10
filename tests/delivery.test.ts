import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  deliver,
  queueMessage,
  allowed,
  readUnsubscribe,
  unsubscribeUrl,
} from "../server/crm/delivery";
import { randomUUID } from "node:crypto";
process.env.SUPABASE_URL = "https://unit-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-only";
process.env.RESEND_API_KEY = "unit-test-only";
process.env.COMMUNICATION_SIGNING_SECRET =
  "unit-test-signing-key-not-a-real-credential";
const original = globalThis.fetch;
let providerCalls = 0;
let providerResult = "success";
const state: Record<string, any[]> = {};
const defaults = () => {
  state.customers = [
    {
      id: "c",
      company_id: "co",
      data: {
        name: "Taylor Test",
        contacts: [{ email: "test@example.com", phone: "+18165551234" }],
      },
    },
  ];
  state.crm_settings = [
    {
      company_id: "co",
      data: {
        company_name: "Air King",
        sender_name: "Air King",
        sender_email: "office@example.com",
        sending_enabled: true,
        timezone: "America/Chicago",
        sms_start: 8,
        sms_end: 19,
      },
    },
  ];
  state.customer_communication_preferences = [
    {
      customer_id: "c",
      company_id: "co",
      email_transactional: true,
      sms_transactional: true,
      email_marketing: false,
      sms_marketing: false,
      sms_stopped: false,
    },
  ];
  state.quotes = [
    {
      id: "q",
      customer_id: "c",
      company_id: "co",
      data: { id: "q", status: "Quote Sent", options: [] },
    },
  ];
  state.invoices = [
    {
      id: "i",
      customer_id: "c",
      company_id: "co",
      data: { id: "i", status: "Sent", amount: 5000, paidAmount: 2000 },
    },
  ];
  state.work_orders = [];
  state.communications = [];
  state.communication_events = [];
  state.document_links = [];
  state.automations = [
    {
      id: "a",
      company_id: "co",
      enabled: true,
      trigger: "quote.sent",
      conditions: [],
      stop_conditions: [],
      steps: [{ action: "email", conditions: [] }],
    },
  ];
  state.automation_runs = [
    { id: "r", company_id: "co", automation_id: "a", step_index: 0 },
  ];
  providerCalls = 0;
  providerResult = "success";
};
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
globalThis.fetch = async (input: any, init: any = {}) => {
  const url = new URL(
    typeof input === "string" ? input : input.url || String(input),
  );
  if (url.hostname === "api.resend.com") {
    providerCalls++;
    if (providerResult === "timeout")
      throw new Error("Provider response timed out");
    if (providerResult === "rate_limit")
      return json({ name: "rate_limit_exceeded", message: "Slow down" }, 429);
    return json({ id: "email-" + providerCalls });
  }
  assert.equal(
    url.hostname,
    "unit-test.supabase.invalid",
    "Tests must never access live services",
  );
  const path = url.pathname.split("/").filter(Boolean);
  const table = path[2];
  const method = init.method || "GET";
  const payload = init.body ? JSON.parse(init.body) : {};
  if (table === "rpc") {
    if (path[3] === "crm_document_lifecycle") return json(null);
    assert.equal(path[3], "crm_claim_message");
    const m = state.communications.find(
      (x) => x.id === payload.p_id && x.status === "pending",
    );
    if (!m) return json([]);
    m.status = "sending";
    m.claim_token = randomUUID();
    m.attempts = (m.attempts || 0) + 1;
    return json([m]);
  }
  state[table] ||= [];
  const match = (row: any) =>
    Array.from(url.searchParams.entries()).every(([key, value]) => {
      if (["select", "on_conflict", "order", "limit"].includes(key))
        return true;
      const [op, ...rest] = value.split(".");
      const operand = rest.join(".");
      if (op === "eq") return String(row[key]) === operand;
      if (op === "is")
        return operand === "null"
          ? row[key] == null
          : String(row[key]) === operand;
      if (op === "gt") return row[key] > operand;
      return true;
    });
  if (method === "GET") {
    const rows = state[table].filter(match);
    const headers = new Headers(init.headers);
    return json(
      headers.get("accept")?.includes("object") ? rows[0] || null : rows,
    );
  }
  if (method === "POST") {
    const duplicate = state[table].find(
      (x) => payload.dedupe_key && x.dedupe_key === payload.dedupe_key,
    );
    if (duplicate) return json([]);
    const row = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      attempts: 0,
      ...payload,
    };
    state[table].push(row);
    return json([row]);
  }
  if (method === "PATCH") {
    const rows = state[table].filter(match);
    rows.forEach((x) => Object.assign(x, payload));
    return json(rows);
  }
  throw new Error("Unsupported test request");
};
after(() => {
  globalThis.fetch = original;
});
const message = (extra: any = {}) => {
  const m = {
    id: randomUUID(),
    company_id: "co",
    customer_id: "c",
    channel: "email",
    category: "transactional",
    recipient: "test@example.com",
    subject: "Quote",
    body: "Test",
    status: "pending",
    reason: "test",
    attempts: 0,
    ...extra,
  };
  state.communications.push(m);
  return { ...m };
};
test("email send is logged and never submitted a second time", async () => {
  defaults();
  const m = message();
  await deliver(m);
  await deliver(m);
  assert.equal(providerCalls, 1);
  assert.equal(state.communications[0].status, "sent");
  assert.equal(state.communication_events[0].event_type, "communication.sent");
});
test("quote acceptance between queueing and sending cancels follow-up", async () => {
  defaults();
  const m = message({ quote_id: "q", automation_run_id: "r" });
  state.quotes[0].data.status = "Won";
  await deliver(m);
  assert.equal(providerCalls, 0);
  assert.equal(state.communications[0].status, "cancelled");
});
test("invoice payment cancels reminder before delivery", async () => {
  defaults();
  state.automations[0].trigger = "invoice.due";
  state.invoices[0].data.paidAmount = 5000;
  const m = message({ invoice_id: "i", automation_run_id: "r" });
  await deliver(m);
  assert.equal(providerCalls, 0);
  assert.equal(state.communications[0].status, "cancelled");
});
test("disabled automation does not send", async () => {
  defaults();
  state.automations[0].enabled = false;
  await deliver(message({ automation_run_id: "r" }));
  assert.equal(providerCalls, 0);
});
test("global sending toggle preserves queue without sending", async () => {
  defaults();
  state.crm_settings[0].data.sending_enabled = false;
  await deliver(message());
  assert.equal(state.communications[0].status, "pending");
  assert.equal(providerCalls, 0);
});
test("marketing opt-out prevents sending while transactional email still works", async () => {
  defaults();
  await deliver(message({ category: "marketing" }));
  assert.equal(providerCalls, 0);
  await deliver(message());
  assert.equal(providerCalls, 1);
});
test("SMS STOP blocks transactional and marketing texts", () => {
  defaults();
  const ctx: any = {
    prefs: { sms_stopped: true, sms_transactional: true, sms_marketing: true },
  };
  assert.equal(allowed(ctx, "sms", "transactional"), false);
  assert.equal(allowed(ctx, "sms", "marketing"), false);
});
test("missing recipient is a visible failed message, not a worker crash", async () => {
  defaults();
  state.customers[0].data.contacts = [];
  const m = await queueMessage(
    { company_id: "co", customer_id: "c" },
    "email",
    { category: "transactional", body: "Hello", subject: "Test" },
    "missing-email",
    "test",
  );
  assert.equal(m.status, "failed");
  assert.match(m.error, /email/);
});
test("duplicate outbox insertion reuses original message", async () => {
  defaults();
  const args: any = [
    { company_id: "co", customer_id: "c" },
    "email",
    { category: "transactional", body: "Hello" },
    "same-key",
    "test",
  ];
  const a = await queueMessage(...(args as [any, any, any, any, any]));
  const b = await queueMessage(...(args as [any, any, any, any, any]));
  assert.equal(a.id, b.id);
  assert.equal(state.communications.length, 1);
});
test("uncertain provider timeout is held and never automatically retried", async () => {
  defaults();
  providerResult = "timeout";
  const m = message();
  await deliver(m);
  assert.equal(state.communications[0].status, "unknown");
  await deliver({ ...state.communications[0] });
  assert.equal(providerCalls, 1);
});
test("definitive rate limit schedules a bounded retry", async () => {
  defaults();
  providerResult = "rate_limit";
  await deliver(message());
  assert.equal(state.communications[0].status, "pending");
  assert.ok(Date.parse(state.communications[0].scheduled_at) > Date.now());
});
test("tampered unsubscribe capabilities are rejected", () => {
  defaults();
  const token = unsubscribeUrl("c", "co").split("/").pop()!;
  assert.deepEqual(readUnsubscribe(token), { customer: "c", company: "co" });
  assert.throws(() => readUnsubscribe(token + "x"));
});
test("SMS action records provider acceptance", async () => {
  defaults();
  state.crm_settings[0].data.sms_start = 0;
  state.crm_settings[0].data.sms_end = 24;
  let sent = 0;
  const m = message({ channel: "sms", recipient: "+18165551234" });
  await deliver(m, async () => {
    sent++;
    return "SMtest";
  });
  assert.equal(sent, 1);
  assert.equal(state.communications[0].provider_id, "SMtest");
  assert.equal(state.communications[0].status, "sent");
});
test("failed SMS is logged without breaking subsequent messages", async () => {
  defaults();
  state.crm_settings[0].data.sms_start = 0;
  state.crm_settings[0].data.sms_end = 24;
  await deliver(
    message({ channel: "sms", recipient: "+18165551234" }),
    async () => {
      throw Object.assign(new Error("Invalid destination"), { status: 400 });
    },
  );
  assert.equal(state.communications[0].status, "failed");
  await deliver(message());
  assert.equal(state.communications[1].status, "sent");
});
test("current invoice balance replaces stale merge fields immediately before send", async () => {
  defaults();
  await queueMessage(
    { company_id: "co", customer_id: "c", invoice_id: "i" },
    "email",
    { category: "transactional", body: "Remaining: {{amount_due}}" },
    "balance-refresh",
    "test",
  );
  state.invoices[0].data.paidAmount = 4000;
  let body = "";
  await deliver({ ...state.communications[0] }, async (m) => {
    body = m.body;
    return "fresh-email";
  });
  assert.equal(body, "Remaining: $1,000.00");
});
