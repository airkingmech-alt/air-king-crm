import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type Env = NodeJS.ProcessEnv;
export function smsProvider(env: Env = process.env) {
  return env.SMS_PROVIDER || "twilio";
}
export function sentConfigured(env: Env = process.env) {
  return Boolean(env.SENT_DM_API_KEY && env.SENT_DM_WEBHOOK_SECRET &&
    env.SENT_DM_ACCOUNT_ID && env.SENT_DM_COMPANY_ID);
}
// Local checks only: never claim that credentials, campaign or carrier delivery were verified.
export function sentReadiness(env: Env = process.env, company?: string) {
  const missing = ["SENT_DM_API_KEY", "SENT_DM_WEBHOOK_SECRET", "SENT_DM_ACCOUNT_ID",
    "SENT_DM_COMPANY_ID", "SENT_DM_TEMPLATE_ID"]
    .filter(key => !env[key]?.trim());
  const issues = missing.map(key => `Missing ${key}.`);
  if (env.SENT_DM_WEBHOOK_SECRET && !env.SENT_DM_WEBHOOK_SECRET.startsWith("whsec_"))
    issues.push("SENT_DM_WEBHOOK_SECRET must be the endpoint signing secret.");
  if (env.NODE_ENV === "production" && !env.SENT_DM_WEBHOOK_ID?.trim())
    issues.push("Missing SENT_DM_WEBHOOK_ID for production endpoint verification.");
  if (company && company !== env.SENT_DM_COMPANY_ID)
    issues.push("Sent SMS is not configured for this CRM company.");
  if (env.SENT_DM_FROM_NUMBER && !/^\+[1-9]\d{7,14}$/.test(env.SENT_DM_FROM_NUMBER))
    issues.push("SENT_DM_FROM_NUMBER must use E.164 format.");
  if (env.SENT_DM_SENDING_ENABLED !== "true")
    issues.push("Sent SMS sending is paused in the server configuration.");
  return { ready: issues.length === 0, issues, provider_verified: false };
}
export function sentReady(env: Env = process.env) {
  return sentReadiness(env).ready;
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
    "message.blocked": "blocked", "message.filtered": "filtered", "message.scheduled": "scheduled", "message.cancelled": "cancelled",
  };
  return map[event] || null;
}

export async function sendSentSms(msg: {id: string; company_id: string; recipient: string; body: string; category: string}, env: Env = process.env, request: typeof fetch = fetch) {
  if (!sentReady(env) || msg.company_id !== env.SENT_DM_COMPANY_ID)
    throw Object.assign(new Error("Sent.dm SMS setup or approval is incomplete."), {status: 400});
  if (msg.category === "marketing")
    throw Object.assign(new Error("The Sent.dm campaign is registered for customer care only."), {status: 400});
  // Sent rejects newlines, tabs and long space runs in template parameters
  // (VALIDATION_008). The CRM always appends a newline before its STOP footer.
  const message = msg.body.replace(/[\r\n\t]+/g, " ").replace(/ {5,}/g, " ");
  const response = await request("https://api.sent.dm/v3/messages", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: {"Content-Type": "application/json", "x-api-key": env.SENT_DM_API_KEY!, "Idempotency-Key": `crm-${msg.id}`},
    // Pin SMS. Never allow automatic routing, WhatsApp, or cross-channel fallback.
    body: JSON.stringify({to: [msg.recipient], channel: ["sms"],
      ...(env.SENT_DM_FROM_NUMBER ? {channels: {sms: [{from: [env.SENT_DM_FROM_NUMBER]}]}} : {}),
      template: {id: env.SENT_DM_TEMPLATE_ID, parameters: {message}}}),
  });
  // Error responses can be empty or HTML (for example a proxy rate limit).
  // Classify the HTTP result even when JSON cannot be parsed; never retain raw text.
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) {
    // 409 may mean a concurrent request was accepted. Keep it unknown for reconciliation.
    const status = response.status === 409 || response.ok ? undefined : response.status;
    throw Object.assign(new Error(`Sent.dm rejected the request (${response.status}). ${sentFailureReason({reason_code: data?.error?.code})}`), {status});
  }
  const recipients = data.data?.recipients;
  if (!Array.isArray(recipients) || recipients.length !== 1 ||
    recipients[0].to !== msg.recipient || recipients[0].channel !== "sms" ||
    typeof recipients[0].message_id !== "string" || !recipients[0].message_id)
    throw new Error("Sent.dm acceptance could not be confirmed.");
  return `sentdm:${recipients[0].message_id}`;
}

// The event ID is stable across attempts; endpoint ID and signing timestamp are not
// event identities. Bind it to the signed body hash as the ID header is not signed.
export function sentEventKey(raw: Buffer, eventId: unknown) {
  const hash = createHash("sha256").update(raw).digest("hex");
  return `sentdm-event:${typeof eventId === "string" ? eventId.slice(0, 200) : "legacy"}:${hash}`;
}

export function sentFailureReason(payload: Record<string, unknown>) {
  // Never persist arbitrary provider text (may contain PII, credentials or markup).
  const code = typeof payload.reason_code === "string" && /^(?:(?:BUSINESS|DELIVERY|VALIDATION|AUTH|RESOURCE)_\d{3}|CONVERSATION_TEMPLATE_REQUIRED)$/.test(payload.reason_code)
    ? payload.reason_code : null;
  const hints: Record<string, string> = {
    VALIDATION_008: "Check template parameter whitespace, required values and validation patterns.",
    RESOURCE_002: "The configured template was not found in this Sent account.",
    BUSINESS_005: "The SMS template is awaiting approval.",
    AUTH_005: "The Sent account is awaiting activation.",
    AUTH_006: "Sent account verification is incomplete.",
    AUTH_007: "Configure the SMS channel in Sent.",
    AUTH_002: "Check the server API key for the intended Sent account.",
    CONVERSATION_TEMPLATE_REQUIRED: "An approved template is required to open this SMS conversation.",
    BUSINESS_003: "Account balance is insufficient.", BUSINESS_004: "Recipient is opted out or suppressed.",
    BUSINESS_020: "Account onboarding quota reached.", BUSINESS_029: "SMS sender is not active on the account.",
    DELIVERY_004: "Destination is denied by routing policy.",
  };
  return code ? `${code}: ${hints[code] || "Provider could not deliver. Review the Sent dashboard."}`
    : "Provider could not deliver. Review the Sent dashboard.";
}

export function sentOptOut(text: unknown) {
  return typeof text === "string" && /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(text.trim());
}
