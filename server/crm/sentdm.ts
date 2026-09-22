import { createHmac, timingSafeEqual } from "node:crypto";

type Env = NodeJS.ProcessEnv;
export function smsProvider(env: Env = process.env) {
  return env.SMS_PROVIDER || "twilio";
}
export function sentConfigured(env: Env = process.env) {
  return Boolean(env.SENT_DM_API_KEY && env.SENT_DM_WEBHOOK_SECRET &&
    env.SENT_DM_ACCOUNT_ID && env.SENT_DM_COMPANY_ID);
}
export function sentReady(env: Env = process.env) {
  return sentConfigured(env) && env.SENT_DM_SENDING_ENABLED === "true" &&
    Boolean(env.SENT_DM_TEMPLATE_ID);
}

// https://docs.sent.dm/start/webhooks/signature-verification
export function verifySentWebhook(raw: Buffer, headers: Record<string, unknown>, env: Env = process.env, now = Date.now()) {
  const secret = env.SENT_DM_WEBHOOK_SECRET;
  const id = headers["x-webhook-id"];
  const ts = headers["x-webhook-timestamp"];
  const signature = headers["x-webhook-signature"];
  if (!secret?.startsWith("whsec_") || typeof id !== "string" ||
    typeof ts !== "string" || !/^\d+$/.test(ts) || typeof signature !== "string" ||
    Math.abs(now / 1000 - Number(ts)) > 300) return false;
  if (env.SENT_DM_WEBHOOK_ID && id !== env.SENT_DM_WEBHOOK_ID) return false;
  const key = Buffer.from(secret.slice(6), "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${ts}.`).update(raw).digest();
  return signature.split(/\s+/).some(part => {
    if (!part.startsWith("v1,")) return false;
    const actual = Buffer.from(part.slice(3), "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export function sentStatus(event: string): string | null {
  const map: Record<string, string> = {
    "message.queued": "queued", "message.routed": "routed", "message.sent": "sent",
    "message.delivered": "delivered", "message.read": "read", "message.failed": "failed",
    "message.blocked": "blocked", "message.filtered": "filtered", "message.scheduled": "scheduled",
  };
  return map[event] || null;
}

export async function sendSentSms(msg: {id: string; company_id: string; recipient: string; body: string; category: string}, env: Env = process.env, request: typeof fetch = fetch) {
  if (!sentReady(env) || msg.company_id !== env.SENT_DM_COMPANY_ID)
    throw Object.assign(new Error("Sent.dm SMS setup or approval is incomplete."), {status: 400});
  if (msg.category === "marketing")
    throw Object.assign(new Error("The Sent.dm campaign is registered for customer care only."), {status: 400});
  const response = await request("https://api.sent.dm/v3/messages", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: {"Content-Type": "application/json", "x-api-key": env.SENT_DM_API_KEY!, "Idempotency-Key": `crm-${msg.id}`},
    // Pin SMS. Never allow automatic routing, WhatsApp, or cross-channel fallback.
    body: JSON.stringify({to: [msg.recipient], channel: ["sms"],
      template: {id: env.SENT_DM_TEMPLATE_ID, parameters: {message: msg.body}}}),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) {
    // 409 may mean a concurrent request was accepted. Keep it unknown for reconciliation.
    const status = response.status === 409 || response.ok ? undefined : response.status;
    throw Object.assign(new Error(`Sent.dm rejected the request (${response.status}).`), {status});
  }
  const recipients = data.data?.recipients;
  if (!Array.isArray(recipients) || recipients.length !== 1 ||
    recipients[0].to !== msg.recipient || recipients[0].channel !== "sms" ||
    typeof recipients[0].message_id !== "string" || !recipients[0].message_id)
    throw new Error("Sent.dm acceptance could not be confirmed.");
  return `sentdm:${recipients[0].message_id}`;
}
