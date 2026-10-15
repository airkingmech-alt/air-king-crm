import { sentOptOut } from "./sentdm";
import { db, result, event, phone, type Row } from "./core";

// Only suppression is automatic. START never restores transactional/marketing consent.
export async function processSentInbound(callback: Row) {
  const {company_id: company, from, text: body = "", message_id: messageId} = callback.payload;
  const stop = callback.payload.opt_out === true || sentOptOut(body);
  if (stop) await result(db().from("sms_phone_suppressions").upsert({
    company_id: company, phone: from,
  }, {onConflict: "company_id,phone", ignoreDuplicates: true}));
  const matches: Row[] = [];
  // Keyset pagination is bounded per request and independent of PostgREST's row cap.
  let after: string | undefined;
  for (;;) {
    let query = db().from("customers").select("id,company_id,data")
      .eq("company_id", company).order("id").limit(500);
    if (after) query = query.gt("id", after);
    const customers: Row[] = await result(query);
    for (const c of customers) if (!c.data.deletedAt && (c.data.contacts || []).some((contact: Row) => {
      try { return phone(contact.phone) === from; } catch { return false; }
    })) matches.push(c);
    if (customers.length < 500) break;
    after = customers[customers.length - 1].id;
  }
  // Suppress every duplicate, but never attribute private reply text to an ambiguous
  // customer. Keep it in the company inbox for staff to resolve.
  if (stop) for (const c of matches) await result(db().from("customer_communication_preferences").upsert({
    company_id: company, customer_id: c.id, sms_stopped: true, updated_at: new Date().toISOString(),
  }));
  const customer = matches.length === 1 ? matches[0] : null;
  await event({company_id: company, ...(customer ? {customer_id: customer.id} : {}), channel: "sms"},
    stop ? "customer.opted_out" : "sms.received",
    {body, from, provider: "sentdm", provider_id: messageId,
      unmatched: !matches.length, ambiguous: matches.length > 1, match_count: matches.length},
    `sentdm-inbound:${company}:${messageId || callback.id}:${stop ? "stop" : "reply"}`);
  await result(db().from("provider_webhook_events").update({processed_at: new Date().toISOString()}).eq("id", callback.id));
}
