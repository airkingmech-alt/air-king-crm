import twilio from "twilio";
import { Resend } from "resend";
import {
  db,
  result,
  entity,
  settings,
  linkFor,
  merge,
  money,
  phone,
  email,
  origin,
  conditionsPass,
  shouldStop,
  nextWindow,
  event,
  type Row,
} from "./core";

export async function context(ref: Row) {
  const customer = await entity("customers", ref.customer_id, ref.company_id);
  const contact =
    customer.data.contacts?.find((x: Row) => x.role === "Primary") ||
    customer.data.contacts?.[0] ||
    {};
  const quote = ref.quote_id
    ? await entity("quotes", ref.quote_id, ref.company_id)
    : null;
  const invoice = ref.invoice_id
    ? await entity("invoices", ref.invoice_id, ref.company_id)
    : null;
  const job = ref.job_id
    ? await entity("work_orders", ref.job_id, ref.company_id)
    : null;
  const prefs = (await result(
    db()
      .from("customer_communication_preferences")
      .select("*")
      .eq("customer_id", customer.id)
      .eq("company_id", ref.company_id)
      .maybeSingle(),
  )) || {
    email_transactional: true,
    sms_transactional: false,
    email_marketing: false,
    sms_marketing: false,
  };
  const config = await settings(ref.company_id);
  const name = customer.data.name || "";
  const fields = {
    customer_name: name,
    customer_first_name: name.split(" ")[0],
    customer_last_name: name.split(" ").slice(1).join(" "),
    company_name: config.company_name,
    quote_number: quote?.id,
    quote_total: money(
      quote?.data.options?.find(
        (o: Row) => o.tier === quote.data.selectedOption,
      )?.customerPrice ||
        quote?.data.options?.[0]?.customerPrice ||
        0,
    ),
    invoice_number: invoice?.id,
    invoice_total: money(invoice?.data.amount || 0),
    amount_due: money(
      Math.max(
        0,
        (invoice?.data.amount || 0) - (invoice?.data.paidAmount || 0),
      ),
    ),
    appointment_date: job?.data.scheduledDate,
    appointment_time: job?.data.scheduledTime,
    job_address: job?.data.property,
    technician_name: job?.data.technician || "Your technician",
    review_link: config.review_url || "",
    receipt_amount: money((ref.metadata?.amount_cents || 0) / 100),
  };
  const rules = {
    quote_pending: quote ? !shouldStop("quote", quote.data) : false,
    invoice_unpaid: invoice ? !shouldStop("invoice", invoice.data) : false,
    invoice_balance:
      (invoice?.data.amount || 0) - (invoice?.data.paidAmount || 0),
    has_email: !!contact.email,
    has_phone: !!contact.phone,
    allows_sms: !!prefs.sms_transactional && !prefs.sms_stopped,
    allows_marketing_email: !!prefs.email_marketing && !prefs.email_suppressed,
    job_type: job?.data.type || quote?.data.jobType,
    quote_amount: quote?.data.options?.[0]?.customerPrice || 0,
    months_since_service: customer.data.lastServiceAt
      ? (Date.now() - Date.parse(customer.data.lastServiceAt)) /
        (30.4375 * 86400000)
      : null,
  };
  return {
    customer,
    contact,
    quote,
    invoice,
    job,
    prefs,
    config,
    fields,
    rules,
  };
}
export function allowed(
  ctx: Awaited<ReturnType<typeof context>>,
  channel: string,
  category: string,
) {
  if (channel === "sms")
    return (
      !ctx.prefs.sms_stopped &&
      !!ctx.prefs[
        category === "marketing" ? "sms_marketing" : "sms_transactional"
      ]
    );
  return (
    !ctx.prefs.email_suppressed &&
    ctx.prefs[
      category === "marketing" ? "email_marketing" : "email_transactional"
    ] !== false &&
    (category !== "marketing" || ctx.prefs.email_marketing === true)
  );
}
export async function queueMessage(
  ref: Row,
  channel: "email" | "sms",
  template: Row,
  key: string,
  reason: string,
  actor?: string,
  run?: string,
) {
  const old = await result(
    db().from("communications").select("*").eq("dedupe_key", key).maybeSingle(),
  );
  if (old) return old;
  const ctx = await context(ref);
  let recipient = "",
    error = "";
  if (template.body.includes("{{review_link}}") && !ctx.config.review_url)
    error =
      "Add your Google review link in Integrations before sending review requests.";
  try {
    recipient =
      channel === "email" ? email(ctx.contact.email) : phone(ctx.contact.phone);
    if (!allowed(ctx, channel, template.category))
      throw new Error(
        "Customer communication preferences do not allow this message.",
      );
  } catch (e: any) {
    error = e.message;
  }
  const values: Row = { ...ctx.fields };
  if (ctx.quote) values.quote_link = await linkFor(ctx.quote, "quote");
  if (ctx.invoice) values.payment_link = await linkFor(ctx.invoice, "invoice");
  // Marketing unsubscribe uses a signed capability, never a customer ID exposed as authorization.
  if (template.category === "marketing")
    values.unsubscribe_link = unsubscribeUrl(ref.customer_id, ref.company_id);
  let body = merge(template.body, values);
  if (template.category === "marketing")
    body += `\n\nUnsubscribe: ${values.unsubscribe_link}`;
  if (channel === "sms") body += "\nReply STOP to stop texts.";
  const message = {
    template_snapshot: { body: template.body, subject: template.subject },
    merge_values: values,
    company_id: ref.company_id,
    customer_id: ref.customer_id,
    quote_id: ref.quote_id || null,
    invoice_id: ref.invoice_id || null,
    job_id: ref.job_id || null,
    channel,
    category: template.category,
    recipient,
    subject: merge(template.subject || "", values),
    body,
    template_id: template.id || null,
    automation_run_id: run || null,
    dedupe_key: key,
    reason,
    actor_id: actor || null,
    status: error ? "failed" : "pending",
    error: error || null,
  };
  const created = await result(
    db()
      .from("communications")
      .upsert(message, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select(),
  );
  await event(
    {
      company_id: ref.company_id,
      customer_id: ref.customer_id,
      quote_id: ref.quote_id || null,
      invoice_id: ref.invoice_id || null,
      job_id: ref.job_id || null,
      channel,
      status: message.status,
    },
    error ? "communication.failed" : "communication.queued",
    { reason, message_id: created?.[0]?.id, error },
    "message-queued:" + key,
  );
  return (
    created?.[0] ||
    (await result(
      db().from("communications").select("*").eq("dedupe_key", key).single(),
    ))
  );
}
import { createHmac, timingSafeEqual } from "node:crypto";
export function unsubscribeUrl(customer: string, company: string) {
  const secret = process.env.COMMUNICATION_SIGNING_SECRET;
  if (!secret)
    throw new Error("Marketing unsubscribe signing is not configured.");
  const data = Buffer.from(JSON.stringify({ customer, company })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${origin()}/#/unsubscribe/${data}.${signature}`;
}
export function readUnsubscribe(token: string) {
  const [data, signature] = token.split(".");
  const secret = process.env.COMMUNICATION_SIGNING_SECRET;
  if (!secret || !data || !signature)
    throw new Error("Invalid unsubscribe link.");
  const expected = createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  )
    throw new Error("Invalid unsubscribe link.");
  return JSON.parse(Buffer.from(data, "base64url").toString());
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function html(body: string, name: string) {
  const content = escapeHtml(body)
    .replace(
      /https:\/\/[^\s<]+/g,
      (url) => `<a href="${url}" style="color:#0369a1">${url}</a>`,
    )
    .replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,sans-serif;background:#f0f9ff;padding:24px"><div style="max-width:600px;margin:auto;background:white;padding:28px;border-radius:12px"><h2 style="color:#075985">${escapeHtml(name)}</h2><div style="font-size:16px;line-height:1.6">${content}</div><hr><p style="color:#64748b">Air King Mechanical Services LLC · Lathrop, Missouri</p></div></div>`;
}
async function stopReason(msg: Row, ctx: Awaited<ReturnType<typeof context>>) {
  if (!allowed(ctx, msg.channel, msg.category))
    return "Customer opted out or consent is missing.";
  if (msg.automation_run_id) {
    const run = await entity(
      "automation_runs",
      msg.automation_run_id,
      msg.company_id,
    );
    const a = await entity("automations", run.automation_id, msg.company_id);
    if (!a.enabled) return "Automation is turned off.";
    const step = a.steps[run.step_index];
    if (!step) return "Automation step was removed.";
    if (
      !conditionsPass([...a.conditions, ...step.conditions], ctx.rules) ||
      (a.stop_conditions.length && conditionsPass(a.stop_conditions, ctx.rules))
    )
      return "Automation conditions changed.";
    if (
      a.trigger.startsWith("quote.") &&
      !["quote.accepted", "quote.declined"].includes(a.trigger) &&
      ctx.quote &&
      shouldStop("quote", ctx.quote.data)
    )
      return "Quote is closed.";
    if (
      a.trigger.startsWith("invoice.") &&
      a.trigger !== "invoice.paid" &&
      ctx.invoice &&
      shouldStop("invoice", ctx.invoice.data)
    )
      return "Invoice no longer needs a reminder.";
  }
  return null;
}
export async function deliver(
  msg: Row,
  transport?: (message: Row) => Promise<string>,
) {
  let ctx;
  try {
    ctx = await context(msg);
  } catch {
    await result(
      db()
        .from("communications")
        .update({
          status: "cancelled",
          error: "Related record is unavailable.",
        })
        .eq("id", msg.id)
        .eq("status", "pending"),
    );
    return;
  }
  if (!ctx.config.sending_enabled) return;
  const stop = await stopReason(msg, ctx);
  if (stop) {
    await result(
      db()
        .from("communications")
        .update({ status: "cancelled", error: stop })
        .eq("id", msg.id)
        .eq("status", "pending"),
    );
    return;
  }
  if (msg.channel === "sms") {
    const now = new Date();
    const next = nextWindow(
      now,
      ctx.config.timezone,
      ctx.config.sms_start,
      ctx.config.sms_end,
    );
    if (next.getTime() > now.getTime()) {
      await result(
        db()
          .from("communications")
          .update({ scheduled_at: next.toISOString() })
          .eq("id", msg.id)
          .eq("status", "pending"),
      );
      return;
    }
    if (
      !transport &&
      (!process.env.TWILIO_ACCOUNT_SID ||
        !process.env.TWILIO_AUTH_TOKEN ||
        !process.env.TWILIO_MESSAGING_SERVICE_SID)
    )
      return;
  } else if (
    !transport &&
    (!process.env.RESEND_API_KEY || !ctx.config.sender_email)
  )
    return;
  const claimed = await result(db().rpc("crm_claim_message", { p_id: msg.id }));
  if (!claimed?.[0]) return;
  msg = claimed[0];
  let attempted = false;
  try {
    // Re-read after claiming; acceptance, payment, toggles and opt-outs win over queued messages.
    ctx = await context(msg);
    const finalStop = await stopReason(msg, ctx);
    if (finalStop || !ctx.config.sending_enabled) {
      await result(
        db()
          .from("communications")
          .update({
            status: "cancelled",
            error: finalStop || "Sending disabled.",
          })
          .eq("id", msg.id)
          .eq("claim_token", msg.claim_token),
      );
      return;
    }
    const latestValues: Row = {
      ...msg.merge_values,
      ...ctx.fields,
      receipt_amount:
        msg.merge_values?.receipt_amount || ctx.fields.receipt_amount,
    };
    if (ctx.quote) latestValues.quote_link = await linkFor(ctx.quote, "quote");
    if (ctx.invoice)
      latestValues.payment_link = await linkFor(ctx.invoice, "invoice");
    if (msg.template_snapshot) {
      msg.body = merge(msg.template_snapshot.body, latestValues);
      msg.subject = merge(msg.template_snapshot.subject || "", latestValues);
      if (msg.category === "marketing")
        msg.body += "\n\nUnsubscribe: " + latestValues.unsubscribe_link;
      if (msg.channel === "sms") msg.body += "\nReply STOP to stop texts.";
      await result(
        db()
          .from("communications")
          .update({
            body: msg.body,
            subject: msg.subject,
            merge_values: latestValues,
          })
          .eq("id", msg.id)
          .eq("claim_token", msg.claim_token),
      );
    }
    let providerId: string;
    attempted = true;
    if (transport) {
      providerId = await transport(msg);
    } else if (msg.channel === "sms") {
      const response = await twilio(
        process.env.TWILIO_ACCOUNT_SID!,
        process.env.TWILIO_AUTH_TOKEN!,
        { timeout: 15000, autoRetry: false },
      ).messages.create({
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: msg.recipient,
        body: msg.body,
        statusCallback: `${origin()}/api/webhooks/twilio/status`,
      });
      providerId = response.sid;
    } else {
      const response = await new Resend(
        process.env.RESEND_API_KEY!,
      ).emails.send(
        {
          from: `${ctx.config.sender_name} <${ctx.config.sender_email}>`,
          ...(ctx.config.reply_to_email
            ? { replyTo: ctx.config.reply_to_email }
            : {}),
          to: msg.recipient,
          subject: msg.subject || "Air King Mechanical Services",
          text: msg.body,
          html: html(msg.body, ctx.config.sender_name),
        },
        { idempotencyKey: msg.id },
      );
      if (response.error)
        throw Object.assign(new Error(response.error.message), {
          status:
            response.error.name === "rate_limit_exceeded"
              ? 429
              : response.error.statusCode || undefined,
        });
      providerId = response.data!.id;
    }
    await result(
      db()
        .from("communications")
        .update({
          status: "sent",
          provider_id: providerId,
          provider_status: "accepted",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", msg.id)
        .eq("claim_token", msg.claim_token),
    );
    await event(
      {
        company_id: msg.company_id,
        customer_id: msg.customer_id,
        quote_id: msg.quote_id,
        invoice_id: msg.invoice_id,
        job_id: msg.job_id,
        channel: msg.channel,
        status: "sent",
      },
      "communication.sent",
      {
        message_id: msg.id,
        reason: msg.reason,
        automation_run_id: msg.automation_run_id,
      },
      "sent:" + msg.id,
    );
    if (msg.reason === "document_delivery")
      await result(
        db().rpc("crm_document_lifecycle", {
          p_kind: msg.quote_id ? "quote" : "invoice",
          p_id: msg.quote_id || msg.invoice_id,
          p_company: msg.company_id,
          p_action: "sent",
        }),
      );
  } catch (e: any) {
    // A timeout or crash can happen after provider acceptance. Hold for review, never auto-resend it.
    const rateLimited = e.status === 429;
    const rejected = e.status >= 400 && e.status < 500;
    const status =
      rateLimited && msg.attempts < 4
        ? "pending"
        : rejected || !attempted
          ? "failed"
          : "unknown";
    await result(
      db()
        .from("communications")
        .update({
          status,
          error:
            status === "unknown"
              ? "Delivery could not be confirmed. Check the provider before resending."
              : String(e.message).slice(0, 300),
          scheduled_at: new Date(
            Date.now() + Math.pow(2, msg.attempts) * 60000,
          ).toISOString(),
        })
        .eq("id", msg.id)
        .eq("claim_token", msg.claim_token),
    );
    await event(
      {
        company_id: msg.company_id,
        customer_id: msg.customer_id,
        channel: msg.channel,
        status,
      },
      "communication.failed",
      { message_id: msg.id, reason: msg.reason },
      "failure:" + msg.id + ":" + msg.attempts,
    );
  }
}
