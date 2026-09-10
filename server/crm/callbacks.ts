import { db, result, event, type Row } from "./core";
export async function saveCallback(
  provider: string,
  id: string,
  providerId: string,
  payload: Row,
) {
  await result(
    db()
      .from("provider_webhook_events")
      .upsert(
        { id, provider, provider_id: providerId, payload },
        { onConflict: "id", ignoreDuplicates: true },
      ),
  );
}
export async function processCallbacks() {
  const callbacks: Row[] = await result(
    db()
      .from("provider_webhook_events")
      .select("*")
      .is("processed_at", null)
      .order("created_at")
      .limit(100),
  );
  for (const callback of callbacks) {
    const msg = await result(
      db()
        .from("communications")
        .select("*")
        .eq("provider_id", callback.provider_id)
        .maybeSingle(),
    );
    if (!msg) continue;
    const status = callback.payload.status;
    const failed = [
      "failed",
      "undelivered",
      "email.bounced",
      "email.complained",
      "email.failed",
    ].includes(status);
    const delivered = ["delivered", "read", "email.delivered"].includes(status);
    const at = callback.payload.created_at || callback.created_at;
    if (
      !msg.provider_status_at ||
      Date.parse(at) >= Date.parse(msg.provider_status_at)
    ) {
      const state = failed ? "failed" : delivered ? "delivered" : msg.status;
      await result(
        db()
          .from("communications")
          .update({
            status: state,
            provider_status: status,
            provider_status_at: at,
            error: failed
              ? "Provider reported delivery failure. Check contact details."
              : msg.error,
          })
          .eq("id", msg.id),
      );
    }
    if (["email.bounced", "email.complained"].includes(status))
      await result(
        db()
          .from("customer_communication_preferences")
          .upsert({
            company_id: msg.company_id,
            customer_id: msg.customer_id,
            email_suppressed: true,
          }),
      );
    await event(
      {
        company_id: msg.company_id,
        customer_id: msg.customer_id,
        quote_id: msg.quote_id,
        invoice_id: msg.invoice_id,
        job_id: msg.job_id,
        channel: msg.channel,
        status,
      },
      callback.provider + "." + status,
      { message_id: msg.id, provider_id: callback.provider_id },
      callback.id,
    );
    await result(
      db()
        .from("provider_webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", callback.id),
    );
  }
}
