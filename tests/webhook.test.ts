import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { registerCrm } from "../server/crm/routes";

const app = express();
app.use(express.json({ verify: (req, _res, body) => { (req as any).rawBody = body; } }));
registerCrm(app);
const server = createServer(app);
let url: string;
const secret = "local-webhook-test-only";
test("Sent HTTP webhook rejects forged and foreign-account events and ignores non-SMS replies", async () => {
  Object.assign(process.env, {SENT_DM_API_KEY:"test-only", SENT_DM_ACCOUNT_ID:"account", SENT_DM_COMPANY_ID:"co",
    SENT_DM_WEBHOOK_ID:"endpoint", SENT_DM_WEBHOOK_SECRET:"whsec_" + Buffer.from(secret).toString("base64")});
  const send = (account = "account", valid = true) => {
    const body = JSON.stringify({event:"message.received",timestamp:new Date().toISOString(),payload:{account_id:account,message_id:"id",channel:"whatsapp",text:"STOP"}});
    const t = String(Math.floor(Date.now()/1000));
    const sig = createHmac("sha256",secret).update(`endpoint.${t}.${body}`).digest("base64");
    return fetch(url.replace("/stripe","/sentdm"),{method:"POST",body,headers:{"Content-Type":"application/json","x-webhook-id":"endpoint","x-webhook-timestamp":t,"x-webhook-signature":valid?`v1,${sig}`:"invalid"}});
  };
  assert.equal((await send("account",false)).status,403);
  assert.equal((await send("other")).status,403);
  assert.equal((await send()).status,204);
});
before(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.STRIPE_SECRET_KEY = "test-only";
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  url = `http://127.0.0.1:${address.port}/api/webhooks/stripe`;
});
after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
async function ping(valid = true) {
  const body = JSON.stringify({ id: "evt_local_setup", object: "event", type: "ping", data: { object: {} } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${valid ? sig : "invalid"}` }, body });
}
test("Express raw-body handling accepts a signed setup ping and rejects a forged one", async () => {
  assert.equal((await ping()).status, 200);
  const forged = await ping(false);
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).error, "Invalid webhook signature.");
});
test("missing Stripe configuration is not misreported as an invalid signature", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  try {
    const response = await ping();
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Stripe is not connected.");
  } finally { process.env.STRIPE_SECRET_KEY = "test-only"; }
});
