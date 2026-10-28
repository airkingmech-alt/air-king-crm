import { z } from "zod";
import { confirmedEquipment } from "./equipment-analysis";

export type EquipmentDetails = z.infer<typeof confirmedEquipment>;
export const equipmentTypes = confirmedEquipment.shape.type.options;
export const manualEquipmentInput = z.object({
  customerId: z.string().min(1).max(200),
  propertyId: z.string().min(1).max(200),
  requestId: z.string().uuid(),
  systemId: z.string().min(1).max(200).optional(),
  original: confirmedEquipment.optional(),
  equipment: confirmedEquipment,
}).refine(value => !value.systemId || value.original, { message: "Original equipment details are required when editing." });

// Compare only editable fields; legacy optional fields may not exist yet.
export function equipmentDetails(system: Partial<EquipmentDetails>): EquipmentDetails {
  return {
    type: system.type || "AC", brand: (system.brand || "").trim(), model: (system.model || "").trim(), serial: (system.serial || "").trim(),
    capacity: (system.capacity || "").trim(), efficiency: (system.efficiency || "").trim(), refrigerant: (system.refrigerant || "").trim(),
    manufactureYear: system.manufactureYear ?? null, notes: system.notes || "",
  };
}
export function sameEquipment(a: Partial<EquipmentDetails>, b: Partial<EquipmentDetails>) {
  return JSON.stringify(equipmentDetails(a)) === JSON.stringify(equipmentDetails(b));
}
