import { z } from "zod";
import { email, phone, type Row } from "./core";

export const conditionSchema = z.object({
  field: z.enum(["customer_type", "lead_source", "lead_status", "city", "zip", "tag", "has_email", "has_phone", "last_service_months", "equipment_type", "equipment_brand", "equipment_age", "quote_status", "invoice_status", "membership_status", "has_upcoming_job", "lifetime_revenue"]),
  op: z.enum(["eq", "neq", "contains", "gt", "lt", "exists"]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
}).refine(c => c.op === "exists" || c.value !== undefined, "A condition value is required.");

export function contacts(customer: Row) {
  const list = customer.data?.contacts || [];
  const primary = list.find((x: Row) => x.role === "Primary") || list[0] || {};
  return { email: String(primary.email || "").trim().toLowerCase(), phone: String(primary.phone || "").trim() };
}
export function destination(customer: Row, channel: string) {
  const contact = contacts(customer);
  return channel === "email" ? email(contact.email).toLowerCase() : phone(contact.phone);
}
export function match(actual: unknown, c: Row): boolean {
  const present = actual !== undefined && actual !== null && actual !== "" && (!Array.isArray(actual) || actual.length > 0);
  if (c.op === "exists") return present === (c.value !== false);
  if (!present) return false; // Unknown age/service history is not zero or a negative match.
  if (c.op === "gt" || c.op === "lt") {
    if (typeof actual === "boolean" || Array.isArray(actual) || c.value === "") return false;
    const a = Number(actual), b = Number(c.value);
    return Number.isFinite(a) && Number.isFinite(b) && (c.op === "gt" ? a > b : a < b);
  }
  const values = (Array.isArray(actual) ? actual : [actual]).map(x => String(x).toLowerCase());
  const expected = String(c.value ?? "").toLowerCase();
  if (c.op === "contains") return !!expected && values.some(x => x.includes(expected));
  const equal = values.includes(expected);
  return c.op === "neq" ? !equal : equal;
}
export function valueFor(field: string, customer: Row, related: Row, now = Date.now()): unknown {
  const data = customer.data || {}, contact = contacts(customer);
  const equipment: Row[] = (data.properties || []).flatMap((p: Row) => p.systems || []);
  const latest = (rows: Row[] = []) => [...rows].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const ages = equipment.map(x => x.installDate ? (now - Date.parse(x.installDate)) / 31557600000 : x.age === undefined ? NaN : Number(x.age)).filter(x => Number.isFinite(x) && x >= 0);
  const serviceDates = [data.lastServiceAt, ...(related.jobs || []).filter((x:Row) => x.data?.status === "Completed").map((x:Row) => x.data.completedAt || x.data.completedDate || x.data.scheduledDate)].map(x => Date.parse(x)).filter(x => Number.isFinite(x) && x <= now);
  switch (field) {
    case "customer_type": return data.type;
    case "lead_source": return data.leadSource;
    case "lead_status": return data.leadStatus;
    case "city": return (data.properties || []).map((x:Row) => x.city).concat(data.city || []).filter(Boolean);
    case "zip": return (data.properties || []).map((x:Row) => x.zip).concat(data.zip || []).filter(Boolean);
    case "tag": return data.tags || [];
    case "has_email": return !!contact.email;
    case "has_phone": return !!contact.phone;
    case "last_service_months": return serviceDates.length ? (now - Math.max(...serviceDates)) / 2629800000 : null;
    case "equipment_type": return equipment.map(x => x.type || x.systemType || x.name).filter(Boolean);
    case "equipment_brand": return equipment.map(x => x.brand).filter(Boolean);
    case "equipment_age": return ages.length ? Math.max(...ages) : null;
    case "quote_status": return latest(related.quotes)?.data?.status;
    case "invoice_status": return latest(related.invoices)?.data?.status;
    case "membership_status": return latest(related.memberships)?.data?.status;
    case "has_upcoming_job": return (related.jobs || []).some((x:Row) => ["Scheduled", "Dispatched", "In Progress"].includes(x.data?.status));
    case "lifetime_revenue": return (related.invoices || []).reduce((n:number,x:Row) => n + Number(x.data?.paidAmount ?? (x.data?.status === "Paid" ? x.data?.amount : 0) ?? 0), 0);
  }
}
export function matchesAudience(customer: Row, related: Row, audience: Row) {
  return (audience.filters || []).every((c:Row) => match(valueFor(c.field, customer, related), c)) &&
    !(audience.exclusions || []).some((c:Row) => match(valueFor(c.field, customer, related), c));
}
