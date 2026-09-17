import { z } from "zod";

export const coverageTypes = ["AC", "Heat Pump", "Furnace", "Mini-Split", "Air Handler", "Coil", "Package Unit", "Boiler", "Humidifier", "Dehumidifier", "Other"] as const;
export const coverageSchema = z.object({
  id:z.string().uuid(), propertyId:z.string().max(200), systemId:z.string().max(200).optional(),
  type:z.enum(coverageTypes), description:z.string().trim().max(500), quantity:z.number().int().min(1).max(100),
  filterSize:z.string().trim().max(100), filterQuantity:z.number().int().min(0).max(100),
  filterNotes:z.string().trim().max(500), notes:z.string().trim().max(2000),
}).refine(v=>v.type!=="Other" || !!v.description,"Describe the other equipment.");
export const crownConfiguration = z.object({
  coveredEquipment:z.array(coverageSchema).min(1).max(100),
  notes:z.string().trim().max(5000), billingFrequency:z.enum(["Annual","Monthly"]),
  visitsIncluded:z.number().int().min(1).max(52),
  pricing:z.object({baseAmountCents:z.number().int().min(0).max(100_000_000),adjustmentCents:z.number().int().min(-100_000_000).max(100_000_000),adjustmentReason:z.string().trim().max(500)}),
}).superRefine((v,ctx)=>{
  if(v.pricing.baseAmountCents+v.pricing.adjustmentCents<0) ctx.addIssue({code:"custom",message:"The total price cannot be negative."});
  if(v.pricing.adjustmentCents!==0 && !v.pricing.adjustmentReason) ctx.addIssue({code:"custom",message:"Explain the price adjustment."});
  const ids=v.coveredEquipment.map(e=>e.id), links=v.coveredEquipment.filter(e=>e.systemId).map(e=>`${e.propertyId}:${e.systemId}`);
  if(new Set(ids).size!==ids.length || new Set(links).size!==links.length) ctx.addIssue({code:"custom",message:"The same equipment was selected twice."});
});
export type CrownConfiguration = z.infer<typeof crownConfiguration>;
export type CoveredEquipment = z.infer<typeof coverageSchema>;
export function membershipPriceCents(m: any):number {
  return Number.isSafeInteger(m.pricing?.totalAmountCents) && m.pricing.totalAmountCents>=0 ? m.pricing.totalAmountCents : m.billingFrequency==="Monthly"?1575:18900;
}
export function configurationFor(m:any):CrownConfiguration {
  return {coveredEquipment:m.coveredEquipment || [{id:crypto.randomUUID(),propertyId:"",type:"Other",description:m.systemDescription || "Existing coverage — confirm equipment",quantity:1,filterSize:"",filterQuantity:0,filterNotes:"",notes:""}],notes:m.notes || "",billingFrequency:m.billingFrequency || "Annual",visitsIncluded:m.visitsIncluded || 2,
    pricing:{baseAmountCents:m.pricing?.baseAmountCents ?? membershipPriceCents(m),adjustmentCents:m.pricing?.adjustmentCents ?? 0,adjustmentReason:m.pricing?.adjustmentReason || ""}};
}
export function serviceDetails(m:any):string {
  return (m.coveredEquipment || []).map((e:CoveredEquipment)=>`${e.quantity} × ${e.type}${e.description?" — "+e.description:""}${e.filterSize?`\nFilter: ${e.filterSize}${e.filterQuantity?` × ${e.filterQuantity}`:""}`:""}${e.filterNotes?"\nFilter notes: "+e.filterNotes:""}${e.notes?"\nEquipment notes: "+e.notes:""}`).concat(m.notes?["Membership notes: "+m.notes]:[]).join("\n\n");
}
export function renewalFrom(start:string) {
  const date=new Date(start+"T00:00:00Z");
  if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==start)throw new Error("Choose a valid start date.");
  const year=date.getUTCFullYear()+1,month=date.getUTCMonth(),day=Math.min(date.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);
}
