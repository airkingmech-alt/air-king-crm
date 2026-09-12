import { processCallbacks } from "./callbacks";
import {
  db,
  result,
  entity,
  event,
  conditionsPass,
  shouldStop,
  settings,
  type Row,
} from "./core";
import { context, queueMessage, deliver } from "./delivery";
import { bodies } from "./catalog";
import { processMarketingRuns } from "./marketing";

async function processRun(run: Row) {
  const save = (data: Row) =>
    result(
      db()
        .from("automation_runs")
        .update({
          ...data,
          updated_at: new Date().toISOString(),
          lease_until: null,
        })
        .eq("id", run.id)
        .eq("claim_token", run.claim_token),
    );
  try {
    const automation = await entity(
      "automations",
      run.automation_id,
      run.company_id,
    );
    const source = await entity(
      "communication_events",
      run.event_id,
      run.company_id,
    );
    if (!automation.enabled) {
      await save({ status: "stopped", error: "Automation was turned off." });
      return;
    }
    const ctx = await context(source);
    const step = automation.steps[run.step_index];
    if (!step) {
      await save({ status: "completed" });
      return;
    }
    const closed =
      (automation.trigger.startsWith("quote.") &&
        !["quote.accepted", "quote.declined"].includes(automation.trigger) &&
        ctx.quote &&
        shouldStop("quote", ctx.quote.data)) ||
      (automation.trigger.startsWith("invoice.") &&
        automation.trigger !== "invoice.paid" &&
        ctx.invoice &&
        shouldStop("invoice", ctx.invoice.data));
    if (
      closed ||
      !conditionsPass(
        [...automation.conditions, ...step.conditions],
        ctx.rules,
      ) ||
      (automation.stop_conditions.length &&
        conditionsPass(automation.stop_conditions, ctx.rules)) ||
      step.action === "stop"
    ) {
      await save({ status: "stopped", error: "Stop condition reached." });
      return;
    }
    if (step.action === "activity")
      await event(
        {
          company_id: run.company_id,
          customer_id: source.customer_id,
          quote_id: source.quote_id,
          invoice_id: source.invoice_id,
          job_id: source.job_id,
          coupon_id: source.coupon_id,
        },
        "automation.activity",
        {
          message: step.message || automation.name,
          automation_id: automation.id,
        },
        `run:${run.id}:${run.step_index}`,
      );
    if (["email", "sms"].includes(step.action)) {
      const template = await entity(
        "message_templates",
        step.template_id,
        run.company_id,
      );
      if (
        !template.active ||
        template.archived ||
        template.channel !== step.action
      )
        throw new Error(
          "The message template is unavailable or has the wrong channel.",
        );
      const message = await queueMessage(
        source,
        step.action,
        template,
        automation.trigger === "payment.received"
          ? "receipt:" + source.metadata.payment_id
          : `run:${run.id}:${run.step_index}`,
        "automation:" + automation.name,
        undefined,
        run.id,
      );
      if (["pending", "sending"].includes(message.status)) {
        await save({
          status: "waiting",
          next_at: new Date(Date.now() + 60000).toISOString(),
        });
        return;
      }
      if (!["sent", "delivered"].includes(message.status)) {
        await save({
          status: message.status === "cancelled" ? "stopped" : "failed",
          error: message.error || "Message could not be sent.",
        });
        return;
      }
    }
    const index = run.step_index + 1;
    const next = automation.steps[index];
    await save({
      step_index: index,
      status: next ? "waiting" : "completed",
      next_at: new Date(
        Date.now() + (next?.wait_minutes || 0) * 60000,
      ).toISOString(),
    });
  } catch (e: any) {
    await save({ status: "failed", error: String(e.message).slice(0, 300) });
  }
}
async function scanDates() {
  // Bounded pagination: no silent 1,000-row cap. Keys make repeated scans harmless.
  for (const table of ["invoices", "work_orders", "customers"]) {
    for (let offset = 0; ; offset += 500) {
      const rows: Row[] = await result(
        db()
          .from(table)
          .select("*")
          .order("id")
          .range(offset, offset + 499),
      );
      for (const row of rows) {
        const d = row.data;
        const base = {
          company_id: row.company_id,
          customer_id: table === "customers" ? row.id : row.customer_id,
        };
        if (
          table === "invoices" &&
          !["Draft", "Paid", "Void"].includes(d.status) &&
          Number(d.amount) > Number(d.paidAmount)
        ) {
          const config = await context({ ...base, invoice_id: row.id });
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: config.config.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
          if (d.dueDate && d.dueDate <= today)
            await event(
              { ...base, invoice_id: row.id },
              "invoice.due",
              {},
              "due:" + row.id + ":" + d.dueDate,
            );
          if (d.dueDate && d.dueDate < today)
            await event(
              { ...base, invoice_id: row.id },
              "invoice.overdue",
              {},
              "overdue:" + row.id + ":" + d.dueDate,
            );
        }
        if (
          table === "work_orders" &&
          d.status === "Scheduled" &&
          (d.scheduledAt || (d.scheduledDate && d.scheduledTime))
        ) {
          const config = await settings(row.company_id);
          const scheduledAt =
            d.scheduledAt ||
            localAppointment(d.scheduledDate, d.scheduledTime, config.timezone);
          if (!scheduledAt) continue;
          const hours = (Date.parse(scheduledAt) - Date.now()) / 3600000;
          for (const threshold of [24, 2])
            if (hours > 0 && hours <= threshold)
              await event(
                { ...base, job_id: row.id },
                "appointment.upcoming",
                { hours_before: threshold },
                `appointment:${row.id}:${scheduledAt}:${threshold}`,
              );
        }
        if (table === "customers") {
          if (
            d.lastServiceAt &&
            Date.now() - Date.parse(d.lastServiceAt) >= 365 * 86400000
          )
            await event(
              base,
              "customer.inactive",
              {},
              "inactive:" + row.id + ":" + d.lastServiceAt,
            );
          for (const prop of d.properties || [])
            for (const system of prop.systems || []) {
              if (
                system.maintenanceDueAt &&
                Date.parse(system.maintenanceDueAt) <= Date.now()
              )
                await event(
                  base,
                  "equipment.maintenance_due",
                  { system_id: system.id },
                  `maintenance:${row.id}:${system.id}:${system.maintenanceDueAt}`,
                );
              if (
                system.replacementFollowUpAt &&
                Date.parse(system.replacementFollowUpAt) <= Date.now()
              )
                await event(
                  base,
                  "equipment.replacement_due",
                  { system_id: system.id },
                  `replacement:${row.id}:${system.id}:${system.replacementFollowUpAt}`,
                );
            }
        }
      }
      if (rows.length < 500) break;
    }
  }
}
async function queueReceipts() {
  const events: Row[] = await result(
    db()
      .from("communication_events")
      .select("*")
      .eq("event_type", "payment.received")
      .is("metadata->>receipt_queued", null)
      .order("created_at", { ascending: false })
      .limit(100),
  );
  for (const source of events) {
    // Mandatory transactional receipt shares the outbox with the optional receipt starter.
    const key = "receipt:" + source.metadata.payment_id;
    const saved = await result(
      db()
        .from("message_templates")
        .select("*")
        .eq("company_id", source.company_id)
        .eq("purpose", "receipt")
        .eq("channel", "email")
        .eq("active", true)
        .eq("archived", false)
        .limit(1),
    );
    await queueMessage(
      source,
      "email",
      saved[0] || {
        channel: "email",
        category: "transactional",
        subject: "Thank you for your payment",
        body: bodies.receipt,
      },
      key,
      "payment_receipt",
    );
    await result(
      db()
        .from("communication_events")
        .update({ metadata: { ...source.metadata, receipt_queued: true } })
        .eq("id", source.id),
    );
  }
}
export async function tick() {
  // Stale sending rows are ambiguous; never release them into the send queue.
  await result(
    db()
      .from("communications")
      .update({
        status: "unknown",
        error: "Delivery interrupted. Check provider history before resending.",
      })
      .eq("status", "sending")
      .lt("claimed_at", new Date(Date.now() - 5 * 60000).toISOString()),
  );
  await processCallbacks();
  await scanDates();
  await queueReceipts();
  const marketing = await processMarketingRuns();
  const runs: Row[] = await result(db().rpc("crm_claim_runs"));
  for (const run of runs) await processRun(run);
  const messages: Row[] = await result(
    db()
      .from("communications")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(50),
  );
  for (const message of messages) {
    try {
      await deliver(message);
    } catch (e: any) {
      console.error("Communication processing failed", message.id, e.message);
    }
  }
  return { checked: messages.length, runs: runs.length, marketing_runs: marketing.runs };
}

export function localAppointment(
  date: string,
  time: string,
  zone: string,
): string | null {
  const match = time.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let hour = Number(match[1]);
  if (match[3]) hour = (hour % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const target = date + "T" + String(hour).padStart(2, "0") + ":" + match[2];
  const base = Date.parse(target + ":00Z");
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const at = new Date(base + offset * 60000);
    if (fmt.format(at).replace(" ", "T") === target) return at.toISOString();
  }
  return null;
}
