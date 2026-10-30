import { z } from "zod";
import { confirmedEquipment } from "./equipment-analysis";

export const manualEquipmentDetails = confirmedEquipment.extend({
  filterSize: z.string().trim().max(100).optional(),
  filterQuantity: z.number().int().min(0).max(100).nullable().optional(),
  filterNotes: z.string().trim().max(500).optional(),
  location: z.string().trim().max(200).optional(),
});
export type EquipmentDetails = z.infer<typeof manualEquipmentDetails>;
export const equipmentTypes = confirmedEquipment.shape.type.options;
export const manualEquipmentInput = z.object({
  customerId: z.string().min(1).max(200),
  propertyId: z.string().min(1).max(200),
  requestId: z.string().uuid(),
  systemId: z.string().min(1).max(200).optional(),
  original: manualEquipmentDetails.optional(),
  equipment: manualEquipmentDetails,
}).refine(value => !value.systemId || value.original, { message: "Original equipment details are required when editing." });

// Compare only editable fields; legacy optional fields may not exist yet.
export function equipmentDetails(system: Partial<EquipmentDetails>): EquipmentDetails {
  return {
    type: system.type || "AC", brand: (system.brand || "").trim(), model: (system.model || "").trim(), serial: (system.serial || "").trim(),
    capacity: (system.capacity || "").trim(), efficiency: (system.efficiency || "").trim(), refrigerant: (system.refrigerant || "").trim(),
    filterSize: (system.filterSize || "").trim(), filterQuantity: system.filterQuantity ?? null, filterNotes: (system.filterNotes || "").trim(), location: (system.location || "").trim(),
    manufactureYear: system.manufactureYear ?? null, notes: system.notes || "",
  };
}
export function sameEquipment(a: Partial<EquipmentDetails>, b: Partial<EquipmentDetails>) {
  return JSON.stringify(equipmentDetails(a)) === JSON.stringify(equipmentDetails(b));
}
