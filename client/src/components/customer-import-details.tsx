import React from "react";
import { Mail, Phone } from "lucide-react";
import type { CustomerImportFields } from "../../../shared/customer-import";
import type { Contact } from "../data/mock-data";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function CustomerImportSummary({ customer }: { customer: CustomerImportFields }) {
  return <>
    {customer.companyName && <p className="mt-2 text-sm">Company: {customer.companyName}</p>}
    {customer.sourceReferences?.markate && <p className="mt-1 text-xs text-muted-foreground">
      Imported from Markate · <a className="underline" target="_blank" rel="noreferrer" href={`https://www.markate.com/pro/track/customers/preview/id/${encodeURIComponent(customer.sourceReferences.markate.customerId)}`}>Customer {customer.sourceReferences.markate.customerId}</a>
    </p>}
  </>;
}
export function CustomerBillingAddress({ customer }: { customer: CustomerImportFields }) {
  const a = customer.billingAddress;
  if (!a || !Object.values(a).some(Boolean)) return null;
  return <Card>
    <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Billing address</CardTitle></CardHeader>
    <CardContent className="text-sm space-y-1" data-testid="customer-billing-address">
      <p>{[a.street, a.unit].filter(Boolean).join(", ")}</p>
      <p>{[a.city, a.state, a.postalCode].filter(Boolean).join(", ")}</p>
    </CardContent>
  </Card>;
}
export function CustomerContactChannels({ contact }: { contact: Contact }) {
  const phones = contact.phoneNumbers?.length ? contact.phoneNumbers : contact.phone ? [{ label: "Phone", value: contact.phone }] : [];
  const emails = [contact.email, ...(contact.additionalEmails || [])].filter(Boolean);
  return <div className="flex flex-col gap-1 break-all">
    {phones.map((phone, i) => <span key={i} className="flex items-start gap-1.5"><Phone size={11} className="mt-0.5 shrink-0" />{phone.label}: {phone.value}</span>)}
    {emails.map((email, i) => <span key={i} className="flex items-start gap-1.5"><Mail size={11} className="mt-0.5 shrink-0" />{email}</span>)}
  </div>;
}
