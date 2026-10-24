import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sendSentSms, verifySentWebhook, sentReady, sentReadiness } from "../server/crm/sentdm";

const env = { SMS_PROVIDER: "sentdm", SENT_DM_API_KEY: "test-only", SENT_DM_ACCOUNT_ID: "account",
  SENT_DM_COMPANY_ID: "co", SENT_DM_WEBHOOK_SECRET: "whsec_" + Buffer.from("test-signing-key").toString("base64"),
  SENT_DM_WEBHOOK_ID: "endpoint", SENT_DM_TEMPLATE_ID: "template", SENT_DM_SENDING_ENABLED: "true" };
const msg = {id: "crm-id", company_id: "co", recipient: "+18165551234", body: "Appointment confirmed.", category: "transactional"};

test("Sent webhook authenticates exact bytes, endpoint and freshness", () => {
  const raw = Buffer.from('{"event":"message.delivered"}');
  const timestamp = "1800000000";
  const signature = createHmac("sha256", Buffer.from("test-signing-key"))
    .update(`endpoint.${timestamp}.`).update(raw).digest("base64");
  const headers = {"x-webhook-id": "endpoint", "x-webhook-timestamp": timestamp, "x-webhook-signature": `v1,${signature}`};
  const now = Number(timestamp) * 1000;
  assert.equal(verifySentWebhook(raw, headers, env, now), true);
  assert.equal(verifySentWebhook(Buffer.from(raw + " "), headers, env, now), false);
  assert.equal(verifySentWebhook(raw, {...headers, "x-webhook-id": "other"}, env, now), false);
  assert.equal(verifySentWebhook(raw, headers, env, now + 301000), false);
  assert.equal(verifySentWebhook(raw, {...headers, "x-webhook-signature": "v1,bad"}, env, now), false);
});

test("SMS remains disabled until explicitly activated with all required settings", async () => {
  assert.equal(sentReady({...env, SENT_DM_SENDING_ENABLED: "false"}), false);
  assert.equal(sentReady({...env, SENT_DM_TEMPLATE_ID: ""}), false);
  const never = (async () => { throw new Error("Must not contact provider"); }) as typeof fetch;
  await assert.rejects(sendSentSms({...msg, company_id: "other"}, env, never), /incomplete/);
  await assert.rejects(sendSentSms({...msg, category: "marketing"}, env, never), /customer care/);
  await assert.rejects(sendSentSms(msg, {...env, SENT_DM_SENDING_ENABLED: "false"}, never), /incomplete/);
});

test("Sent sends only SMS with a stable idempotency key and validates acceptance", async () => {
  const accepted = (channel = "sms", to = msg.recipient) => ({success: true, data: {recipients: [{message_id: "provider-id", channel, to}]}});
  const request = (async (url: any, init: any) => {
    assert.equal(url, "https://api.sent.dm/v3/messages");
    assert.equal(init.headers["Idempotency-Key"], "crm-crm-id");
    assert.deepEqual(JSON.parse(init.body), {to: [msg.recipient], channel: ["sms"], template: {id: "template", parameters: {message: msg.body}}});
    return Response.json(accepted());
  }) as typeof fetch;
  assert.equal(await sendSentSms(msg, env, request), "sentdm:provider-id");
  for (const body of [accepted("whatsapp"), accepted("sms", "+18165559999"), {success: true, data: {}}, {success: false}]) {
    await assert.rejects(sendSentSms(msg, env, (async () => Response.json(body)) as typeof fetch));
  }
  await assert.rejects(sendSentSms(msg, env, (async () => Response.json({}, {status:409})) as typeof fetch), (e:any) => e.status === undefined);
});

test("documented cancellation maps to a terminal status and provider reasons cannot leak arbitrary text", async () => {
  const {sentStatus, sentFailureReason, sentEventKey} = await import("../server/crm/sentdm");
  assert.equal(sentStatus("message.cancelled"), "cancelled");
  assert.match(sentFailureReason({reason_code:"BUSINESS_004",reason:"secret customer +18165551234 <script>"}), /opted out/);
  assert.doesNotMatch(sentFailureReason({reason_code:"BUSINESS_004",reason:"secret"}), /secret/);
  assert.doesNotMatch(sentFailureReason({reason_code:"evil<script>",reason:"secret"}), /evil|secret/);
  const raw = Buffer.from('{"event":"contact.opt_out"}');
  assert.equal(sentEventKey(raw,"stable-event"), sentEventKey(raw,"stable-event"));
  assert.notEqual(sentEventKey(raw,"stable-event"), sentEventKey(Buffer.from("other"),"stable-event"));
  assert.equal(sentEventKey(raw,undefined), sentEventKey(raw,undefined));
});


