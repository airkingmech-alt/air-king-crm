import type { CustomerRecord } from "../client/src/data/customer-record";
import type { AddressProvenance } from "./address-autocomplete";
import type { CustomerAddress } from "./customer-import";
import type { Contact, Property } from "../client/src/data/mock-data";

export interface ServiceAddressDraft {
  id: string;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  addressProvenance?: AddressProvenance;
}
export interface CustomerEditDraft {
  name: string;
  companyName: string;
  firstName: string;
  lastName: string;
  contactName: string;
  phone: string;
  email: string;
  properties: ServiceAddressDraft[];
  billingAddress: CustomerAddress;
  billingAddressProvenance?: AddressProvenance;
}
export const emptyBillingAddress = (): CustomerAddress => ({ street: "", unit: "", city: "", state: "", postalCode: "" });
export function primaryContactIndex(customer: CustomerRecord): number {
  const primary = customer.contacts.findIndex(contact => contact.role?.toLowerCase() === "primary");
  return primary >= 0 ? primary : customer.contacts.length ? 0 : -1;
}
function propertyDraft(property: Property): ServiceAddressDraft {
  // Legacy records sometimes have a unit in the combined address but no street field.
  const unit = property.unit || "";
  const combined = property.address || "";
  const street = property.street !== undefined ? property.street : unit && combined.endsWith(`, ${unit}`) ? combined.slice(0, -(unit.length + 2)) : combined;
  return { id: property.id, street, unit, city: property.city || "", state: property.state || "", zip: property.zip || "", ...(property.addressProvenance ? { addressProvenance: property.addressProvenance } : {}) };
}
export function customerEditDraft(customer: CustomerRecord): CustomerEditDraft {
  const contact = customer.contacts[primaryContactIndex(customer)];
  return {
    name: customer.name, companyName: customer.companyName || "", firstName: customer.firstName || "", lastName: customer.lastName || "",
    contactName: contact?.name || "", phone: contact?.phone || "", email: contact?.email || "",
    properties: customer.properties.map(propertyDraft),
    billingAddress: { ...emptyBillingAddress(), ...customer.billingAddress },
    ...(customer.billingAddressProvenance ? { billingAddressProvenance: customer.billingAddressProvenance } : {}),
  };
}
const clean = (value: string) => value.trim();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const hasAddress = (address: CustomerAddress) => Object.values(address).some(Boolean);
function cleanedAddress(address: CustomerAddress): CustomerAddress {
  return { street: clean(address.street), unit: clean(address.unit), city: clean(address.city), state: clean(address.state), postalCode: clean(address.postalCode) };
}
function cleanProperty(property: ServiceAddressDraft): ServiceAddressDraft {
  return { id: property.id, street: clean(property.street), unit: clean(property.unit), city: clean(property.city), state: clean(property.state), zip: clean(property.zip), ...(property.addressProvenance ? { addressProvenance: property.addressProvenance } : {}) };
}
function updatePrimaryContact(contact: Contact | undefined, draft: CustomerEditDraft): Contact {
  const updated: Contact = { ...contact,
    name: draft.contactName === contact?.name ? contact.name : clean(draft.contactName),
    phone: draft.phone === contact?.phone ? contact.phone : clean(draft.phone),
    email: draft.email === contact?.email ? contact.email : clean(draft.email),
  };
  if (contact?.phoneNumbers && updated.phone !== contact.phone) {
    const key = (value: string) => value.replace(/\D/g, "");
    const index = contact.phoneNumbers.findIndex(phone => key(phone.value) === key(contact.phone) && !!key(phone.value));
    // Keep every other labeled phone, and keep the edited number's existing label.
    updated.phoneNumbers = contact.phoneNumbers.flatMap((phone, i) => i === index ? updated.phone ? [{ ...phone, value: updated.phone }] : [] : [{ ...phone }]);
    if (index < 0 && updated.phone) updated.phoneNumbers.unshift({ label: "Phone", value: updated.phone });
  }
  if (!contact) updated.role = "Primary";
  return updated;
}

