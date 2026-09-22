import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sendSentSms, verifySentWebhook, sentReady } from "../server/crm/sentdm";

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
