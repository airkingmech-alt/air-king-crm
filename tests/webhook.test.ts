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
