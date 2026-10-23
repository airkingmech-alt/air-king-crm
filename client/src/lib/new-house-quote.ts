import type { BuilderLine, Project } from "@/components/new-house/new-house-builder";
import { pricebook } from "@/data/pricebook";
import type { QuoteDraftInput } from "./quote-pricing";

export interface NewHouseSnapshot {
  version: 1;
  sourceQuoteId?: string;
  sourceCommit: "6338e3262dc96a7d0a7d7af547b5f5309e834535";
  propertyId: string;
  state: Record<string, unknown>;
  lines: BuilderLine[];
}

export function newHouseQuoteInput(customer: {id:string;name:string}, propertyId:string, project:Project, lines:BuilderLine[], state:Record<string,unknown>): QuoteDraftInput {
  const finite=(value:unknown):boolean=>typeof value==="number"?Number.isFinite(value):Array.isArray(value)?value.every(finite):value!==null&&typeof value==="object"?Object.values(value).every(finite):true;
  if(!finite(state))throw new Error("Review the sizing inputs. Every number must be finite.");
  if (!customer.id || !propertyId || !project.address.trim() || !project.projectName.trim()) throw new Error("Select a CRM customer and service property and enter a project name.");
  if (!lines.length || lines.length>500 || lines.some(line=>!Number.isFinite(line.qty)||!Number.isFinite(line.cost)||line.qty<0||line.cost<0||line.qty>100000||line.cost>1000000)) throw new Error("Review all quantities and costs. They must be finite, non-negative amounts.");
  let equipmentCost=0, materialsCost=0, laborCost=0;
  const equipmentItems:string[]=[];
  for (const line of lines) {
    if (line.category==="Equipment") {
      const item=pricebook.find(item=>item.id===line.equipmentId);
      if (!item || line.cost!==item.cost || !Number.isInteger(line.qty) || line.qty<1 || line.qty>50) throw new Error("Equipment must match the current CRM pricebook. Remove and reselect the item.");
      equipmentItems.push(...Array.from({length:line.qty},()=>item.id));
      equipmentCost+=line.qty*line.cost;
    } else if (line.category==="Materials") materialsCost+=line.qty*line.cost;
    else if (line.category==="Labor" || line.category==="Other Costs") laborCost+=line.qty*line.cost;
    else throw new Error("Unknown cost category. Review the takeoff before saving.");
  }
  if (equipmentItems.length<2) throw new Error("Select at least two major equipment items.");
  const newHouseSnapshot:NewHouseSnapshot={version:1,sourceCommit:"6338e3262dc96a7d0a7d7af547b5f5309e834535",propertyId,state:JSON.parse(JSON.stringify(state)),lines:lines.map(line=>({...line}))};
  if (JSON.stringify(newHouseSnapshot).length>100000) throw new Error("The takeoff is too large to save. Shorten the job notes.");
  return {customerId:customer.id,customerName:customer.name,jobType:"New Construction",title:project.projectName.trim(),equipmentItems,equipmentCost,materialsCost,laborCost,
    laborDescription: "New construction HVAC installation at " + project.address + ". Install heating/cooling equipment, ductwork, controls and air distribution per the agreed project scope.",newHouseSnapshot};
}
