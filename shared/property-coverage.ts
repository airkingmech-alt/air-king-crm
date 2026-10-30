import type { Property, HVACSystem } from "../client/src/data/mock-data";
import { coverageTypes, type CoveredEquipment } from "./crown-care";

export function savedEquipmentCoverage(propertyId: string, system: HVACSystem, id: string): CoveredEquipment {
  return { id, propertyId, systemId: system.id, type: coverageTypes.includes(system.type) ? system.type : "Other",
    description: [system.brand, system.model, system.location].filter(Boolean).join(" · ").slice(0, 500), quantity: 1,
    filterSize: system.filterSize || "", filterQuantity: system.filterQuantity ?? 0,
    filterNotes: [system.filterNotes, system.filterQuantity == null ? "Verify filter quantity at visit" : ""].filter(Boolean).join("; ").slice(0, 500), notes: system.notes || "" };
}
export function addPropertyCoverage(current: CoveredEquipment[], property: Property, newId: () => string): CoveredEquipment[] {
  const additions = property.systems.filter(system => system.status !== "Inactive" && !current.some(item => item.propertyId === property.id && item.systemId === system.id));
  if (current.length + additions.length > 100) throw new Error("A membership can contain at most 100 equipment items.");
  return [...current, ...additions.map(system => savedEquipmentCoverage(property.id, system, newId()))];
}
export function propertyServiceDetails(property: Property): string {
  return [ [property.address, property.city, property.state, property.zip].filter(Boolean).join(", "),
    ...(property.serviceContacts || []).map(contact => [contact.role || "Service contact", contact.name, contact.phone, contact.email].filter(Boolean).join(" · ")),
    property.accessNotes ? `Access: ${property.accessNotes}` : "", property.gateCode ? `Gate code: ${property.gateCode}` : "",
  ].filter(Boolean).join("\n");
}
