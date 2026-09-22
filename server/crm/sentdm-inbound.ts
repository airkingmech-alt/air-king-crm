import { db, result, event, phone, type Row } from "./core";

// Durable callback processing: never grant marketing consent or automatically
// re-enable a stopped number merely because it sent an arbitrary reply.
export async function processSentInbound(callback: Row) {
  const {company_id: company, from, text: body, message_id: messageId} = callback.payload;
  const customers: Row[] = await result(db().from("customers").select("id,company_id,data").eq("company_id", company));
  const matches = customers.filter(c => (c.data.contacts || []).some((contact: Row) => {
    try { return phone(contact.phone) === from; } catch { return false; }
  }));
  const stop = /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(body.trim());
  for (const c of matches) {
    if (stop) await result(db().from("customer_communication_preferences").upsert({
      company_id: company, customer_id: c.id, sms_stopped: true, updated_at: new Date().toISOString(),
    }));
    await event({company_id: company, customer_id: c.id, channel: "sms"},
      stop ? "customer.opted_out" : "sms.received",
      {body, from, provider: "sentdm", provider_id: messageId}, `sentdm-inbound:${messageId}:${c.id}`);
  }
  if (!matches.length) await event({company_id: company, channel: "sms"}, "sms.received",
    {body, from, provider: "sentdm", provider_id: messageId, unmatched: true}, `sentdm-inbound:${messageId}`);
  await result(db().from("provider_webhook_events").update({processed_at: new Date().toISOString()}).eq("id", callback.id));
}
