import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaField = { name?: string; values?: unknown[] };

export function secureEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyMetaSignature(rawBody: Buffer, signature: string, appSecret: string) {
  if (!signature.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return secureEqual(signature, expected);
}

function values(fields: MetaField[]) {
  const entries = fields.flatMap((field) =>
    (field.values || []).map((value) => [String(field.name || ""), String(value ?? "")] as const),
  );
  return Object.fromEntries(entries);
}

function first(data: Record<string, string>, ...names: string[]) {
  return names.map((name) => data[name]).find(Boolean) || "";
}

export function mapMetaLead(lead: Record<string, any>, context: Record<string, any> = {}) {
  const data = values(Array.isArray(lead.field_data) ? lead.field_data : []);
  const firstName = first(data, "first_name");
  const lastName = first(data, "last_name");
  const name = first(data, "full_name", "name") || [firstName, lastName].filter(Boolean).join(" ");
  const known = new Set(["full_name", "name", "first_name", "last_name", "email", "phone_number", "phone", "street_address", "address", "city", "state", "zip_code", "postal_code", "service_type", "service_needed", "message", "project_details"]);
  const custom = Object.entries(data).filter(([key, value]) => value && !known.has(key));
  const message = [
    first(data, "message", "project_details"),
    ...custom.map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`),
  ].filter(Boolean).join("\n");
  return {
    name: name || "Facebook lead",
    email: first(data, "email") || null,
    phone: first(data, "phone_number", "phone") || null,
    address: first(data, "street_address", "address") || null,
    city: first(data, "city") || null,
    state: first(data, "state") || null,
    postal_code: first(data, "zip_code", "postal_code") || null,
    service_type: first(data, "service_type", "service_needed") || "Facebook / Instagram inquiry",
    message,
    source_ref: String(lead.id || context.leadgen_id || ""),
    metadata: {
      provider: "meta",
      page_id: context.page_id || null,
      form_id: context.form_id || lead.form_id || null,
      ad_id: context.ad_id || lead.ad_id || null,
      adgroup_id: context.adgroup_id || lead.adgroup_id || null,
      campaign_id: context.campaign_id || lead.campaign_id || null,
      created_time: lead.created_time || context.created_time || null,
      field_names: Object.keys(data),
    },
  };
}
