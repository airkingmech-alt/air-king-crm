import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  cents,
  publicFields,
  conditionsPass,
  shouldStop,
  nextWindow,
  merge,
  phone,
} from "../server/crm/core";
import { automationSchema, starters, bodies } from "../server/crm/catalog";
import Stripe from "stripe";
import twilio from "twilio";
const pg = new PGlite();
const company = "test-company";
async function sql(s: string, p: any[] = []) {
  return (await pg.query(s, p)).rows as any[];
}
async function invoice(id: string, amount = 5000, paid = 0) {
  await sql(
    "insert into invoices(id,company_id,customer_id,data) values($1,$2,$3,$4)",
    [
      id,
      company,
      "customer-test",
      {
        id,
        amount,
        paidAmount: paid,
        status: "Sent",
        customerName: "Test",
        items: [],
        dueDate: "2026-10-01",
      },
    ],
  );
}
async function manual(id: string, amount: number, key: string) {
  return sql("select * from crm_record_payment($1,$2,$3,'Cash',$4)", [
    id,
    company,
    amount,
    key,
  ]);
}
before(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table profiles(id uuid primary key,company_id text,role text);create function get_my_company_id() returns text language sql as $$select 'test-company'::text$$;
 create table customers(id text primary key,company_id text,data jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
 create table quotes(id text primary key,company_id text,customer_id text,data jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
 create table invoices(like quotes including all);create table work_orders(like quotes including all);
 insert into profiles values('11111111-1111-4111-8111-111111111111','test-company','owner');
 insert into customers values('customer-test','test-company','{"name":"Test Customer","leadStatus":"New"}');
 insert into invoices(id,company_id,customer_id,data) values('legacy','test-company','customer-test','{"id":"legacy","amount":5000,"paidAmount":2000,"status":"Partial"}');`);
  await pg.exec(
    await readFile(
      "supabase/migrations/20260909230728_communications_payments.sql",
      "utf8",
    ),
  );
  await pg.exec(
    await readFile(
      "supabase/migrations/20260910222500_save_quote_addons.sql",
      "utf8",
    ),
  );
});
after(() => pg.close());
test("staff database reads cannot expose another company's settings", async () => {
  await sql("insert into crm_settings(company_id) values('other-company')");
  await pg.exec("begin; set local role authenticated;");
  try {
    const rows = await sql("select company_id from crm_settings");
    assert.deepEqual(
      rows.map((r) => r.company_id),
      [company],
    );
    assert.equal(
      (await sql("select * from crm_settings where company_id='other-company'"))
        .length,
      0,
    );
  } finally {
    await pg.exec("rollback");
  }
});
test("staff cannot write operational tables or invoke payment RPCs directly", async () => {
  for (const query of [
    "update crm_settings set data='{}' where company_id='test-company'",
    "delete from payments where invoice_id='legacy'",
    "select crm_record_payment('legacy','test-company',100,'Cash','forged')",
    "select * from document_links",
    "select * from stripe_events",
    "select * from provider_webhook_events",
  ]) {
    await pg.exec("begin; set local role authenticated;");
    try {
      await assert.rejects(sql(query), /permission denied/i);
    } finally {
      await pg.exec("rollback");
    }
  }
});
test("anonymous database access to customer communications and payments is denied", async () => {
  for (const table of [
    "communications",
    "communication_events",
    "payments",
    "quote_acceptances",
    "document_links",
  ]) {
    await pg.exec("begin; set local role anon;");
    try {
      await assert.rejects(sql(`select * from ${table}`), /permission denied/i);
    } finally {
      await pg.exec("rollback");
    }
  }
});
test("all 14 starter automations install disabled and repeated setup creates no duplicates", async () => {
  const definitions = starters.map(
    ([name, trigger, bodyKey, category, steps]) => ({
      name,
      trigger,
      description: "Test starter",
      templates: ["email", "sms"].map((channel) => ({
        name: `${name} ${channel}`,
        channel,
        category,
        purpose: bodyKey,
        description: "Test template",
        subject: name,
        body: bodies[bodyKey],
      })),
      steps: steps.map(([wait_minutes, action]) => ({
        wait_minutes,
        action,
        conditions: [],
      })),
    }),
  );
  for (let i = 0; i < 2; i++)
    await sql("select crm_install_starters($1,$2)", [
      "starter-test-company",
      definitions,
    ]);
  const automations = await sql(
    "select * from automations where company_id='starter-test-company'",
  );
  assert.equal(automations.length, 14);
  assert.ok(automations.every((a) => a.enabled === false));
  assert.equal(
    (
      await sql(
        "select * from message_templates where company_id='starter-test-company'",
      )
    ).length,
    28,
  );
  for (const automation of automations) {
    automationSchema.parse(automation);
    for (const step of automation.steps) {
      if (["email", "sms"].includes(step.action)) {
        const [template] = await sql(
          "select channel from message_templates where id=$1",
          [step.template_id],
        );
        assert.equal(template.channel, step.action);
      }
    }
  }
});
test("migration preserves historical balance and labels provenance", async () => {
  const [p] = await sql("select * from payments where invoice_id='legacy'");
  assert.equal(Number(p.amount_cents), 200000);
  assert.equal(p.method, "Historical");
  assert.equal(p.paid_at, null);
});
test("partial, second payment and ledger derived balance", async () => {
  await invoice("partial");
  await manual("partial", 200000, "partial-1");
  let [i] = await sql("select data from invoices where id='partial'");
  assert.equal(i.data.paidAmount, 2000);
  assert.equal(i.data.status, "Partial");
  await manual("partial", 300000, "partial-2");
  [i] = await sql("select data from invoices where id='partial'");
  assert.equal(i.data.paidAmount, 5000);
  assert.equal(i.data.status, "Paid");
});
test("duplicate manual payment is idempotent", async () => {
  await invoice("duplicate");
  await manual("duplicate", 10000, "dup-key");
  await manual("duplicate", 10000, "dup-key");
  assert.equal(
    (await sql("select * from payments where invoice_id='duplicate'")).length,
    1,
  );
});
test("manual payments cannot exceed balance or mutate existing reference", async () => {
  await invoice("over");
  await assert.rejects(manual("over", 500001, "over-key"));
  await manual("over", 10000, "over-key");
  await assert.rejects(manual("over", 20000, "over-key"));
});
test("checkout is reserved atomically and prevents conflicting or manual payments", async () => {
  await invoice("checkout");
  const [a] = await sql("select * from crm_reserve_checkout($1,$2,$3)", [
    "checkout",
    company,
    200000,
  ]);
  const [b] = await sql("select * from crm_reserve_checkout($1,$2,$3)", [
    "checkout",
    company,
    200000,
  ]);
  assert.equal(a.id, b.id);
  await assert.rejects(
    sql("select * from crm_reserve_checkout($1,$2,$3)", [
      "checkout",
      company,
      300000,
    ]),
  );
  await assert.rejects(manual("checkout", 10000, "during-checkout"));
});
test("verified Stripe settlement and duplicate callbacks credit only once", async () => {
  await invoice("stripe");
  const [a] = await sql("select * from crm_reserve_checkout($1,$2,$3)", [
    "stripe",
    company,
    200000,
  ]);
  const args = [
    "stripe",
    company,
    200000,
    "visa •••• 4242",
    "pi_test",
    null,
    null,
    a.id,
    "evt_1",
    "checkout.session.completed",
    0,
    null,
  ];
  await sql(
    "select * from crm_record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    args,
  );
  await sql(
    "select * from crm_record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    args,
  );
  args[8] = "evt_2";
  await sql(
    "select * from crm_record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    args,
  );
  assert.equal(
    (await sql("select * from payments where invoice_id='stripe'")).length,
    1,
  );
  assert.equal(
    (await sql("select * from stripe_events where id in ('evt_1','evt_2')"))
      .length,
    2,
  );
  await manual("stripe", 300000, "stripe-manual");
  assert.equal(
    (await sql("select data from invoices where id='stripe'"))[0].data.status,
    "Paid",
  );
});
test("webhook amount mismatch rolls back all writes", async () => {
  await invoice("mismatch");
  const [a] = await sql("select * from crm_reserve_checkout($1,$2,$3)", [
    "mismatch",
    company,
    200000,
  ]);
  await assert.rejects(
    sql(
      "select * from crm_record_payment($1,$2,100000,'Card','pi_bad',null,null,$3,'evt_bad','checkout.session.completed')",
      ["mismatch", company, a.id],
    ),
  );
  assert.equal(
    (await sql("select * from payments where invoice_id='mismatch'")).length,
    0,
  );
  assert.equal(
    (await sql("select * from stripe_events where id='evt_bad'")).length,
    0,
  );
});
test("stale client cannot overwrite payment balances", async () => {
  await sql(
    'update invoices set data=data||\'{"paidAmount":0,"status":"Sent"}\'::jsonb where id=\'partial\'',
  );
  assert.equal(
    (await sql("select data from invoices where id='partial'"))[0].data
      .paidAmount,
    5000,
  );
  await assert.rejects(
    sql(
      "update invoices set data=data||'{\"amount\":100}'::jsonb where id='partial'",
    ),
  );
});
test("quote acceptance selects package and creates exactly one unscheduled work order", async () => {
  await sql(
    "insert into quotes(id,company_id,customer_id,data) values($1,$2,$3,$4)",
    [
      "quote-1",
      company,
      "customer-test",
      {
        id: "quote-1",
        status: "Quote Sent",
        title: "System",
        customerName: "Test",
        jobType: "Changeout",
        options: [
          { tier: "Good", customerPrice: 5000 },
          { tier: "Better", customerPrice: 6000 },
        ],
      },
    ],
  );
  await assert.rejects(
    sql(
      "select crm_decide_quote('quote-1',$1,'Test','accepted','Test','Unknown','')",
      [company],
    ),
  );
  await sql(
    "select crm_decide_quote('quote-1',$1,'Test','accepted','Test','Better','Please call','[\"crown-care\"]'::jsonb)",
    [company],
  );
  await sql(
    "select crm_decide_quote('quote-1',$1,'Test','accepted','Test','Better','Please call')",
    [company],
  );
  const [q] = await sql("select data from quotes where id='quote-1'");
  assert.equal(q.data.status, "Won");
  assert.equal(q.data.selectedOption, "Better");
  assert.deepEqual(q.data.selectedAddOns, ["crown-care"]);
  const [acceptedWorkOrder] = await sql(
    "select data from work_orders where data->>'quoteId'='quote-1'",
  );
  assert.deepEqual(acceptedWorkOrder.data.selectedAddOns, ["crown-care"]);
  assert.equal(
    (await sql("select * from work_orders where data->>'quoteId'='quote-1'"))
      .length,
    1,
  );
  assert.equal(
    (
      await sql(
        "select * from communication_events where quote_id='quote-1' and event_type='quote.accepted'",
      )
    ).length,
    1,
  );
});
test("decline and expired quotes do not create work orders", async () => {
  await sql(
    "insert into quotes(id,company_id,customer_id,data) values('quote-2',$1,'customer-test','{\"status\":\"Quote Sent\",\"options\":[]}')",
    [company],
  );
  await sql(
    "select crm_decide_quote('quote-2',$1,'Test','declined','','','')",
    [company],
  );
  assert.equal(
    (await sql("select data from quotes where id='quote-2'"))[0].data.status,
    "Lost",
  );
  await sql(
    'insert into quotes(id,company_id,customer_id,data) values(\'quote-expired\',$1,\'customer-test\',\'{"status":"Quote Sent","options":[],"expiresAt":"2020-01-01"}\')',
    [company],
  );
  await assert.rejects(
    sql(
      "select crm_decide_quote('quote-expired',$1,'Test','declined','','','')",
      [company],
    ),
  );
});
test("lifecycle viewed event emits once", async () => {
  await sql("select crm_document_lifecycle('quote','quote-1',$1,'viewed')", [
    company,
  ]);
  await sql("select crm_document_lifecycle('quote','quote-1',$1,'viewed')", [
    company,
  ]);
  assert.equal(
    (
      await sql(
        "select * from communication_events where quote_id='quote-1' and event_type='quote.viewed'",
      )
    ).length,
    1,
  );
});
test("enabled automation queues a delayed run exactly once; disabled does not", async () => {
  const [a] = await sql(
    "insert into automations(company_id,name,enabled,trigger,steps) values($1,'Test',true,'test.trigger','[{\"action\":\"wait\",\"wait_minutes\":120}]') returning id",
    [company],
  );
  await sql(
    "insert into automations(company_id,name,enabled,trigger,steps) values($1,'Disabled',false,'test.trigger','[{\"action\":\"wait\",\"wait_minutes\":0}]')",
    [company],
  );
  await sql(
    "insert into communication_events(company_id,customer_id,event_type,dedupe_key) values($1,'customer-test','test.trigger','trigger-1') on conflict do nothing",
    [company],
  );
  await sql(
    "insert into communication_events(company_id,customer_id,event_type,dedupe_key) values($1,'customer-test','test.trigger','trigger-1') on conflict do nothing",
    [company],
  );
  const runs = await sql(
    "select * from automation_runs where automation_id=$1",
    [a.id],
  );
  assert.equal(runs.length, 1);
  assert.ok(Date.parse(runs[0].next_at) - Date.now() > 119 * 60000);
});
test("atomic message claim prevents concurrent duplicate sends", async () => {
  const [m] = await sql(
    "insert into communications(company_id,customer_id,channel,category,recipient,body,reason,dedupe_key) values($1,'customer-test','sms','transactional','+15555550123','Test','test','msg-1') returning id",
    [company],
  );
  assert.equal(
    (await sql("select * from crm_claim_message($1)", [m.id])).length,
    1,
  );
  assert.equal(
    (await sql("select * from crm_claim_message($1)", [m.id])).length,
    0,
  );
});
test("new tables deny anonymous access and service RPCs are not public", async () => {
  const [r] = await sql(
    "select has_table_privilege('anon','public.document_links','select') as links, has_function_privilege('anon','public.crm_claim_runs()','execute') as rpc",
  );
  assert.equal(r.links, false);
  assert.equal(r.rpc, false);
  const tables = await sql(
    "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('payments','automations','communications','document_links')",
  );
  assert.ok(tables.every((x) => x.relrowsecurity));
});
test("money inputs reject malformed, negative, extra precision and unsafe amounts", () => {
  assert.equal(cents("2000.01"), 200001);
  for (const n of ["0", "-1", "1.001", "1e3", "NaN", "1000000000000"])
    assert.throws(() => cents(n));
});
test("public projection excludes internal costs and private fields", () => {
  const data = publicFields("quote", {
    id: "q",
    laborCost: 900,
    materialsCost: 3000,
    gateCode: "1234",
    options: [{ tier: "Good", customerPrice: 5000, totalCost: 3500 }],
  });
  assert.equal(data.laborCost, undefined);
  assert.equal(data.gateCode, undefined);
  assert.equal(data.options[0].totalCost, undefined);
});
test("stop conditions cover accepted, declined, paid, void and zero balance", () => {
  for (const status of ["Won", "Lost", "Expired", "Cancelled"])
    assert.equal(shouldStop("quote", { status }), true);
  assert.equal(
    shouldStop("invoice", { status: "Void", amount: 100, paidAmount: 0 }),
    true,
  );
  assert.equal(
    shouldStop("invoice", { status: "Paid", amount: 100, paidAmount: 100 }),
    true,
  );
  assert.equal(
    shouldStop("invoice", { status: "Partial", amount: 100, paidAmount: 50 }),
    false,
  );
  assert.equal(
    conditionsPass([{ field: "quote_pending", op: "eq", value: true }], {
      quote_pending: false,
    }),
    false,
  );
});
test("quiet hours carry into next day and respect daylight savings", () => {
  assert.equal(
    nextWindow(
      new Date("2026-09-10T01:00:00Z"),
      "America/Chicago",
      8,
      19,
    ).toISOString(),
    "2026-09-10T13:00:00.000Z",
  );
  assert.equal(
    nextWindow(
      new Date("2026-11-01T03:00:00Z"),
      "America/Chicago",
      8,
      19,
    ).toISOString(),
    "2026-11-01T14:00:00.000Z",
  );
});
test("templates allow known fields and reject unsupported ones", () => {
  assert.equal(
    merge("Hello {{customer_first_name}}", { customer_first_name: "Taylor" }),
    "Hello Taylor",
  );
  assert.throws(() => merge("{{secret}}", {}));
  assert.equal(phone("(816) 555-1234"), "+18165551234");
  assert.throws(() => phone("invalid"));
});
test("automation input rejects unsupported actions and unreasonable delays", () => {
  assert.equal(
    automationSchema.safeParse({
      name: "Bad",
      trigger: "quote.sent",
      steps: [{ action: "execute_code", wait_minutes: 0 }],
    }).success,
    false,
  );
});
test("Stripe signature verification rejects forged and modified callbacks", () => {
  const stripe = new Stripe("sk_test_unit_test_only");
  const secret = "whsec_unit_test_only";
  const payload = JSON.stringify({
    id: "evt_test",
    type: "checkout.session.completed",
    data: { object: { payment_status: "paid" } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(
    stripe.webhooks.constructEvent(payload, header, secret).id,
    "evt_test",
  );
  assert.throws(() =>
    stripe.webhooks.constructEvent(payload + " ", header, secret),
  );
});
test("Twilio callback verification rejects forged status changes", () => {
  const url = "https://example.com/api/webhooks/twilio/status";
  const params = { MessageSid: "SMtest", MessageStatus: "delivered" };
  const signature = twilio.getExpectedTwilioSignature(
    "unit-test-only",
    url,
    params,
  );
  assert.equal(
    twilio.validateRequest("unit-test-only", signature, url, params),
    true,
  );
  assert.equal(
    twilio.validateRequest("unit-test-only", signature, url, {
      ...params,
      MessageStatus: "failed",
    }),
    false,
  );
});
test("new customers produce customer and lead events", async () => {
  await sql(
    'insert into customers(id,company_id,data) values(\'new-customer\',$1,\'{"name":"Synthetic","leadStatus":"New"}\')',
    [company],
  );
  const events = await sql(
    "select event_type from communication_events where customer_id='new-customer' order by event_type",
  );
  assert.deepEqual(
    events.map((x) => x.event_type),
    ["customer.created", "lead.created"],
  );
});
test("sent lifecycle emits exactly one trigger event", async () => {
  await invoice("draft-sent");
  await sql(
    "update invoices set data=data||'{\"status\":\"Draft\"}'::jsonb where id='draft-sent'",
  );
  await sql("select crm_document_lifecycle('invoice','draft-sent',$1,'sent')", [
    company,
  ]);
  assert.equal(
    (
      await sql(
        "select * from communication_events where invoice_id='draft-sent' and event_type='invoice.sent'",
      )
    ).length,
    1,
  );
});
test("late successful payment is retained and flagged instead of losing money history", async () => {
  await invoice("late");
  const [a] = await sql("select * from crm_reserve_checkout($1,$2,$3)", [
    "late",
    company,
    500000,
  ]);
  await sql(
    "update checkout_attempts set expires_at=now()-interval '1 minute' where id=$1",
    [a.id],
  );
  await manual("late", 500000, "late-manual");
  await sql(
    "select * from crm_record_payment($1,$2,500000,'Card','pi_late',null,null,$3,'evt_late','checkout.session.completed')",
    ["late", company, a.id],
  );
  assert.equal(
    (await sql("select data from invoices where id='late'"))[0].data.paidAmount,
    10000,
  );
  const events = await sql(
    "select metadata from communication_events where invoice_id='late' and event_type='payment.received'",
  );
  assert.ok(events.some((x) => x.metadata.overpayment === true));
});
test("voiding an unpaid invoice blocks checkout and manual payments", async () => {
  await invoice("void");
  await sql("select crm_void_invoice($1,$2)", ["void", company]);
  await assert.rejects(manual("void", 1000, "void-manual"));
  await assert.rejects(
    sql("select * from crm_reserve_checkout($1,$2,$3)", [
      "void",
      company,
      1000,
    ]),
  );
  await assert.rejects(
    sql("select crm_void_invoice($1,$2)", ["partial", company]),
  );
});