test("CRM multiline text and STOP footer conform to Sent template parameter rules", async () => {
  let calls = 0;
  const body = "Visit tomorrow.\r\nDetails:\tGate     2\nReply STOP to stop texts.";
  await sendSentSms({...msg, body}, env, (async (_url: any, init: any) => {
    calls++;
    const payload = JSON.parse(init.body);
    assert.equal(payload.template.parameters.message, "Visit tomorrow. Details: Gate 2 Reply STOP to stop texts.");
    assert.deepEqual(payload.channel, ["sms"]);
    assert.equal(payload.text, undefined);
    return Response.json({success: true, data: {recipients: [{message_id: "id", to: msg.recipient, channel: "sms"}]}});
  }) as typeof fetch);
  assert.equal(calls, 1);
});

test("optional sender pin uses documented SMS channel selector and rejects malformed numbers before transport", async () => {
  const pinned = {...env, SENT_DM_FROM_NUMBER: "+12025550123"};
  const request = (async (_url: any, init: any) => {
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.channels, {sms: [{from: [pinned.SENT_DM_FROM_NUMBER]}]});
    assert.deepEqual(payload.channel, ["sms"]);
    return Response.json({success: true, data: {recipients: [{message_id: "id", to: msg.recipient, channel: "sms"}]}});
  }) as typeof fetch;
  await sendSentSms(msg, pinned, request);
  let called = false;
  await assert.rejects(sendSentSms(msg, {...env, SENT_DM_FROM_NUMBER: "invalid"}, (async () => {called = true; throw new Error();}) as typeof fetch));
  assert.equal(called, false);
});

test("Sent readiness reports safe local blockers without claiming approval or leaking values", () => {
  assert.deepEqual(sentReadiness(env, "co"), {ready: true, issues: [], provider_verified: false});
  assert.equal(sentReadiness(env, "other").ready, false);
  for (const key of ["SENT_DM_API_KEY", "SENT_DM_WEBHOOK_SECRET", "SENT_DM_ACCOUNT_ID", "SENT_DM_COMPANY_ID", "SENT_DM_TEMPLATE_ID"]) {
    const readiness = sentReadiness({...env, [key]: "   "});
    assert.equal(readiness.ready, false);
    assert.ok(readiness.issues.some(issue => issue.includes(key)));
    assert.doesNotMatch(JSON.stringify(readiness), /test-only|test-signing-key/);
  }
  assert.equal(sentReady({...env, NODE_ENV: "production", SENT_DM_WEBHOOK_ID: ""}), false);
  assert.equal(sentReady({...env, SENT_DM_WEBHOOK_SECRET: "wrong-secret"}), false);
});

test("non-JSON rejection preserves rate limit classification while ambiguous responses remain unknown", async () => {
  for (const status of [400, 401, 403, 429, 409, 500, 502]) {
    await assert.rejects(sendSentSms(msg, env, (async () => new Response("private proxy details", {status})) as typeof fetch),
      (error: any) => error.status === (status === 409 ? undefined : status) && !error.message.includes("private"));
  }
  for (const body of [null, {}, {success: true}, {success: false}]) {
    await assert.rejects(sendSentSms(msg, env, (async () => Response.json(body, {status: 202})) as typeof fetch),
      (error: any) => error.status === undefined);
  }
});

test("provider errors retain only validated codes and local remediation", async () => {
  await assert.rejects(sendSentSms(msg, env, (async () => Response.json({success:false, error:{code:"VALIDATION_008",message:"private key and customer text"}}, {status:400})) as typeof fetch),
    (error: any) => error.status === 400 && /VALIDATION_008/.test(error.message) && !/private/.test(error.message));
});
