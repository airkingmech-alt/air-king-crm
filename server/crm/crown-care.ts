import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller,db,result,entity,hash } from "./core";
import { crownConfiguration,renewalFrom,type CrownConfiguration } from "../../shared/crown-care";
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  res.set("Cache-Control","no-store");
  try{await fn(req,res);}catch(e:any){res.status(e.status || 400).json({error:e instanceof z.ZodError?e.issues[0]?.message || "Check the membership fields.":e.message});}
};
async function access(req:Request){
  const user=await caller(req);
  const profile=await result(db().from("profiles").select("permissions").eq("id",user.id).single());
  if(user.role!=="owner" && profile.permissions?.memberships===false)throw fail("Crown Care access is disabled. Ask the owner.",403);
  return user;
}
function validatedConfiguration(configuration:CrownConfiguration,customer:any){
  const properties=customer.data.properties || [];
  for(const equipment of configuration.coveredEquipment){
    const property=properties.find((p:any)=>p.id===equipment.propertyId);
    if(equipment.propertyId&&!property)throw fail("Choose a property belonging to this customer.");
    if(equipment.systemId && (!property || !property.systems?.some((s:any)=>s.id===equipment.systemId)))throw fail("The selected equipment does not belong to this customer property.");
    if(equipment.systemId && equipment.quantity!==1)throw fail("Saved equipment is one unit. Add additional units separately.");
  }
  return {...configuration,pricing:{...configuration.pricing,totalAmountCents:configuration.pricing.baseAmountCents+configuration.pricing.adjustmentCents,currency:"usd"},
    systemDescription:configuration.coveredEquipment.map(e=>`${e.quantity} × ${e.type}${e.description?" — "+e.description:""}`).join("; "),
    systemId:configuration.coveredEquipment[0].systemId || "",
    propertyAddress:Array.from(new Set(configuration.coveredEquipment.map(e=>properties.find((p:any)=>p.id===e.propertyId)).filter(Boolean).map((p:any)=>[p.address,p.city,p.state,p.zip].filter(Boolean).join(", ")))).join("; ")};
}
export function registerCrownCare(app:Express){
  app.get("/api/crm/memberships/:id",wrap(async(req,res)=>{
    const user=await access(req),row=await entity("memberships",String(req.params.id),user.company);
    res.json({membership:row.data,version:row.updated_at});
  }));
  app.post("/api/crm/memberships",wrap(async(req,res)=>{
    const user=await access(req),key=z.string().uuid().parse(req.headers["idempotency-key"]);
    const input=z.object({customerId:z.string().min(1),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),autoRenew:z.boolean(),configuration:crownConfiguration}).strict().parse(req.body);
    const renewalDate=renewalFrom(input.startDate),customer=await entity("customers",input.customerId,user.company);
    const config=validatedConfiguration(input.configuration,customer),requestHash=hash(JSON.stringify(input)),id="CC-"+key;
    const data={...config,id,customerId:customer.id,customerName:customer.data.name,startDate:input.startDate,renewalDate,autoRenew:input.autoRenew,
      status:"Active",paymentStatus:"Pending",visitsUsed:0,springVisit:{status:"Unscheduled"},fallVisit:{status:"Unscheduled"},requestHash,
      configurationHistory:[{at:new Date().toISOString(),actorId:user.id,requestKey:key,before:null,after:config}]};
    const saved=await db().from("memberships").insert({id,company_id:user.company,customer_id:customer.id,data}).select("data").single();
    if(saved.error){
      if(saved.error.code!=="23505")throw fail("Could not save the membership. Try again.");
      const prior=await entity("memberships",id,user.company);
      if(prior.data.requestHash!==requestHash)throw fail("This enrollment was already saved with different details. Refresh before creating another.",409);
      return res.json({membership:prior.data});
    }
    res.json({membership:saved.data.data});
  }));
  app.patch("/api/crm/memberships/:id",wrap(async(req,res)=>{
    const user=await access(req),key=z.string().uuid().parse(req.headers["idempotency-key"]);
    const input=z.object({version:z.string().min(1),configuration:crownConfiguration}).strict().parse(req.body);
    const row=await entity("memberships",String(req.params.id),user.company);
    const requestHash=hash(JSON.stringify(input));
    const prior=(row.data.configurationHistory || []).find((h:any)=>h.requestKey===key);
    if(prior){if(prior.requestHash!==requestHash)throw fail("Save reference was reused. Reopen the membership and try again.",409);return res.json({membership:row.data,version:row.updated_at});}
    if(row.updated_at!==input.version)throw fail("Someone changed this membership. Reopen it to review the latest details.",409);
    if(input.configuration.visitsIncluded<Number(row.data.visitsUsed || 0))throw fail("Included visits cannot be fewer than the visits already used.");
    if(row.data.stripeSubscriptionId || row.data.stripe_subscription_id)throw fail("This membership has linked billing. Its pricing must be updated through the billing workflow.",409);
    const customer=await entity("customers",row.customer_id,user.company),config=validatedConfiguration(input.configuration,customer);
    if(!config.propertyAddress)config.propertyAddress=row.data.propertyAddress || "";
    const data={...row.data,...config,configurationHistory:[...(row.data.configurationHistory || []),{at:new Date().toISOString(),actorId:user.id,requestKey:key,requestHash,before:{coveredEquipment:row.data.coveredEquipment,pricing:row.data.pricing,notes:row.data.notes,billingFrequency:row.data.billingFrequency,visitsIncluded:row.data.visitsIncluded,systemDescription:row.data.systemDescription},after:config}]};
    const saved=await result(db().from("memberships").update({data}).eq("id",row.id).eq("company_id",user.company).eq("updated_at",input.version).select("data,updated_at").maybeSingle());
    if(!saved)throw fail("Someone changed this membership. Reopen it and try again.",409);
    res.json({membership:saved.data,version:saved.updated_at});
  }));
}