/** Applies only reviewed fields, retaining unknown metadata and untouched record sections. */
export function buildCustomerEdit(
  customer: CustomerRecord,
  input: CustomerEditDraft,
  audit: { id: string; date: string; user: string },
): CustomerRecord {
  const initial = customerEditDraft(customer);
  if (!clean(input.name)) throw new Error("Customer name is required.");
  const editableStrings = [input.name, input.companyName, input.firstName, input.lastName, input.contactName, input.phone, input.email,
    ...input.properties.flatMap(property => [property.street, property.unit, property.city, property.state, property.zip]), ...Object.values(input.billingAddress)];
  if (editableStrings.some(value => value.length > 1000)) throw new Error("Keep each field under 1,000 characters.");
  // Existing imported values may need review; unrelated edits must remain possible.
  if (input.email !== initial.email && clean(input.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(input.email))) throw new Error("Enter a valid primary email address, or leave it blank.");
  if (input.phone !== initial.phone && clean(input.phone) && (!/^\+?[\d\s().-]{7,30}$/.test(clean(input.phone)) || !/^\d{7,15}$/.test(input.phone.replace(/\D/g, "")))) throw new Error("Enter a valid primary phone number, or leave it blank.");
  const propertyIds = input.properties.map(property => property.id);
  if (new Set(propertyIds).size !== propertyIds.length || propertyIds.some(id => !id)) throw new Error("Each service address must have a unique ID.");
  if (customer.properties.some(property => !propertyIds.includes(property.id))) throw new Error("Existing service addresses cannot be removed in this editor.");
  const properties = input.properties.map(property => {
    const previous = customer.properties.find(item => item.id === property.id);
    if (previous && same(property, propertyDraft(previous))) return previous;
    const value = cleanProperty(property);
    if (!value.street) throw new Error("A street address is required for each new or changed service address.");
    return { ...previous, id: value.id, address: [value.street, value.unit].filter(Boolean).join(", "), street: value.street,
      unit: value.unit, city: value.city, state: value.state, zip: value.zip, systems: previous?.systems || [],
      ...(value.addressProvenance ? { addressProvenance: value.addressProvenance } : {}) };
  });
  const updated: CustomerRecord = { ...customer };
  const changed: string[] = [];
  for (const field of ["name", "companyName", "firstName", "lastName"] as const) {
    if (input[field] !== initial[field]) {
      updated[field] = clean(input[field]);
      if (updated[field] !== customer[field]) changed.push(field === "name" ? "customer name" : field === "companyName" ? "company name" : "contact name");
    }
  }
  const contactIndex = primaryContactIndex(customer);
  if (["contactName", "phone", "email"].some(field => input[field as keyof CustomerEditDraft] !== initial[field as keyof CustomerEditDraft])) {
    const contact = updatePrimaryContact(customer.contacts[contactIndex], input);
    if (!same(contact, customer.contacts[contactIndex])) {
      updated.contacts = contactIndex < 0 ? [contact] : customer.contacts.map((value, index) => index === contactIndex ? contact : value);
      changed.push("primary contact");
    }
  }
  if (!same(properties, customer.properties)) { updated.properties = properties; changed.push("service addresses"); }
  if (!same(input.billingAddress, initial.billingAddress)) {
    const billingAddress = cleanedAddress(input.billingAddress);
    if (hasAddress(billingAddress) && !billingAddress.street) throw new Error("Enter a billing street address, or clear all billing fields.");
    if (!same(billingAddress, initial.billingAddress)) {
      updated.billingAddress = { ...customer.billingAddress, ...billingAddress };
      changed.push("billing address");
    }
  }
  if (input.billingAddressProvenance && !same(input.billingAddressProvenance, customer.billingAddressProvenance)) {
    updated.billingAddressProvenance = input.billingAddressProvenance;
    changed.push("billing address");
  }
  if (!changed.length) return customer;
  updated.activity = [{ ...audit, type: "note", title: "Customer updated", description: `Updated ${Array.from(new Set(changed)).join(", ")}.` }, ...customer.activity];
  return updated;
}
