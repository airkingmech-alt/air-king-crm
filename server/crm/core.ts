import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";
import type { Request } from "express";
export type Row = Record<string, any>;
let client: SupabaseClient | undefined;
export function db() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase server connection is not configured.");
  return (client ??= createClient(
    process.env.SUPABASE_URL || "https://vnqtoehunolxvxywrizj.supabase.co",
    key,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // Render runs Node 20, which does not provide a native WebSocket.
      // ws has Node-specific event overloads; Supabase accepts it as a transport.
      realtime: {
        transport: WebSocket as unknown as NonNullable<
          SupabaseClientOptions<"public">["realtime"]
        >["transport"],
      },
    },
  ));
}
export async function result(
  query: PromiseLike<{ data: any; error: any }>,
): Promise<any> {
  const r = await query;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function caller(req: Request, admin = false) {
  const token = req.headers.authorization?.replace(/^Bearer /i, "");
  if (!token)
    throw Object.assign(new Error("Please sign in."), { status: 401 });
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user)
    throw Object.assign(new Error("Please sign in again."), { status: 401 });
  const profile = await result(
    db().from("profiles").select("*").eq("id", data.user.id).single(),
  );
  if (
    !profile ||
    typeof profile.company_id !== "string" ||
    !profile.company_id.trim() ||
    !["owner", "admin", "technician", "dispatcher"].includes(profile.role)
  )
    throw Object.assign(new Error("Staff access required."), { status: 403 });
  if (admin && !["owner", "admin"].includes(profile.role))
    throw Object.assign(new Error("Administrator access required."), {
      status: 403,
    });
  return { id: data.user.id, company: profile.company_id, role: profile.role };
}
export async function entity(
  table: string,
  id: string,
  company?: string,
): Promise<Row> {
  let q = db().from(table).select("*").eq("id", id);
  if (company) q = q.eq("company_id", company);
  const row = await result(q.maybeSingle());
  if (!row)
    throw Object.assign(new Error("Record not found."), { status: 404 });
  return row;
}
export async function settings(company: string): Promise<Row> {
  const data = (
    await result(
      db()
        .from("crm_settings")
        .select("data")
        .eq("company_id", company)
        .single(),
    )
  ).data;
  return { reply_to_email: "", ...data };
}
export function origin() {
  const url = process.env.APP_BASE_URL || "https://air-king-crm.onrender.com";
  return url.replace(/\/$/, "");
}
export function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function linkFor(row: Row, kind: "quote" | "invoice") {
  const token = randomBytes(32).toString("base64url");
  await result(
    db()
      .from("document_links")
      .insert({
        company_id: row.company_id,
        token_hash: hash(token),
        [kind + "_id"]: row.id,
      }),
  );
  return `${origin()}/#/customer/${token}`;
}
export async function publicDocument(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw Object.assign(new Error("This link is invalid or expired."), {
      status: 404,
    });
  const link = await result(
    db()
      .from("document_links")
      .select("*")
      .eq("token_hash", hash(token))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  );
  if (!link)
    throw Object.assign(new Error("This link is invalid or expired."), {
      status: 404,
    });
  const kind = link.quote_id ? "quote" : "invoice";
  const row = await entity(kind + "s", link[kind + "_id"], link.company_id);
  return { link, kind, row };
}
export async function event(
  row: Row,
  type: string,
  metadata: Row = {},
  dedupe?: string,
) {
  const record = {
    ...row,
    event_type: type,
    metadata,
    ...(dedupe ? { dedupe_key: dedupe } : {}),
  };
  return result(
    db()
      .from("communication_events")
      .upsert(record, { onConflict: "dedupe_key", ignoreDuplicates: true }),
  );
}
export function cents(value: unknown) {
  if (!/^(\d+)(\.\d{1,2})?$/.test(String(value)))
    throw new Error("Enter a valid amount with at most two decimal places.");
  const n = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 99999999)
    throw new Error("Enter a valid payment amount.");
  return n;
}
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
export function phone(value: string) {
  const n = (value || "").replace(/\D/g, "");
  const normalized = n.length === 10 ? "+1" + n : "+" + n;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized))
    throw new Error("A valid phone number is required.");
  return normalized;
}
export function email(value: string) {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || "") ||
    value.includes("noreply@email.com")
  )
    throw new Error("A valid customer email is required.");
  return value.trim();
}
export function publicFields(kind: string, data: Row): Row {
  if (kind === "invoice")
    return {
      number: data.id,
      customerName: data.customerName,
      amount: data.amount,
      paidAmount: data.paidAmount,
      status: data.status,
      dueDate: data.dueDate,
      items: (data.items || []).map((x: Row) => ({
        description: x.description,
        amount: x.amount,
      })),
    };
  return {
    number: data.id,
    customerName: data.customerName,
    title: data.title,
    scope: data.laborDescription || data.title,
    status: data.status,
    expiresAt: data.expiresAt,
    createdAt: data.createdAt,
    jobType: data.jobType,
    selectedOption: data.selectedOption,
    selectedAddOns: data.selectedAddOns || [],
    equipmentItems: data.equipmentItems || [],
    options: (data.options || []).map((o: Row) => ({
      tier: o.tier,
      label: o.label,
      equipment: o.equipment,
      efficiency: o.efficiency,
      features: o.features,
      customerPrice: o.customerPrice,
      isPopular: o.isPopular,
    })),
  };
}
export const mergeFields = [
  "customer_first_name",
  "customer_last_name",
  "customer_name",
  "company_name",
  "quote_number",
  "quote_total",
  "quote_link",
  "invoice_number",
  "invoice_total",
  "amount_due",
  "payment_link",
  "appointment_date",
  "appointment_time",
  "job_address",
  "technician_name",
  "review_link",
  "receipt_amount",
  "coupon_code",
  "coupon_amount",
  "coupon_expires",
  "referred_customer_name",
  "unsubscribe_link",
];
export function merge(template: string, values: Row) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    if (!mergeFields.includes(key))
      throw new Error(`Unknown merge field: ${key}`);
    return String(values[key] ?? "");
  });
}
export function conditionsPass(conditions: Row[], context: Row): boolean {
  return conditions.every((c) => {
    const actual = context[c.field];
    switch (c.op) {
      case "eq":
        return String(actual) === String(c.value);
      case "gt":
        return Number(actual) > Number(c.value);
      case "lt":
        return Number(actual) < Number(c.value);
      case "exists":
        return Boolean(actual);
      default:
        return false;
    }
  });
}
export function shouldStop(kind: string, data: Row) {
  return kind === "quote"
    ? ["Won", "Lost", "Accepted", "Declined", "Expired", "Cancelled"].includes(
        data.status,
      ) ||
        (data.expiresAt && Date.parse(data.expiresAt) < Date.now())
    : kind === "invoice"
      ? data.status === "Void" ||
        Number(data.amount) - Number(data.paidAmount) <= 0
      : false;
}
export function nextWindow(
  now: Date,
  zone: string,
  start: number,
  end: number,
) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    hourCycle: "h23",
  });
  for (let i = 0; i <= 24 * 60 + 60; i++) {
    const at = new Date(now.getTime() + i * 60000);
    const hour = Number(fmt.format(at));
    if (hour >= start && hour < end) return at;
  }
  throw new Error("Invalid communication hours.");
}
