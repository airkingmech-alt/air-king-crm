import { z } from "zod";

const text = z.string().max(1000);
const email = text.refine(v => !v || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !/\.con$/i.test(v)), "Email needs review");
const phone = text.refine(v => !v || /^(1?\d{10})$/.test(v.replace(/\D/g, "")), "Phone needs review");
export const customerAddressSchema = z.object({ street: text, unit: text, city: text, state: text, postalCode: text }).strict();
export type CustomerAddress = z.infer<typeof customerAddressSchema>;
export interface CustomerSourceReference {
  customerId: string;
  batchId: string;
  exportSha256: string;
  exportedAt: string;
  sourceAddedOn: string;
  sourceRow: number;
  status: "Active" | "Pending";
}
export interface CustomerImportFields {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  billingAddress?: CustomerAddress;
  sourceStatus?: "Active" | "Pending";
  sourceReferences?: { markate?: CustomerSourceReference };
}
export const markateCustomerSchema = z.object({
  source: z.object({
    system: z.literal("markate"), customerId: z.string().regex(/^\d{1,20}$/),
    status: z.enum(["Active", "Pending"]), addedOn: text,
    exportedAt: z.iso.datetime(), exportSha256: z.string().regex(/^[a-f0-9]{64}$/), csvRow: z.number().int().min(2),
    typeEvidence: text.optional(), profileUrl: z.string().url().optional(),
  }).strict(),
  displayName: text.refine(v => v.trim().length > 0), firstName: text, lastName: text, companyName: text,
  type: z.enum(["Residential", "Commercial"]), email, mobile: phone, phone,
  billingAddress: customerAddressSchema,
  serviceAddresses: z.array(customerAddressSchema.extend({ sourceSlot: z.number().int().min(1).max(100) })).max(100),
  additionalContacts: z.array(z.object({
    name: text, emails: z.array(email).max(2), phones: z.array(phone).max(2), raw: text,
    unparsed: z.array(text).length(0),
  }).strict()).max(100),
}).strict();
export type MarkateCustomer = z.infer<typeof markateCustomerSchema>;
export const customerImportSchema = z.object({
  batchId: z.uuid(), expectedSnapshot: z.string().regex(/^[a-f0-9]{32}$/),
  expectedNew: z.number().int().min(0).max(1000), expectedLinks: z.number().int().min(0).max(1000),
  records: z.array(z.object({
    mode: z.enum(["create", "link"]), customerId: z.string().min(1).max(100).optional(), source: markateCustomerSchema,
  }).strict()).min(1).max(1000),
}).strict().superRefine((v, ctx) => {
  if (v.records.filter(r => r.mode === "create").length !== v.expectedNew || v.records.filter(r => r.mode === "link").length !== v.expectedLinks)
    ctx.addIssue({ code: "custom", message: "Reviewed counts do not match the request" });
  const ids = v.records.map(r => r.source.source.customerId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate source IDs" });
  if (new Set(v.records.map(r => r.source.source.exportSha256)).size !== 1)
    ctx.addIssue({ code: "custom", message: "Use one reviewed source export per batch" });
  for (const r of v.records) if (r.mode === "link" ? !r.customerId : !!r.customerId)
    ctx.addIssue({ code: "custom", message: "Only an existing link may specify a destination ID" });
});

export function sourceReference(source: MarkateCustomer, batchId: string): CustomerSourceReference {
  return { customerId: source.source.customerId, batchId, exportSha256: source.source.exportSha256,
    exportedAt: source.source.exportedAt, sourceAddedOn: source.source.addedOn,
    sourceRow: source.source.csvRow, status: source.source.status };
}
export function importedCustomer(source: MarkateCustomer, batchId: string) {
  const id = `cust-markate-${source.source.customerId}`;
  const primaryPhones = [{ label: "Mobile", value: source.mobile }, { label: "Phone", value: source.phone }].filter(p => p.value);
  return {
    id, name: source.displayName, type: source.type,
    firstName: source.firstName, lastName: source.lastName, companyName: source.companyName,
    contacts: [{ name: [source.firstName, source.lastName].filter(Boolean).join(" "), role: "Primary",
      email: source.email, phone: source.mobile || source.phone, phoneNumbers: primaryPhones },
    ...source.additionalContacts.map(c => ({ name: c.name, role: "Additional contact", email: c.emails[0] || "",
      phone: c.phones[0] || "", phoneNumbers: c.phones.map((value, i) => ({ label: i ? "Other phone" : "Phone", value })),
      sourceText: c.raw, ...(c.emails.length > 1 ? { additionalEmails: c.emails.slice(1) } : {}) }))],
    billingAddress: source.billingAddress,
    properties: source.serviceAddresses.map(a => ({
      id: `prop-markate-${source.source.customerId}-${a.sourceSlot}`, sourceSlot: a.sourceSlot,
      address: [a.street, a.unit].filter(Boolean).join(", "), street: a.street, unit: a.unit,
      city: a.city, state: a.state, zip: a.postalCode, systems: [],
    })),
    sourceStatus: source.source.status, sourceReferences: { markate: sourceReference(source, batchId) },
    leadSource: "Unknown", tags: [], activity: [], createdAt: source.source.addedOn,
    // Historical contacts have no inferred sales-lead status, consent, jobs or messages.
  };
}
export function prepareCustomerImport(input: unknown) {
  const request = customerImportSchema.parse(input);
  return { batchId: request.batchId, expectedSnapshot: request.expectedSnapshot,
    expectedNew: request.expectedNew, expectedLinks: request.expectedLinks,
    records: request.records.map(r => ({ mode: r.mode, sourceId: r.source.source.customerId,
      ...(r.customerId ? { customerId: r.customerId } : {}), customer: importedCustomer(r.source, request.batchId) })) };
}
