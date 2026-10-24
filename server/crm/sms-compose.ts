import { db, result, phone } from "./core";
import { allowed, context, queueMessage } from "./delivery";
import { smsConfigured } from "./readiness";
import { sentReadiness, smsProvider } from "./sentdm";

export async function customerSmsReadiness(company: string, customer: string) {
  const ctx = await context({company_id: company, customer_id: customer});
  const issues: string[] = [];
  let recipient = "";
  try { recipient = phone(ctx.contact.phone); } catch { issues.push("Add a valid phone number to the customer's primary contact."); }
  if (!allowed(ctx, "sms", "transactional")) issues.push("SMS consent is missing or the customer has opted out. Review communication preferences.");
  if (recipient && await result(db().from("sms_phone_suppressions").select("phone").eq("company_id", company).eq("phone", recipient).maybeSingle()))
    issues.push("This phone is suppressed after an opt-out. Sending START or editing preferences does not remove suppression.");
  if (smsProvider() === "sentdm") issues.push(...sentReadiness(process.env, company).issues);
  else if (!smsConfigured()) issues.push("Complete SMS provider setup in Integrations.");
  return {recipient, ready: !issues.length, issues, sending_enabled: !!ctx.config.sending_enabled,
    timezone: ctx.config.timezone, sms_start: ctx.config.sms_start, sms_end: ctx.config.sms_end,
    provider: smsProvider(), mode: smsProvider() === "sentdm" ? "approved_template" : "sms"};
}

export async function queueCustomerSms(company: string, customer: string, actor: string,
  requestKey: string, body: string, recipient: string) {
  const dedupe = `customer-sms:${company}:${customer}:${requestKey}`;
  const previous = await result(db().from("communications").select("*").eq("company_id", company).eq("dedupe_key", dedupe).maybeSingle());
  if (previous) {
    if (previous.template_snapshot?.body !== body || previous.recipient !== recipient)
      throw Object.assign(new Error("This request was already used for a different text. Review the customer timeline."), {status:409});
    return previous;
  }
  const readiness = await customerSmsReadiness(company, customer);
  if (!readiness.ready) throw Object.assign(new Error(readiness.issues.join(" ")), {status:400});
  if (recipient !== readiness.recipient) throw Object.assign(new Error("The primary contact phone changed. Refresh and confirm the recipient before sending."), {status:409});
  // Existing outbox rechecks consent; the worker owns quiet hours, suppression,
  // provider transport and claims. This request never contacts a messaging provider.
  const queued = await queueMessage({company_id:company,customer_id:customer,expected_recipient:recipient}, "sms",
    {category:"transactional",channel:"sms",body}, dedupe, "customer_care", actor);
  if (queued.template_snapshot?.body !== body || queued.recipient !== recipient)
    throw Object.assign(new Error("This request was already used for a different text. Review the customer timeline."), {status:409});
  return queued;
}
