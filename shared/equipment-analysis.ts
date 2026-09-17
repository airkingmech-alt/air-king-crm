import { z } from "zod";
export const equipmentFields = ["manufacturer","model","serial","equipmentType","capacity","manufactureYear","efficiency","refrigerant"] as const;
export const equipmentReading = z.object({ value: z.string().max(300).nullable(), confidence: z.enum(["high","medium","low","unknown"]), evidence: z.string().max(500) });
export const analysisSchema = z.object({ fields: z.object(Object.fromEntries(equipmentFields.map(key => [key,equipmentReading])) as Record<typeof equipmentFields[number], typeof equipmentReading>), note:z.string().max(2000) });
export const confirmedEquipment = z.object({
  brand:z.string().trim().max(200),model:z.string().trim().max(200),serial:z.string().trim().max(200),
  type:z.enum(["AC","Coil","Furnace","Air Handler","Heat Pump","Mini-Split","Package Unit"]),
  capacity:z.string().trim().max(200),efficiency:z.string().trim().max(200),refrigerant:z.string().trim().max(100),
  manufactureYear:z.number().int().min(1900).max(new Date().getUTCFullYear()).nullable(),
  notes:z.string().max(2000),
});
