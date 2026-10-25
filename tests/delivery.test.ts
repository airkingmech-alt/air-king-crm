import {sendNowPreview,requestSmsSendNow} from "../server/crm/sms-send-now";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  deliver,
  queueMessage,
  allowed,
  readUnsubscribe,
  unsubscribeUrl,
  html,
} from "../server/crm/delivery";
import { customerSmsReadiness, queueCustomerSms } from "../server/crm/sms-compose";
import { randomUUID } from "node:crypto";
import { processSentInbound } from "../server/crm/sentdm-inbound";
process.env.SUPABASE_URL = "https://unit-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-only";
process.env.RESEND_API_KEY = "unit-test-only";
process.env.COMMUNICATION_SIGNING_SECRET =
  "unit-test-signing-key-not-a-real-credential";
const original = globalThis.fetch;

test("email links exclude trailing sentence punctuation", () => {
  const link = "https://air-king-crm.onrender.com/#/customer/abc_123-XYZ";
  const rendered = html(`Review your quote: ${link}. Please reply.`, "Air King");
  assert.match(rendered, new RegExp(`href="${link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.doesNotMatch(rendered, /href="[^"]+\."/);
});
let providerCalls = 0;
let providerResult = "success";
let failHistory = false;
let afterClaim: (()=>void) | null = null;
let beforeDefer: (()=>void) | null = null;
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
  state.sms_phone_suppressions = [];
  providerCalls = 0;
  providerResult = "success";
  failHistory = false;afterClaim=null;beforeDefer=null;
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
    if(path[3] === "crm_request_sms_send_now") {
      const m=state.communications.find(x=>x.id===payload.p_id&&x.company_id===payload.p_company);
      if(!m || m.recipient!==payload.p_recipient)return json({message:'Message unavailable'},400);
      if(m.send_now_requested_at)return json({already_requested:true,message:m});
      // PostgreSQL now() is stable throughout crm_request_sms_send_now.
      const requestedAt=Date.now();
      Object.assign(m,{send_now_requested_at:new Date(requestedAt).toISOString(),send_now_expires_at:new Date(requestedAt+300000).toISOString(),send_now_actor_id:payload.p_actor,scheduled_at:new Date(requestedAt).toISOString()});
      return json({already_requested:false,message:m});
    }
    assert.equal(path[3], "crm_claim_message");
    const m = state.communications.find(
      (x) => x.id === payload.p_id && x.status === "pending",
    );
    if (!m) return json([]);
    m.status = "sending";
    m.claim_token = randomUUID();
    m.attempts = (m.attempts || 0) + 1;
    afterClaim?.();
    return json([m]);
  }
  if (table === "communication_events" && init.method === "POST" && failHistory) return json({message:"synthetic history outage"},503);
  state[table] ||= [];
  if(table==='communications' && method==='PATCH' && payload.scheduled_at && !payload.status && beforeDefer){const hook=beforeDefer;beforeDefer=null;hook();}
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
    let rows = state[table].filter(match);
    if (url.searchParams.get("order") === "id.asc") rows = rows.sort((a,b) => a.id.localeCompare(b.id));
    if (url.searchParams.has("limit")) rows = rows.slice(0,Number(url.searchParams.get("limit")));
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
test("Sent inbound STOP is company scoped, preserves consent, and deduplicates history", async () => {
  defaults();
  state.customers.push({id:"other-c",company_id:"other",data:{contacts:[{phone:"+18165551234"}]}});
  state.customer_communication_preferences = [];
  state.provider_webhook_events = [{id:"callback",processed_at:null}];
  const callback = {id:"callback",payload:{company_id:"co",from:"+18165551234",text:" STOP ",message_id:"inbound"}};
  await processSentInbound(callback);
  assert.equal(state.customer_communication_preferences.length, 1);
  assert.equal(state.customer_communication_preferences[0].customer_id, "c");
  assert.equal(state.customer_communication_preferences[0].sms_stopped, true);
  assert.equal(state.customer_communication_preferences[0].sms_marketing, undefined);
  assert.ok(state.provider_webhook_events[0].processed_at);
  await processSentInbound(callback);
  assert.equal(state.communication_events.length, 1);
  assert.equal(state.communication_events[0].event_type, "customer.opted_out");
  await processSentInbound({...callback,payload:{...callback.payload,text:"START",message_id:"reply"}});
  assert.ok(state.customer_communication_preferences.every(p=>p.sms_stopped));
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

test("draft quote automated delivery is blocked, including previously queued work", async () => {
  defaults();
  state.quotes[0].data.status = "Draft";
  const m = message({ quote_id: "q", automation_run_id: "r" });
  await deliver(m);
  assert.equal(providerCalls, 0);
  assert.equal(state.communications[0].status, "cancelled");
  const queued = await queueMessage({company_id:"co",customer_id:"c",quote_id:"q"}, "email", {channel:"email",category:"transactional",subject:"Test",body:"Review {{quote_link}}"}, "draft-block-test", "automation:test", undefined, "r");
  assert.equal(queued.status, "failed");
  assert.equal(state.document_links.length, 0);
});
test("draft quote can still be sent only through explicit document delivery", async () => {
  defaults(); state.quotes[0].data.status = "Draft";
  await deliver(message({quote_id:"q",reason:"document_delivery"}));
  assert.equal(providerCalls, 1);
  assert.equal(state.communications[0].status, "sent");
});

test("Sent provider opt-out without a message or text suppresses all company phone duplicates", async () => {
  defaults();
  state.communication_events = [];
  state.customers.push({id:"duplicate",company_id:"co",data:{contacts:[{phone:"(816) 555-1234"}]}});
  state.customers.push({id:"foreign",company_id:"other",data:{contacts:[{phone:"+18165551234"}]}});
  state.customer_communication_preferences = [];
  await processSentInbound({id:"network-opt-out",payload:{company_id:"co",from:"+18165551234",text:"",message_id:null,opt_out:true}});
  assert.deepEqual(state.customer_communication_preferences.map(p=>p.customer_id).sort(),["c","duplicate"]);
  assert.equal(state.sms_phone_suppressions.length,1);
  assert.equal(state.communication_events.length,1);
  assert.equal(state.communication_events[0].customer_id,undefined);
  assert.equal(state.communication_events[0].metadata.ambiguous,true);
});
test("Sent matching traverses beyond 1000 customers and skips soft-deleted matches", async () => {
  defaults(); state.communication_events = [];
  state.customers = Array.from({length:1100},(_,i)=>({id:String(i).padStart(5,"0"),company_id:"co",data:{contacts:[]}}));
  state.customers.push({id:"zz-match",company_id:"co",data:{contacts:[{phone:"8165551234"}]}});
  state.customers.push({id:"zz-deleted",company_id:"co",data:{deletedAt:"2026-10-01",contacts:[{phone:"8165551234"}]}});
  await processSentInbound({id:"page-reply",payload:{company_id:"co",from:"+18165551234",text:"Synthetic reply",message_id:"page-message"}});
  assert.equal(state.communication_events.length,1);
  assert.equal(state.communication_events[0].customer_id,"zz-match");
  assert.equal(state.communication_events[0].metadata.body,"Synthetic reply");
});
test("unmatched opt-out is durable and suppresses a later customer's send without provider calls", async () => {
  defaults(); state.communication_events = []; state.customers = [];
  await processSentInbound({id:"unmatched-stop",payload:{company_id:"co",from:"+18165551234",text:"STOP",message_id:"unknown"}});
  assert.equal(state.communication_events[0].metadata.unmatched,true);
  state.customers.push({id:"c",company_id:"co",data:{contacts:[{phone:"8165551234"}]}});
  let sends=0;
  await deliver(message({channel:"sms",recipient:"+18165551234"}), async()=>{sends++;return "never";});
  assert.equal(sends,0);
  assert.match(state.communications[state.communications.length-1].error,/suppressed/);
});


test("customer SMS queues once, keeps SMS-only transactional content and worker-owned delivery", async () => {
  defaults();
  const saved = {...process.env};
  Object.assign(process.env,{SMS_PROVIDER:"sentdm",SENT_DM_API_KEY:"synthetic",SENT_DM_ACCOUNT_ID:"account",SENT_DM_COMPANY_ID:"co",SENT_DM_TEMPLATE_ID:"template",SENT_DM_WEBHOOK_SECRET:"whsec_c3ludGhldGlj",SENT_DM_WEBHOOK_ID:"endpoint",SENT_DM_SENDING_ENABLED:"true"});
  try {
    const readiness=await customerSmsReadiness("co","c");assert.equal(readiness.ready,true);
    const args = ["co","c","actor","stable","Service appointment confirmed.",readiness.recipient] as const;
    const first=await queueCustomerSms(...args);
    const again=await queueCustomerSms(...args);
    const parallel=await Promise.all([queueCustomerSms(...args),queueCustomerSms(...args)]);
    assert.ok(parallel.every(row=>row.id===first.id));
    assert.equal(first.id,again.id);assert.equal(state.communications.length,1);
    failHistory=true;
    await assert.rejects(queueCustomerSms("co","c","actor","history-outage","Service text",readiness.recipient),/history outage/);
    assert.equal(state.communications.length,2);
    failHistory=false;
    const confirmed=await queueCustomerSms("co","c","actor","history-outage","Service text",readiness.recipient);
    assert.equal(confirmed.status,"pending");assert.equal(state.communications.length,2);
    assert.equal(first.channel,"sms");assert.equal(first.category,"transactional");assert.equal(first.status,"pending");
    assert.match(first.body,/Reply STOP/);assert.equal(providerCalls,0);
    await assert.rejects(queueCustomerSms("co","c","actor","stable","Different text",readiness.recipient),/different text/);
    await assert.rejects(queueCustomerSms("co","c","actor","next","Message","+18165559999"),/phone changed/);
    state.sms_phone_suppressions.push({company_id:"co",phone:readiness.recipient});
    assert.equal((await customerSmsReadiness("co","c")).ready,false);
    await assert.rejects(queueCustomerSms("co","c","actor","blocked","Message",readiness.recipient),/suppressed/);
    assert.equal(state.communications.length,2);
    assert.equal((await queueCustomerSms(...args)).id,first.id,"Prior acceptance remains confirmable after opt-out");
  } finally {for(const key of Object.keys(process.env)) if(!(key in saved)) delete process.env[key];Object.assign(process.env,saved);}
});

test("customer SMS readiness rejects missing consent and foreign customer and explains missing template", async () => {
  defaults();
  state.customer_communication_preferences=[];
  const readiness=await customerSmsReadiness("co","c");
  assert.equal(readiness.ready,false);
  assert.equal(readiness.consent_required,true);
  assert.ok(readiness.issues.some(issue=>issue.includes("consent")));
  await assert.rejects(queueCustomerSms("co","c","actor","first-text","Service text",readiness.recipient),/consent/);
  assert.equal(state.communications.length,0);
  defaults();
  state.customer_communication_preferences[0].sms_stopped=true;
  assert.equal((await customerSmsReadiness("co","c")).consent_required,false,"Opt-outs must not be presented as first-contact permission setup");
  await assert.rejects(customerSmsReadiness("foreign","c"),/not found/);
});

test("customer-care queued texts are cancelled if the primary phone changes before delivery", async () => {
  defaults();state.crm_settings[0].data.sms_start=0;state.crm_settings[0].data.sms_end=24;
  const msg=message({channel:"sms",reason:"customer_care",recipient:"+18165559999"});
  let sends=0;await deliver(msg,async()=>{sends++;return "never";});
  assert.equal(sends,0);assert.equal(state.communications[0].status,"cancelled");
  assert.match(state.communications[0].error,/phone changed/);
});

function outsideHours(){const hour=new Date().getUTCHours();const start=hour===12?14:12;state.crm_settings[0].data={...state.crm_settings[0].data,timezone:'UTC',sms_start:start,sms_end:start+1};}
function grantedSms(extra:any={}) {return message({channel:'sms',recipient:'+18165551234',send_now_actor_id:'synthetic-owner',send_now_requested_at:new Date(Date.now()-1000).toISOString(),send_now_expires_at:new Date(Date.now()+60000).toISOString(),...extra});}
test('one-message grant and simultaneous worker attempts dispatch once outside hours',async()=>{
 defaults();outsideHours();const m=grantedSms();let calls=0;
 await Promise.all([deliver(m,async()=>{calls++;return 'one';}),deliver(m,async()=>{calls++;return 'two';})]);
 assert.equal(calls,1);assert.equal(state.communications[0].status,'sent');assert.equal(state.communications[0].attempts,1);
});
test('expired, long-lived and consumed grants cannot override quiet hours',async()=>{
 for(const extra of [{send_now_expires_at:new Date(Date.now()-1).toISOString()},{send_now_expires_at:new Date(Date.now()+3600000).toISOString()},{attempts:1}]){
  defaults();outsideHours();let calls=0;await deliver(grantedSms(extra),async()=>{calls++;return 'never';});assert.equal(calls,0);assert.equal(state.communications[0].status,'pending');assert.ok(Date.parse(state.communications[0].scheduled_at)>Date.now());
 }
});
test('fresh suppression, revoked consent, paused sending and changed primary contact win over granted SMS',async()=>{
 for(const change of [()=>{state.sms_phone_suppressions=[{company_id:'co',phone:'+18165551234'}];},()=>{state.customer_communication_preferences[0].sms_transactional=false;},()=>{state.crm_settings[0].data.sending_enabled=false;},()=>{state.customers[0].data.contacts[0].phone='+18165559999';}]){
  defaults();outsideHours();const m=grantedSms({reason:'customer_care'});change();let calls=0;await deliver(m,async()=>{calls++;return 'never';});assert.equal(calls,0);
 }
});
test('a rate-limited granted attempt uses normal hours on retry; unknown outcomes never resend',async()=>{
 for(const status of [429,undefined]){
  defaults();outsideHours();const m=grantedSms();let calls=0;
  await deliver(m,async()=>{calls++;throw Object.assign(new Error('synthetic transport failure'),{status});});
  await deliver(m,async()=>{calls++;return 'never';});assert.equal(calls,1);assert.equal(state.communications[0].status,status===429?'pending':'unknown');
 }
});

test('revoked consent and expired grant after atomic claim still prevent transport',async()=>{
 for(const revoke of [true,false]){
  defaults();outsideHours();const m=grantedSms();let calls=0;
  afterClaim=()=>{if(revoke)state.customer_communication_preferences[0].sms_transactional=false;else state.communications[0].send_now_expires_at=new Date(Date.now()-1).toISOString();};
  await deliver(m,async()=>{calls++;return 'never';});assert.equal(calls,0);assert.equal(state.communications[0].status,revoke?'cancelled':'pending');
 }
});
test('a stale quiet-hours deferral cannot postpone a newly authorized message',async()=>{
 defaults();outsideHours();const m=message({channel:'sms',recipient:'+18165551234',scheduled_at:new Date().toISOString()});let calls=0;
 beforeDefer=()=>{Object.assign(state.communications[0],{send_now_actor_id:'owner',send_now_requested_at:new Date().toISOString(),send_now_expires_at:new Date(Date.now()+60000).toISOString()});};
 await deliver(m,async()=>{calls++;return 'never';});assert.ok(Date.parse(state.communications[0].scheduled_at)<=Date.now());
 await deliver(m,async()=>{calls++;return 'once';});assert.equal(calls,1);
});

test('Send now service rejects stale consent, foreign tenants and changed recipient, then converges repeated requests',async(t)=>{
 // Advance between clock reads: a mock grant must retain PostgreSQL's single
 // transaction timestamp even when the host clock crosses a millisecond.
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-25T00:57:00Z')});
 const clockNow=Date.now.bind(Date);
 t.mock.method(Date,'now',()=>{t.mock.timers.tick(1);return clockNow();});
 defaults();outsideHours();const m=message({channel:'sms',recipient:'+18165551234'});let calls=0;
 const prior={...process.env};Object.assign(process.env,{SMS_PROVIDER:'twilio',TWILIO_ACCOUNT_SID:'synthetic',TWILIO_AUTH_TOKEN:'synthetic',TWILIO_MESSAGING_SERVICE_SID:'synthetic'});
 try {
  await assert.rejects(sendNowPreview('foreign',m.id,m.recipient),/unavailable/);
  await assert.rejects(sendNowPreview('co',m.id,'+18165559999'),/confirmed/);
  state.customer_communication_preferences[0].sms_transactional=false;
  await assert.rejects(requestSmsSendNow('co',m.id,'owner',m.recipient),/consent/i);
  assert.equal(state.communications[0].send_now_requested_at,undefined);
  state.customer_communication_preferences[0].sms_transactional=true;
  const dispatch=(row:any)=>deliver(row,async()=>{calls++;return 'synthetic-sent';});
  await Promise.all([requestSmsSendNow('co',m.id,'owner',m.recipient,dispatch),requestSmsSendNow('co',m.id,'owner',m.recipient,dispatch)]);
  const saved=state.communications[0];
  assert.equal(Date.parse(saved.send_now_expires_at)-Date.parse(saved.send_now_requested_at),300000);
  assert.equal(saved.scheduled_at,saved.send_now_requested_at);
  assert.equal(calls,1);assert.equal(state.communications.length,1);
  const again=await requestSmsSendNow('co',m.id,'owner',m.recipient,dispatch);assert.equal(again.status,'sent');assert.equal(calls,1);
 } finally {for(const key of ['SMS_PROVIDER','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_MESSAGING_SERVICE_SID']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
